// ============================================================
// poll-replies — Scheduled Edge Function
// ============================================================
// Check Gmail threads for replies. Run every 5 min via cron.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('AGENCY_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    return json({ error: 'Not configured' }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find recent logs with gmail_thread_id that haven't been replied to
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: logs } = await adminClient
    .from('email_logs')
    .select('id, user_id, gmail_thread_id')
    .not('gmail_thread_id', 'is', null)
    .is('replied_at', null)
    .gte('sent_at', sevenDaysAgo)
    .limit(50);

  if (!logs?.length) return json({ ok: true, checked: 0 });

  // Group by user to batch token refresh
  const byUser = new Map<string, typeof logs>();
  for (const log of logs) {
    const arr = byUser.get(log.user_id) ?? [];
    arr.push(log);
    byUser.set(log.user_id, arr);
  }

  let repliesFound = 0;

  for (const [userId, userLogs] of byUser) {
    // Get user's refresh token
    const { data: settings } = await adminClient
      .from('agency_user_settings')
      .select('gmail_refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!settings?.gmail_refresh_token) continue;

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(settings.gmail_refresh_token, clientId, clientSecret);
    } catch {
      continue; // Skip user if token refresh fails
    }

    for (const log of userLogs) {
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${log.gmail_thread_id}?format=metadata&metadataHeaders=From`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) continue;

        const thread = await res.json() as { messages?: { id: string }[] };
        if (thread.messages && thread.messages.length > 1) {
          // Reply detected (thread has more than the original sent message)
          await adminClient
            .from('email_logs')
            .update({ replied_at: new Date().toISOString() })
            .eq('id', log.id);
          repliesFound++;
        }
      } catch {
        // Skip individual thread errors
      }
    }
  }

  return json({ ok: true, checked: logs.length, replies: repliesFound });
});
