import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  User,
  Share2,
  Palette,
  Upload,
  Download,
  Code2,
  Globe,
  Lock,
  Copy,
  ExternalLink,
  Sun,
  Moon,
  Monitor,
  X,
  ImageIcon,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/cn';
import { getBasename, getPublicUrl, getOriginWithBasename } from '@/lib/basename';

import { SlugSchema, SpaceNameSchema } from '../schemas';
import type {
  BackgroundType,
  BlendMode,
  Bookmark,
  BookmarkCategory,
  BookmarkProfile,
  BookmarkTheme,
} from '../types';
import { BLEND_MODES } from '../types';
import { contrastPair } from '../lib/color';
// BookmarkBackground helpers not used here — LivePreview inlines its own preview
// styling since custom CSS is NOT applied inside the Settings dialog.
import type { UpdateProfileInput } from '../api';
import {
  downloadFile,
  exportCsv,
  exportHtml,
  parseCsv,
  parseHtml,
  type ImportedBookmark,
} from '../lib/import-export';

// ============================================================
// SettingsDialog — sidebar + main pane, fixed 820x580
// ============================================================

interface SettingsDialogProps {
  open: boolean;
  profile: BookmarkProfile | null;
  categories: BookmarkCategory[];
  bookmarks: Bookmark[];
  onClose: () => void;
  onSave: (patch: UpdateProfileInput) => void;
  onImport: (items: ImportedBookmark[]) => Promise<void>;
  onOpenCssEditor: () => void;
  isSubmitting?: boolean;
}

type SectionId = 'profile' | 'sharing' | 'appearance' | 'data' | 'advanced';

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: typeof User;
}[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'sharing', label: 'Sharing', icon: Share2 },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'data', label: 'Import / Export', icon: Upload },
    { id: 'advanced', label: 'Advanced', icon: Code2 },
  ];

const GRADIENT_PRESETS: {
  name: string;
  value: string;
  labelColor: string | null;
  titleColor: string | null;
}[] = [
    // Twilight (replaces old Default reset slot)
    { name: 'Twilight', value: 'linear-gradient(135deg, #4c669f 0%, #3b5998 50%, #192f6a 100%)', labelColor: '#ffffff', titleColor: '#cbd5e1' },
    // Warm
    { name: 'Sunset', value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', labelColor: '#ffffff', titleColor: '#fde68a' },
    { name: 'Peach', value: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', labelColor: '#ffffff', titleColor: '#fde68a' },
    { name: 'Coral', value: 'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)', labelColor: '#ffffff', titleColor: '#fde68a' },
    { name: 'Golden', value: 'linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)', labelColor: '#1f2937', titleColor: '#0f172a' },
    // Cool
    { name: 'Ocean', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labelColor: '#ffffff', titleColor: '#bae6fd' },
    { name: 'Mint', value: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', labelColor: '#134e4a', titleColor: '#0f766e' },
    { name: 'Sky', value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', labelColor: '#ffffff', titleColor: '#bae6fd' },
    { name: 'Forest', value: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)', labelColor: '#ffffff', titleColor: '#d1fae5' },
    // Purple / Pink
    { name: 'Purple', value: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', labelColor: '#ffffff', titleColor: '#fde68a' },
    { name: 'Berry', value: 'linear-gradient(135deg, #cc2b5e 0%, #753a88 100%)', labelColor: '#ffffff', titleColor: '#fde68a' },
    { name: 'Candy', value: 'linear-gradient(135deg, #d365ff 0%, #ff8fbc 100%)', labelColor: '#ffffff', titleColor: '#fde68a' },
    // Dark / Moody
    { name: 'Night', value: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)', labelColor: '#e5e7eb', titleColor: '#f9fafb' },
    { name: 'Cyber', value: 'linear-gradient(135deg, #000428 0%, #004e92 100%)', labelColor: '#ffffff', titleColor: '#bae6fd' },
    { name: 'Nordic', value: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)', labelColor: '#ffffff', titleColor: '#bae6fd' },
    // Solid subtle
    { name: 'Paper', value: 'linear-gradient(180deg, #fafafa 0%, #f1f1f1 100%)', labelColor: '#1f2937', titleColor: '#0f172a' },
    { name: 'Slate', value: 'linear-gradient(180deg, #1e1e2e 0%, #181825 100%)', labelColor: '#e5e7eb', titleColor: '#f9fafb' },
    // Extras
    { name: 'Aurora', value: 'linear-gradient(135deg, #00c9a7 0%, #92fe9d 50%, #c471ed 100%)', labelColor: '#ffffff', titleColor: '#fef3c7' },
    { name: 'Rose', value: 'linear-gradient(135deg, #ffdde1 0%, #ee9ca7 100%)', labelColor: '#7f1d1d', titleColor: '#9f1239' },
    { name: 'Midnight', value: 'linear-gradient(135deg, #232526 0%, #414345 100%)', labelColor: '#f9fafb', titleColor: '#e5e7eb' },
  ];

const SOLID_PRESETS: {
  name: string;
  value: string;
  labelColor: string;
  titleColor: string;
}[] = [
    { name: 'White', value: '#ffffff', labelColor: '#1f2937', titleColor: '#0f172a' },
    { name: 'Cream', value: '#fef3c7', labelColor: '#78350f', titleColor: '#92400e' },
    { name: 'Peach', value: '#fed7aa', labelColor: '#7c2d12', titleColor: '#9a3412' },
    { name: 'Rose', value: '#fbcfe8', labelColor: '#831843', titleColor: '#9f1239' },
    { name: 'Lavender', value: '#ddd6fe', labelColor: '#4c1d95', titleColor: '#5b21b6' },
    { name: 'Sky', value: '#bae6fd', labelColor: '#0c4a6e', titleColor: '#075985' },
    { name: 'Mint', value: '#bbf7d0', labelColor: '#14532d', titleColor: '#166534' },
    { name: 'Neutral', value: '#e5e7eb', labelColor: '#1f2937', titleColor: '#374151' },
    { name: 'Slate', value: '#334155', labelColor: '#f1f5f9', titleColor: '#e2e8f0' },
    { name: 'Navy', value: '#1e3a8a', labelColor: '#f9fafb', titleColor: '#dbeafe' },
    { name: 'Emerald', value: '#065f46', labelColor: '#f9fafb', titleColor: '#d1fae5' },
    { name: 'Charcoal', value: '#0f172a', labelColor: '#f9fafb', titleColor: '#cbd5e1' },
    // Extras
    { name: 'Coral', value: '#fecaca', labelColor: '#7f1d1d', titleColor: '#991b1b' },
    { name: 'Amber', value: '#fde68a', labelColor: '#78350f', titleColor: '#92400e' },
    { name: 'Teal', value: '#99f6e4', labelColor: '#134e4a', titleColor: '#115e59' },
    { name: 'Indigo', value: '#c7d2fe', labelColor: '#3730a3', titleColor: '#4338ca' },
    { name: 'Forest', value: '#14532d', labelColor: '#f9fafb', titleColor: '#d1fae5' },
  ];



const MAX_IMPORT = 500;

export default function SettingsDialog({
  open,
  profile,
  categories,
  bookmarks,
  onClose,
  onSave,
  onImport,
  onOpenCssEditor,
  isSubmitting,
}: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>('profile');
  const [draft, setDraft] = useState<UpdateProfileInput>({});
  const [slugError, setSlugError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({});
      setSlugError(null);
      setSection('profile');
    }
  }, [open, profile?.userId]);

  if (!profile) return null;

  // useMemo giữ ref current ổn định khi profile/draft không đổi. Giúp React.memo
  // ở LivePreview + PreviewCategories/PreviewHero skip re-render đúng cách.
  // NOTE: useMemo sau early return vi phạm rules-of-hooks; pre-existing từ trước
  // spec plugin-storage-facade. Cần refactor riêng, không đổi trong spec này.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const current = useMemo(() => ({ ...profile, ...draft }), [profile, draft]);

  function setField<K extends keyof UpdateProfileInput>(key: K, value: UpdateProfileInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function validateSlug(v: string) {
    const parsed = SlugSchema.safeParse(v);
    setSlugError(parsed.success ? null : parsed.error.issues[0]?.message ?? 'Invalid');
  }

  function handleSave() {
    if (Object.keys(draft).length === 0) {
      onClose();
      return;
    }
    if (slugError) {
      toast.error('Sửa slug trước khi lưu');
      return;
    }
    if (draft.spaceName !== undefined) {
      const parsed = SpaceNameSchema.safeParse(draft.spaceName);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'Space name không hợp lệ');
        return;
      }
    }
    onSave(draft);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 p-0',
          // Mobile: full-screen sheet
          'max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-screen max-md:max-w-none max-md:rounded-none',
          // Desktop: responsive dialog
          'md:h-[85vh] md:max-h-[85vh] md:w-[95vw] md:max-w-4xl',
        )}
      >
        <DialogHeader className="border-b border-border/60 px-5 py-3">
          <DialogTitle className="text-sm font-semibold">Bookmark settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Sidebar (desktop) / Horizontal tabs (mobile) */}
          <nav
            className={cn(
              'shrink-0 border-border/60 bg-muted/30',
              // Mobile: horizontal scroll tabs
              'flex overflow-x-auto border-b p-2 md:hidden',
            )}
            aria-label="Settings sections"
          >
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-150',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
          <nav
            className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-border/60 bg-muted/30 p-2 md:block"
            aria-label="Settings sections"
          >
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-150',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{s.label}</p>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Main pane */}
          <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
            {section === 'profile' && <ProfileSection current={current} setField={setField} />}
            {section === 'sharing' && (
              <SharingSection
                current={current}
                setField={setField}
                slugError={slugError}
                validateSlug={validateSlug}
              />
            )}
            {section === 'appearance' && (
              <AppearanceSection current={current} setField={setField} />
            )}
            {section === 'data' && (
              <DataSection
                categories={categories}
                bookmarks={bookmarks}
                onImport={onImport}
                onImportDone={onClose}
              />
            )}
            {section === 'advanced' && (
              <AdvancedSection
                customCss={current.customCss}
                onOpenCssEditor={onOpenCssEditor}
                onResetAppearance={() => {
                  if (
                    !window.confirm(
                      'Reset toàn bộ Appearance + Custom CSS về default?\nProfile, slug, và public toggle giữ nguyên.',
                    )
                  )
                    return;
                  setDraft((prev) => ({
                    ...prev,
                    theme: 'system',
                    columnCount: 3,
                    iconSize: 30,
                    backgroundType: 'default',
                    backgroundValue: '',
                    backgroundOverlayColor: null,
                    backgroundOverlayOpacity: 0,
                    backgroundBlendMode: 'normal',
                    categoryLabelColor: null,
                    categoryBgColor: null,
                    bookmarkTitleColor: null,
                    heroTitleColor: null,
                    heroSpaceColor: null,
                    heroUrlColor: null,
                    customCss: '',
                  }));
                  toast.success('Đã reset — bấm Save để lưu');
                }}
              />
            )}
          </main>
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !!slugError}>
            {isSubmitting ? 'Đang lưu…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Layout helpers
// ============================================================

// Shared hook: throttle onChange của native <input type="color"> qua rAF (max 1
// call/frame). Return [handleChange] để gắn vào input.onChange.
// - onCommit nhận latest hex đúng 1 lần/frame.
// - Cancel pending rAF khi unmount.
// - Không recreate scheduler mỗi render (useCallback+ref cho onCommit).
function useRafThrottledColor(onCommit: (hex: string) => void) {
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
    };
  }, []);

  return useCallback((next: string) => {
    pendingRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) onCommitRef.current(pending);
    });
  }, []);
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const hex = value ?? '#888888';
  const [localHex, setLocalHex] = useState(hex);

  // Sync local với parent CHỈ khi value đổi từ ngoài (VD reset button, preset apply).
  const lastSyncedHexRef = useRef(hex);
  useEffect(() => {
    if (hex !== lastSyncedHexRef.current) {
      lastSyncedHexRef.current = hex;
      setLocalHex(hex);
    }
  }, [hex]);

  const scheduleChange = useRafThrottledColor(
    useCallback(
      (next: string) => {
        lastSyncedHexRef.current = next;
        onChange(next);
      },
      [onChange],
    ),
  );

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background p-1.5">
        <input
          type="color"
          value={localHex}
          onChange={(e) => {
            setLocalHex(e.target.value);
            scheduleChange(e.target.value);
          }}
          className="h-6 w-8 shrink-0 cursor-pointer border-0 bg-transparent p-0"
          aria-label={label}
        />
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="Default"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground focus:outline-none"
        />
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            title="Reset về default"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SubGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      {title && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {title}
        </p>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ============================================================
// Profile
// ============================================================

function ProfileSection({
  current,
  setField,
}: {
  current: BookmarkProfile;
  setField: <K extends keyof UpdateProfileInput>(k: K, v: UpdateProfileInput[K]) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
      <div className="min-w-0">
        <SectionHeader
          title="Profile"
          hint="Tên và mô tả hiển thị trên public page. Preview bên phải cập nhật real-time."
        />

        <SubGroup title="Identity">
          <Field label="Display name" hint="Tên hiển thị thay username.">
            <Input
              value={current.displayName}
              onChange={(e) => setField('displayName', e.target.value)}
              maxLength={60}
              placeholder="Bao Nguyen"
              className="h-9"
            />
          </Field>

          <Field label="Space name" hint="Label bên phải tên. VD: Home, Work, Dev.">
            <Input
              value={current.spaceName}
              onChange={(e) => setField('spaceName', e.target.value)}
              maxLength={40}
              placeholder="Home"
              className="h-9"
            />
          </Field>
        </SubGroup>

        <SubGroup title="Links">
          <Field label="Webpage" hint="URL cá nhân, hiện dưới tên trong Hero header.">
            <Input
              value={current.webpage}
              onChange={(e) => setField('webpage', e.target.value)}
              placeholder="https://baonguyen.dev"
              type="url"
              className="h-9"
            />
          </Field>
        </SubGroup>
      </div>
      <aside className="sticky top-0 h-fit self-start">
        <LivePreview current={current} />
      </aside>
    </div>
  );
}

// ============================================================
// Sharing
// ============================================================

function SharingSection({
  current,
  setField,
  slugError,
  validateSlug,
}: {
  current: BookmarkProfile;
  setField: <K extends keyof UpdateProfileInput>(k: K, v: UpdateProfileInput[K]) => void;
  slugError: string | null;
  validateSlug: (v: string) => void;
}) {
  const publicUrl = getPublicUrl(`/bookmarks/${current.slug}`);
  const originWithBasename = getOriginWithBasename();
  const basename = getBasename();

  function copyUrl() {
    navigator.clipboard.writeText(publicUrl);
    toast.success('Đã copy URL');
  }

  return (
    <div>
      <SectionHeader title="Sharing" hint="Kiểm soát trang public của bạn." />

      {/* Hero toggle */}
      <div
        className={cn(
          'mb-5 rounded-xl border p-4 transition-colors duration-150',
          current.isPublic
            ? 'border-success/30 bg-success/5'
            : 'border-border/60 bg-muted/30',
        )}
      >
        <div className="flex items-center gap-3">
          {current.isPublic ? (
            <Globe className="h-5 w-5 shrink-0 text-success" />
          ) : (
            <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {current.isPublic ? 'Trang đang public' : 'Trang đang private'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {current.isPublic
                ? 'Ai có URL cũng xem được. Có thể ẩn category riêng lẻ bằng dot xanh ở header category.'
                : 'Chỉ bạn xem được. Bật để share URL công khai.'}
            </p>
          </div>
          <Switch
            checked={current.isPublic}
            onCheckedChange={(v) => setField('isPublic', v)}
          />
        </div>
      </div>

      <SubGroup title="Public URL">
        <Field label="Slug" hint={`3-30 ký tự [a-z0-9-]. Không dùng "admin", "api"…`}>
          <div className="flex items-center gap-1 text-xs">
            <span className="whitespace-nowrap font-mono text-muted-foreground">
              {originWithBasename}/bookmarks/
            </span>
            <Input
              value={current.slug}
              onChange={(e) => {
                const v = e.target.value.toLowerCase();
                setField('slug', v);
                validateSlug(v);
              }}
              className="h-9 flex-1 font-mono text-xs"
            />
          </div>
          {slugError && <p className="mt-1 text-xs text-destructive">{slugError}</p>}
        </Field>

        {current.isPublic && (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
            <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
              {publicUrl}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={copyUrl}
              title="Copy URL"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" asChild title="Preview">
              <a href={`${basename}/bookmarks/${current.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        )}
      </SubGroup>
    </div>
  );
}

// ============================================================
// Appearance
// ============================================================

function AppearanceSection({
  current,
  setField,
}: {
  current: BookmarkProfile;
  setField: <K extends keyof UpdateProfileInput>(k: K, v: UpdateProfileInput[K]) => void;
}) {
  // Throttle Pick swatch color input (Solid tab). Combine 3 setField vào 1 rAF
  // batch → 1 render/frame thay vì 3.
  const pickSolidCommit = useRafThrottledColor(
    useCallback(
      (hex: string) => {
        const { label, title } = contrastPair(hex);
        // Badge bg=label (contrast với page bg hex), text=contrast pair từ label.
        const { label: badgeText } = contrastPair(label);
        setField('backgroundValue', hex);
        setField('categoryBgColor', label);
        setField('categoryLabelColor', badgeText);
        setField('bookmarkTitleColor', title);
        setField('heroTitleColor', label);
        setField('heroSpaceColor', title);
        setField('heroUrlColor', title);
      },
      [setField],
    ),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
      <div className="min-w-0">
        <SectionHeader
          title="Appearance"
          hint="Diện mạo bookmark page. Preview bên phải cập nhật real-time."
        />

        <SubGroup title="Header">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-background p-3">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground">Hero header</p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                Superdense-style h1 title + space name + URL trên đầu bookmark grid.
                Tắt để chỉ hiện grid.
              </p>
            </div>
            <Switch
              checked={current.showHero}
              onCheckedChange={(v) => setField('showHero', v)}
              aria-label="Hero header"
            />
          </div>

          {current.showHero && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <ColorPicker
                label="Title color"
                value={current.heroTitleColor}
                onChange={(v) => setField('heroTitleColor', v)}
              />
              <ColorPicker
                label="Space color"
                value={current.heroSpaceColor}
                onChange={(v) => setField('heroSpaceColor', v)}
              />
              <ColorPicker
                label="URL color"
                value={current.heroUrlColor}
                onChange={(v) => setField('heroUrlColor', v)}
              />
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Muốn đổi size, font-family, weight? Dùng Custom CSS editor trong Advanced
            (target <code>.bibo-hero-title</code>, <code>.spaces-link</code>,
            <code>.user-static-link</code>).
          </p>

          <div className="mt-4 space-y-2 border-t border-border/40 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Text colors
            </p>
            <div className="grid grid-cols-3 gap-3">
              <ColorPicker
                label="Category label"
                value={current.categoryLabelColor}
                onChange={(v) => setField('categoryLabelColor', v)}
              />
              <ColorPicker
                label="Category background"
                value={current.categoryBgColor}
                onChange={(v) => setField('categoryBgColor', v)}
              />
              <ColorPicker
                label="Bookmark title (hover)"
                value={current.bookmarkTitleColor}
                onChange={(v) => setField('bookmarkTitleColor', v)}
              />
            </div>
          </div>
        </SubGroup>

        <SubGroup title="Theme">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'light', label: 'Light', Icon: Sun },
                { id: 'dark', label: 'Dark', Icon: Moon },
                { id: 'system', label: 'System', Icon: Monitor },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = current.theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setField('theme', id as BookmarkTheme)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors duration-150',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </SubGroup>

        <SubGroup title="Layout">
          <Field label="Columns" hint="Số cột hiển thị category (1-4).">
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setField('columnCount', n)}
                  className={cn(
                    'flex h-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs transition-colors duration-150',
                    current.columnCount === n
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  <ColumnGlyph n={n} active={current.columnCount === n} />
                  <span className="font-medium">{n}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Icon size — ${current.iconSize}px`}>
            <input
              type="range"
              min={20}
              max={60}
              step={2}
              value={current.iconSize}
              onChange={(e) => setField('iconSize', parseInt(e.target.value, 10))}
              className="w-full"
            />
          </Field>
        </SubGroup>

        <SubGroup title="Background">
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                {
                  id: 'default' as const,
                  label: 'Default',
                  swatch: 'bg-muted border border-border/60',
                  style: undefined as React.CSSProperties | undefined,
                },
                {
                  id: 'solid' as const,
                  label: 'Solid',
                  swatch: '',
                  style: { background: '#4facfe' } as React.CSSProperties,
                },
                {
                  id: 'gradient' as const,
                  label: 'Gradient',
                  swatch: '',
                  style: {
                    background:
                      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  } as React.CSSProperties,
                },
                {
                  id: 'image' as const,
                  label: 'Image',
                  swatch: '',
                  style: {
                    background:
                      'linear-gradient(45deg, #94a3b8 25%, transparent 25%, transparent 75%, #94a3b8 75%), linear-gradient(45deg, #94a3b8 25%, #cbd5e1 25%, #cbd5e1 75%, #94a3b8 75%)',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 4px 4px',
                  } as React.CSSProperties,
                },
              ]
            ).map(({ id, label, swatch, style }) => {
              const active = current.backgroundType === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (current.backgroundType !== id) {
                      setField('backgroundType', id as BackgroundType);
                      setField('backgroundValue', '');
                    }
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors duration-150',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  <span
                    className={cn('h-6 w-full rounded', swatch)}
                    style={style}
                  />
                  {label}
                </button>
              );
            })}
          </div>

          {current.backgroundType === 'solid' && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Chọn màu preset hoặc paste hex tuỳ ý:
              </p>
              <div className="grid grid-cols-6 gap-2">
                {SOLID_PRESETS.map((s) => {
                  const active = current.backgroundValue === s.value;
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => {
                        setField('backgroundValue', s.value);
                        // Category badge: bg=labelColor, text=contrast pair từ labelColor.
                        const { label: badgeText } = contrastPair(s.labelColor);
                        setField('categoryBgColor', s.labelColor);
                        setField('categoryLabelColor', badgeText);
                        setField('bookmarkTitleColor', s.titleColor);
                        setField('heroTitleColor', s.labelColor);
                        setField('heroSpaceColor', s.titleColor);
                        setField('heroUrlColor', s.titleColor);
                      }}
                      className={cn(
                        'relative flex h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 transition-transform duration-150 hover:scale-[1.03]',
                        active ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
                      )}
                      style={{ background: s.value }}
                      title={s.name}
                      aria-label={s.name}
                    >
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wider"
                        style={{ color: s.labelColor }}
                      >
                        Aa
                      </span>
                      <span
                        className="text-[9px] font-medium"
                        style={{ color: s.titleColor }}
                      >
                        {s.name}
                      </span>
                    </button>
                  );
                })}
                {/* Pick from palette — native color picker */}
                <label
                  className={cn(
                    'relative flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 border-border/60 transition-transform duration-150 hover:scale-[1.03]',
                  )}
                  style={{
                    background:
                      'conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
                  }}
                  title="Pick from palette"
                  aria-label="Pick color from palette"
                >
                  <input
                    type="color"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    onChange={(e) => pickSolidCommit(e.target.value)}
                  />
                  <span className="pointer-events-none rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                    Pick
                  </span>
                </label>
              </div>
              <Input
                value={current.backgroundValue}
                onChange={(e) => setField('backgroundValue', e.target.value)}
                placeholder="#hex hoặc rgb(...)"
                className="h-8 font-mono text-xs"
              />
            </div>
          )}

          {current.backgroundType === 'gradient' && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Chọn preset hoặc paste CSS gradient tuỳ ý:
              </p>
              <div className="grid grid-cols-4 gap-2">
                {GRADIENT_PRESETS.map((g) => {
                  const active = current.backgroundValue === g.value;
                  return (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => {
                        setField('backgroundValue', g.value);
                        // Category badge: bg=labelColor, text=contrast pair từ labelColor.
                        // contrastPair() tự tính text đọc được trên bg hex đó.
                        if (g.labelColor) {
                          const { label: badgeText } = contrastPair(g.labelColor);
                          setField('categoryBgColor', g.labelColor);
                          setField('categoryLabelColor', badgeText);
                        }
                        setField('bookmarkTitleColor', g.titleColor);
                        setField('heroTitleColor', g.labelColor);
                        setField('heroSpaceColor', g.titleColor);
                        setField('heroUrlColor', g.titleColor);
                      }}
                      className={cn(
                        'relative flex flex-col items-start gap-1 overflow-hidden rounded-lg border-2 p-2 text-left transition-transform duration-150 hover:scale-[1.02]',
                        active ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
                      )}
                      style={{ background: g.value }}
                      title={g.name}
                      aria-label={g.name}
                    >
                      <span
                        className="inline-flex items-center rounded-full bg-white/25 px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm"
                        style={{ color: g.labelColor ?? undefined }}
                      >
                        Social
                      </span>
                      <div className="flex gap-1">
                        <span className="h-4 w-4 rounded-full bg-white/70" />
                        <span className="h-4 w-4 rounded-full bg-white/55" />
                        <span className="h-4 w-4 rounded-full bg-white/45" />
                      </div>
                      <span
                        className="mt-1 text-[10px] font-semibold drop-shadow"
                        style={{ color: g.titleColor ?? undefined }}
                      >
                        {g.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Input
                value={current.backgroundValue}
                onChange={(e) => setField('backgroundValue', e.target.value)}
                placeholder="linear-gradient(...) hoặc CSS bất kỳ"
                className="h-8 font-mono text-xs"
              />
            </div>
          )}

          {current.backgroundType === 'image' && (
            <ImageUploadField
              value={current.backgroundValue}
              onChange={(v) => setField('backgroundValue', v)}
            />
          )}
        </SubGroup>

        <SubGroup title="Overlay">
          <p className="text-[11px] text-muted-foreground">
            Phủ 1 lớp màu blend lên background. Opacity = 0 để tắt.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <ColorPicker
              label="Overlay color"
              value={current.backgroundOverlayColor}
              onChange={(v) => setField('backgroundOverlayColor', v)}
            />
            <Field label="Blend mode">
              <select
                value={current.backgroundBlendMode}
                onChange={(e) => setField('backgroundBlendMode', e.target.value as BlendMode)}
                className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={`Overlay opacity — ${current.backgroundOverlayOpacity}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={current.backgroundOverlayOpacity}
              onChange={(e) =>
                setField('backgroundOverlayOpacity', parseInt(e.target.value, 10))
              }
              className="w-full"
            />
          </Field>
        </SubGroup>

        <SubGroup title="Behavior">
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-background p-3">
            <div>
              <p className="text-xs font-medium text-foreground">Open in same tab</p>
              <p className="text-[11px] text-muted-foreground">
                Click bookmark thay trang hiện tại thay vì mở tab mới.
              </p>
            </div>
            <Switch
              checked={current.openInSameTab}
              onCheckedChange={(v) => setField('openInSameTab', v)}
            />
          </div>
        </SubGroup>
      </div>

      {/* h-fit prevents CSS Grid from stretching aside to left column height, which would
          collapse position:sticky range to 0. self-start reinforces no-stretch. Sticky then
          pins preview at top of scrolling <main> as user scrolls Appearance section. */}
      <aside className="sticky top-0 h-fit self-start">
        <LivePreview current={current} />
      </aside>
    </div>
  );
}

// Static preview data — hoisted outside component để không tạo array mới mỗi render.
const FAKE_CATEGORIES: readonly { name: string; letters: readonly string[] }[] = [
  { name: 'Design', letters: ['D', 'F', 'B', 'I'] },
  { name: 'Dev', letters: ['G', 'S', 'V', 'N', 'T'] },
];

const LivePreview = memo(function LivePreview({ current }: { current: BookmarkProfile }) {
  // useMemo cho style objects để children nhận stable ref khi bg/overlay không đổi.
  const wrapperStyle = useMemo<CSSProperties>(() => {
    if (current.backgroundType === 'solid' && current.backgroundValue) {
      return { background: current.backgroundValue };
    }
    if (current.backgroundType === 'gradient' && current.backgroundValue) {
      return { background: current.backgroundValue };
    }
    if (current.backgroundType === 'image' && current.backgroundValue) {
      return {
        backgroundImage: `url(${current.backgroundValue})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    return {};
  }, [current.backgroundType, current.backgroundValue]);

  const overlayStyle = useMemo<CSSProperties | null>(
    () =>
      current.backgroundOverlayColor && current.backgroundOverlayOpacity > 0
        ? {
          backgroundColor: current.backgroundOverlayColor,
          opacity: current.backgroundOverlayOpacity / 100,
          mixBlendMode: current.backgroundBlendMode as CSSProperties['mixBlendMode'],
        }
        : null,
    [
      current.backgroundOverlayColor,
      current.backgroundOverlayOpacity,
      current.backgroundBlendMode,
    ],
  );

  const size = Math.max(18, Math.min(40, Math.round(current.iconSize * 0.7)));
  const cols = Math.min(2, current.columnCount);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Live preview
        </p>
        <span className="inline-flex items-center gap-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-success">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse [animation-duration:2s] motion-reduce:animate-none" />
          preview
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded-lg border border-border/60 bg-background shadow-inner"
        style={{ height: 460, ...wrapperStyle }}
      >
        {overlayStyle && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0"
            style={overlayStyle}
          />
        )}

        <div className="relative z-10 flex items-center gap-1.5 border-b border-border/30 bg-background/70 px-2.5 py-1.5 backdrop-blur-sm">
          <span className="text-[9px] font-semibold text-foreground/80">Bookmarks</span>
          <div className="ml-auto h-3 w-14 rounded bg-muted/60" />
        </div>

        {current.showHero && (
          <PreviewHero
            displayName={current.displayName}
            spaceName={current.spaceName}
            slug={current.slug}
            webpage={current.webpage}
            heroTitleColor={current.heroTitleColor}
            heroSpaceColor={current.heroSpaceColor}
            heroUrlColor={current.heroUrlColor}
          />
        )}

        <PreviewCategories
          cols={cols}
          size={size}
          categoryLabelColor={current.categoryLabelColor}
          categoryBgColor={current.categoryBgColor}
          bookmarkTitleColor={current.bookmarkTitleColor}
        />
      </div>
    </div>
  );
});

// Isolated hero preview — chỉ re-render khi các field liên quan hero thay đổi.
// Drag category color KHÔNG trigger re-render này.
const PreviewHero = memo(function PreviewHero(props: {
  displayName: string;
  spaceName: string;
  slug: string;
  webpage: string;
  heroTitleColor: string | null;
  heroSpaceColor: string | null;
  heroUrlColor: string | null;
}) {
  const {
    displayName,
    spaceName,
    slug,
    webpage,
    heroTitleColor,
    heroSpaceColor,
    heroUrlColor,
  } = props;
  const urlText = webpage?.trim()
    ? webpage.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : null;
  return (
    <div className="relative z-10 flex flex-col items-start gap-0 px-2.5 pb-1 pt-2 text-left">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <h1
          className="text-sm font-bold leading-tight tracking-tight text-foreground"
          style={heroTitleColor ? { color: heroTitleColor } : undefined}
        >
          {displayName || slug || 'user'}
        </h1>
        {spaceName && (
          <span
            className="text-[9px] font-medium text-muted-foreground"
            style={heroSpaceColor ? { color: heroSpaceColor } : undefined}
          >
            {spaceName}
          </span>
        )}
      </div>
      {urlText && (
        <p
          className="mt-0.5 text-[8px] text-muted-foreground/60"
          style={heroUrlColor ? { color: heroUrlColor } : undefined}
        >
          {urlText}
        </p>
      )}
    </div>
  );
});

// Isolated categories grid — chỉ re-render khi cols/size/category colors thay đổi.
// Letter avatars HSL calc chỉ chạy khi memo miss.
const PreviewCategories = memo(function PreviewCategories(props: {
  cols: number;
  size: number;
  categoryLabelColor: string | null;
  categoryBgColor: string | null;
  bookmarkTitleColor: string | null;
}) {
  const { cols, size, categoryLabelColor, categoryBgColor, bookmarkTitleColor } = props;
  const badgeStyle: CSSProperties = {};
  if (categoryLabelColor) badgeStyle.color = categoryLabelColor;
  if (categoryBgColor) badgeStyle.background = categoryBgColor;
  const titleStyle: CSSProperties | undefined = bookmarkTitleColor
    ? { color: bookmarkTitleColor }
    : undefined;

  return (
    <div className="relative z-10 p-2.5">
      <div className={cn('grid gap-3', cols === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {FAKE_CATEGORIES.slice(0, cols).map((cat) => (
          <div key={cat.name}>
            <div className="mb-1.5">
              <span
                className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-primary-foreground shadow-sm"
                style={Object.keys(badgeStyle).length ? badgeStyle : undefined}
              >
                {cat.name}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {cat.letters.map((letter, i) => (
                <div
                  key={i}
                  className="shrink-0 shadow-sm"
                  style={{ width: size, height: size }}
                >
                  <div
                    className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
                    style={{
                      background: `hsl(${(letter.charCodeAt(0) * 37) % 360}, 55%, 60%)`,
                      fontSize: size * 0.42,
                    }}
                  >
                    {letter}
                  </div>
                </div>
              ))}
            </div>
            <p
              className="mt-1.5 truncate text-[9px] text-muted-foreground/70"
              style={titleStyle}
            >
              Hover title example
            </p>
          </div>
        ))}
      </div>
    </div>
  );
});

// Compress + downscale image on client, return base64 data URL.
async function compressImage(
  file: File,
  maxWidth = 1920,
  quality = 0.85,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new window.Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const ratio = img.width / img.height;
        if (ratio < 1.2) {
          toast.warning(
            'Ảnh hơi vuông/dọc — background sẽ crop ngang. Tỉ lệ 16:9 hoặc 3:2 đẹp nhất.',
          );
        } else if (ratio > 4) {
          toast.warning('Ảnh quá rộng (panorama) — có thể crop nhiều trên/dưới.');
        }
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas ctx'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

function ImageUploadField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isDataUrl = value.startsWith('data:');
  const hasImage = !!value;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Chỉ nhận ảnh (JPG / PNG / WebP)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Ảnh quá lớn (tối đa 5MB)');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      const kb = Math.round((dataUrl.length * 0.75) / 1024);
      onChange(dataUrl);
      toast.success(`Đã upload — ${kb} KB sau khi nén`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xử lý được ảnh');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {hasImage ? (
        <div className="relative overflow-hidden rounded-md border border-border/60">
          <img
            src={value}
            alt="Background preview"
            className="h-28 w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="absolute right-1.5 top-1.5 flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-3 w-3" />
              Change
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 w-7 p-0"
              onClick={() => onChange('')}
              disabled={busy}
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={cn(
            'flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-border/60 bg-muted/20 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
            busy && 'cursor-wait opacity-60',
          )}
        >
          <ImageIcon className="h-5 w-5" />
          <span>{busy ? 'Đang nén…' : 'Click để upload ảnh'}</span>
          <span className="text-[10px] text-muted-foreground/60">
            JPG / PNG / WebP, tối đa 5MB
          </span>
        </button>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          hoặc URL
        </span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      <Input
        value={isDataUrl ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://example.com/bg.jpg"
        className="h-8 text-xs"
      />
    </div>
  );
}

function ColumnGlyph({ n, active }: { n: number; active: boolean }) {
  const color = active ? 'bg-primary' : 'bg-muted-foreground/40';
  return (
    <div className="flex items-end gap-0.5">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className={cn('h-3 w-1 rounded-sm', color)} />
      ))}
    </div>
  );
}

// ============================================================
// Data (Import / Export)
// ============================================================

function DataSection({
  categories,
  bookmarks,
  onImport,
  onImportDone,
}: {
  categories: BookmarkCategory[];
  bookmarks: Bookmark[];
  onImport: (items: ImportedBookmark[]) => Promise<void>;
  onImportDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ImportedBookmark[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  function handleFile(file: File) {
    setErrors([]);
    setParsed([]);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (file.name.toLowerCase().endsWith('.csv')) {
        const { rows, errors: errs } = parseCsv(text);
        setParsed(rows);
        setErrors(errs);
      } else {
        const rows = parseHtml(text);
        setParsed(rows);
        if (rows.length === 0) setErrors(['Không parse được bookmark nào từ HTML']);
      }
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (parsed.length === 0) return;
    if (parsed.length > MAX_IMPORT) {
      toast.error(`Tối đa ${MAX_IMPORT} bookmark / lần. File có ${parsed.length}.`);
      return;
    }
    setImporting(true);
    try {
      await onImport(parsed);
      toast.success(`Đã import ${parsed.length} bookmark`);
      setParsed([]);
      onImportDone();
    } catch (e) {
      toast.error('Import lỗi: ' + (e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Import / Export"
        hint="Đưa bookmark từ trình duyệt vào hoặc backup ra file."
      />

      <SubGroup title="Import">
        <p className="text-xs text-muted-foreground">
          Chấp nhận file HTML (Chrome / Firefox export bookmark) hoặc CSV (cột{' '}
          <code className="rounded bg-muted px-1 font-mono">url,title,category,note</code>). Max{' '}
          {MAX_IMPORT} bookmark / lần.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".html,.csv,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" /> Chọn file
        </Button>

        {parsed.length > 0 && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            <p className="mb-1 font-medium">Sẽ import {parsed.length} bookmark:</p>
            <ul className="max-h-24 space-y-0.5 overflow-y-auto">
              {parsed.slice(0, 8).map((b, i) => (
                <li key={i} className="truncate">
                  <span className="text-primary">[{b.category}]</span> {b.title}
                </li>
              ))}
              {parsed.length > 8 && (
                <li className="text-muted-foreground">…và {parsed.length - 8} khác</li>
              )}
            </ul>
            <Button
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={confirmImport}
              disabled={importing}
            >
              {importing ? 'Đang import…' : `Confirm import ${parsed.length}`}
            </Button>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {errors.slice(0, 3).map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
      </SubGroup>

      <SubGroup title="Export">
        <p className="text-xs text-muted-foreground">
          Backup toàn bộ {bookmarks.length} bookmark / {categories.length} category.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              downloadFile(
                `bookmarks-${new Date().toISOString().slice(0, 10)}.html`,
                'text/html',
                exportHtml(categories, bookmarks),
              );
              toast.success('Đã tải HTML');
            }}
          >
            <Download className="h-3.5 w-3.5" /> HTML
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              downloadFile(
                `bookmarks-${new Date().toISOString().slice(0, 10)}.csv`,
                'text/csv',
                exportCsv(categories, bookmarks),
              );
              toast.success('Đã tải CSV');
            }}
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </SubGroup>
    </div>
  );
}

// ============================================================
// Advanced
// ============================================================

function AdvancedSection({
  customCss,
  onOpenCssEditor,
  onResetAppearance,
}: {
  customCss: string;
  onOpenCssEditor: () => void;
  onResetAppearance: () => void;
}) {
  return (
    <div>
      <SectionHeader title="Advanced" hint="Tùy biến sâu — cho power user." />

      <SubGroup title="Custom CSS">
        <p className="text-xs text-muted-foreground">
          Viết CSS áp dụng cho cả trang edit và trang public. Editor có preview split-view + toggle
          light/dark.
        </p>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={onOpenCssEditor} className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> Open CSS editor
          </Button>
          {customCss ? (
            <span className="text-[11px] text-muted-foreground">
              {customCss.length} ký tự đã lưu
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/60">Chưa có CSS</span>
          )}
        </div>
      </SubGroup>

      <SubGroup title="Reset">
        <p className="text-xs text-muted-foreground">
          Đưa toàn bộ Appearance (theme, layout, background, overlay, text colors) + Custom CSS về
          default. KHÔNG đụng vào profile, slug, hay trạng thái public.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onResetAppearance}
        >
          Reset to default
        </Button>
      </SubGroup>
    </div>
  );
}
