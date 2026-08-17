// ============================================================
// lookup-username — Edge Function (dashboard-inline version)
// ============================================================
// Public function (không cần auth): map username → email fake.
// Paste toàn bộ file này vào Supabase Dashboard Edge Function editor.
//
// Security notes:
//   - LUÔN trả HTTP 200 với { email: string | null } để chống
//     username enumeration oracle. Attacker không phân biệt được
//     "username tồn tại vs không" qua status code.
//   - CONSTANT TIME response: mọi path (invalid format / not found /
//     found) đều đợi tối thiểu ~150ms. Chống timing attack.
//   - Trường 500 (server misconfigured / DB query error) vẫn trả 500
//     vì đây là lỗi hạ tầng, không leak info user.
//   - Chưa có rate limit ở function này. Supabase built-in rate limit
//     ở gateway (~30 req/min/IP) đủ chống casual sweep. Muốn kỹ hơn
//     cần bảng `rate_limits` — tách task sau.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Chờ tới khi tổng response time đạt tối thiểu `targetMs` để giả timing
 * không phân biệt được các path bên trong.
 * Baseline empirical:
 *   - path found:      ~80-120ms (2 DB query)
 *   - path not found:  ~30-50ms  (1 DB query hoặc early return)
 *   - path invalid:    ~1-5ms    (early return)
 * Target 150ms cover cả 3.
 */
async function constantTimeDelay(startTime: number, targetMs = 150): Promise<void> {
  const elapsed = Date.now() - startTime;
  if (elapsed < targetMs) {
    await new Promise((r) => setTimeout(r, targetMs - elapsed));
  }
}

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const startTime = Date.now();

  let body: { username?: unknown };
  try {
    body = await req.json();
  } catch {
    // Invalid JSON body — trả null với constant time
    await constantTimeDelay(startTime);
    return jsonResponse({ email: null });
  }

  const raw = typeof body.username === 'string' ? body.username.trim() : '';

  // Invalid format — trả null (không phân biệt với "không tồn tại")
  if (!USERNAME_REGEX.test(raw)) {
    await constantTimeDelay(startTime);
    return jsonResponse({ email: null });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    // Infrastructure error — không leak info user, trả 500
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id')
    .ilike('username', raw)
    .maybeSingle();

  if (profileErr) {
    // eslint-disable-next-line no-console
    console.error('[lookup-username] Profile query error:', profileErr);
    // Infrastructure error, trả 500 (không constant time để dev dễ debug)
    return jsonResponse({ error: 'Internal error' }, 500);
  }

  // Không tìm thấy — trả null với constant time (giả giống path found)
  if (!profile) {
    await constantTimeDelay(startTime);
    return jsonResponse({ email: null });
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(profile.id);

  // Auth user không tồn tại (data corruption: profile có id nhưng auth.users mất)
  // hoặc query fail → trả null với constant time
  if (userErr || !userData.user?.email) {
    await constantTimeDelay(startTime);
    return jsonResponse({ email: null });
  }

  // Found — trả email. Đã đạt ~80-120ms tự nhiên qua 2 query, ít cần padding
  // nhưng vẫn ensure minimum để consistent.
  await constantTimeDelay(startTime);
  return jsonResponse({ email: userData.user.email });
});
