// ============================================================
// Workspace env — single source of truth cho workspace project config
// ============================================================
//
// Fail-fast: nếu env missing thì throw ngay lúc module load (app crash
// ở boot) thay vì silent broken lúc user click bookmark/highlight/vault.
//
// Lý do: legacy fallback hardcoded JWT không còn hoạt động (Legacy
// HS256 signing keys đã revoke ở Dashboard). Giữ fallback = hardcode
// key material vào repo (kể cả publishable) — vi phạm security posture.
//
// Consumer: bất kỳ chỗ nào gọi workspace project (Edge Function,
// PostgREST, Storage). KHÔNG duplicate constants này ở file khác.
// ============================================================

function requireEnv(key: string): string {
  const value = import.meta.env[key] as string | undefined;
  if (!value) {
    throw new Error(
      `[workspace/env] Missing ${key}. Check .env — copy .env.example nếu clone repo mới.`,
    );
  }
  return value;
}

export const WORKSPACE_URL = requireEnv('VITE_SUPABASE_WORKSPACE_URL');
export const WORKSPACE_ANON_KEY = requireEnv('VITE_SUPABASE_WORKSPACE_ANON_KEY');

export const WORKSPACE_PROXY_URL = `${WORKSPACE_URL}/functions/v1/workspace-proxy`;
export const WORKSPACE_FETCH_META_URL = `${WORKSPACE_URL}/functions/v1/fetch-bookmark-meta`;
export const WORKSPACE_PUBLIC_BOOKMARKS_URL = `${WORKSPACE_URL}/functions/v1/get-public-bookmarks`;
