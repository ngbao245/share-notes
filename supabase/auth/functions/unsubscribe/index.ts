// ============================================================
// unsubscribe — Edge Function (public, no auth required)
// ============================================================
// GET /functions/v1/unsubscribe?token=xxx
// Tìm email_log by unsubscribe_token, update lead.unsubscribed = true.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) return json({ error: 'Missing token' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('AGENCY_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find email_log by token
  const { data: log, error: logErr } = await adminClient
    .from('email_logs')
    .select('id, lead_id, recipient_name, unsubscribed_at')
    .eq('unsubscribe_token', token)
    .maybeSingle();

  if (logErr) return json({ error: logErr.message }, 500);
  if (!log) return json({ error: 'Invalid or expired unsubscribe link' }, 404);

  // Already unsubscribed
  if (log.unsubscribed_at) {
    return json({ ok: true, already: true, lead_name: log.recipient_name });
  }

  const now = new Date().toISOString();

  // Update email_log
  await adminClient
    .from('email_logs')
    .update({ unsubscribed_at: now })
    .eq('id', log.id);

  // Update lead.unsubscribed = true
  if (log.lead_id) {
    await adminClient
      .from('leads')
      .update({ unsubscribed: true })
      .eq('id', log.lead_id);
  }

  return json({ ok: true, lead_name: log.recipient_name });
});
