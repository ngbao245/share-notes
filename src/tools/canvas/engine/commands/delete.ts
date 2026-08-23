import type { Board, CanvasObject } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { useSelectionStore } from '../../store/selection-store';
import { getCanvasRepository } from '../../repository';
import { release as releaseBlobUrl } from '../../lib/blob-url-cache';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { Command } from './types';

function releaseImageBlobUrls(objects: CanvasObject[]): void {
  for (const o of objects) {
    if (o.type !== 'image') continue;
    const blobId = (o.data as { blobId?: string })?.blobId;
    if (blobId) releaseBlobUrl(blobId);
  }
}

/**
 * Batch delete objects (+ optional boards for cascade). Undo restore
 * cả 2 + previous selection state.
 * @param objects objects cần xoá (kể cả BoardObject nếu có)
 * @param boards board records cần xoá song song (Phase 4A cascade)
 */
export function deleteCommand(
  objects: CanvasObject[],
  boards: Board[] = []
): Command {
  // Capture selection state at command creation for undo restore.
  const selectionSnapshot = Array.from(
    useSelectionStore.getState().selectedIds
  );

  return {
    id: `delete-${Date.now()}`,
    type: 'delete',
    timestamp: Date.now(),
    execute() {
      const store = useObjectsStore.getState();
      const repo = getCanvasRepository();
      store.batchRemove(objects.map((o) => o.id));
      // Revoke blob object URL cho image objects — không component nào còn
      // render các blobId này sau khi remove khỏi store. Undo sẽ re-load
      // qua loadUrl() vì blob vẫn ở IDB/Storage (soft-delete).
      releaseImageBlobUrls(objects);
      for (const o of objects) {
        enqueueRepoCall(() => repo.deleteObject(o.id), `delete ${o.type} ${o.id}`);
      }
      for (const b of boards) {
        enqueueRepoCall(() => repo.deleteBoard(b.id), `delete board ${b.id}`);
      }
      // Clear selection (deleted objects không còn selectable).
      useSelectionStore.getState().clear();
    },
    undo() {
      const store = useObjectsStore.getState();
      const repo = getCanvasRepository();
      store.batchUpsert(objects);
      for (const o of objects) {
        enqueueRepoCall(() => repo.createObject(o), `restore ${o.type} ${o.id}`);
      }
      for (const b of boards) {
        enqueueRepoCall(() => repo.createBoard(b), `restore board ${b.id}`);
      }
      // Restore selection.
      useSelectionStore.getState().replaceAll(selectionSnapshot);
    },
  };
}
