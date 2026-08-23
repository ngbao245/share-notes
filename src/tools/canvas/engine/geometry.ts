// ============================================================
// Canvas — Geometry helpers (pure)
// ============================================================
//
// AABB (Axis-Aligned Bounding Box) intersect, point-in-rect, union.
// Dùng cho marquee selection, hit-test object, fit-to-content bounds.
// ============================================================

import type { Point } from './coords';
import type { Geometry } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Point (x,y) có nằm trong rect không (inclusive edges). */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** 2 rect có overlap không (AABB intersect test). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** `outer` có chứa hoàn toàn `inner` không (inclusive edges). */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Chuyển 2 point (start/end) thành rect bình thường hoá (width/height > 0). */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Union nhiều rect. Return null nếu list rỗng. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Extract AABB rect từ Geometry (bỏ qua rotation Phase 1). */
export function geometryToRect(geo: Geometry): Rect {
  return {
    x: geo.x,
    y: geo.y,
    width: geo.width,
    height: geo.height,
  };
}
