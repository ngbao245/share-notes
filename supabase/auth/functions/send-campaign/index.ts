// ============================================================
// send-campaign — Edge Function (Gmail API version)
// ============================================================
// Send emails via Gmail API. Inject tracking pixel + click links.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Lead {
  id: string;
  full_name: string;
  email: string;
  company: string | null;
  phone: string | null;
  website: string | null;
}

function renderTemplate(text: string, lead: Lead): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const map: Record<string, string> = {
      first_name: lead.full_name.split(' ')[0],
      name: lead.full_name,
      email: lead.email,
      phone: lead.phone ?? '',
      company: lead.company ?? '',
      website: lead.website ?? '',
    };
    return map[key] ?? `{{${key}}}`;
  });
}

function generateToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function injectTracking(html: string, logId: string, supabaseUrl: string, appUrl: string, unsubToken: string): string {
  // Inject tracking pixel
  const pixel = `<img src="${supabaseUrl}/functions/v1/track-open?id=${logId}" width="1" height="1" style="display:none" />`;

  // Replace links with click-tracking
  const tracked = html.replace(
    /<a\s+href="([^"]+)"/g,
    (_, url: string) => `<a href="${supabaseUrl}/functions/v1/track-click?id=${logId}&url=${encodeURIComponent(url)}"`,
  );

  // Inject unsubscribe link
  const unsubLink = `${appUrl}/agency-studio/unsubscribe?token=${unsubToken}`;
  const footer = `<br><br><hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="font-size:11px;color:#999">Nếu bạn không muốn nhận email này nữa, <a href="${unsubLink}">unsubscribe tại đây</a>.</p>`;

  return tracked + pixel + footer;
}

/** Build RFC 2822 MIME message, return base64url encoded */
function buildMimeMessage(from: string, to: string, subject: string, html: string): string {
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html))),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  // Base64url encode
  return btoa(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function sendViaGmail(accessToken: string, raw: string): Promise<{ id: string; threadId: string }> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${err}`);
  }
  return res.json() as Promise<{ id: string; threadId: string }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('AGENCY_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const defaultAppUrl = Deno.env.get('APP_URL') ?? 'https://vudecor.vn/hubibo';

  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  if (!clientId || !clientSecret) return json({ error: 'Google OAuth not configured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Missing auth' }, 401);

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  let body: { campaign_id: string; lead_ids: string[]; app_url?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { campaign_id, lead_ids } = body;
  const appUrl = body.app_url || defaultAppUrl;
  if (!campaign_id || !lead_ids?.length) return json({ error: 'Missing params' }, 400);

  // Load user Gmail credentials
  const { data: userSettings } = await adminClient
    .from('agency_user_settings')
    .select('gmail_email, gmail_refresh_token, gmail_connected')
    .eq('user_id', userId)
    .maybeSingle();

  if (!userSettings?.gmail_connected || !userSettings.gmail_refresh_token) {
    return json({ error: 'Gmail not connected. Go to Agency Studio → Settings.' }, 400);
  }

  // Get access token
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(userSettings.gmail_refresh_token, clientId, clientSecret);
  } catch (err) {
    return json({ error: `Gmail auth failed: ${err instanceof Error ? err.message : 'unknown'}` }, 401);
  }

  // Load campaign
  const { data: campaign, error: campErr } = await adminClient
    .from('campaigns').select('*').eq('id', campaign_id).maybeSingle();
  if (campErr || !campaign) return json({ error: `Campaign not found: ${campaign_id}` }, 404);
  if (campaign.user_id !== userId) return json({ error: 'Forbidden' }, 403);

  const templateId = campaign.template_id;
  if (!templateId) return json({ error: 'Campaign has no template' }, 400);

  const { data: template } = await adminClient
    .from('templates').select('subject, body').eq('id', templateId).maybeSingle();
  if (!template) return json({ error: 'Template not found' }, 404);

  const { data: leads } = await adminClient
    .from('leads')
    .select('id, full_name, email, company, phone, website')
    .in('id', lead_ids)
    .eq('user_id', userId)
    .eq('unsubscribed', false);

  if (!leads?.length) return json({ error: 'No eligible leads' }, 400);

  await adminClient.from('campaigns')
    .update({ status: 'Sending', total_leads: leads.length })
    .eq('id', campaign_id);

  let sentCount = 0;
  let failedCount = 0;
  const fromEmail = userSettings.gmail_email;

  for (const lead of leads as Lead[]) {
    const unsubToken = generateToken();
    const renderedSubject = renderTemplate(template.subject, lead);
    const renderedBody = renderTemplate(template.body, lead);

    // Create email_log first to get ID for tracking
    const { data: logRow, error: logErr } = await adminClient.from('email_logs').insert({
      user_id: userId,
      campaign_id,
      lead_id: lead.id,
      recipient_email: lead.email,
      recipient_name: lead.full_name,
      subject: renderedSubject,
      body_snapshot: renderedBody,
      status: 'queued',
      unsubscribe_token: unsubToken,
    }).select('id').single();

    if (logErr || !logRow) { failedCount++; continue; }
    const logId = logRow.id;

    const htmlWithTracking = injectTracking(
      renderedBody.replace(/\n/g, '<br>'),
      logId, supabaseUrl, appUrl, unsubToken,
    );

    const raw = buildMimeMessage(fromEmail, lead.email, renderedSubject, htmlWithTracking);

    try {
      const result = await sendViaGmail(accessToken, raw);
      await adminClient.from('email_logs').update({
        status: 'sent',
        gmail_message_id: result.id,
        gmail_thread_id: result.threadId,
        sent_at: new Date().toISOString(),
      }).eq('id', logId);
      sentCount++;
    } catch (err) {
      await adminClient.from('email_logs').update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Send failed',
      }).eq('id', logId);
      failedCount++;
    }
  }

  const finalStatus = failedCount === leads.length ? 'Failed' : 'Completed';
  await adminClient.from('campaigns').update({
    status: finalStatus, sent_count: sentCount, failed_count: failedCount, sent_at: new Date().toISOString(),
  }).eq('id', campaign_id);

  return json({ ok: true, sent: sentCount, failed: failedCount });
});
