// ============================================================
// AuthGuard — wrap route để gate app entry
// ============================================================
//
// Boot flow:
//   1. Gọi authClient.auth.getSession() lấy session persist localStorage
//   2. Nếu session tồn tại và gần expire (< 5 phút) → proactive refresh
//      trước khi render app. Tránh race: component đầu fetch API bị 401
//      trong lúc SDK đang refresh nền, gây flash error state.
//   3. Subscribe onAuthStateChange để bắt SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED
//   4. Fetch profile qua useProfileQuery
//   5. Nếu chưa auth → redirect /login (giữ URL cũ trong ?next=)
//   6. Nếu auth + profile OK → render children
//
// Cache cleanup khi logout / user switch:
//   Delegate cho `clearUserScopedStorage()` trong `@/lib/auth/user-scope`.
//   Tool code KHÔNG cần biết — cache của họ tự bị wipe.
//
// Debug log:
//   Console.warn khi session bị null bất thường (không phải user chủ động
//   logout). Giúp trace lý do bị đá ra: refresh token hết hạn, bị revoke,
//   network fail... Xem Console F12 khi gặp bug.
// ============================================================

import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/authClient';
import { useAuthStore, type Profile } from '@/stores/authStore';
import { clearUserScopedStorage } from '@/lib/auth/user-scope';
import { migrateLegacyStorageForUser } from '@/lib/plugin-storage/migrate-legacy';
import { hydrateRagActiveSession } from '@/stores/ragStore';
import { useLogout } from '@/hooks/useLogout';
import { ErrorState, EmptyState, LoadingState } from '@/components/shared';
import { Lock } from 'lucide-react';

/** Ngưỡng thời gian còn lại (giây) mà Kiro chủ động refresh session trước khi render. */
const REFRESH_THRESHOLD_SEC = 5 * 60;

async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await authClient
    .from('profiles')
    .select('id, role, allowed_tools, created_at, username, avatar_url, last_login_at')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to load profile');
  }
  if (!data) {
    throw new Error('Profile row không tồn tại cho user này');
  }

  return data as Profile;
}

export default function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const qc = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const initializing = useAuthStore((s) => s.initializing);
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setInitializing = useAuthStore((s) => s.setInitializing);
  const logout = useLogout();

  // Track user id gần nhất để detect user switch (logout A → login B).
  // Không dùng session.user.id trong closure vì onAuthStateChange chỉ set
  // 1 lần, ref giữ giá trị mới nhất giữa các event.
  const lastUserIdRef = useRef<string | null>(null);

  // Boot: load session từ localStorage + proactive refresh nếu gần expire
  useEffect(() => {
    let mounted = true;

    void (async () => {
      const { data } = await authClient.auth.getSession();
      if (!mounted) return;

      let currentSession = data.session;

      // Proactive refresh: nếu session tồn tại nhưng gần expire → refresh
      // ngay để lần request đầu không bị 401. `expires_at` là unix timestamp
      // seconds. Nếu đã expire (< 0), refresh vẫn work vì refresh_token còn hạn.
      if (currentSession?.expires_at) {
        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = currentSession.expires_at - nowSec;

        if (remainingSec < REFRESH_THRESHOLD_SEC) {
          const { data: refreshed, error } = await authClient.auth.refreshSession();
          if (!mounted) return;

          if (error) {
            // Refresh token hết hạn / bị revoke / network fail — session sẽ null.
            // Guard tự redirect login. Log để debug.
             
            console.warn(
              `[AuthGuard] Boot refresh session fail: ${error.message}. User sẽ bị redirect login. ` +
              `Nguyên nhân thường: refresh_token expire, user bị admin xoá, hoặc rotation conflict giữa tabs.`,
            );
            currentSession = null;
          } else {
            currentSession = refreshed.session;
          }
        }
      }

      setSession(currentSession);
      lastUserIdRef.current = currentSession?.user.id ?? null;

      // Migrate legacy user-scope keys với real userId (chỉ chạy 1 lần / user / máy).
      // Sau đó hydrate ragStore.activeSessionId (module init lúc trước session ready).
      if (currentSession?.user.id) {
        migrateLegacyStorageForUser(currentSession.user.id);
        hydrateRagActiveSession();
      }

      setInitializing(false);
    })();

    const { data: sub } = authClient.auth.onAuthStateChange((event, newSession) => {
      const prevUserId = lastUserIdRef.current;
      const nextUserId = newSession?.user.id ?? null;
      setSession(newSession);

      // Log rõ khi session bị null bất thường (không phải user chủ động logout).
      // Giúp F12 Console thấy lý do bị đá ra khi bug xảy ra.
      if (!newSession && event !== 'SIGNED_OUT' && event !== 'INITIAL_SESSION') {
         
        console.warn(
          `[AuthGuard] Session null sau event "${event}". ` +
          `Có thể refresh token hết hạn / bị revoke / network fail. User sẽ bị redirect login.`,
        );
      }

      // SIGNED_OUT hoặc user đổi (A → B) → wipe cache user cũ để không leak
      // favorites/sessions/drafts sang user mới. `clearUserScopedStorage`
      // giữ lại preferences qua preserve list.
      const userChanged = prevUserId !== nextUserId;
      if (event === 'SIGNED_OUT' || (userChanged && prevUserId !== null)) {
        setProfile(null);
        qc.clear();
        void clearUserScopedStorage();
      } else if (!newSession) {
        // Fallback: newSession null nhưng không phải SIGNED_OUT event
        // (VD token expire) — vẫn phải reset profile.
        setProfile(null);
      }

      // Login mới (SIGNED_IN với userId mới) → migrate legacy + hydrate rag.
      // Skip nếu prevUserId trùng nextUserId (TOKEN_REFRESHED, cùng user).
      if (nextUserId && userChanged) {
        migrateLegacyStorageForUser(nextUserId);
        hydrateRagActiveSession();
      }

      lastUserIdRef.current = nextUserId;
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [qc, setSession, setProfile, setInitializing]);

  // Fetch profile sau khi có session
  const profileQuery = useQuery({
    queryKey: ['profile', session?.user.id],
    queryFn: () => fetchProfile(session!.user.id),
    enabled: Boolean(session?.user.id),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (profileQuery.data) setProfile(profileQuery.data);
  }, [profileQuery.data, setProfile]);

  // Đang load initial session
  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState label="Đang khởi tạo..." />
      </div>
    );
  }

  // Chưa có session → redirect login
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Có session, đang fetch profile
  if (profileQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState label="Đang tải hồ sơ..." />
      </div>
    );
  }

  // Profile fetch fail
  if (profileQuery.isError) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <ErrorState
          message={
            profileQuery.error instanceof Error
              ? profileQuery.error.message
              : 'Không load được profile'
          }
          onRetry={() => profileQuery.refetch()}
        />
      </div>
    );
  }

  // Profile empty (data corruption: session OK nhưng không có row profiles)
  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <EmptyState
          icon={Lock}
          title="Tài khoản chưa được cấp quyền"
          description="Liên hệ admin để kích hoạt tài khoản."
          action={
            <button
              className="text-sm text-primary underline"
              onClick={() => void logout()}
            >
              Đăng xuất
            </button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
