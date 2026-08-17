// ============================================================
// service-executor — Edge Function (Control Plane)
// ============================================================
// Server-side credential selection and execution orchestration.
// Browser never receives raw API keys.
//
// Actions:
//   - execute: select credential from pool, return scoped descriptor/token
//   - test-connection: server-side connectivity test
//   - update-status: update credential status (admin only)
//   - reserve-credits: reserve quota before job
//   - commit-credits: commit/refund reservation after job
//
// Architecture:
//   1. Verify JWT (Core project shared key)
//   2. Check tool permission (RBAC)
//   3. Resolve binding → profile → credential pool
//   4. Apply provider-specific selection policy
//   5. Return scoped token/descriptor (never raw secret)
//
// NOTE: _shared/crypto.ts inlined below for Dashboard deployment.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { importSPKI, jwtVerify } from 'https://deno.land/x/jose@v5.2.3/index.ts';

// ── Inlined: _shared/crypto.ts ──────────────────────────────

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE526+auliBc/ZCGUmtU9UvHTrInDR
kKy5s/bvYjhOWp5HRQrp1+cdHPxUZ9WtAxuEj0FRbjtcWrBPh7quWYuq2w==
-----END PUBLIC KEY-----`;

interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

async function verifyJwt(authHeader: string | null): Promise<JwtPayload | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const publicKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256');
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['ES256'] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      role: payload.role as string | undefined,
      user_metadata: payload.user_metadata as Record<string, unknown> | undefined,
      app_metadata: payload.app_metadata as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}

function isAdmin(payload: JwtPayload): boolean {
  const appRole = payload.app_metadata?.role ?? payload.user_metadata?.role;
  return appRole === 'admin';
}

// ── Config ──────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Types ───────────────────────────────────────────────────

interface ExecuteRequest {
  action: 'execute' | 'test-connection' | 'update-status' | 'reserve-credits' | 'commit-credits';
  tool_code: string;
  capability: string;
  payload?: Record<string, unknown>;
}

interface CredentialRow {
  id: string;
  profile_id: string;
  credential_kind: string;
  identifier: string;
  secret_data_json: Record<string, unknown>;
  status: string;
  priority: number;
  weight: number;
  quota_limit: number | null;
  quota_used: number | null;
  quota_reset_at: string | null;
  cooldown_until: string | null;
  last_used_at: string | null;
}

interface ProfileRow {
  id: string;
  provider_id: string;
  status: string;
  settings_json: Record<string, unknown>;
}

interface BindingRow {
  id: string;
  profile_id: string;
  is_primary: boolean;
  priority: number;
  enabled: boolean;
  overrides_json: Record<string, unknown>;
}

interface ProviderRow {
  id: string;
  code: string;
  category: string;
}

// ── CORS ────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Handler ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return json(null, 204);
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 1. Verify JWT
  const user = await verifyJwt(req.headers.get('Authorization'));
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // 2. Parse body
  let body: ExecuteRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { action, tool_code, capability, payload } = body;
  if (!action || !tool_code || !capability) {
    return json({ error: 'Missing required fields: action, tool_code, capability' }, 400);
  }

  // 3. Create service_role client
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 4. Check permission
  const hasAccess = await checkToolPermission(supabase, user, tool_code);
  if (!hasAccess) {
    return json({ error: `No permission for tool: ${tool_code}` }, 403);
  }

  // 5. Route action
  switch (action) {
    case 'execute':
      return handleExecute(supabase, user, tool_code, capability, payload);
    case 'test-connection': {
      const adminCheck = await checkToolPermission(supabase, user, '_admin');
      if (!adminCheck) return json({ error: 'Admin only' }, 403);
      return handleTestConnection(supabase, payload);
    }
    case 'update-status': {
      const adminCheck2 = await checkToolPermission(supabase, user, '_admin');
      if (!adminCheck2) return json({ error: 'Admin only' }, 403);
      return handleUpdateStatus(supabase, payload);
    }
    case 'reserve-credits':
      return handleReserveCredits(supabase, user, tool_code, capability, payload);
    case 'commit-credits':
      return handleCommitCredits(supabase, user, payload);
    default:
      return json({ error: `Unknown action: ${action}` }, 400);
  }
});

// ── Permission check ────────────────────────────────────────

async function checkToolPermission(
  supabase: ReturnType<typeof createClient>,
  user: JwtPayload,
  toolCode: string,
): Promise<boolean> {
  // Load profile from DB (source of truth for role + allowed_tools)
  const { data: profile } = await supabase
    .from('profiles')
    .select('allowed_tools, role')
    .eq('id', user.sub)
    .maybeSingle();

  if (!profile) return false;

  // Admin role = full bypass
  if (profile.role === 'admin') return true;

  // Wildcard = all tools
  const userTools: string[] = profile.allowed_tools ?? [];
  if (userTools.includes('*') || userTools.includes(toolCode)) return true;

  // Admin-only actions (test-connection, update-status)
  if (toolCode === '_admin') return false;

  // Check role-level allowed_tools
  if (profile.role) {
    const { data: role } = await supabase
      .from('roles')
      .select('allowed_tools')
      .eq('name', profile.role)
      .maybeSingle();
    const roleTools: string[] = role?.allowed_tools ?? [];
    if (roleTools.includes('*') || roleTools.includes(toolCode)) return true;
  }

  return false;
}

// ── Execute: credential selection + scoped token ────────────

async function handleExecute(
  supabase: ReturnType<typeof createClient>,
  _user: JwtPayload,
  toolCode: string,
  capability: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const { data: bindings } = await supabase
    .from('tool_service_bindings')
    .select('id, profile_id, is_primary, priority, enabled, overrides_json')
    .eq('tool_code', toolCode)
    .eq('capability', capability)
    .eq('enabled', true)
    .order('is_primary', { ascending: false })
    .order('priority');

  if (!bindings || bindings.length === 0) {
    return json({ error: `No bindings for ${toolCode}/${capability}` }, 404);
  }

  for (const binding of bindings as BindingRow[]) {
    if (!binding.profile_id) continue;

    const { data: profile } = await supabase
      .from('service_profiles')
      .select('id, provider_id, status, settings_json')
      .eq('id', binding.profile_id)
      .maybeSingle();

    if (!profile || profile.status !== 'active') continue;

    const { data: provider } = await supabase
      .from('service_providers')
      .select('id, code, category')
      .eq('id', (profile as ProfileRow).provider_id)
      .maybeSingle();

    if (!provider) continue;

    const credentials = await loadAvailableCredentials(supabase, binding.profile_id);
    if (credentials.length === 0) continue;

    const selected = selectByPolicy(
      credentials,
      (provider as ProviderRow).code,
      (profile as ProfileRow).settings_json,
    );
    if (!selected) continue;

    const descriptor = await generateDescriptor(
      (provider as ProviderRow).code,
      selected,
      payload,
    );
    if (!descriptor) continue;

    await supabase
      .from('service_credentials')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', selected.id);

    return json({
      success: true,
      provider_code: (provider as ProviderRow).code,
      credential_id: selected.id,
      identifier: selected.identifier,
      descriptor,
      overrides: binding.overrides_json,
    });
  }

  return json({ error: 'All credentials exhausted or unavailable', success: false }, 503);
}

// ── Credential loading ──────────────────────────────────────

async function loadAvailableCredentials(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
): Promise<CredentialRow[]> {
  const { data: credentials } = await supabase
    .from('service_credentials')
    .select('*')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .order('priority');

  if (!credentials) return [];

  const now = Date.now();
  return (credentials as CredentialRow[]).filter((c) => {
    if (c.cooldown_until && new Date(c.cooldown_until).getTime() > now) return false;
    return true;
  });
}

// ── Provider-specific selection policy ──────────────────────

function selectByPolicy(
  credentials: CredentialRow[],
  providerCode: string,
  profileSettings: Record<string, unknown>,
): CredentialRow | null {
  if (credentials.length === 0) return null;

  switch (providerCode) {
    case 'gemini':
      // Load balance: least recently used (RPM/RPD fairness)
      return credentials.sort((a, b) => {
        const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return aTime - bTime;
      })[0] ?? null;

    case 'ilovepdf':
      // Priority order: use until exhausted, then next
      return credentials[0] ?? null;

    case 'cloudconvert':
      // Prefer credential with remaining quota
      return credentials.filter((c) =>
        c.quota_limit === null || (c.quota_used ?? 0) < c.quota_limit,
      ).sort((a, b) => a.priority - b.priority)[0] ?? credentials[0] ?? null;

    case 'google_drive':
      // Priority order with capacity awareness
      return credentials.sort((a, b) => a.priority - b.priority)[0] ?? null;

    default: {
      const strategy = profileSettings?.keySelectionStrategy as string ?? 'priority';
      if (strategy === 'least_used') {
        return credentials.sort((a, b) => {
          const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
          const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
          return aTime - bTime;
        })[0] ?? null;
      }
      return credentials[0] ?? null;
    }
  }
}

// ── Descriptor generation (scoped token, never raw secret) ──

async function generateDescriptor(
  providerCode: string,
  credential: CredentialRow,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const secret = credential.secret_data_json;

  switch (providerCode) {
    case 'gemini': {
      const apiKey = secret.apiKey as string | undefined;
      if (!apiKey) return null;
      return {
        type: 'server_execute',
        provider: 'gemini',
        credential_id: credential.id,
      };
    }

    case 'ilovepdf': {
      const publicKey = (secret.public_key ?? secret.key) as string | undefined;
      if (!publicKey) return null;
      try {
        const authRes = await fetch('https://api.ilovepdf.com/v1/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_key: publicKey }),
          signal: AbortSignal.timeout(10000),
        });
        if (!authRes.ok) return null;
        const authData = await authRes.json();
        const token = authData.token as string;

        const tool = payload?.tool as string ?? 'compress';
        const startRes = await fetch(`https://api.ilovepdf.com/v1/start/${tool}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!startRes.ok) return null;
        const startData = await startRes.json();

        return {
          type: 'direct_upload',
          provider: 'ilovepdf',
          credential_id: credential.id,
          token,
          server: startData.server,
          task: startData.task,
        };
      } catch {
        return null;
      }
    }

    case 'cloudconvert': {
      const apiKey = secret.api_key as string | undefined;
      if (!apiKey) return null;
      return {
        type: 'server_execute',
        provider: 'cloudconvert',
        credential_id: credential.id,
        api_base: 'https://api.cloudconvert.com/v2',
      };
    }

    case 'google_drive': {
      const clientId = secret.client_id as string | undefined;
      const clientSecret = secret.client_secret as string | undefined;
      const refreshToken = secret.refresh_token as string | undefined;
      if (!clientId || !clientSecret || !refreshToken) return null;
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!tokenRes.ok) return null;
        const tokenData = await tokenRes.json();
        return {
          type: 'direct_upload',
          provider: 'google_drive',
          credential_id: credential.id,
          access_token: tokenData.access_token,
          expires_in: tokenData.expires_in,
          folder_id: secret.folder_id,
        };
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}

// ── Test connection (admin) ─────────────────────────────────

async function handleTestConnection(
  supabase: ReturnType<typeof createClient>,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const credentialId = payload?.credential_id as string;
  if (!credentialId) return json({ error: 'Missing credential_id' }, 400);

  const { data: cred } = await supabase
    .from('service_credentials')
    .select('secret_data_json, profile_id')
    .eq('id', credentialId)
    .maybeSingle();

  if (!cred) return json({ error: 'Credential not found' }, 404);

  const { data: profile } = await supabase
    .from('service_profiles')
    .select('provider_id')
    .eq('id', cred.profile_id)
    .maybeSingle();

  if (!profile) return json({ error: 'Profile not found' }, 404);

  const { data: provider } = await supabase
    .from('service_providers')
    .select('code')
    .eq('id', profile.provider_id)
    .maybeSingle();

  if (!provider) return json({ error: 'Provider not found' }, 404);

  const secret = cred.secret_data_json as Record<string, unknown>;
  let success = false;

  switch (provider.code) {
    case 'gemini': {
      const apiKey = secret.apiKey as string;
      if (apiKey) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
            { signal: AbortSignal.timeout(10000) },
          );
          success = res.ok;
        } catch { /* ignore */ }
      }
      break;
    }
    case 'ilovepdf': {
      const publicKey = (secret.public_key ?? secret.key) as string;
      if (publicKey) {
        try {
          const res = await fetch('https://api.ilovepdf.com/v1/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_key: publicKey }),
            signal: AbortSignal.timeout(10000),
          });
          success = res.ok;
        } catch { /* ignore */ }
      }
      break;
    }
    case 'cloudconvert': {
      const apiKey = secret.api_key as string;
      if (apiKey) {
        try {
          const res = await fetch('https://api.cloudconvert.com/v2/users/me', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          success = res.ok;
        } catch { /* ignore */ }
      }
      break;
    }
    case 'google_drive': {
      const clientId = secret.client_id as string;
      const clientSecret = secret.client_secret as string;
      const refreshToken = secret.refresh_token as string;
      if (clientId && clientSecret && refreshToken) {
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: 'refresh_token',
            }),
            signal: AbortSignal.timeout(10000),
          });
          success = tokenRes.ok;
        } catch { /* ignore */ }
      }
      break;
    }
  }

  return json({ success, provider: provider.code });
}

// ── Update credential status (admin) ────────────────────────

async function handleUpdateStatus(
  supabase: ReturnType<typeof createClient>,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const credentialId = payload?.credential_id as string;
  const newStatus = payload?.status as string;
  if (!credentialId || !newStatus) {
    return json({ error: 'Missing credential_id or status' }, 400);
  }

  const validStatuses = ['active', 'disabled', 'exhausted', 'cooldown', 'invalid', 'error', 'full'];
  if (!validStatuses.includes(newStatus)) {
    return json({ error: `Invalid status: ${newStatus}` }, 400);
  }

  const update: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (payload?.cooldown_until) update.cooldown_until = payload.cooldown_until;
  if (payload?.last_error_message) update.last_error_message = payload.last_error_message;

  const { error } = await supabase
    .from('service_credentials')
    .update(update)
    .eq('id', credentialId);

  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ── Reserve credits ─────────────────────────────────────────

async function handleReserveCredits(
  supabase: ReturnType<typeof createClient>,
  user: JwtPayload,
  _toolCode: string,
  _capability: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const jobId = payload?.job_id as string;
  const credentialId = payload?.credential_id as string;
  const providerCode = payload?.provider_code as string;
  const estimatedCredits = (payload?.estimated_credits as number) ?? 1;

  if (!jobId || !credentialId || !providerCode) {
    return json({ error: 'Missing job_id, credential_id, or provider_code' }, 400);
  }

  const { data: reservation, error } = await supabase
    .from('pdf_studio_reservations')
    .insert({
      job_id: jobId,
      user_id: user.sub,
      credential_id: credentialId,
      provider_code: providerCode,
      estimated_credits: estimatedCredits,
      status: 'reserved',
    })
    .select('id')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ success: true, reservation_id: reservation.id });
}

// ── Commit/refund credits ───────────────────────────────────

async function handleCommitCredits(
  supabase: ReturnType<typeof createClient>,
  user: JwtPayload,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const reservationId = payload?.reservation_id as string;
  const actualCredits = payload?.actual_credits as number;
  const outcome = payload?.outcome as string;

  if (!reservationId || !outcome) {
    return json({ error: 'Missing reservation_id or outcome' }, 400);
  }

  const validOutcomes = ['committed', 'refunded', 'expired'];
  if (!validOutcomes.includes(outcome)) {
    return json({ error: `Invalid outcome: ${outcome}` }, 400);
  }

  const { error } = await supabase
    .from('pdf_studio_reservations')
    .update({
      status: outcome,
      actual_credits: actualCredits ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reservationId)
    .eq('user_id', user.sub);

  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ── Helpers ─────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(
    body === null ? null : JSON.stringify(body),
    {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  );
}
