// ============================================================
// Canvas — Camera math (pure)
// ============================================================
//
// Camera state = { x, y, zoom }. Không giữ state ở đây (đó là store).
// File này chỉ pure math: zoom around point, clamp, fit-to-bounds, reset.
//
// Zoom around point:
//   Sau khi zoom, điểm dưới cursor phải giữ nguyên vị trí world → tính
//   lại camera translate. Công thức chuẩn Milanote/Figma:
//     before = screenToCanvas(pointer, oldCamera)
//     newCamera = { zoom: newZoom, x: pointer.x - before.x * newZoom, y: ... }
// ============================================================

import type { Camera } from '../types';
import { ZOOM_MIN, ZOOM_MAX } from '../types';
import type { Point } from './coords';
import { screenToCanvas } from './coords';

/**
 * Clamp zoom vào range hợp lệ. `min`/`max` optional để override khi có
 * content-aware dynamic min (P6 Motion Overhaul). Default = static
 * ZOOM_MIN/ZOOM_MAX từ types.
 */
export function clampZoom(
  zoom: number,
  min: number = ZOOM_MIN,
  max: number = ZOOM_MAX,
): number {
  return Math.max(min, Math.min(max, zoom));
}

/**
 * Zoom quanh 1 điểm screen. Điểm đó ở canvas-space giữ nguyên sau zoom.
 * @param camera state hiện tại
 * @param pointer điểm screen (viewport-relative) làm anchor
 * @param newZoom zoom target (sẽ được clamp bởi `[min, max]`)
 * @param min optional lower bound override (dynamic content-aware min)
 * @param max optional upper bound override
 */
export function zoomAroundPoint(
  camera: Camera,
  pointer: Point,
  newZoom: number,
  min: number = ZOOM_MIN,
  max: number = ZOOM_MAX,
): Camera {
  const clamped = clampZoom(newZoom, min, max);
  if (clamped === camera.zoom) return camera;

  const before = screenToCanvas(pointer, camera);
  return {
    zoom: clamped,
    x: pointer.x - before.x * clamped,
    y: pointer.y - before.y * clamped,
  };
}

/**
 * Zoom bằng factor (VD 1.1 để zoom in 10%, 1/1.1 để zoom out) quanh 1 điểm.
 * Wheel handler thường dùng cái này. `min`/`max` optional cho dynamic bounds.
 */
export function zoomByFactor(
  camera: Camera,
  pointer: Point,
  factor: number,
  min: number = ZOOM_MIN,
  max: number = ZOOM_MAX,
): Camera {
  return zoomAroundPoint(camera, pointer, camera.zoom * factor, min, max);
}

/** Pan camera bằng delta screen. */
export function panBy(camera: Camera, delta: Point): Camera {
  return {
    ...camera,
    x: camera.x + delta.x,
    y: camera.y + delta.y,
  };
}

/** Reset về origin, zoom 1x. */
export function resetCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Content-space margin ratio khi tính FitZoom. VD content 800x600, ratio 0.15
 * → effective 920x690 (thêm 15% mỗi phía) → zoom out cho phép hơi rộng hơn.
 */
const FIT_MARGIN_RATIO = 0.15;
/** Pixel margin floor — dùng khi content quá nhỏ (ratio × small = tiny). */
const FIT_MIN_MARGIN_PX = 80;

/**
 * Compute FitZoom — zoom lớn nhất mà bounds fit toàn bộ vào viewport,
 * có margin (15% content-space + 80px floor). Clamp vào [ZOOM_MIN, ZOOM_MAX].
 *
 * Đây là SSOT cho fit-zoom math. Dùng bởi cả:
 *   - `fitBounds()` khi user click Fit / press F
 *   - Dynamic zoom min (content-bounds.ts) — clamp zoom out khi wheel scroll
 * → 2 flow này luôn consistent.
 */
export function computeFitZoom(
  bounds: Bounds,
  viewport: { width: number; height: number },
): number {
  if (bounds.width <= 0 || bounds.height <= 0) return 1;
  if (viewport.width <= 0 || viewport.height <= 0) return 1;

  const marginX = Math.max(bounds.width * FIT_MARGIN_RATIO, FIT_MIN_MARGIN_PX);
  const marginY = Math.max(bounds.height * FIT_MARGIN_RATIO, FIT_MIN_MARGIN_PX);
  const effectiveW = bounds.width + marginX * 2;
  const effectiveH = bounds.height + marginY * 2;

  const zoomX = viewport.width / effectiveW;
  const zoomY = viewport.height / effectiveH;
  return clampZoom(Math.min(zoomX, zoomY));
}

/**
 * Tính camera fit `bounds` (canvas-space) vào viewport. Dùng `computeFitZoom`
 * cho zoom (same margin model như dynamic zoom min → consistent với wheel
 * clamp). Center bounds trong viewport.
 */
export function fitBounds(
  bounds: Bounds,
  viewport: { width: number; height: number },
): Camera {
  if (bounds.width <= 0 || bounds.height <= 0) return resetCamera();

  const zoom = computeFitZoom(bounds, viewport);

  const centerCanvas = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const centerScreen = { x: viewport.width / 2, y: viewport.height / 2 };

  return {
    zoom,
    x: centerScreen.x - centerCanvas.x * zoom,
    y: centerScreen.y - centerCanvas.y * zoom,
  };
}
