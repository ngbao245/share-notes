import type { CanvasObject } from '../types';
import type { Rect } from './geometry';

// ============================================================
// Canvas — Board drop-target engine (Phase 4B, pure)
// ============================================================
//
// Detect board hit-test khi drag hover + validate circular hierarchy
// (không drop board vào chính descendant).
//
// Threshold: 50% overlap dragging AABB nằm trong board AABB.
// ============================================================

const DROP_OVERLAP_RATIO = 0.5;

function rectIntersectArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

export interface BoardCandidate {
  id: string;
  aabb: Rect;
  parentId: string | null;
  zIndex: number;
}

/**
 * Walk parent chain của boardId, return true nếu chain có ancestorId
 * (hoặc boardId === ancestorId).
 */
export function isDescendantBoard(
  boardId: string,
  ancestorId: string,
  hierarchy: Map<string, string | null>
): boolean {
  let cursor: string | null | undefined = boardId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    if (cursor === ancestorId) return true;
    guard.add(cursor);
    cursor = hierarchy.get(cursor) ?? null;
  }
  return false;
}

/**
 * Tìm board drop target hợp lệ.
 *
 * Rules:
 *   - Skip nếu board.id ∈ draggingIds (drop vào chính self).
 *   - Skip nếu overlap ratio < DROP_OVERLAP_RATIO.
 *   - Skip nếu dragging chứa board id, và target = descendant của board đó
 *     (circular).
 *   - Pick TOP-most (max zIndex) match nếu multiple.
 */
export function findBoardDropTarget(
  draggingAABB: Rect,
  draggingIds: Set<string>,
  boards: BoardCandidate[],
  hierarchy: Map<string, string | null>,
  draggingObjects: CanvasObject[]
): string | null {
  const dragArea = draggingAABB.width * draggingAABB.height;
  if (dragArea <= 0) return null;

  const draggingBoardIds = draggingObjects
    .filter((o) => o.type === 'board')
    .map((o) => o.id);

  let best: { id: string; zIndex: number } | null = null;

  for (const b of boards) {
    if (draggingIds.has(b.id)) continue;

    const overlap = rectIntersectArea(draggingAABB, b.aabb);
    if (overlap / dragArea < DROP_OVERLAP_RATIO) continue;

    // Circular: nếu bất kỳ dragging board nào là ancestor của b → invalid.
    let invalid = false;
    for (const draggingBoardId of draggingBoardIds) {
      if (isDescendantBoard(b.id, draggingBoardId, hierarchy)) {
        invalid = true;
        break;
      }
    }
    if (invalid) continue;

    if (!best || b.zIndex > best.zIndex) {
      best = { id: b.id, zIndex: b.zIndex };
    }
  }

  return best?.id ?? null;
}
