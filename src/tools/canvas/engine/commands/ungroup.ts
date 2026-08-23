import type { CanvasObject } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { useSelectionStore } from '../../store/selection-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import type { GroupData } from '../../components/objects/GroupObject';
import type { Command } from './types';

// ============================================================
// ungroupCommand — Xoá GroupObject, children thành top-level
// ============================================================
//
// Không đổi geometry / boardId của children (chúng đã ở absolute canvas
// coord đúng, group chỉ là logical wrap).
//
// Execute:
//   - Remove GroupObject
//   - Selection = children ids
//
// Undo:
//   - Restore GroupObject nguyên snapshot
//   - Selection = { groupId }
// ============================================================

export function ungroupCommand(groupId: string): Command {
  const timestamp = Date.now();
  // Snapshot group trước khi execute để undo restore full state.
  const initialSnapshot = useObjectsStore.getState().get(groupId);

  return {
    id: `ungroup-${groupId}-${timestamp}`,
    type: 'ungroup',
    timestamp,
    execute() {
      const store = useObjectsStore.getState();
      const group = store.get(groupId);
      if (!group || group.type !== 'group') return;

      const childIds = (group.data as GroupData).children;
      store.remove(groupId);
      enqueueRepoCall(
        () => getCanvasRepository().deleteObject(groupId),
        `delete group ${groupId}`,
      );

      // Selection = children còn tồn tại.
      const restoreIds = childIds.filter((id) => store.get(id));
      useSelectionStore.getState().replaceAll(restoreIds);
    },
    undo() {
      if (!initialSnapshot) return;
      const store = useObjectsStore.getState();
      // Recreate group (dùng snapshot nguyên trạng).
      const restored: CanvasObject = { ...initialSnapshot };
      store.upsert(restored);
      enqueueRepoCall(
        () => getCanvasRepository().createObject(restored),
        `restore group ${groupId}`,
      );
      useSelectionStore.getState().replaceAll([groupId]);
    },
  };
}
