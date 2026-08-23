// ============================================================
// Canvas — Board cascade delete helper
// ============================================================
//
// Collect tất cả descendants (sub-boards + objects) khi xoá 1 board.
// Return { objects, boards } sẵn sàng cho deleteCommand.
// ============================================================

import type { Board, CanvasObject } from '../types';
import { getCanvasRepository } from '../repository';
import { useObjectsStore } from '../store/objects-store';

export interface CascadeCollectResult {
  objects: CanvasObject[];
  boards: Board[];
}

/**
 * Collect subtree khi xoá board `rootId`:
 *   - Tất cả sub-boards recursive
 *   - Tất cả objects thuộc mọi board trong subtree (bao gồm root)
 *   - Object đại diện của board (tồn tại trong parent board của mỗi sub-board)
 */
export async function collectBoardCascade(
  rootBoardObjectId: string
): Promise<CascadeCollectResult> {
  const repo = getCanvasRepository();

  // 1. Load all boards + build children index.
  const allBoards = await repo.loadAllBoards();
  const childrenOf = new Map<string, Board[]>();
  for (const b of allBoards) {
    if (b.parentId === null) continue;
    if (!childrenOf.has(b.parentId)) childrenOf.set(b.parentId, []);
    childrenOf.get(b.parentId)!.push(b);
  }

  // 2. Walk subtree từ root.
  const boardsInSubtree: Board[] = [];
  const walk = (id: string) => {
    const board = allBoards.find((b) => b.id === id);
    if (board) boardsInSubtree.push(board);
    const kids = childrenOf.get(id) ?? [];
    for (const k of kids) walk(k.id);
  };
  walk(rootBoardObjectId);

  // 3. Collect objects thuộc mọi board trong subtree.
  const objectsSet: CanvasObject[] = [];
  const objectsStore = useObjectsStore.getState();

  // In-memory store hiện chỉ chứa objects của board hiện tại (đã filter).
  // Cần load thẳng từ repo cho từng board trong subtree.
  for (const b of boardsInSubtree) {
    const filterId = b.parentId === null ? null : b.id;
    const objs = await repo.loadObjects(filterId);
    objectsSet.push(...objs);
  }

  // 4. Include board object đại diện tại parent (nếu tồn tại trong memory hoặc parent load).
  // Board object có id = board.id, nằm ở boardId = board.parentId.
  // Cache trong memory nếu currently ở parent board.
  for (const b of boardsInSubtree) {
    if (b.parentId === null) continue; // root không có object đại diện
    // Check in-memory first
    const inMem = objectsStore.get(b.id);
    if (inMem && inMem.type === 'board' && !objectsSet.some((o) => o.id === b.id)) {
      objectsSet.push(inMem);
      continue;
    }
    // Load từ repo (boardId của board object = parent board's id-as-filter)
    const parentBoard = allBoards.find((pb) => pb.id === b.parentId);
    if (!parentBoard) continue;
    const filterId = parentBoard.parentId === null ? null : parentBoard.id;
    const parentObjects = await repo.loadObjects(filterId);
    const boardObj = parentObjects.find(
      (o) => o.id === b.id && o.type === 'board'
    );
    if (boardObj && !objectsSet.some((o) => o.id === boardObj.id)) {
      objectsSet.push(boardObj);
    }
  }

  return { objects: objectsSet, boards: boardsInSubtree };
}
