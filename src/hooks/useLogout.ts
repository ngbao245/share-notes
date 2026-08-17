// ============================================================
// useLogout — hook duy nhất cho logout
// ============================================================
//
// 3 UI logout (AuthGuard fallback, ProfileTab, HubPro dropdown)
// đều import hook này. Consumer: `const logout = useLogout(); await logout();`
//
// Design:
//   - Hook CHỈ call authClient.auth.signOut()
//   - KHÔNG tự navigate: AuthGuard sẽ redirect /login khi session state null
//   - KHÔNG tự clear storage: AuthGuard listener SIGNED_OUT chạy
//     clearUserScopedStorage() — tách concern rõ ràng
//
// Silent error:
//   signOut fail hiếm (Supabase local operation, chỉ chạm mạng cho refresh
//   token invalidate). Nếu fail, session localStorage có thể đã bị clear
//   partial → listener SIGNED_OUT vẫn fire trong hầu hết case.
// ============================================================

import { authClient } from '@/lib/authClient';

export function useLogout() {
  return async () => {
    try {
      await authClient.auth.signOut();
    } catch {
      // Silent — không throw để UI không kẹt loading state
    }
  };
}
