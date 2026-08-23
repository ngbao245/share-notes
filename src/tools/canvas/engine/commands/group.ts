import type { CanvasObject, Geometry } from '../../types';
import { useObjectsStore } from '../../store/objects-store';
import { useSelectionStore } from '../../store/selection-store';
import { getCanvasRepository } from '../../repository';
import { enqueueRepoCall } from '../../sync/optimistic-queue';
import { geometryToRect, unionRects } from '../geometry';
import type { GroupData } from '../../components/objects/GroupObject';
import type { Command } from './types';

// ============================================================
// groupCommand — Tạo GroupObject wrap các children
// ============================================================
//
// AABB group = union geometry của children (Phase 4B: tính lúc create,
// không auto-recompute khi child move — group.geometry chỉ dùng cho
// alignment/selection outline reference).
//
// zIndex group = max(children.zIndex) + 1 để group nằm trên children
// trong sort order (dù invisible).
//
// boardId group = boardId chung của children. Assume tất cả children
// cùng board (caller đã validate).
//
// Execute:
//   - Upsert GroupObject vào store + repo
//   - Selection = { groupId } (thay các children được selected trước)
//
// Undo:
//   - Remove GroupObject
//   - Selection = children set (restore state trước group)
// ============================================================

export function groupCommand(childIds: string[], newGroupId?: string): Command {
  const timestamp = Date.now();
  const groupId = newGroupId ?? crypto.randomUUID();

  return {
    id: `group-${groupId}-${timestamp}`,
    type: 'group',
    timestamp,
    execute() {
      const store = useObjectsStore.getState();
      const children: CanvasObject[] = [];
      for (const id of childIds) {
        const obj = store.get(id);
        if (obj) children.push(obj);
      }
      if (children.length < 2) {
        // Guard: group cần ≥ 2 children. Caller nên validate trước,
        // nhưng safety net để execute không crash.
        return;
      }

      // Compute AABB union.
      const aabb = unionRects(children.map((c) => geometryToRect(c.geometry)));
      if (!aabb) return;

      // Max zIndex + 1.
      let maxZ = 0;
      for (const c of children) {
        if (c.geometry.zIndex > maxZ) maxZ = c.geometry.zIndex;
      }

      const boardId = children[0].boardId; // Cùng board — caller validate.
      const now = new Date().toISOString();
      const groupGeometry: Geometry = {
        x: aabb.x,
        y: aabb.y,
        width: aabb.width,
        height: aabb.height,
        rotation: 0,
        zIndex: maxZ + 1,
      };

      const groupObject: CanvasObject = {
        id: groupId,
        type: 'group',
        boardId,
        geometry: groupGeometry,
        data: { children: [...childIds] } as GroupData,
        createdAt: now,
        updatedAt: now,
      };

      store.upsert(groupObject);
      enqueueRepoCall(
        () => getCanvasRepository().createObject(groupObject),
        `create group ${groupId}`,
      );

      useSelectionStore.getState().replaceAll([groupId]);
    },
    undo() {
      const store = useObjectsStore.getState();
      store.remove(groupId);
      enqueueRepoCall(
        () => getCanvasRepository().deleteObject(groupId),
        `delete group ${groupId}`,
      );
      // Restore selection = tất cả children (nếu còn tồn tại).
      const restoreIds = childIds.filter((id) => store.get(id));
      useSelectionStore.getState().replaceAll(restoreIds);
    },
  };
}
