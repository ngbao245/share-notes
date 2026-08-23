import type { CanvasObject } from '../types';
import type { GroupData } from '../components/objects/GroupObject';

// ============================================================
// Group helpers (Phase 4B)
// ============================================================
//
// Reverse map lookup + expand utilities. Không memoize toàn cục —
// caller thường có snapshot objects trước operation nên tính O(N)
// là chấp nhận được (N ≤ 500 realistic).
// ============================================================

/**
 * Tìm group chứa child id. Return group id hoặc null nếu không thuộc group.
 * Walk qua tất cả GroupObject, check children array.
 */
export function resolveGroupOwner(
  childId: string,
  objects: Map<string, CanvasObject>
): string | null {
  for (const obj of objects.values()) {
    if (obj.type !== 'group') continue;
    const data = obj.data as GroupData;
    if (data.children.includes(childId)) return obj.id;
  }
  return null;
}

/**
 * Lấy children ids của 1 group.
 */
export function getGroupChildren(
  groupId: string,
  objects: Map<string, CanvasObject>
): string[] {
  const obj = objects.get(groupId);
  if (!obj || obj.type !== 'group') return [];
  return (obj.data as GroupData).children;
}

/**
 * Expand danh sách ids: nếu id là group → thêm children ids (keep group
 * để engine cũng move group.geometry cùng delta). Return list dedup.
 */
export function expandGroupIds(
  ids: string[],
  objects: Map<string, CanvasObject>
): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    result.add(id);
    const obj = objects.get(id);
    if (obj && obj.type === 'group') {
      const data = obj.data as GroupData;
      for (const childId of data.children) {
        result.add(childId);
      }
    }
  }
  return Array.from(result);
}
