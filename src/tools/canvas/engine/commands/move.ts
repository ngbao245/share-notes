import type { Geometry } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { Command } from './types';

interface MovePatch {
  id: string;
  from: Geometry;
  to: Geometry;
}

const MERGE_WINDOW_MS = 500;

/**
 * Move batch. Undo revert từng object về from-geometry.
 * Merge: consecutive move cùng id set trong 500ms → gộp (giữ from cũ,
 * dùng to mới) để 1 lần drag không tốn N undo slot.
 */
export function moveCommand(patches: MovePatch[]): Command {
  const timestamp = Date.now();
  const idSet = new Set(patches.map((p) => p.id));

  const cmd: Command = {
    id: `move-${timestamp}`,
    type: 'move',
    timestamp,
    execute() {
      const store = useObjectsStore.getState();
      const repo = getCanvasRepository();
      store.batchPatch(patches.map((p) => ({ id: p.id, patch: { geometry: p.to } })));
      for (const p of patches) {
        enqueueRepoCall(
          () => repo.updateObject(p.id, { geometry: p.to }),
          `move ${p.id}`,
          { coalesceKey: `move-${p.id}`, debounceMs: 500 },
        );
      }
    },
    undo() {
      const store = useObjectsStore.getState();
      const repo = getCanvasRepository();
      store.batchPatch(patches.map((p) => ({ id: p.id, patch: { geometry: p.from } })));
      for (const p of patches) {
        enqueueRepoCall(
          () => repo.updateObject(p.id, { geometry: p.from }),
          `undo move ${p.id}`,
          { coalesceKey: `move-${p.id}`, debounceMs: 500 },
        );
      }
    },
    merge(next) {
      if (next.type !== 'move') return null;
      if (next.timestamp - timestamp > MERGE_WINDOW_MS) return null;
      const nextCmd = next as ReturnType<typeof moveCommand> & {
        __patches?: MovePatch[];
      };
      const nextPatches = nextCmd.__patches;
      if (!nextPatches) return null;
      // Same id set?
      if (nextPatches.length !== patches.length) return null;
      for (const p of nextPatches) if (!idSet.has(p.id)) return null;

      // Merged: keep `from` từ cmd cũ, `to` từ cmd mới.
      const merged: MovePatch[] = patches.map((p) => {
        const nextP = nextPatches.find((n) => n.id === p.id)!;
        return { id: p.id, from: p.from, to: nextP.to };
      });
      return moveCommand(merged);
    },
  };
  (cmd as Command & { __patches?: MovePatch[] }).__patches = patches;
  return cmd;
}

export type { MovePatch };
