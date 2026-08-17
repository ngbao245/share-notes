// ============================================================
// authClient — Supabase client cho project Auth mới
// ============================================================
//
// Project riêng, TÁCH BIỆT với readerClient (`src/lib/library/supabase.ts`)
// vốn dùng cho books storage. Không share session giữa 2 client.
//
// Session persist localStorage tự động, key: sb-{projectRef}-auth-token.
// autoRefreshToken bật để token expire silent refresh.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_URL = import.meta.env.VITE_SUPABASE_AUTH_URL as string | undefined;
const AUTH_ANON_KEY = import.meta.env.VITE_SUPABASE_AUTH_ANON_KEY as string | undefined;

if (!AUTH_URL || !AUTH_ANON_KEY) {
   
  console.error(
    '[authClient] Missing VITE_SUPABASE_AUTH_URL or VITE_SUPABASE_AUTH_ANON_KEY. Login sẽ fail.',
  );
}

// Fallback string để createClient không throw ở boot khi env chưa set.
// Runtime call sẽ fail rõ ràng.
export const authClient: SupabaseClient = createClient(
  AUTH_URL || 'https://invalid.supabase.co',
  AUTH_ANON_KEY || 'invalid',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

/** URL của Edge Functions — dùng cho create-user, delete-user, lookup-username. */
export const AUTH_FUNCTIONS_URL = `${AUTH_URL || ''}/functions/v1`;

/** Anon key — dùng cho public Edge Function (VD lookup-username) cần header apikey. */
export const AUTH_ANON_KEY_PUBLIC = AUTH_ANON_KEY || '';

/** Có phải env đã config đủ để login không. */
export function isAuthConfigured(): boolean {
  return Boolean(AUTH_URL && AUTH_ANON_KEY);
}

/**
 * Resolve identifier (email hoặc username) thành email dùng cho signInWithPassword.
 * - Nếu input có `@` → coi là email, return trực tiếp.
 * - Nếu không → gọi Edge Function lookup-username để lấy fake email tương ứng.
 * Throw generic error nếu không tìm thấy để chống enumeration.
 */
export async function resolveEmailForLogin(identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return trimmed;

  const res = await fetch(`${AUTH_FUNCTIONS_URL}/lookup-username`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: AUTH_ANON_KEY_PUBLIC,
    },
    body: JSON.stringify({ username: trimmed }),
  });

  // Backend luôn trả 200 với { email: string | null } để chống username
  // enumeration. Non-2xx chỉ khi infrastructure fail.
  if (!res.ok) {
    throw new Error('Sai thông tin đăng nhập');
  }

  const data = (await res.json()) as { email?: string | null };
  if (!data.email) throw new Error('Sai thông tin đăng nhập');
  return data.email;
}
