import { forwardRef, memo, useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';

import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';
import { useHistoryStore } from '../../engine/commands/history';
import { updateCommand } from '../../engine/commands/update';
import {
  fetchLinkMetadata,
  googleFaviconUrl,
} from '../../lib/link-metadata';
import { ObjectShell } from './ObjectShell';

// ============================================================
// LinkObject — URL với auto-fetch metadata preview
// ============================================================
//
// Data: { url, title?, favicon?, ogImage?, hostname?, fetchStatus }
// Layout adapt theo metadata available:
//   ogImage → thumbnail top full-width + title + URL
//   favicon (no og) → horizontal favicon + title + URL
//   loading → skeleton
//   fail → URL raw + globe icon
//
// Click (không edit) → mở URL tab mới.
// Double-click → enter edit mode → khi có prompt hoặc trigger từ orchestrator.
// Phase 2 double-click chỉ trigger onEditEnd (dialog re-edit sẽ ở CanvasApp).
// ============================================================

export interface LinkData {
  url: string;
  title?: string;
  favicon?: string;
  ogImage?: string;
  hostname?: string;
  fetchStatus: 'pending' | 'ok' | 'fail';
}

const LinkObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected, isEditing }, ref) => {
    const data = object.data as LinkData;
    const [fetching, setFetching] = useState(false);

    // Trigger fetch nếu status = pending và chưa fetched.
    useEffect(() => {
      if (data.fetchStatus !== 'pending') return;
      if (!data.url) return;
      if (fetching) return;
      setFetching(true);

      let cancelled = false;
      void fetchLinkMetadata(data.url).then((meta) => {
        if (cancelled) return;
        setFetching(false);
        if (!meta) {
          // Silent update (không undo-able) sang fail.
          useHistoryStore.getState().push(
            updateCommand(
              object.id,
              { data: data as unknown as Record<string, unknown> },
              {
                data: {
                  ...data,
                  fetchStatus: 'fail',
                  favicon: googleFaviconUrl(data.url),
                } as unknown as Record<string, unknown>,
              }
            )
          );
          return;
        }
        useHistoryStore.getState().push(
          updateCommand(
            object.id,
            { data: data as unknown as Record<string, unknown> },
            {
              data: {
                ...data,
                title: meta.title,
                favicon: meta.favicon || googleFaviconUrl(data.url),
                ogImage: meta.ogImage,
                hostname: meta.hostname,
                fetchStatus: 'ok',
              } as unknown as Record<string, unknown>,
            }
          )
        );
      });

      return () => {
        cancelled = true;
      };
    }, [data.fetchStatus, data.url, fetching, object.id, data]);

    const handleClick = (e: React.MouseEvent) => {
      if (isEditing) return;
      // Chỉ mở link khi single click (không phải drag)
      // usePointerFSM đã handle drag detection, click event chỉ fire khi
      // pointer up sau khoảng ngắn không di chuyển.
      // Actually: mousedown → drag, click chỉ fire sau khi up.
      // Để tránh xung đột, chỉ open link khi Ctrl-click hoặc Alt-click.
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    };

    const showOgImage = data.fetchStatus === 'ok' && data.ogImage;
    const showFavicon = data.fetchStatus !== 'pending' && data.favicon;

    return (
      <ObjectShell
        ref={ref as React.Ref<HTMLDivElement>}
        object={object}
        isSelected={isSelected}
        onClick={handleClick}
        title={
          data.fetchStatus === 'ok'
            ? `Ctrl+Click để mở: ${data.url}`
            : data.url
        }
        className="flex flex-col"
      >
        {data.fetchStatus === 'pending' && (
          <div className="flex flex-1 items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="truncate">{data.url}</span>
          </div>
        )}

        {data.fetchStatus === 'ok' && showOgImage && (
          <>
            <div className="relative flex-1 overflow-hidden bg-muted">
              <img
                src={data.ogImage}
                alt=""
                draggable={false}
                className="pointer-events-none h-full w-full select-none object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <div className="flex items-center gap-2 border-t border-border p-2">
              {showFavicon && (
                <img
                  src={data.favicon}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-sm"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {data.title || data.url}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {data.hostname || data.url}
                </div>
              </div>
            </div>
          </>
        )}

        {data.fetchStatus === 'ok' && !showOgImage && (
          <div className="flex flex-1 items-center gap-3 p-3">
            {showFavicon ? (
              <img
                src={data.favicon}
                alt=""
                className="h-8 w-8 shrink-0 rounded-sm"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Globe className="h-8 w-8 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {data.title || data.url}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {data.hostname || data.url}
              </div>
            </div>
          </div>
        )}

        {data.fetchStatus === 'fail' && (
          <div className="flex flex-1 items-center gap-3 p-3">
            <Globe className="h-8 w-8 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{data.url}</div>
            </div>
          </div>
        )}
      </ObjectShell>
    );
  }
);
LinkObjectImpl.displayName = 'LinkObject';

export const LinkObject = memo(LinkObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'link',
  renderer: LinkObject as any,
  defaultGeometry: { width: 320, height: 100, rotation: 0, zIndex: 0 },
  defaultData: {
    url: '',
    fetchStatus: 'pending',
  } as LinkData,
  label: 'Add link',
});
