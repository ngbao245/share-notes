import { forwardRef, memo, useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';
import { useHistoryStore } from '../../engine/commands/history';
import { updateCommand } from '../../engine/commands/update';
import { getCanvasRepository } from '../../repository';
import {
  loadUrl,
  peekUrl,
  release as releaseBlobUrl,
  subscribeUrl,
} from '../../lib/blob-url-cache';
import { readImageMetadata, isImageMime } from '../../lib/file-to-image';
import { ObjectShell } from './ObjectShell';

// ============================================================
// ImageObject — Blob-backed image
// ============================================================
//
// Data: { blobId, mimeType, naturalWidth, naturalHeight }
// Blob stored in IDB `blobs` store. Renderer loads URL qua cache,
// subscribes cho re-render khi resolved.
//
// Double-click → mở file picker để replace image. Save new blob (new
// blobId) + push UpdateCommand.
// ============================================================

interface ImageData {
  blobId: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
}

const ImageObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected, isEditing, onEditEnd }, ref) => {
    const data = object.data as ImageData;
    const [url, setUrl] = useState<string | undefined>(() => peekUrl(data.blobId));
    const [failed, setFailed] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load URL + subscribe.
    useEffect(() => {
      if (!data.blobId) return;
      if (url) return;
      let cancelled = false;
      void loadUrl(data.blobId).then((u) => {
        if (cancelled) return;
        if (u) setUrl(u);
        else setFailed(true);
      });
      const unsub = subscribeUrl(data.blobId, () => {
        const cached = peekUrl(data.blobId);
        if (cached) setUrl(cached);
      });
      return () => {
        cancelled = true;
        unsub();
      };
    }, [data.blobId, url]);

    // Auto-open picker khi isEditing (double-click).
    useEffect(() => {
      if (isEditing) {
        fileInputRef.current?.click();
        // Không giữ isEditing lâu — file dialog block.
        onEditEnd?.();
      }
    }, [isEditing, onEditEnd]);

    const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!isImageMime(file.type)) {
        toast.error('Chỉ hỗ trợ png/jpg/jpeg/gif/webp');
        return;
      }
      try {
        const meta = await readImageMetadata(file);
        const newBlobId = crypto.randomUUID();
        await getCanvasRepository().saveBlob(newBlobId, file, file.type);
        const oldBlobId = data.blobId;
        useHistoryStore.getState().push(
          updateCommand(
            object.id,
            { data: data as unknown as Record<string, unknown> },
            {
              data: {
                blobId: newBlobId,
                mimeType: meta.mimeType,
                naturalWidth: meta.naturalWidth,
                naturalHeight: meta.naturalHeight,
              } as unknown as Record<string, unknown>,
            }
          )
        );
        // Revoke object URL cũ — không component nào còn tham chiếu blobId cũ
        // sau update (blobId là random UUID per image, không share).
        if (oldBlobId) releaseBlobUrl(oldBlobId);
        setUrl(undefined);
        setFailed(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không lưu được ảnh');
      }
    };

    return (
      <ObjectShell
        ref={ref as React.Ref<HTMLDivElement>}
        object={object}
        isSelected={isSelected}
      >
        {url && !failed ? (
          <img
            src={url}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
            className="pointer-events-none h-full w-full select-none object-cover"
          />
        ) : failed ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={handleReplace}
          className="hidden"
        />
      </ObjectShell>
    );
  }
);
ImageObjectImpl.displayName = 'ImageObject';

export const ImageObject = memo(ImageObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'image',
  renderer: ImageObject as any,
  defaultGeometry: { width: 300, height: 200, rotation: 0, zIndex: 0 },
  defaultData: {
    blobId: '',
    mimeType: '',
    naturalWidth: 0,
    naturalHeight: 0,
  } as ImageData,
  label: 'Add image',
});
