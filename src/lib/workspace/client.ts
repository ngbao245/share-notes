// ============================================================
// Workspace Proxy Client — gọi Edge Function thay vì PostgREST
// ============================================================
//
// Lý do: Supabase hosted PostgREST yêu cầu kid JWT match JWKS.
// Core và Workspace có kid khác nhau (cùng key pair nhưng Supabase
// tự gen kid). Edge Function verify JWT thủ công (ignore kid) rồi
// proxy DB operation qua service_role.
//
// Frontend gọi workspaceQuery/workspaceMutate thay vì supabase-js.
// ============================================================

import { useAuthStore } from '@/stores/authStore';
import { WORKSPACE_ANON_KEY, WORKSPACE_PROXY_URL as PROXY_URL } from './env';

// ============================================================
// Types
// ============================================================

type AllowedTable = 'notes' | 'tasks' | 'task_lists' | 'watchlist' | 'bookmark_profiles' | 'bookmark_categories' | 'bookmarks' | 'bookmark_css_presets' | 'canvas_objects' | 'canvas_boards';

/**
 * Filter value support:
 * - primitive → eq
 * - null → is null
 * - operator object → { gt / gte / lt / lte / in }
 */
export type FilterOperator = {
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  in?: unknown[];
};

export type FilterValue = unknown | FilterOperator;

interface ProxyRequest {
  table: AllowedTable;
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Record<string, FilterValue>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
  onConflict?: string;
}

interface ProxyResponse<T = unknown> {
  data: T;
  error: null;
}

// ============================================================
// Core fetch
// ============================================================

async function proxyFetch<T = unknown>(body: ProxyRequest): Promise<T> {
  const token = useAuthStore.getState().session?.access_token;
  if (!token) throw new Error('Chưa đăng nhập — không thể gọi workspace');

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: WORKSPACE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `Workspace proxy error: ${res.status}`);
  }

  const json = (await res.json()) as ProxyResponse<T>;
  return json.data;
}

// ============================================================
// Public API — mimic supabase-js interface nhưng qua proxy
// ============================================================

/** SELECT * FROM {table} WHERE user_id = current_user */
export async function workspaceSelect<T = unknown>(
  table: AllowedTable,
  options?: {
    filters?: Record<string, FilterValue>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
  },
): Promise<T[]> {
  return proxyFetch<T[]>({
    table,
    action: 'select',
    filters: options?.filters,
    order: options?.order,
    limit: options?.limit,
  });
}

/** INSERT INTO {table} ... RETURNING * */
export async function workspaceInsert<T = unknown>(
  table: AllowedTable,
  data: Record<string, unknown>,
): Promise<T> {
  return proxyFetch<T>({
    table,
    action: 'insert',
    data,
    single: true,
  });
}

/**
 * Batch INSERT — nhiều rows 1 request. Dùng cho migration + bulk import.
 * Chunk client-side (VD 50 rows/req) để tránh workspace-proxy timeout 30s
 * hoặc rate limit.
 */
export async function workspaceInsertBatch<T = unknown>(
  table: AllowedTable,
  rows: Record<string, unknown>[],
): Promise<T[]> {
  if (rows.length === 0) return [];
  return proxyFetch<T[]>({
    table,
    action: 'insert',
    data: rows,
    single: false,
  });
}

/** UPDATE {table} SET ... WHERE id = X AND user_id = current_user RETURNING * */
export async function workspaceUpdate<T = unknown>(
  table: AllowedTable,
  id: string,
  data: Record<string, unknown>,
): Promise<T> {
  return proxyFetch<T>({
    table,
    action: 'update',
    data,
    filters: { id },
    single: true,
  });
}

/** DELETE FROM {table} WHERE id = X AND user_id = current_user */
export async function workspaceDelete(
  table: AllowedTable,
  id: string | string[],
): Promise<void> {
  await proxyFetch({
    table,
    action: 'delete',
    filters: { id },
  });
}

/** UPSERT INTO {table} ON CONFLICT ({onConflict}) DO UPDATE ... RETURNING * */
export async function workspaceUpsert<T = unknown>(
  table: AllowedTable,
  data: Record<string, unknown>,
  options?: { onConflict?: string; single?: boolean },
): Promise<T> {
  return proxyFetch<T>({
    table,
    action: 'upsert',
    data,
    single: options?.single ?? true,
    onConflict: options?.onConflict ?? 'user_id',
  });
}

/** Call a whitelisted database RPC function via proxy. p_user_id injected server-side. */
export async function workspaceRpc<T = unknown>(
  rpcName: string,
  rpcArgs: Record<string, unknown>,
): Promise<T> {
  const token = useAuthStore.getState().session?.access_token;
  if (!token) throw new Error('Chưa đăng nhập — không thể gọi workspace');

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: WORKSPACE_ANON_KEY,
    },
    body: JSON.stringify({
      table: 'bookmarks', // table field required by proxy schema; rpc ignores it
      action: 'rpc',
      rpcName,
      rpcArgs,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `Workspace RPC error: ${res.status}`);
  }

  const json = (await res.json()) as { data: T };
  return json.data;
}
