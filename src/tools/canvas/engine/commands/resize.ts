import type { Geometry } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { Command } from './types';

/** Resize single object. Undo về geometry cũ. */
export function resizeCommand(id: string, from: Geometry, to: Geometry): Command {
  return {
    id: `resize-${id}-${Date.now()}`,
    type: 'resize',
    timestamp: Date.now(),
    execute() {
      useObjectsStore.getState().patch(id, { geometry: to });
      enqueueRepoCall(
        () => getCanvasRepository().updateObject(id, { geometry: to }),
        `resize ${id}`,
        { coalesceKey: `resize-${id}`, debounceMs: 500 },
      );
    },
    undo() {
      useObjectsStore.getState().patch(id, { geometry: from });
      enqueueRepoCall(
        () => getCanvasRepository().updateObject(id, { geometry: from }),
        `undo resize ${id}`,
        { coalesceKey: `resize-${id}`, debounceMs: 500 },
      );
    },
  };
}
