import type { CanvasObject } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { Command } from './types';

/** Tạo object mới. Undo = xoá. */
export function createCommand(object: CanvasObject): Command {
  return {
    id: `create-${object.id}-${Date.now()}`,
    type: 'create',
    timestamp: Date.now(),
    execute() {
      useObjectsStore.getState().upsert(object);
      enqueueRepoCall(
        () => getCanvasRepository().createObject(object),
        `create ${object.type} ${object.id}`,
      );
    },
    undo() {
      useObjectsStore.getState().remove(object.id);
      enqueueRepoCall(
        () => getCanvasRepository().deleteObject(object.id),
        `delete ${object.type} ${object.id}`,
      );
    },
  };
}
