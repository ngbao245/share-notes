// ============================================================
// Canvas — Snap-to-grid engine (Phase 4B, pure)
// ============================================================
//
// Grid size hard-code 20px = match visible grid dots (CanvasSurface
// background 22px, close enough — grid dots space là visual reference
// duy nhất, snap phải sync). Nếu grid config thành setting sau, thay
// constant này qua getter đọc từ store.
// ============================================================

export const CANVAS_GRID_SIZE = 20;

export interface Point {
  x: number;
  y: number;
}

/** Round position về nearest multiple của gridSize. */
export function snapPosition(pos: Point, gridSize: number = CANVAS_GRID_SIZE): Point {
  return {
    x: Math.round(pos.x / gridSize) * gridSize,
    y: Math.round(pos.y / gridSize) * gridSize,
  };
}

/**
 * Snap delta: nhận anchor position + raw delta, return delta để anchor
 * sau move rơi vào grid. Dùng cho multi-object drag (snap chung theo
 * anchor, không snap từng object riêng).
 */
export function snapDelta(
  anchorFromPos: Point,
  rawDelta: { dx: number; dy: number },
  gridSize: number = CANVAS_GRID_SIZE
): { dx: number; dy: number } {
  const targetPos = { x: anchorFromPos.x + rawDelta.dx, y: anchorFromPos.y + rawDelta.dy };
  const snapped = snapPosition(targetPos, gridSize);
  return {
    dx: snapped.x - anchorFromPos.x,
    dy: snapped.y - anchorFromPos.y,
  };
}
