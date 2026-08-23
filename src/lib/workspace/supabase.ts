// ============================================================
// Workspace Supabase client — auth-aware factory
// ============================================================
// Connects to biboHub-workspace project. Used by: notes, tasks,
// watchlist (and future workspace tools).
//
// Auth flow:
//   Core Supabase (authClient) login → JWT stored in authStore.session
//   Workspace project trusts JWT (shared HS256 key) → RLS auth.uid() works
//
// Pattern (KHÔNG dùng workspaceClient.auth.setSession() vì sẽ đè
// localStorage session key của Core client):
//
//   1. Module cache 1 SupabaseClient instance kèm token hiện tại
//   2. getWorkspaceClient() sync: nếu token trong authStore đã đổi
//      -> tạo client mới với Authorization header, cache lại
//   3. Subscribe authStore để proactive invalidate cache + queryClient
//      khi session change (login / logout / TOKEN_REFRESHED)
//
// Fallback: khi chưa có session, client vẫn create được (anon key) —
// mọi query sẽ fail RLS 401, hooks handle bằng optimistic rollback.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useAuthStore } from '@/stores/authStore';
import { queryClient } from '@/lib/queryClient';
import { WORKSPACE_URL, WORKSPACE_ANON_KEY } from './env';

/**
 * @deprecated Import `WORKSPACE_URL` từ `@/lib/workspace/env` trực tiếp.
 * Giữ tạm để backward compat, xoá khi không còn consumer.
 */
export const WORKSPACE_URL_PUBLIC = WORKSPACE_URL;

// ============================================================
// Query keys owned by workspace project. Auth change -> invalidate
// so hooks refetch with correct token / user_id scope.
// ============================================================
const WORKSPACE_QUERY_KEYS = ['notes', 'tasks', 'watchlist'] as const;

// ============================================================
// Internal cache
// ============================================================

let _client: SupabaseClient | null = null;
let _cachedToken: string | null = null;

function createClientWithToken(token: string | null): SupabaseClient {
  return createClient(WORKSPACE_URL, WORKSPACE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      // Prevent this client from reading URL hash tokens — Core client owns auth flow
      detectSessionInUrl: false,
    },
    global: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : {},
  });
}

/**
 * Returns SupabaseClient targeting workspace project, with Authorization
 * header matching current Core session (if any).
 *
 * SYNC — safe to call inside query/mutation functions.
 */
export function getWorkspaceClient(): SupabaseClient {
  const token = useAuthStore.getState().session?.access_token ?? null;
  if (!_client || _cachedToken !== token) {
    _client = createClientWithToken(token);
    _cachedToken = token;
  }
  return _client;
}

/** Returns current authenticated user id from Core session, or null. */
export function getWorkspaceUserId(): string | null {
  return useAuthStore.getState().session?.user?.id ?? null;
}

/** Throws if no session — use before insert mutations. */
export function requireWorkspaceUserId(): string {
  const id = getWorkspaceUserId();
  if (!id) throw new Error('Chưa đăng nhập — không thể ghi workspace data');
  return id;
}

// ============================================================
// Reactive subscription: recreate client + invalidate queries when
// auth token changes (login, logout, TOKEN_REFRESHED).
// ============================================================

let _prevToken: string | null = useAuthStore.getState().session?.access_token ?? null;

useAuthStore.subscribe((state) => {
  const nextToken = state.session?.access_token ?? null;
  if (nextToken === _prevToken) return;
  _prevToken = nextToken;

  // Force recreate on next getWorkspaceClient() call
  _client = null;
  _cachedToken = null;

  // Invalidate all workspace-owned queries so hooks refetch with new token
  for (const key of WORKSPACE_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
});