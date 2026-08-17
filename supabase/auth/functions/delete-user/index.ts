// ============================================================
// delete-user — Edge Function (dashboard-inline version)
// ============================================================
// Bản gộp _shared/verify-admin.ts vào 1 file để paste vào
// Supabase Dashboard Edge Function editor.
// ============================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function verifyAdmin(req: Request): Promise<{ userId: string; adminClient: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await adminClient.auth.getUser(match[1]);
  if (userErr || !userData.user) {
    throw new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profileErr || !profile || profile.role !== 'admin') {
    throw new Response(JSON.stringify({ error: 'Not admin' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: userData.user.id, adminClient };
}

interface DeleteUserBody {
  user_id?: unknown;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { userId: callerId, adminClient } = await verifyAdmin(req);

    let body: DeleteUserBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.user_id !== 'string' || !body.user_id) {
      return jsonResponse({ error: 'Missing user_id' }, 400);
    }

    if (body.user_id === callerId) {
      return jsonResponse({ error: 'Cannot delete yourself' }, 400);
    }

    const { error: delErr } = await adminClient.auth.admin.deleteUser(body.user_id);
    if (delErr) return jsonResponse({ error: delErr.message }, 500);

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    // eslint-disable-next-line no-console
    console.error('[delete-user] Unexpected error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
