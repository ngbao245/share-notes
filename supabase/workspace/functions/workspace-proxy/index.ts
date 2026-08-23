// ============================================================
// workspace-proxy — Edge Function
// ============================================================
// Verify JWT from Core project using shared ES256 public key,
// then proxy CRUD operations to workspace DB via service_role.
//
// Why: Supabase hosted PostgREST requires kid match in JWKS.
// Core and Workspace have different kids for same key pair.
// This function bypasses that by verifying JWT manually.
//
// Frontend sends:
//   POST /functions/v1/workspace-proxy
//   Headers: Authorization: Bearer <core-jwt>
//   Body: { table, action, data?, filters?, order?, limit? }
//
// Function verifies JWT → extracts user_id → performs DB operation
// with service_role (bypass RLS) + manual user_id filter.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { importSPKI, jwtVerify } from 'https://deno.land/x/jose@v5.2.3/index.ts';

// ── Config ──

const WORKSPACE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Auth project ES256 public key (SPKI PEM derived from JWKS)
// JWK: x="3DNZohvO2qXxdkvUBMLF38KYpvumPYMuI32xb7F86Go", y="fQA55HxI3-jHhXwz9NRPKne6iFOadQhjtatR7v745iQ"
// kid=89d316af-68a8-4805-9b85-c92e5d833f51 (current, rotated 2026-08)
// Long-term fix: fetch JWKS runtime + cache instead of hardcoded PEM.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3DNZohvO2qXxdkvUBMLF38KYpvum
PYMuI32xb7F86Gp9ADnkfEjf6MeFfDP01E8qd7qIU5p1CGO1q1Hu/vjmJA==
-----END PUBLIC KEY-----`;

// ── Types ──

interface ProxyRequest {
  table: 'notes' | 'tasks' | 'task_lists' | 'watchlist' | 'vault_meta' | 'vault_entries' | 'highlights' | 'reading_progress' | 'bookmark_profiles' | 'bookmark_categories' | 'bookmarks' | 'bookmark_css_presets' | 'canvas_objects' | 'canvas_boards';
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc';
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
  onConflict?: string; // ignored for bookmark tables — server decides conflict target
  rpcName?: string; // only for action='rpc'
  rpcArgs?: Record<string, unknown>; // only for action='rpc'
}

// ── Security: field allowlists & conflict targets ──
// Fields that clients are NEVER allowed to set/change via proxy.
const IMMUTABLE_FIELDS = new Set(['user_id', 'id', 'created_at']);

// Tables cho phép client-supplied `id` khi INSERT.
// Canvas engine tạo UUID client-side để giữ invariant BoardObject.id === Board.id
// và optimistic UI (client biết id ngay khi CreateCommand execute, không chờ server).
// Update path vẫn strip `id` (không cho đổi PK sau tạo).
const ALLOW_CLIENT_ID_ON_INSERT = new Set(['canvas_objects', 'canvas_boards']);

// Per-table writable field allowlists for bookmark domain.
// Tables not listed here have no field restriction (legacy behavior for non-bookmark tables).
const WRITABLE_FIELDS: Record<string, Set<string> | undefined> = {
  bookmark_profiles: new Set([
    'slug', 'space_name', 'column_count', 'is_public', 'theme',
    'display_name', 'bio', 'webpage', 'icon_size',
    'background_type', 'background_value',
    'background_overlay_color', 'background_overlay_opacity', 'background_blend_mode',
    'icon_backdrop', 'category_label_color', 'category_bg_color', 'bookmark_title_color',
    'hero_title_color', 'hero_space_color', 'hero_url_color',
    'custom_css', 'open_in_same_tab', 'active_preset_id', 'custom_css_draft',
    'header_mode',
  ]),
  bookmark_categories: new Set([
    'name', 'column_index', 'order_index', 'hidden_from_public',
  ]),
  bookmarks: new Set([
    'category_id', 'url', 'title', 'note', 'favicon_url', 'order_index',
    'icon_type', 'icon_text', 'icon_rounded', 'icon_background',
  ]),
  bookmark_css_presets: new Set([
    'name', 'css', 'includes_settings', 'settings_snapshot',
  ]),
  canvas_objects: new Set([
    'board_id', 'type', 'geometry', 'data', 'deleted_at',
  ]),
  canvas_boards: new Set([
    'parent_id', 'name', 'camera', 'deleted_at',
  ]),
};

// Fixed conflict targets per table (client cannot choose).
const UPSERT_CONFLICT: Record<string, string> = {
  bookmark_profiles: 'user_id',
  bookmark_css_presets: 'id',
  // Non-bookmark tables keep legacy behavior (client-supplied or default 'user_id').
};

/**
 * Strip disallowed fields from client data.
 * Returns sanitized copy — does NOT mutate input.
 *
 * `mode = 'insert'` cho phép client-supplied `id` với tables trong ALLOW_CLIENT_ID_ON_INSERT.
 * `mode = 'update'` (default) strip mọi immutable field bao gồm `id`.
 */
function sanitizeData(
  table: string,
  data: Record<string, unknown>,
  mode: 'insert' | 'update' = 'update',
): Record<string, unknown> {
  const allowed = WRITABLE_FIELDS[table];
  const canClientSetId = mode === 'insert' && ALLOW_CLIENT_ID_ON_INSERT.has(table);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    // Special case: id allowed on INSERT for canvas tables
    if (key === 'id' && canClientSetId) {
      clean[key] = value;
      continue;
    }
    if (IMMUTABLE_FIELDS.has(key)) continue; // strip user_id / id / created_at
    if (allowed && !allowed.has(key)) continue; // not in allowlist
    clean[key] = value;
  }
  return clean;
}

// ── CORS ──

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Handler ──

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 1. Extract + verify JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  let userId: string;

  try {
    const publicKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256');
    // Verify signature only — skip kid check (that's the whole point)
    // clockTolerance: 30s để dung sai clock skew giữa Auth project sign time và Edge Function verify time.
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['ES256'],
      clockTolerance: '30s',
    });
    userId = payload.sub as string;
    if (!userId) {
      return json({ error: 'JWT missing sub claim' }, 401);
    }
  } catch (err) {
    return json({ error: `JWT verification failed: ${(err as Error).message}` }, 401);
  }

  // 2. Parse request body
  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { table, action, data, filters, order, limit, single, onConflict } = body;

  // Validate table name (whitelist)
  const ALLOWED_TABLES = ['notes', 'tasks', 'task_lists', 'watchlist', 'vault_meta', 'vault_entries', 'highlights', 'reading_progress', 'bookmark_profiles', 'bookmark_categories', 'bookmarks', 'bookmark_css_presets', 'canvas_objects', 'canvas_boards'];
  if (!ALLOWED_TABLES.includes(table)) {
    return json({ error: `Table "${table}" not allowed` }, 400);
  }

  // 3. Create service_role client
  const supabase = createClient(WORKSPACE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let result: { data: unknown; error: unknown };

    switch (action) {
      case 'select': {
        let query = supabase.from(table).select('*').eq('user_id', userId);
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            if (value === null) {
              query = query.is(key, null);
            } else if (
              typeof value === 'object' &&
              value !== null &&
              !Array.isArray(value)
            ) {
              // Operator object: { gt / gte / lt / lte / in }
              // Backward-compat: primitive filters vẫn dùng eq (branch else dưới).
              const ops = value as Record<string, unknown>;
              if ('gt' in ops) query = query.gt(key, ops.gt as string);
              if ('gte' in ops) query = query.gte(key, ops.gte as string);
              if ('lt' in ops) query = query.lt(key, ops.lt as string);
              if ('lte' in ops) query = query.lte(key, ops.lte as string);
              if ('in' in ops && Array.isArray(ops.in)) {
                query = query.in(key, ops.in as string[]);
              }
            } else {
              query = query.eq(key, value as string);
            }
          }
        }
        if (order) query = query.order(order.column, { ascending: order.ascending ?? false });
        if (limit) query = query.limit(limit);
        result = await query;
        break;
      }

      case 'insert': {
        if (!data) return json({ error: 'Missing data for insert' }, 400);
        // Sanitize (insert mode: allow client-supplied id for canvas tables) + inject user_id
        const rows = Array.isArray(data)
          ? data.map((r) => ({ ...sanitizeData(table, r, 'insert'), user_id: userId }))
          : { ...sanitizeData(table, data, 'insert'), user_id: userId };
        let query = supabase.from(table).insert(rows).select();
        if (single) query = query.single();
        result = await query;
        break;
      }

      case 'update': {
        if (!data || !filters?.id) return json({ error: 'Missing data or filters.id for update' }, 400);
        // Sanitize data — immutable + disallowed fields stripped
        const sanitized = sanitizeData(table, data as Record<string, unknown>);
        if (Object.keys(sanitized).length === 0) {
          return json({ error: 'No writable fields in update payload' }, 400);
        }
        // Ensure user can only update own rows
        let query = supabase
          .from(table)
          .update(sanitized)
          .eq('id', filters.id as string)
          .eq('user_id', userId)
          .select();
        if (single) query = query.single();
        result = await query;
        break;
      }

      case 'delete': {
        if (!filters?.id) return json({ error: 'Missing filters.id for delete' }, 400);
        // Support single id or array of ids
        const ids = filters.id;
        if (Array.isArray(ids)) {
          result = await supabase
            .from(table)
            .delete()
            .in('id', ids)
            .eq('user_id', userId);
        } else {
          result = await supabase
            .from(table)
            .delete()
            .eq('id', ids as string)
            .eq('user_id', userId);
        }
        break;
      }

      case 'upsert': {
        if (!data) return json({ error: 'Missing data for upsert' }, 400);
        // Sanitize (upsert = insert-or-update: allow client-supplied id for canvas tables) + inject user_id
        const upsertRow = Array.isArray(data)
          ? data.map((r) => ({ ...sanitizeData(table, r, 'insert'), user_id: userId }))
          : { ...sanitizeData(table, data, 'insert'), user_id: userId };
        // Conflict target is server-decided for bookmark tables; legacy tables may use client hint or default.
        const conflictCols = UPSERT_CONFLICT[table] ?? onConflict ?? 'user_id';
        let query = supabase.from(table).upsert(upsertRow, { onConflict: conflictCols }).select();
        if (single) query = query.single();
        result = await query;
        break;
      }

      case 'rpc': {
        // Invoke a database function (RPC). Only whitelisted functions allowed.
        const ALLOWED_RPCS = new Set([
          'bookmark_batch_update',
          'bookmark_bulk_import',
          'bookmark_enrich_meta',
        ]);
        const { rpcName, rpcArgs } = body;
        if (!rpcName || !ALLOWED_RPCS.has(rpcName)) {
          return json({ error: `RPC "${rpcName}" not allowed` }, 400);
        }
        // Always inject p_user_id from JWT — client cannot override
        const args = { ...(rpcArgs ?? {}), p_user_id: userId };
        result = await supabase.rpc(rpcName, args);
        break;
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }

    if (result.error) {
      return json({ error: (result.error as { message: string }).message }, 500);
    }

    return json({ data: result.data });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

// ── Helpers ──

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}