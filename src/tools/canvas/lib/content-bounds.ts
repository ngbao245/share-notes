// ============================================================
// Canvas — Content bounds derivation (P6 Milanote parity)
// ============================================================
//
// Pure functions compute:
//   - `computeContentBounds`: AABB union objects trên 1 board
//   - `computeDynamicZoomMin`: min zoom cho phép dựa content + viewport
//
// Fit-zoom math sống ở `engine/camera.ts` (`computeFitZoom`) — SSOT dùng
// cho cả Fit button (route.tsx handleFit) và dynamic zoom min (đây).
// Đảm bảo Fit target luôn khớp zoom-out clamp threshold.
//
// Milanote UX principle: user không được zoom out vào empty space vô
// nghĩa. Khi content ít → zoom min cao (không cho zoom nhỏ hơn 100%).
// Khi content spread rộng → zoom min thấp (cho zoom out xa để thấy tất
// cả). Bounds recompute derived từ objects, không persist.
// ============================================================

import type { CanvasObject } from '../types';
import { ZOOM_MIN } from '../types';
import type { Bounds } from '../engine/camera';
import { computeFitZoom } from '../engine/camera';

// Re-export cho consumer nếu cần dùng chung math.
export { computeFitZoom };
export type { Bounds };

/**
 * Compute AABB union của objects trên 1 board. Loại 'group' (logical, không
 * có geometry render) khỏi tính toán. Boards trong board (nested) tính vào
 * bounds vì user sẽ zoom out để thấy board children.
 *
 * @param objects Map hoặc iterable từ objects-store
 * @param boardId board hiện tại. null = root board.
 * @returns Bounds hoặc null nếu empty
 */
export function computeContentBounds(
  objects: Iterable<CanvasObject>,
  boardId: string | null,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const obj of objects) {
    if (obj.boardId !== boardId) continue;
    if (obj.type === 'group') continue; // logical only
    const g = obj.geometry;
    if (g.x < minX) minX = g.x;
    if (g.y < minY) minY = g.y;
    const right = g.x + g.width;
    const bottom = g.y + g.height;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
    count++;
  }

  if (count === 0) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Margin (world-space pixel) thêm quanh content bounds để tạo pan bounds.
 * User có thể pan viewport center xa ra ngoài content edge tối đa
 * `PAN_MARGIN_PX` mỗi phía trước khi bị clamp.
 */
const PAN_MARGIN_PX = 300;

/**
 * Compute pan bounds — world-space region viewport center được phép move
 * vào. Content bounds + margin mỗi phía. Empty content → return null,
 * caller không clamp.
 *
 * Milanote UX: board bounded, không cho pan vào empty vô hạn xa content.
 */
export function computePanBounds(
  contentBounds: Bounds | null,
): Bounds | null {
  if (!contentBounds) return null;
  return {
    x: contentBounds.x - PAN_MARGIN_PX,
    y: contentBounds.y - PAN_MARGIN_PX,
    width: contentBounds.width + PAN_MARGIN_PX * 2,
    height: contentBounds.height + PAN_MARGIN_PX * 2,
  };
}

/**
 * Compute dynamic min zoom cho board hiện tại. Đây là cận dưới thực tế
 * áp cho camera.zoom, thay ZOOM_MIN constant.
 *
 * Rule:
 *   - Empty content (bounds null): min = 1 (không zoom out được nữa, đã
 *     ở viewport level, zoom out vào empty vô nghĩa)
 *   - Content fit trong viewport ở zoom 1x (fitZoom >= 1): min = 1
 *     (không zoom out < 100% khi content đã ít)
 *   - Content vượt viewport ở zoom 1x (fitZoom < 1): min = fitZoom
 *     (user zoom out được tới đúng chỗ thấy toàn bộ, khớp Fit button)
 *
 * @returns zoom min ∈ [ZOOM_MIN, 1]
 */
export function computeDynamicZoomMin(
  bounds: Bounds | null,
  viewport: { width: number; height: number },
): number {
  if (!bounds) return 1;

  const fit = computeFitZoom(bounds, viewport);

  // Content nhỏ hơn viewport → fit > 1. Clamp min = 1.
  if (fit >= 1) return 1;

  // Content lớn hơn viewport → fit < 1. Cho phép zoom out tới fit.
  return Math.max(ZOOM_MIN, fit);
}
