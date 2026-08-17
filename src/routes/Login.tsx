// ============================================================
// Login page — gate app entry
// ============================================================
//
// URL: /login (public route ngoài AuthGuard).
// Form email/username + password → authClient.auth.signInWithPassword.
// Query param ?next=... để redirect về URL user định vào sau login.
//
// Redirect strategy:
//   Sau signInWithPassword success, session update qua onAuthStateChange
//   → Zustand authStore.session không null → dòng `if (session) <Navigate>`
//   dưới đây trigger redirect qua React Router. KHÔNG dùng
//   window.location.href — full reload không cần thiết, gây flash trắng.
// ============================================================

import { useState, type FormEvent } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { Loader2, LogIn } from 'lucide-react';

import { authClient, isAuthConfigured, resolveEmailForLogin } from '@/lib/authClient';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Sanitize ?next param: chỉ nhận pathname bắt đầu bằng '/', không backslash,
// không '//' (protocol-relative). Fallback '/' nếu invalid.
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return '/';
  }
  if (!decoded.startsWith('/')) return '/';
  if (decoded.startsWith('//')) return '/';
  if (decoded.includes('\\')) return '/';
  return decoded;
}

/**
 * Fire-and-forget cập nhật last_login_at. Không block redirect.
 * Fail silent — chỉ là telemetry, không critical.
 */
function updateLastLoginAt(): void {
  void authClient.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;
    void authClient
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);
  });
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const session = useAuthStore((s) => s.session);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Đã login từ trước → về URL đích ngay.
  // Cũng chạy sau signIn thành công khi session state update.
  if (session) {
    return <Navigate to={safeNext(params.get('next'))} replace />;
  }

  const configured = isAuthConfigured();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      // Resolve identifier (email hoặc username) thành email.
      let email: string;
      try {
        email = await resolveEmailForLogin(identifier);
      } catch {
        setError('Sai thông tin đăng nhập');
        setSubmitting(false);
        return;
      }

      const { data, error: authErr } = await authClient.auth.signInWithPassword({
        email,
        password,
      });

      if (authErr) {
        // Generic message chống enumeration
        setError('Sai thông tin đăng nhập');
        setSubmitting(false);
        return;
      }

      // Manual set session vào Zustand ngay — không chờ onAuthStateChange listener
      // (fire async, có race làm component đứng ở trang login vài giây).
      // AuthGuard listener sẽ fire sau và setSession lại cùng session (no-op).
      if (data.session) {
        useAuthStore.getState().setSession(data.session);
      }

      // Fire-and-forget last_login_at — không block redirect
      updateLastLoginAt();

      // KHÔNG setSubmitting(false) ở đây: session state sẽ update qua
      // onAuthStateChange, component re-render với `if (session)` trigger
      // <Navigate>, component unmount. Nếu setSubmitting(false) trước
      // navigate, có thể flash form empty 1 nhịp.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <LogIn className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Đăng nhập</h1>
        </div>

        {!configured && (
          <div className="mb-4 border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            Env `VITE_SUPABASE_AUTH_URL` chưa được set. Kiểm tra `.env`.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="identifier" className="text-xs text-muted-foreground">
              Email hoặc username
            </label>
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={submitting}
              required
              autoFocus
              placeholder="baobibo hoặc email@domain.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs text-muted-foreground">
              Mật khẩu
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
          </div>

          {error && (
            <div className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={submitting || !configured}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Đang đăng nhập...
              </>
            ) : (
              'Đăng nhập'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
