// ============================================================
// authStore — Zustand store cho auth session + profile
// ============================================================
//
// Mirror `authClient.auth` session + profile row vào memory cho
// component subscribe. KHÔNG persist (Supabase SDK đã persist session
// qua localStorage).
//
// Flow:
//   1. AuthGuard boot → gọi authClient.auth.getSession() → setSession
//   2. useProfileQuery chạy sau khi có session → setProfile
//   3. onAuthStateChange event → setSession null → guard redirect login
//
// Helpers (isAdmin, checkPermission, getAllowedTools) sống trong
// `@/lib/core-sdk/auth` — không duplicate ở store.
// ============================================================

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'user';

export interface Profile {
  id: string;
  role: UserRole;
  allowed_tools: string[];
  created_at: string;
  /** Username identity, unique case-insensitive. Nullable với data cũ chưa migrate. */
  username: string | null;
  /** Path relative trong bucket avatars. NULL = chưa chọn. */
  avatar_url: string | null;
  /** Timestamp lần login gần nhất. NULL nếu chưa login lần nào. */
  last_login_at: string | null;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** True khi initial boot chưa xong (chưa biết có session hay không). */
  initializing: boolean;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setInitializing: (v: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  initializing: true,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setInitializing: (initializing) => set({ initializing }),
  clear: () => set({ session: null, profile: null }),
}));
