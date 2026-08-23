import { useObjectsStore } from '../../store/objects-store';
import { useSelectionStore } from '../../store/selection-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { Command } from './types';

// ============================================================
// moveIntoBoardCommand — Phase 4B
// ============================================================
//
// Batch chuyển objects sang board mới. Object.boardId change, geometry
// giữ nguyên (position trong absolute canvas-space của board mới).
//
// Selection sau execute: clear (objects moved khỏi current view).
// Undo: revert boardId + restore selection.
// ============================================================

export interface MoveIntoBoardPatch {
  id: string;
  fromBoardId: string | null;
  toBoardId: string | null;
}

export function moveIntoBoardCommand(patches: MoveIntoBoardPatch[]): Command {
  const timestamp = Date.now();
  const selectionSnapshot = Array.from(useSelectionStore.getState().selectedIds);

  return {
    id: `move-into-board-${timestamp}`,
    type: 'update',
    timestamp,
    execute() {
      const store = useObjectsStore.getState();
      const repo = getCanvasRepository();
      const now = new Date().toISOString();
      const objPatches = patches
        .map((p) => {
          const existing = store.get(p.id);
          if (!existing) return null;
          return {
            id: p.id,
            patch: { boardId: p.toBoardId, updatedAt: now },
          };
        })
        .filter((p): p is NonNullable<typeof p> => !!p);
      store.batchPatch(objPatches);
      for (const p of patches) {
        enqueueRepoCall(
          () => repo.updateObject(p.id, { boardId: p.toBoardId }),
          `move ${p.id} into board`,
          { coalesceKey: `move-into-${p.id}`, debounceMs: 500 },
        );
      }
      useSelectionStore.getState().clear();
    },
    undo() {
      const store = useObjectsStore.getState();
      const repo = getCanvasRepository();
      const now = new Date().toISOString();
      const objPatches = patches
        .map((p) => {
          const existing = store.get(p.id);
          if (!existing) return null;
          return {
            id: p.id,
            patch: { boardId: p.fromBoardId, updatedAt: now },
          };
        })
        .filter((p): p is NonNullable<typeof p> => !!p);
      store.batchPatch(objPatches);
      for (const p of patches) {
        enqueueRepoCall(
          () => repo.updateObject(p.id, { boardId: p.fromBoardId }),
          `undo move ${p.id} into board`,
          { coalesceKey: `move-into-${p.id}`, debounceMs: 500 },
        );
      }
      useSelectionStore.getState().replaceAll(selectionSnapshot);
    },
  };
}
