// ============================================================
// gmail-oauth — Edge Function
// ============================================================
// Handles Google OAuth2 callback. Exchanges auth code for tokens.
// Stores refresh_token in agency_user_settings.
// Redirects user back to app.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('AGENCY_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const appUrl = Deno.env.get('APP_URL') ?? 'https://vudecor.vn/hubibo';

  if (!clientId || !clientSecret) {
    return json({ error: 'Google OAuth not configured' }, 500);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // user JWT token passed as state

  if (!code || !state) {
    return json({ error: 'Missing code or state' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify user from state (JWT)
  const { data: userData, error: userErr } = await adminClient.auth.getUser(state);
  if (userErr || !userData.user) {
    return json({ error: 'Invalid user token' }, 401);
  }
  const userId = userData.user.id;

  // Exchange code for tokens
  const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return json({ error: `Token exchange failed: ${err}` }, 400);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    scope: string;
  };

  if (!tokens.refresh_token) {
    return json({ error: 'No refresh_token received. User may need to re-authorize with prompt=consent.' }, 400);
  }

  // Get Gmail address from Google userinfo
  const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json() as { emailAddress?: string };
  const gmailEmail = profile.emailAddress ?? '';

  // Store in agency_user_settings
  const { error: upsertErr } = await adminClient
    .from('agency_user_settings')
    .upsert({
      user_id: userId,
      gmail_email: gmailEmail,
      gmail_refresh_token: tokens.refresh_token,
      gmail_connected: true,
    }, { onConflict: 'user_id' });

  if (upsertErr) {
    return json({ error: `Save failed: ${upsertErr.message}` }, 500);
  }

  // Redirect back to app
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: `${appUrl}/agency-studio/settings?gmail=connected`,
    },
  });
});
