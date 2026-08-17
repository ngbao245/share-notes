import { useState } from 'react';
import { LogOut, Shield, User, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { authClient } from '@/lib/authClient';
import { useAuthStore } from '@/stores/authStore';
import { useLogout } from '@/hooks/useLogout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import AvatarPicker from './AvatarPicker';

const FAKE_EMAIL_DOMAIN = 'bibo-tools.local';

function isFakeEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${FAKE_EMAIL_DOMAIN}`);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ProfileTab() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const logout = useLogout();
  const currentEmail = session?.user.email ?? '';
  const usingFakeEmail = isFakeEmail(currentEmail);

  // Fake email là identifier nội bộ, không phải email thật user muốn dùng.
  // Không prefill vào input để user gõ mới, tránh nhầm hiểu.
  const [emailDraft, setEmailDraft] = useState(usingFakeEmail ? '' : currentEmail);
  const [saving, setSaving] = useState(false);

  async function handleLogout() {
    await logout();
  }

  async function handleSaveEmail() {
    const email = emailDraft.trim();
    if (!email) {
      toast.error('Email không được để trống');
      return;
    }
    if (!isValidEmail(email)) {
      toast.error('Email không hợp lệ');
      return;
    }
    if (email.toLowerCase().endsWith(`@${FAKE_EMAIL_DOMAIN}`)) {
      toast.error(`Không dùng được domain ${FAKE_EMAIL_DOMAIN}`);
      return;
    }
    if (email === currentEmail) {
      toast.info('Email không thay đổi');
      return;
    }

    setSaving(true);
    try {
      const { error } = await authClient.auth.updateUser({ email });
      if (error) {
        toast.error(error.message);
        return;
      }
      // Supabase yêu cầu user confirm mail. Email chưa đổi thật cho tới khi
      // user click link trong inbox → feedback rõ để user không hiểu nhầm.
      toast.success(`Đã gửi email xác nhận đến ${email}. Check inbox để hoàn tất.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update fail');
    } finally {
      setSaving(false);
    }
  }

  if (!session || !profile) return null;

  const isAdmin = profile.role === 'admin';

  return (
    <div className="space-y-4">
      <div className="border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          {isAdmin ? (
            <Shield className="h-4 w-4 text-primary" />
          ) : (
            <User className="h-4 w-4 text-muted-foreground" />
          )}
          <h3 className="text-sm font-medium text-foreground">Tài khoản</h3>
        </div>

        <dl className="space-y-3 text-sm">
          <Row
            label="Username"
            value={
              profile.username ? (
                <code className="font-mono text-foreground">{profile.username}</code>
              ) : (
                <span className="text-muted-foreground">(chưa set)</span>
              )
            }
          />

          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <div className="flex gap-2">
              <Input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                disabled={saving}
                placeholder="you@example.com"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleSaveEmail}
                disabled={saving || emailDraft === currentEmail}
                className="gap-1"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Lưu
              </Button>
            </div>
          </div>

          <Row
            label="Role"
            value={
              <span
                className={
                  isAdmin
                    ? 'bg-primary/15 px-2 py-0.5 text-xs text-primary'
                    : 'bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                }
              >
                {profile.role}
              </span>
            }
          />
          <Row
            label="Tool được dùng"
            value={
              isAdmin
                ? 'Tất cả (admin)'
                : profile.allowed_tools.length === 0
                  ? 'Chưa được cấp'
                  : profile.allowed_tools.join(', ')
            }
          />
          <Row label="User ID" value={<code className="text-xs">{profile.id}</code>} />
        </dl>
      </div>

      <AvatarPicker />

      <Button variant="outline" onClick={handleLogout} className="gap-2">
        <LogOut className="h-4 w-4" />
        Đăng xuất
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
