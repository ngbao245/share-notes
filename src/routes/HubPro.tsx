
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pin, PinOff, User, LogOut } from 'lucide-react';
import { PencilSparkles } from '@/components/icons/PencilSparkles';
import { useNavigate, Link } from 'react-router-dom';

import { TOOLS, TOOL_GROUPS, type Tool, type ToolGroup } from '@/lib/tools';
import { useToolAction } from '@/hooks/useToolAction';
import { useHubFavorites, useSaveHubFavorites } from '@/api/hubFavorites';
import { useToolCategories } from '@/api/toolCategories';
import { useThemeControls } from '@/tools/theme';
import type { ThemeId } from '@/tools/theme';
import { cn } from '@/lib/cn';
import WidgetArea from '@/tools/home-widgets/components/WidgetArea';
import { useAuthStore } from '@/stores/authStore';
import { useLogout } from '@/hooks/useLogout';
import { getAvatarUrl } from '@/api/avatars';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToolIcon } from '@/components/ToolIcon';
import { toast } from '@/components/ui/sonner';
import { LoadingState, EmptyState } from '@/components/shared';
import { useModalStore } from '@/stores/modalStore';
import { createToolStorage } from '@/lib/plugin-storage';

const favoritesStorage = createToolStorage<string[]>({
  toolId: 'hub',
  key: 'favorites',
  scope: 'user',
});

// ============================================================
// HubPro - bản REDESIGNED dùng shadcn/ui
// ============================================================
//
// Layout:
//   Header → Focus Layer → Favorites (full viewport đầu) → Categories → Footer
//
// Favorites: shortcut nhanh, chiếm trọn 100vh đầu tiên (trừ header/focus).
// Categories: hiển thị TẤT CẢ tools sắp theo group, scroll xuống sẽ thấy.
// 1 tool có thể xuất hiện ở cả 2 chỗ — favorite chỉ là shortcut.
// Tối đa 24 favorite slots.
// ============================================================

// 6 category fix cứng — user không thêm/xoá được.
// Thứ tự này là default order lần đầu vào app; user có thể reorder qua Setting.
const DEFAULT_GROUP_ORDER: ToolGroup[] = [
  'Productivity',
  'Finance',
  'Tracking',
  'Utilities',
  'Developer',
  'Admin',
];

const UNASSIGNED_CATEGORY = 'Unassigned';

const MAX_FAVORITES = 24;

export default function HubPro() {
  const handleClick = useToolAction();

  // Filter tools theo profile.allowed_tools. Admin → all tools.
  const profile = useAuthStore((s) => s.profile);
  const visibleTools = useMemo(() => {
    if (!profile) return [] as Tool[];
    if (profile.role === 'admin') return TOOLS;
    if (profile.allowed_tools.includes('*')) return TOOLS;
    return TOOLS.filter((t) => profile.allowed_tools.includes(t.id));
  }, [profile]);

  // Favorites — localStorage instant + Supabase sync
  const favQuery = useHubFavorites();
  const saveMut = useSaveHubFavorites();

  // Read initial from facade (instant), then override from Supabase when ready
  const [favoriteIds, setFavoriteIdsLocal] = useState<string[]>(() => favoritesStorage.get() ?? []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync logic: localStorage is source of truth (always freshest).
  // Only pull from Supabase when localStorage is empty (first-time user / new device).
  useEffect(() => {
    if (!favQuery.data) return;

    const localIds: string[] = favoritesStorage.get() ?? [];
    const supabaseIds = favQuery.data.ids;

    if (localIds.length === 0 && supabaseIds.length > 0) {
      // New device / cleared cache → pull from Supabase
      setFavoriteIdsLocal(supabaseIds);
      favoritesStorage.set(supabaseIds);
    } else if (localIds.length > 0 && supabaseIds.length === 0) {
      // localStorage has data, Supabase empty → push up (retry sync)
      saveMut.mutate({ ids: localIds, recordId: null });
    }
    // Both have data → localStorage wins (it's always updated on pin action)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favQuery.data]);

  // Save: localStorage instant + debounce Supabase sync
  const setFavoriteIds = useCallback(
    (ids: string[]) => {
      setFavoriteIdsLocal(ids);
      // Instant facade backup
      favoritesStorage.set(ids);
      // Debounce Supabase sync (500ms)
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        saveMut.mutate({ ids, recordId: favQuery.data?.recordId ?? null });
      }, 500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favQuery.data?.recordId],
  );

  // Flush on tab hidden (visibility change)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        saveMut.mutate({ ids: favoriteIds, recordId: favQuery.data?.recordId ?? null });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteIds, favQuery.data?.recordId]);

  const visibleToolIds = useMemo(() => new Set(visibleTools.map((t) => t.id)), [visibleTools]);
  const favoriteSet = new Set(favoriteIds);
  const favorites: Tool[] = favoriteIds
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter((t): t is Tool => !!t && visibleToolIds.has(t.id))
    .slice(0, MAX_FAVORITES); // hard limit khi render

  // Categories — lưu /Config. Mapping tool → category hoàn toàn dynamic.
  // Chưa config → dùng DEFAULT_GROUP_ORDER, mọi tool rơi vào Unassigned.
  const catQuery = useToolCategories();
  const { categoryOrder, toolsByCategory, unassignedTools } = useMemo(() => {
    const catData = catQuery.data?.data;
    const hasCustom = catData && catData.categories.length > 0;

    // Thứ tự category
    const order: string[] = hasCustom
      ? catData.categories
      : DEFAULT_GROUP_ORDER;

    const grouped: Record<string, Tool[]> = {};
    for (const cat of order) grouped[cat] = [];

    const unassigned: Tool[] = [];
    const mapping = catData?.mapping ?? {};
    for (const tool of visibleTools) {
      const cat = mapping[tool.id];
      if (cat && grouped[cat]) {
        grouped[cat].push(tool);
      } else {
        unassigned.push(tool);
      }
    }

    return {
      categoryOrder: order,
      toolsByCategory: grouped,
      unassignedTools: unassigned,
    };
  }, [catQuery.data, visibleTools]);

  function toggleFavorite(id: string) {
    if (favoriteSet.has(id)) {
      setFavoriteIds(favoriteIds.filter((x) => x !== id));
    } else {
      if (favoriteIds.length >= MAX_FAVORITES) {
        toast.error(`Tối đa ${MAX_FAVORITES} pin. Bỏ bớt rồi thêm lại.`);
        return;
      }
      setFavoriteIds([...favoriteIds, id]);
    }
  }

  // ============================================================
  // Drag-to-reorder favorites — LIVE reorder.
  // Trong lúc đang kéo, mỗi lần dragOver cell mới sẽ ngay lập tức
  // cập nhật `favoriteIds` → React re-render → FLIP animation chạy → các cell
  // khác slide nhường chỗ ngay. Cell đang kéo (draggedId) bị mờ tại slot mới
  // của nó. Khi dragEnd chỉ cần clear state.
  // ============================================================
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);

  function handleDragStart(id: string) {
    setDraggedId(id);
    setInsertIndex(null);
  }

  function handleDragOver(id: string, e: React.DragEvent<HTMLDivElement>) {
    if (!draggedId || draggedId === id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const dropAfter = e.clientX >= rect.left + rect.width / 2;
    const overIdx = favoriteIds.indexOf(id);
    setInsertIndex(dropAfter ? overIdx + 1 : overIdx);
  }

  function handleDrop() {
    if (draggedId === null || insertIndex === null) {
      setDraggedId(null);
      setInsertIndex(null);
      return;
    }
    const next = favoriteIds.filter((id) => id !== draggedId);
    const fromIdx = favoriteIds.indexOf(draggedId);
    // Adjust index sau khi remove
    const adjusted = insertIndex > fromIdx ? insertIndex - 1 : insertIndex;
    next.splice(adjusted, 0, draggedId);
    setFavoriteIds(next);
    setDraggedId(null);
    setInsertIndex(null);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setInsertIndex(null);
  }

  // FLIP animation cho favorites khi reorder — đã bỏ, dùng insert indicator thay thế

  // ============================================================
  // Smooth section transition (JS-driven, easeOutCubic ~450ms).
  // Logic:
  //   - Ở section 1 (top<10% viewport) + scroll DOWN → animate xuống section 2
  //   - Ở section 2 đầu (top trong [0.9h, 1.1h]) + scroll UP → animate lên section 1
  //   - Các trường hợp khác (scroll trong section 2) → browser native
  // ============================================================
  const scrollRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  function smoothScrollTo(target: number, duration = 450) {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollTop;
    const dist = target - start;
    if (Math.abs(dist) < 1) return;
    const t0 = performance.now();
    animatingRef.current = true;

    function step(now: number) {
      if (!el) return;
      const t = Math.min((now - t0) / duration, 1);
      // easeOutCubic — fast start, mềm về cuối
      const eased = 1 - Math.pow(1 - t, 3);
      el.scrollTop = start + dist * eased;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        animatingRef.current = false;
      }
    }
    requestAnimationFrame(step);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!el) return;
      if (animatingRef.current) {
        e.preventDefault();
        return;
      }
      const h = el.clientHeight;
      const top = el.scrollTop;

      // Trong vùng "biên giới" của 2 section đầu (top < 1.1h):
      //  - scroll DOWN → snap về h (đầu section 2)
      //  - scroll UP → snap về 0 (đầu section 1)
      // Ngoài vùng đó (đã cuộn sâu trong section 2) → browser native.
      if (top < h * 1.1) {
        if (e.deltaY > 0 && top < h * 0.9) {
          e.preventDefault();
          smoothScrollTo(h);
          return;
        }
        if (e.deltaY < 0 && top > h * 0.1) {
          e.preventDefault();
          smoothScrollTo(0);
          return;
        }
      }
    }

    let touchY = 0;
    function onTouchStart(e: TouchEvent) {
      touchY = e.touches[0].clientY;
    }
    function onTouchEnd(e: TouchEvent) {
      if (!el) return;
      if (animatingRef.current) return;
      const deltaY = touchY - e.changedTouches[0].clientY;
      if (Math.abs(deltaY) < 50) return;

      const h = el.clientHeight;
      const top = el.scrollTop;
      if (top < h * 1.1) {
        if (deltaY > 0 && top < h * 0.9) smoothScrollTo(h);
        else if (deltaY < 0 && top > h * 0.1) smoothScrollTo(0);
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <Header />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto [scrollbar-gutter:stable]"
      >
        <div className="flex h-full flex-col px-[clamp(12px,4vw,8rem)]">
          {/* Section 1: chiếm trọn container */}
          <div className="flex h-full shrink-0 flex-col gap-3 py-4 max-md:py-2">
            <WidgetArea />

            <section className="min-h-0 flex-1 overflow-y-auto">
              {favQuery.isLoading ? (
                <FavoritesSkeleton />
              ) : favorites.length > 0 ? (
                <div
                  className="grid content-start gap-px bg-border"
                  style={{
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(clamp(110px, 8vw, 180px), 1fr))',
                  }}
                  onDragOver={(e) => {
                    // Chỉ fire khi kéo vào vùng trống của grid (không phải child cell)
                    if (!draggedId) return;
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                    setInsertIndex(favoriteIds.length);
                  }}
                  onDrop={handleDrop}
                >
                  {favorites.map((tool, idx) => {
                    const showInsertBefore = insertIndex === idx;
                    const showInsertAfter = insertIndex === idx + 1 && idx === favorites.length - 1;
                    return (
                      <ToolCell
                        key={tool.id}
                        tool={tool}
                        isFavorite
                        draggable
                        isDragging={draggedId === tool.id}
                        showInsertBefore={showInsertBefore}
                        showInsertAfter={showInsertAfter}
                        onClick={() => handleClick(tool)}
                        onToggleFavorite={() => toggleFavorite(tool.id)}
                        onDragStart={() => handleDragStart(tool.id)}
                        onDragOver={(e) => handleDragOver(tool.id, e)}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={Pin}
                  title="Chưa có pin nào"
                  description="Cuộn xuống và bấm biểu tượng pin ở tool bất kỳ để pin lên đây."
                />
              )}
            </section>
          </div>

          {/* Section 2: content height tự nhiên.
              Khi catQuery còn loading → skeleton grid, tránh flash mọi tool
              vào Unassigned rồi ngay lập tức nhảy về category thật. */}
          <div className="shrink-0 space-y-6 border-t border-border py-6">
            {catQuery.isLoading ? (
              <CategoriesSkeleton />
            ) : (
              <>
                {categoryOrder.map((group) => {
                  const tools = toolsByCategory[group] ?? [];
                  if (tools.length === 0) return null;
                  return (
                    <section key={group}>
                      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group}
                      </h2>
                      <div
                        className="grid gap-px bg-border"
                        style={{
                          gridTemplateColumns:
                            'repeat(auto-fill, minmax(clamp(110px, 8vw, 180px), 1fr))',
                        }}
                      >
                        {tools.map((tool) => (
                          <ToolCell
                            key={tool.id}
                            tool={tool}
                            isFavorite={favoriteSet.has(tool.id)}
                            onClick={() => handleClick(tool)}
                            onToggleFavorite={() => toggleFavorite(tool.id)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}

                {/* Unassigned — tool chưa được gán vào category nào */}
                {unassignedTools.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-warning">
                      {UNASSIGNED_CATEGORY}
                      <span className="ml-1.5 font-mono font-normal text-muted-foreground">
                        ({unassignedTools.length})
                      </span>
                    </h2>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Vào Config → Tool Categories để kéo các tool này vào category.
                    </p>
                    <div
                      className="grid gap-px bg-border"
                      style={{
                        gridTemplateColumns:
                          'repeat(auto-fill, minmax(clamp(110px, 8vw, 180px), 1fr))',
                      }}
                    >
                      {unassignedTools.map((tool) => (
                        <ToolCell
                          key={tool.id}
                          tool={tool}
                          isFavorite={favoriteSet.has(tool.id)}
                          onClick={() => handleClick(tool)}
                          onToggleFavorite={() => toggleFavorite(tool.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <Footer total={TOOLS.length} favorites={favorites.length} />
    </div>
  );
}

// ============================================================
// Header
// ============================================================
function Header() {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useNavigate();
  const logout = useLogout();

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-[clamp(1rem,4vw,4rem)] py-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">BiBo Tools</h1>
        <span className="h-1.5 w-1.5 self-center bg-primary" />
      </div>

      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/community/ideas"
              data-flat
              className="relative inline-flex h-9 w-9 items-center justify-center text-foreground transition-colors hover:text-primary"
            >
              {/* Triangle border shape */}
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 36 36"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M18 2L33 10V26L18 34L3 26V10L18 2Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-border"
                />
              </svg>
              <PencilSparkles className="relative h-3.5 w-3.5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Góp ý</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" data-flat onClick={() => useModalStore.getState().open('shortcuts')}>
              <Keyboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Phím tắt (Alt+K)</TooltipContent>
        </Tooltip>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <Button
            variant="outline"
            size="icon"
            data-flat
            className="overflow-hidden rounded-full"
            onClick={() => setUserMenuOpen((v) => !v)}
          >
            {profile?.avatar_url ? (
              <img
                src={getAvatarUrl(profile.avatar_url) ?? ''}
                alt=""
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <User className="h-4 w-4" />
            )}
          </Button>
          {userMenuOpen && (
            <div data-flat className="absolute right-0 top-full z-50 mt-1 min-w-[200px] border border-border bg-popover py-1 shadow-md">
              {profile?.username && (
                <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  {profile.username}
                </div>
              )}

              {/* Theme section */}
              <ThemeMenuSection />

              <div className="border-t border-border" />
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/account');
                }}
              >
                <User className="h-3.5 w-3.5" />
                My account
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted"
                onClick={() => {
                  setUserMenuOpen(false);
                  void logout();
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ============================================================
// Theme menu section (inside user dropdown)
// ============================================================

const THEME_PREVIEWS: { id: ThemeId; label: string; bg: string; accent: string; text: string; ring: string }[] = [
  { id: 'dark', label: 'Dark', bg: '#1e1e1e', accent: '#007acc', text: '#d4d4d4', ring: '#007acc' },
  { id: 'light', label: 'Light', bg: '#fafafa', accent: '#007acc', text: '#1a1a1e', ring: '#007acc' },
  { id: 'cute', label: 'Cute', bg: '#faf6f8', accent: '#9333ea', text: '#3d1f4e', ring: '#9333ea' },
];

function ThemeMenuSection() {
  const tc = useThemeControls();

  return (
    <div className="border-b border-border px-3 py-2 space-y-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Theme</p>

      {/* Theme preview cards */}
      <div className="grid grid-cols-3 gap-2">
        {THEME_PREVIEWS.map((t) => (
          <button
            key={t.id}
            data-flat
            onClick={() => tc.setTheme(t.id)}
            className={cn(
              'relative flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-all duration-150',
              tc.theme === t.id
                ? 'ring-2'
                : 'ring-1 ring-border hover:ring-foreground/20',
            )}
            style={{
              backgroundColor: t.bg,
              ...(tc.theme === t.id ? { '--tw-ring-color': t.ring } as React.CSSProperties : {}),
            }}
          >
            <div
              className="w-full aspect-[4/3] rounded overflow-hidden"
            >
              <div className="flex flex-col gap-[3px] p-1.5">
                <div className="h-[3px] w-3/4 rounded-sm" style={{ backgroundColor: t.text, opacity: 0.6 }} />
                <div className="h-[3px] w-1/2 rounded-sm" style={{ backgroundColor: t.text, opacity: 0.3 }} />
                <div className="h-[4px] w-2/5 rounded-sm mt-0.5" style={{ backgroundColor: t.accent }} />
              </div>
            </div>
            <span
              className="text-[10px] font-medium"
              style={{ color: t.text }}
            >
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Effect toggles — bordered cards with themed preview */}
      <div className="grid grid-cols-2 gap-2">
        {/* Lift */}
        <button
          data-flat
          onClick={tc.toggleLift}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-150',
            tc.is3d
              ? 'ring-2 ring-primary bg-primary/5'
              : 'ring-1 ring-border hover:ring-foreground/20',
          )}
        >
          {/* Preview: flat button vs raised button */}
          <div className="flex items-end gap-1.5 h-4">
            <div className="h-3 w-8 rounded-sm bg-primary/20" />
            <div className="h-3 w-8 rounded-sm bg-primary/40" style={{ boxShadow: '0 2px 0 0 hsl(var(--primary) / 0.6)' }} />
          </div>
          <span className={cn(
            'text-[10px] font-medium',
            tc.is3d ? 'text-primary' : 'text-muted-foreground',
          )}>
            Lift
          </span>
        </button>

        {/* Subtle — radio với Pill */}
        <button
          data-flat
          onClick={tc.toggleRounded}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-150',
            tc.isRounded
              ? 'ring-2 ring-primary bg-primary/5'
              : 'ring-1 ring-border hover:ring-foreground/20',
          )}
        >
          {/* Preview: square vs subtle rounded */}
          <div className="flex items-center gap-1.5 h-4">
            <div className="h-4 w-6 border border-primary/30 bg-primary/10" />
            <div className="h-4 w-6 border border-primary/50 bg-primary/20" style={{ borderRadius: '0.375rem' }} />
          </div>
          <span className={cn(
            'text-[10px] font-medium',
            tc.isRounded ? 'text-primary' : 'text-muted-foreground',
          )}>
            Subtle
          </span>
        </button>
      </div>

      {/* Retro + Pill toggles */}
      <div className="grid grid-cols-2 gap-2">
        <button
          data-flat
          disabled={!tc.is3d}
          onClick={tc.toggleRetro}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-150',
            !tc.is3d
              ? 'opacity-40 cursor-not-allowed ring-1 ring-border'
              : tc.isRetro
                ? 'ring-2 ring-primary bg-primary/5'
                : 'ring-1 ring-border hover:ring-foreground/20',
          )}
        >
          <div className="flex items-end gap-1.5 h-4">
            <div className="h-3 w-7 rounded-sm bg-primary/30" style={{ boxShadow: '0 2px 0 0 hsl(var(--primary) / 0.5)' }} />
            <div className="h-3 w-7 rounded-sm bg-primary/30" style={{ boxShadow: '0 2px 0 0 hsl(0 0% 0% / 0.4)' }} />
          </div>
          <span className={cn(
            'text-[10px] font-medium',
            tc.isRetro ? 'text-primary' : 'text-muted-foreground',
          )}>
            Retro
          </span>
        </button>

        {/* Pill — radio với Subtle */}
        <button
          data-flat
          onClick={tc.togglePill}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-150',
            tc.isPill
              ? 'ring-2 ring-primary bg-primary/5'
              : 'ring-1 ring-border hover:ring-foreground/20',
          )}
        >
          <div className="flex items-center gap-1.5 h-4">
            <div className="h-4 w-6 border border-primary/30 bg-primary/10" style={{ borderRadius: '0.375rem' }} />
            <div className="h-4 w-6 border border-primary/50 bg-primary/20" style={{ borderRadius: '9999px' }} />
          </div>
          <span className={cn(
            'text-[10px] font-medium',
            tc.isPill ? 'text-primary' : 'text-muted-foreground',
          )}>
            Pill
          </span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Skeletons — beam sweep N hàng, mỗi hàng tốc độ khác nhau
// ============================================================
// Mỗi row = 1 grid clip 1 hàng, có beam riêng. Stack nhiều row với duration
// khác nhau → cảm giác "living", không đơn điệu.

const GRID_TEMPLATE_COLUMNS =
  'repeat(auto-fill, minmax(clamp(110px, 8vw, 180px), 1fr))';

// Duration cho từng row theo index. Beyond 4 rows dùng modulo (hiếm khi cần).
const ROW_DURATIONS = ['1.4s', '2.4s', '1.8s', '2s'];

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-px">
      {Array.from({ length: rows }).map((_, i) => (
        <LoadingState
          key={i}
          variant="skeleton"
          count={20}
          maxRows={1}
          itemClassName="aspect-square h-auto w-full"
          className="grid gap-px bg-border"
          style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
          shimmerDuration={ROW_DURATIONS[i % ROW_DURATIONS.length]}
        />
      ))}
    </div>
  );
}

function FavoritesSkeleton() {
  return <SkeletonRows rows={2} />;
}

function CategoriesSkeleton() {
  // Số section = số category fix cứng (`TOOL_GROUPS`). Nếu tương lai thêm
  // category → tự sync, không phải nhớ update chỗ này.
  return (
    <>
      {TOOL_GROUPS.map((g) => (
        <section key={g}>
          <div className="mb-2 h-3 w-24 bg-muted" />
          <SkeletonRows rows={1} />
        </section>
      ))}
    </>
  );
}

// ============================================================
// Footer
// ============================================================
function Footer({ total, favorites }: { total: number; favorites: number }) {
  return (
    <footer className="flex items-center justify-between border-t border-border bg-card px-[clamp(1rem,4vw,4rem)] py-2 text-xs text-muted-foreground">
      <span>
        {favorites}/{total} đã pin
      </span>
      <span className="font-mono max-md:hidden">v2.0.0</span>
    </footer>
  );
}

// ============================================================
// ToolCell - card từng tool, hover hiện nút pin/unpin.
// Khi `draggable=true` (favorites) hỗ trợ drag để reorder.
// ============================================================
function ToolCell({
  tool,
  isFavorite,
  onClick,
  onToggleFavorite,
  draggable,
  isDragging,
  showInsertBefore,
  showInsertAfter,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  tool: Tool;
  isFavorite: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  showInsertBefore?: boolean;
  showInsertAfter?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => e.key === 'Enter' && onClick()}
          draggable={draggable}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tool.id);
            onDragStart?.();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            onDragOver?.(e);
          }}
          onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
          onDragEnd={onDragEnd}
          className={cn(
            'group relative flex aspect-square flex-col items-center justify-center bg-background p-3',
            'transition-all duration-200',
            'hover:bg-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            draggable && 'cursor-grab active:cursor-grabbing',
            isDragging && 'opacity-40',
            showInsertBefore && 'border-l-4 border-l-primary',
            showInsertAfter && 'border-r-4 border-r-primary',
          )}
        >
          {/* Pin/unpin button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            draggable={false}
            className={cn(
              'absolute right-1 top-1 flex h-5 w-5 items-center justify-center transition-all',
              'hover:bg-popover',
              isFavorite
                ? 'text-primary opacity-70 hover:opacity-100'
                : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground',
            )}
            title={isFavorite ? 'Bỏ pin' : 'Pin lên đầu'}
            aria-label={isFavorite ? 'Bỏ pin' : 'Pin'}
          >
            {isFavorite ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>

          <ToolIcon
            id={tool.id}
            className="mb-1.5 h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary"
          />
          <span className="text-center text-xs leading-tight text-foreground transition-colors">
            {tool.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span>{tool.label}</span>
      </TooltipContent>
    </Tooltip>
  );
}
