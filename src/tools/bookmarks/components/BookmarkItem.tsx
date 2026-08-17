import { memo, useEffect, useRef, useState } from 'react';
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

import BookmarkFavicon from './BookmarkFavicon';
import type { Bookmark } from '../types';
import { isBookmarkPayload, PDND_BOOKMARK_TYPE } from '../lib/pdnd-types';
import { HYSTERESIS_MS } from '@/lib/motion/tokens';
import { useFloatingDragPreview } from '@/lib/motion/floating-drag-preview';

interface BookmarkItemProps {
  bookmark: Bookmark;
  iconSize: number;
  iconBackdrop: boolean;
  openInSameTab: boolean;
  readOnly?: boolean;
  faded?: boolean;
  onClick?: () => void;
  onHover?: (title: string | null) => void;
}

// ============================================================
// BookmarkItem — draggable favicon tile.
//
// Uses pragmatic-drag-and-drop. Each tile is BOTH:
//   - draggable (can be picked up)
//   - drop target (other bookmarks can land before/after it, via closest-edge)
//
// Visual state (dragging + closest edge) applied via data-* attributes so
// CSS pseudo-elements draw the line indicator — no React state cascade to
// parent, no re-render on every mousemove.
// ============================================================

// Preview replica — favicon nho scale nhe + rotate + shadow.
function BookmarkPreview({ bookmark, iconSize, iconBackdrop }: {
  bookmark: Bookmark;
  iconSize: number;
  iconBackdrop: boolean;
}) {
  return (
    <div
      style={{
        transform: 'scale(1.05) rotate(-1.5deg)',
        transformOrigin: 'center',
        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15)) drop-shadow(0 1px 3px rgba(0,0,0,0.1))',
      }}
    >
      <BookmarkFavicon
        faviconUrl={bookmark.faviconUrl}
        title={bookmark.title}
        url={bookmark.url}
        size={iconSize}
        backdrop={iconBackdrop}
        iconType={bookmark.iconType}
        iconText={bookmark.iconText}
        iconRounded={bookmark.iconRounded}
        iconBackground={bookmark.iconBackground}
        className=""
      />
    </div>
  );
}

function BookmarkItemImpl({
  bookmark,
  iconSize,
  iconBackdrop,
  openInSameTab,
  readOnly = false,
  faded = false,
  onClick,
  onHover,
}: BookmarkItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  // anchorRef → inner <a> (khong bao gom px-[3px] hitbox extension cua outer li).
  // Preview grab-offset capture tren anchorRef → alignment DUNG voi favicon visible.
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  // Hysteresis timer — debounce edge change de tranh flicker khi pointer o midpoint.
  // Xem motion-rules.md muc Hysteresis.
  const hysteresisTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Floating drag preview overlay — thay cho native HTML5 drag image.
  // sourceRef = anchorRef (favicon visible) → cursor cam DUNG cho da click.
  const preview = useFloatingDragPreview({
    sourceRef: anchorRef,
    render: () => <BookmarkPreview bookmark={bookmark} iconSize={iconSize} iconBackdrop={iconBackdrop} />,
  });

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (hysteresisTimer.current) clearTimeout(hysteresisTimer.current);
  }, []);

  useEffect(() => {
    if (readOnly) return;
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({
          type: PDND_BOOKMARK_TYPE,
          id: bookmark.id,
          categoryId: bookmark.categoryId,
        }),
        onGenerateDragPreview: preview.onGenerateDragPreview,
        onDragStart: (args) => {
          preview.onDragStart(args);
          setDragging(true);
        },
        onDrag: preview.onDrag,
        onDrop: () => {
          preview.onDrop();
          setDragging(false);
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          isBookmarkPayload(source.data) && source.data.id !== bookmark.id,
        // Explicit 'move' effect → cursor show move indicator thay vì no-drop.
        getDropEffect: () => 'move',
        getData: ({ input, element }) =>
          attachClosestEdge(
            {
              type: PDND_BOOKMARK_TYPE,
              id: bookmark.id,
              categoryId: bookmark.categoryId,
            },
            { input, element, allowedEdges: ['left', 'right'] },
          ),
        onDragEnter: ({ self }) => {
          // Enter = commit ngay, khong debounce (user chua co "previous edge" de flicker)
          if (hysteresisTimer.current) clearTimeout(hysteresisTimer.current);
          setEdge(extractClosestEdge(self.data));
        },
        onDrag: ({ self }) => {
          const nextEdge = extractClosestEdge(self.data);
          setEdge((prev) => {
            if (prev === nextEdge) return prev;
            // Edge change detected — debounce truoc khi commit de tranh flicker
            // o midpoint. Neu edge on dinh sau HYSTERESIS_MS thi moi doi.
            if (hysteresisTimer.current) clearTimeout(hysteresisTimer.current);
            hysteresisTimer.current = setTimeout(() => {
              setEdge(nextEdge);
            }, HYSTERESIS_MS);
            return prev;
          });
        },
        onDragLeave: () => {
          if (hysteresisTimer.current) clearTimeout(hysteresisTimer.current);
          setEdge(null);
        },
        onDrop: () => {
          if (hysteresisTimer.current) clearTimeout(hysteresisTimer.current);
          setEdge(null);
        },
      }),
    );
  }, [
    bookmark.id,
    bookmark.categoryId,
    bookmark.faviconUrl,
    bookmark.title,
    bookmark.url,
    bookmark.iconType,
    bookmark.iconText,
    bookmark.iconRounded,
    bookmark.iconBackground,
    readOnly,
    iconSize,
    iconBackdrop,
  ]);

  const tooltip = bookmark.title || bookmark.url;
  const target = openInSameTab ? '_self' : '_blank';

  // Line indicator: pseudo-elements ALWAYS rendered nhưng opacity 0 by default.
  // Data-edge toggle chỉ đổi opacity → CSS transition tự smooth fade-in.
  // Cách này tránh reflow do thêm/xóa pseudo-element.
  return (
    <>
      {preview.previewNode}
      <li
      ref={ref}
      data-bookmark-id={bookmark.id}
      data-dragging={dragging || undefined}
      data-edge={edge ?? undefined}
      onMouseEnter={() => onHover?.(tooltip)}
      onMouseLeave={() => onHover?.(null)}
      title={tooltip}
      className={
        // Base — position:relative để pseudo-elements anchor
        // px-[3px] extend hit zone 3px each side.
        'group/tile relative shrink-0 select-none px-[3px] rounded-full cursor-grab active:cursor-grabbing ' +
        'transition-[opacity,transform,background-color,box-shadow,filter] duration-fast ease-standard ' +
        // Grab feedback — bumped tu 0.98/95 → 0.96/90. PERSIST xuyen suot drag → source ro rang.
        'active:scale-[0.96] active:brightness-90 ' +
        'data-[dragging=true]:scale-[0.96] data-[dragging=true]:brightness-90 ' +
        // Source item — subtle fade only, no scale distortion
        'data-[dragging=true]:opacity-40 ' +
        // Target-item: subtle shift toward drop edge
        'data-[edge=left]:translate-x-[2px] data-[edge=right]:-translate-x-[2px] ' +
        // Line indicator BEFORE — midpoint of visual gap. Snap opacity (khong transition)
        // chong cross-fade flicker khi cursor bang qua boundary 2 tile.
        "before:absolute before:inset-y-1 before:-left-[1px] before:w-[2px] before:rounded-full before:bg-primary before:shadow-[0_0_4px_hsl(var(--primary)/0.5)] before:content-[''] before:opacity-0 before:pointer-events-none " +
        // Line indicator AFTER — mirror
        "after:absolute after:inset-y-1 after:-right-[1px] after:w-[2px] after:rounded-full after:bg-primary after:shadow-[0_0_4px_hsl(var(--primary)/0.5)] after:content-[''] after:opacity-0 after:pointer-events-none " +
        // Toggle opacity via data-edge
        'data-[edge=left]:before:opacity-100 data-[edge=right]:after:opacity-100 ' +
        (faded ? 'opacity-15' : '')
      }
      style={{ listStyle: 'none' }}
      aria-hidden={faded || undefined}
    >
      <a
        ref={anchorRef}
        href={bookmark.url}
        target={readOnly ? target : undefined}
        rel={readOnly && !openInSameTab ? 'noopener noreferrer' : undefined}
        draggable={false}
        className="block bg-transparent p-0"
        onClick={
          readOnly
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!dragging) onClick?.();
              }
        }
        aria-label={
          readOnly
            ? bookmark.title ||
              bookmark.url.replace(/^https?:\/\//, '').replace(/\/$/, '') ||
              bookmark.url
            : `Edit ${bookmark.title || bookmark.url}`
        }
        tabIndex={faded ? -1 : undefined}
      >
        <BookmarkFavicon
          faviconUrl={bookmark.faviconUrl}
          title={bookmark.title}
          url={bookmark.url}
          size={iconSize}
          backdrop={iconBackdrop}
          iconType={bookmark.iconType}
          iconText={bookmark.iconText}
          iconRounded={bookmark.iconRounded}
          iconBackground={bookmark.iconBackground}
          className=""
        />
      </a>
    </li>
    </>
  );
}

// Memoize — callbacks (onClick, onHover) may change refs from parent, but
// their behavior is stable (closure over stable state). Explicitly compare
// only data props.
const BookmarkItem = memo(BookmarkItemImpl, (prev, next) => {
  return (
    prev.bookmark === next.bookmark &&
    prev.readOnly === next.readOnly &&
    prev.faded === next.faded &&
    prev.iconSize === next.iconSize &&
    prev.iconBackdrop === next.iconBackdrop &&
    prev.openInSameTab === next.openInSameTab
  );
});

export default BookmarkItem;
