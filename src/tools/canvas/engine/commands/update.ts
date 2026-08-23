import type { CanvasObject } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { Command } from './types';

/** Patch data hoặc field khác (không phải geometry). Undo revert. */
export function updateCommand(
  id: string,
  from: Partial<CanvasObject>,
  to: Partial<CanvasObject>
): Command {
  return {
    id: `update-${id}-${Date.now()}`,
    type: 'update',
    timestamp: Date.now(),
    execute() {
      useObjectsStore.getState().patch(id, to);
      enqueueRepoCall(
        () => getCanvasRepository().updateObject(id, to),
        `update ${id}`,
        { coalesceKey: `update-${id}`, debounceMs: 800 },
      );
    },
    undo() {
      useObjectsStore.getState().patch(id, from);
      enqueueRepoCall(
        () => getCanvasRepository().updateObject(id, from),
        `undo update ${id}`,
        { coalesceKey: `update-${id}`, debounceMs: 800 },
      );
    },
  };
}
