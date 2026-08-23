// ============================================================
// Canvas — Coordinate conversions
// ============================================================
//
// Screen-space <=> Canvas-space (world). Centralize tại đây, KHÔNG
// scatter trong component. Rule cứng: mọi hit-test, marquee AABB,
// object position đều tính ở canvas-space; render dùng transform CSS
// để chuyển sang screen.
//
// Camera model:
//   screen.x = canvas.x * zoom + camera.x
//   screen.y = canvas.y * zoom + camera.y
//   (camera.x, camera.y là translate offset của viewport)
// ============================================================

import type { Camera } from '../types';

export interface Point {
  x: number;
  y: number;
}

/** Convert screen coord (pixel viewport-relative) → canvas world coord. */
export function screenToCanvas(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

/** Convert canvas world coord → screen coord. */
export function canvasToScreen(point: Point, camera: Camera): Point {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

/**
 * Delta screen → delta canvas (không tính camera translate, chỉ scale).
 * Dùng cho drag: pointer move Δscreen → object move Δcanvas.
 */
export function screenDeltaToCanvas(delta: Point, camera: Camera): Point {
  return {
    x: delta.x / camera.zoom,
    y: delta.y / camera.zoom,
  };
}
