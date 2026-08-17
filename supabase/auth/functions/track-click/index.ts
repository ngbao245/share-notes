// ============================================================
// track-click — Edge Function (public, no auth)
// ============================================================
// Log click event, redirect to target URL.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing url param', { status: 400 });
  }

  if (id) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('AGENCY_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (supabaseUrl && serviceKey) {
      const client = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Get email_log to find user_id, campaign_id, lead_id
      const { data: log } = await client
        .from('email_logs')
        .select('user_id, campaign_id, lead_id')
        .eq('id', id)
        .maybeSingle();

      if (log) {
        // Insert click event
        await client.from('click_events').insert({
          user_id: log.user_id,
          email_log_id: id,
          campaign_id: log.campaign_id,
          lead_id: log.lead_id,
          target_url: targetUrl,
        });

        // Update email_logs.clicked_at if first click
        await client
          .from('email_logs')
          .update({ clicked_at: new Date().toISOString() })
          .eq('id', id)
          .is('clicked_at', null);
      }
    }
  }

  // Redirect to target
  return new Response(null, {
    status: 302,
    headers: { Location: targetUrl },
  });
});
