import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { motion } from 'framer-motion';
import { useFloatingDragPreview } from '@/lib/motion/floating-drag-preview';
import {
  ArrowRight,
  Eye,
  EyeOff,
  MoreVertical,
  ExternalLink,
  Trash2,
  Pencil,
  Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MOTION_LAYOUT_TRANSITION } from '@/lib/motion/tokens';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/cn';

import BookmarkItem from './BookmarkItem';
import type { Bookmark, BookmarkCategory } from '../types';
import { CATEGORY_NAME_MAX } from '../schemas';
import {
  isBookmarkPayload,
  isCategoryPayload,
  PDND_CATEGORY_TYPE,
} from '../lib/pdnd-types';

// ============================================================
// CategoryBlock — dense Superdense-style
//
// Uses pragmatic-drag-and-drop:
//   - Header row = draggable (whole category can be reordered)
//   - Category root = dropTarget for category-drag (with top/bottom edge)
//     AND dropTarget for bookmarks (bookmark can be dropped into this
//     category's bookmark tail via a dedicated inner drop zone).
//
// No custom collision. No phantom clone. No React state for drop position.
// Visual state (edge, dragging) via data-* attributes → CSS pseudo-elements.
// ============================================================

interface CategoryBlockProps {
  category: BookmarkCategory;
  bookmarks: Bookmark[];
  hoverTitle: string | null;
  matchesSearch: (b: Bookmark) => boolean;
  iconSize: number;
  iconBackdrop: boolean;
  pageIsPublic: boolean;
  editMode: boolean;
  openInSameTab: boolean;
  readOnly?: boolean;
  onEditBookmark?: (b: Bookmark) => void;
  onHoverBookmark?: (title: string | null) => void;
  onQuickAdd?: (categoryId: string, url: string) => void;
  onOpenAll?: () => void;
  onToggleHidden?: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}

function CategoryBlockImpl({
  category,
  bookmarks,
  hoverTitle,
  matchesSearch,
  iconSize,
  iconBackdrop,
  pageIsPublic,
  editMode,
  openInSameTab,
  readOnly = false,
  onEditBookmark,
  onHoverBookmark,
  onQuickAdd,
  onOpenAll,
  onToggleHidden,
  onRename,
  onDelete,
}: CategoryBlockProps) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(category.name);
  const [adding, setAdding] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  // Drag state
  const [catDragging, setCatDragging] = useState(false);
  const [catEdge, setCatEdge] = useState<Edge | null>(null);
  const [bookmarkOver, setBookmarkOver] = useState(false); // bookmark hover Plus button (insert-at-end drop zone)

  const categoryRootRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  // badgeRef → span badge visible. Dung cho grab-offset capture (preview = badge pill,
  // cursor cam DUNG badge). Header rong hon badge nen dung headerRef se lech.
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  // Plus button = drop target khi user drag bookmark. Click = add via URL,
  // drag drop = insert at end of category. Dual purpose (thay cho tail li rỗng).
  const plusButtonRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Floating drag preview overlay — category pill follow cursor.
  // sourceRef = badgeRef (span badge visible) → cursor cam DUNG badge, khong lech.
  const preview = useFloatingDragPreview({
    sourceRef: badgeRef,
    render: () => (
      <div
        className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground"
        style={{
          transform: 'rotate(-2deg)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        {category.name}
      </div>
    ),
  });

  // Hover-intent close for kebab menu (unchanged from before)
  useEffect(() => {
    if (!menuOpen) return;

    const PADDING = 3;
    const DELAY = 100;

    function isInside(x: number, y: number, el: HTMLElement | null): boolean {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return (
        x >= r.left - PADDING &&
        x <= r.right + PADDING &&
        y >= r.top - PADDING &&
        y <= r.bottom + PADDING
      );
    }

    function clearTimer() {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    }

    function handleMove(e: MouseEvent) {
      const inside =
        isInside(e.clientX, e.clientY, categoryRootRef.current) ||
        isInside(e.clientX, e.clientY, contentRef.current);
      if (inside) {
        clearTimer();
      } else if (!closeTimerRef.current) {
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null;
          setMenuOpen(false);
        }, DELAY);
      }
    }

    document.addEventListener('mousemove', handleMove);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      clearTimer();
    };
  }, [menuOpen]);

  // Category header = draggable + category-drag drop target with top/bottom edge
  useEffect(() => {
    if (readOnly) return;
    const catRoot = categoryRootRef.current;
    const header = headerRef.current;
    if (!catRoot || !header) return;

    return combine(
      draggable({
        element: header,
        getInitialData: () => ({
          type: PDND_CATEGORY_TYPE,
          id: category.id,
          columnIndex: category.columnIndex,
        }),
        onGenerateDragPreview: preview.onGenerateDragPreview,
        onDragStart: (args) => {
          preview.onDragStart(args);
          setCatDragging(true);
        },
        onDrag: preview.onDrag,
        onDrop: () => {
          preview.onDrop();
          setCatDragging(false);
        },
      }),
      dropTargetForElements({
        element: catRoot,
        canDrop: ({ source }) =>
          isCategoryPayload(source.data) && source.data.id !== category.id,
        getData: ({ input, element }) =>
          attachClosestEdge(
            {
              type: PDND_CATEGORY_TYPE,
              id: category.id,
              columnIndex: category.columnIndex,
            },
            { input, element, allowedEdges: ['top', 'bottom'] },
          ),
        // KHONG hysteresis — category la block TO, midpoint ro rang.
        // Hysteresis tao lag "khung" khi cursor xuyen midpoint. Xem motion-rules.md muc Hysteresis.
        onDragEnter: ({ self }) => setCatEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => {
          const nextEdge = extractClosestEdge(self.data);
          setCatEdge((prev) => (prev === nextEdge ? prev : nextEdge));
        },
        onDragLeave: () => setCatEdge(null),
        onDrop: () => setCatEdge(null),
      }),
    );
  }, [category.id, category.columnIndex, category.name, readOnly]);

  // Plus button = drop target cho bookmark drop (insert at end).
  // Dual purpose: click → add via URL form; drop → insert into cat end.
  // For empty cat, Plus là drop zone duy nhất.
  useEffect(() => {
    if (readOnly) return;
    const plus = plusButtonRef.current;
    if (!plus) return;

    return dropTargetForElements({
      element: plus,
      canDrop: ({ source }) => isBookmarkPayload(source.data),
      getDropEffect: () => 'move',
      getData: () => ({
        type: 'category-tail',
        categoryId: category.id,
      }),
      onDragEnter: () => setBookmarkOver(true),
      onDragLeave: () => setBookmarkOver(false),
      onDrop: () => setBookmarkOver(false),
    });
  }, [category.id, readOnly]);

  function submitRename() {
    const clean = nameDraft.trim();
    if (clean.length === 0 || clean === category.name) {
      setNameDraft(category.name);
      setRenaming(false);
      return;
    }
    onRename?.(clean);
    setRenaming(false);
  }

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    const clean = urlDraft.trim();
    if (!/^https?:\/\//i.test(clean)) return;
    onQuickAdd?.(category.id, clean);
    setUrlDraft('');
    setAdding(false);
  }

  const showVisibilityBadge = !readOnly && pageIsPublic && editMode;

  return (
    <>
      {preview.previewNode}
      <motion.div
      ref={categoryRootRef}
      layoutId={`category-${category.id}`}
      transition={MOTION_LAYOUT_TRANSITION}
      data-category-id={category.id}
      data-cat-dragging={catDragging || undefined}
      data-cat-edge={catEdge ?? undefined}
      className={cn(
        'bookmark-category group/cat relative rounded-md p-1 -m-1 select-none',
        'transition-[opacity,filter,background-color,box-shadow] duration-fast ease-standard',
        // Line indicator TOP — pseudo ALWAYS rendered, opacity 0 base + fade.
        // Position -9px offset + h-[2px]: line spans [-9, -7] from top edge.
        // Với gap-6 giữa DOM box (effective 16px sau khi trừ -m-1), midpoint gap
        // = ±8px. Line at [-9, -7] center at -8 → cùng vị trí với neighbor's ::after.
        // Snap opacity — chong cross-fade flicker khi cursor bang qua boundary 2 category.
        "before:absolute before:inset-x-0 before:-top-[9px] before:h-[2px] before:rounded-full before:bg-primary before:shadow-[0_0_4px_hsl(var(--primary)/0.5)] before:content-[''] before:opacity-0 before:pointer-events-none",
        // Line indicator BOTTOM — mirror. Line at [+7, +9] center at +8 → overlap với next's ::before.
        "after:absolute after:inset-x-0 after:-bottom-[9px] after:h-[2px] after:rounded-full after:bg-primary after:shadow-[0_0_4px_hsl(var(--primary)/0.5)] after:content-[''] after:opacity-0 after:pointer-events-none",
        // Toggle opacity via data-cat-edge → smooth fade
        'data-[cat-edge=top]:before:opacity-100 data-[cat-edge=bottom]:after:opacity-100',
        // Target category effect: bg tint only (translate handled by framer-motion layout)
        'data-[cat-edge=top]:bg-primary/5 data-[cat-edge=bottom]:bg-primary/5',
        // Source category fade khi drag (no scale — framer-motion handles the visual)
        'data-[cat-dragging=true]:opacity-40',
      )}
    >
      {/* Header row = drag handle. Grab state (scale + brightness) tren badge below,
          khong tren toan header (avoid layout shift). */}
      <div
        ref={headerRef}
        className={cn(
          'group/cathdr mb-2 flex items-center gap-1.5',
          !readOnly && !renaming && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {renaming ? (
          // Super-input rename — rounded pill với arrow-submit button inside.
          // Enter/blur = commit, Esc = cancel.
          <div className="relative inline-flex items-center">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') {
                  setNameDraft(category.name);
                  setRenaming(false);
                }
              }}
              autoFocus
              maxLength={CATEGORY_NAME_MAX}
              placeholder="Category name"
              className="h-7 w-[220px] rounded-full border-none bg-foreground pl-3 pr-8 text-xs font-semibold text-background shadow-2xl placeholder:text-background/50 outline-none ring-0 focus:outline-none focus:ring-0 transition-colors"
            />
            <button
              type="button"
              onMouseDown={(e) => {
                // Prevent onBlur from firing before onClick (mousedown → focusout)
                e.preventDefault();
              }}
              onClick={submitRename}
              className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition-colors hover:bg-background/80"
              aria-label="Save rename"
              tabIndex={-1}
            >
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span
            ref={badgeRef}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!readOnly) setRenaming(true);
            }}
            className={cn(
              'bookmark-category-badge inline-flex items-center rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm',
              'transition-[transform,filter] duration-fast ease-standard',
              // Grab feedback qua parent header :active — bumped 0.98/95 → 0.96/90 cho ro hon.
              'group-active/cathdr:scale-[0.96] group-active/cathdr:brightness-90',
              // PERSIST xuyen suot drag → badge van thu nho + toi trong khi preview follow cursor.
              'group-data-[cat-dragging=true]/cat:scale-[0.96] group-data-[cat-dragging=true]/cat:brightness-90',
            )}
            title={readOnly ? undefined : 'Double-click để đổi tên · kéo để di chuyển'}
          >
            {category.name}
          </span>
        )}

        {showVisibilityBadge && (
          <button
            type="button"
            onClick={onToggleHidden}
            onPointerDown={(e) => e.stopPropagation()}
            draggable={false}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-fast ease-standard',
              category.hiddenFromPublic
                ? 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'
                : 'bg-success/15 text-success hover:bg-success/25',
            )}
            title={
              category.hiddenFromPublic
                ? 'Đang ẩn — click để hiện trên public'
                : 'Đang public — click để ẩn'
            }
            aria-label="Toggle visibility"
          >
            {category.hiddenFromPublic ? (
              <>
                <EyeOff className="h-3 w-3" /> Hidden
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" /> Public
              </>
            )}
          </button>
        )}

        {!readOnly && (
          <div
            className="ml-auto opacity-0 transition-opacity duration-fast ease-standard group-hover/cat:opacity-100 focus-within:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label="Category actions"
                  draggable={false}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent ref={contentRef} align="end">
                {bookmarks.length > 0 && (
                  <DropdownMenuItem onClick={onOpenAll}>
                    <ExternalLink className="h-3.5 w-3.5" /> Open all
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setRenaming(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Icon grid */}
      <div
        className="flex flex-wrap items-center gap-x-0 gap-y-1.5 p-0.5"
        style={{ minHeight: iconSize + 4 }}
      >
        <ul className="contents m-0 p-0" style={{ listStyle: 'none' }}>
          {bookmarks.map((b) => (
            <BookmarkItem
              key={b.id}
              bookmark={b}
              readOnly={readOnly}
              faded={!matchesSearch(b)}
              iconSize={iconSize}
              iconBackdrop={iconBackdrop}
              openInSameTab={openInSameTab}
              onClick={() => onEditBookmark?.(b)}
              onHover={onHoverBookmark}
            />
          ))}
        </ul>

        {/* Plus button + Popover super-input form. Popover open state ↔
            `adding` state. Trigger click opens popover, Esc/click-outside
            closes. Arrow trỏ vào Plus button qua PopoverArrow. */}
        <Popover
          open={adding}
          onOpenChange={(open) => {
            if (!open) setUrlDraft('');
            setAdding(open);
          }}
        >
          <PopoverTrigger asChild>
            <button
              ref={plusButtonRef}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              draggable={false}
              data-bookmark-over={bookmarkOver || undefined}
              // Plus button visible cả ở view mode và edit mode. Drop target
              // chỉ active ở edit mode. mx-[3px] bù gap-x-0. box-border giữ
              // button = 30x30 tròn.
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full border-2 border-dashed transition-colors duration-fast ease-standard mx-[3px]',
                bookmarkOver
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-muted-foreground/25 bg-transparent text-muted-foreground/50 hover:border-muted-foreground/60 hover:bg-muted hover:text-foreground',
              )}
              style={{ width: iconSize, height: iconSize }}
              title={readOnly ? 'Thêm bookmark' : 'Thêm bookmark (kéo bookmark vào đây để chèn cuối)'}
              aria-label="Thêm bookmark"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={10}
            // Invisible wrapper: chỉ positioning. Override mọi visual:
            // - bg + border + padding removed
            // - box-shadow: none inline để beat elev-floating specificity
            className="w-auto border-none bg-transparent !p-0"
            style={{ boxShadow: 'none', background: 'transparent' }}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <form
              onSubmit={submitAdd}
              onPointerDown={(e) => e.stopPropagation()}
              className="relative"
            >
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://example.com"
                autoFocus
                type="text"
                // Input pill = "chat bubble" chính. Inverse bg (foreground)
                // + shadow riêng để nổi trên page. Arrow bên dưới match bg.
                className="h-9 w-72 rounded-full border-none bg-foreground pl-3.5 pr-10 text-xs text-background shadow-2xl placeholder:text-background/50 outline-none ring-0 focus:outline-none focus:ring-0 focus:border-none transition-colors"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setUrlDraft('');
                    setAdding(false);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!urlDraft.trim()}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition-[background-color,opacity] duration-fast ease-standard hover:bg-background/80 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Thêm bookmark"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
            {/* Arrow trỏ xuống Plus button. Fill = foreground (match popover
                bg). Không stroke vì popover không có border. */}
            <PopoverArrow asChild width={14} height={7}>
              <svg
                width={14}
                height={7}
                viewBox="0 0 14 7"
                style={{ display: 'block' }}
              >
                <path d="M0 0 L7 7 L14 0" fill="hsl(var(--foreground))" />
              </svg>
            </PopoverArrow>
          </PopoverContent>
        </Popover>
      </div>

      <p
        className={cn(
          'bibo-bookmark-hover-title mt-1.5 min-h-[14px] text-[11px] text-muted-foreground/70 transition-opacity duration-fast ease-standard',
          hoverTitle ? 'opacity-100' : 'opacity-0',
        )}
      >
        {hoverTitle || '\u00A0'}
      </p>
    </motion.div>
    </>
  );
}

const CategoryBlock = memo(CategoryBlockImpl, (prev, next) => {
  return (
    prev.category === next.category &&
    prev.bookmarks === next.bookmarks &&
    prev.hoverTitle === next.hoverTitle &&
    prev.matchesSearch === next.matchesSearch &&
    prev.iconSize === next.iconSize &&
    prev.iconBackdrop === next.iconBackdrop &&
    prev.pageIsPublic === next.pageIsPublic &&
    prev.editMode === next.editMode &&
    prev.openInSameTab === next.openInSameTab &&
    prev.readOnly === next.readOnly
  );
});

export default CategoryBlock;
