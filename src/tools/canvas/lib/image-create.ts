// ============================================================
// Canvas — Image object creation helper (shared for paste/drop/menu)
// ============================================================

import { toast } from '@/components/ui/sonner';

import type { CanvasObject } from '../types';
import { getCanvasRepository } from '../repository';
import { useHistoryStore } from '../engine/commands/history';
import { createCommand } from '../engine/commands/create';
import { useSelectionStore } from '../store/selection-store';
import { readImageMetadata, isImageMime } from './file-to-image';

interface CreateFromBlobOptions {
  blob: Blob;
  /** Vị trí canvas-space nơi center object đặt vào. */
  canvasX: number;
  canvasY: number;
}

/**
 * Save blob → tạo Image object + push CreateCommand + select.
 * Return object id nếu thành công, null nếu fail (mime hoặc quota).
 */
export async function createImageFromBlob(
  opts: CreateFromBlobOptions
): Promise<string | null> {
  const { blob, canvasX, canvasY } = opts;

  if (!isImageMime(blob.type)) {
    toast.error(`Không hỗ trợ định dạng ${blob.type || 'unknown'}`);
    return null;
  }

  try {
    const meta = await readImageMetadata(blob);
    const blobId = crypto.randomUUID();
    await getCanvasRepository().saveBlob(blobId, blob, blob.type);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const obj: CanvasObject = {
      id,
      type: 'image',
      boardId: null,
      geometry: {
        x: canvasX - meta.displayWidth / 2,
        y: canvasY - meta.displayHeight / 2,
        width: meta.displayWidth,
        height: meta.displayHeight,
        rotation: 0,
        zIndex: 0,
      },
      data: {
        blobId,
        mimeType: meta.mimeType,
        naturalWidth: meta.naturalWidth,
        naturalHeight: meta.naturalHeight,
      },
      createdAt: now,
      updatedAt: now,
    };

    useHistoryStore.getState().push(createCommand(obj));
    useSelectionStore.getState().select(id);
    return id;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      toast.error('IndexedDB đầy — không lưu được ảnh');
    } else {
      toast.error(err instanceof Error ? err.message : 'Không xử được ảnh');
    }
    return null;
  }
}
