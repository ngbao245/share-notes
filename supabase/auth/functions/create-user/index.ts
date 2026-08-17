// ============================================================
// create-user — Edge Function (dashboard-inline version)
// ============================================================
// Nhận username + password + role + allowed_tools, tự sinh fake email.
// Paste toàn bộ file này vào Supabase Dashboard Edge Function editor.
// ============================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

// -----------------------------
// Shared helpers (inlined)
// -----------------------------
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

// -----------------------------
// Main handler
// -----------------------------
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const FAKE_EMAIL_DOMAIN = 'bibo-tools.local';

interface CreateUserBody {
  username?: unknown;
  password?: unknown;
  role?: unknown;
  allowed_tools?: unknown;
}

function validateBody(body: CreateUserBody):
  | { username: string; password: string; role: 'admin' | 'user'; allowed_tools: string[] }
  | string {
  if (typeof body.username !== 'string' || !USERNAME_REGEX.test(body.username.trim())) {
    return 'Username must be 3-20 chars, alphanumeric or underscore';
  }
  if (typeof body.password !== 'string' || body.password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  if (body.role !== 'admin' && body.role !== 'user') return 'Invalid role';
  if (!Array.isArray(body.allowed_tools) || body.allowed_tools.some((t) => typeof t !== 'string')) {
    return 'Invalid allowed_tools';
  }
  return {
    username: body.username.trim().toLowerCase(),
    password: body.password,
    role: body.role,
    allowed_tools: body.allowed_tools as string[],
  };
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { adminClient } = await verifyAdmin(req);

    let body: CreateUserBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const validated = validateBody(body);
    if (typeof validated === 'string') return jsonResponse({ error: validated }, 400);

    // Check duplicate username
    const { data: existing, error: existErr } = await adminClient
      .from('profiles')
      .select('id')
      .ilike('username', validated.username)
      .maybeSingle();

    if (existErr) {
      return jsonResponse({ error: `Username lookup failed: ${existErr.message}` }, 500);
    }
    if (existing) {
      return jsonResponse({ error: 'Username already exists' }, 409);
    }

    const email = `${validated.username}@${FAKE_EMAIL_DOMAIN}`;

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: validated.password,
      email_confirm: true,
    });

    if (createErr || !created.user) {
      const msg = createErr?.message ?? 'Failed to create user';
      const status = msg.toLowerCase().includes('already') ? 409 : 500;
      return jsonResponse({ error: msg }, status);
    }

    const { error: profileErr } = await adminClient.from('profiles').insert({
      id: created.user.id,
      role: validated.role,
      allowed_tools: validated.allowed_tools,
      username: validated.username,
    });

    if (profileErr) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: `Profile insert failed: ${profileErr.message}` }, 500);
    }

    return jsonResponse({
      ok: true,
      user: {
        id: created.user.id,
        email: created.user.email,
        username: validated.username,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    // eslint-disable-next-line no-console
    console.error('[create-user] Unexpected error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
