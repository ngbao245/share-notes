// ============================================================
// Canvas — Camera store (Zustand snapshot layer, P6 Motion Overhaul)
// ============================================================
//
// Trước P6: store là source of truth camera state, mỗi action `set()`
// trigger React re-render per event.
//
// Sau P6: `CameraEngine` là source of truth (refs + rAF). Store chỉ giữ
// SNAPSHOT reactive cho React consumers cần đọc reactive (VD Breadcrumb
// hiện zoom%). Actions forward xuống engine, engine tự flush snapshot
// vào store qua listener trên rAF frame → React commit throttle 60Hz.
//
// Migration path: consumers giữ nguyên `useCameraStore((s) => s.camera)`
// pattern. Không đụng consumer code.
//
// Persist: KHÔNG chạm store. `CanvasSurface` inject `setPersistCallback`
// vào engine → engine trailing-debounced 500ms save.
// ============================================================

import { create } from 'zustand';

import type { Camera } from '../types';
import type { Point } from '../engine/coords';
import type { Bounds } from '../engine/camera';
import { CameraEngine } from '../engine/camera-engine';

interface CameraState {
  camera: Camera;

  hydrate: (camera: Camera) => void;

  setZoom: (
    zoom: number,
    viewport?: { width: number; height: number },
  ) => void;

  zoomAt: (pointer: Point, newZoom: number) => void;
  zoomByAt: (pointer: Point, factor: number) => void;

  /** Pan immediate 1:1 — dùng cho pointer drag. */
  pan: (delta: Point) => void;
  /** Pan smoothed qua ramp — dùng cho wheel/trackpad scroll. */
  panSmooth: (delta: Point) => void;
  /** Zoom by factor quanh CENTER viewport — dùng cho keyboard shortcut. */
  zoomAtCenter: (factor: number) => void;
  reset: () => void;

  fit: (bounds: Bounds, viewport: { width: number; height: number }) => void;
}

// --- Module singleton engine ---
// Instantiated once ở module load. Persist callback + element refs được
// inject sau từ CanvasSurface. Consumer đọc engine qua `getCameraEngine`.
const engine = new CameraEngine({ x: 0, y: 0, zoom: 1 });

/** Get shared CameraEngine singleton. */
export function getCameraEngine(): CameraEngine {
  return engine;
}

export const useCameraStore = create<CameraState>(() => ({
  camera: engine.getCamera(),

  hydrate: (camera) => {
    engine.hydrate(camera);
  },
  setZoom: (zoom, viewport) => {
    engine.setZoom(zoom, viewport);
  },
  zoomAt: (pointer, newZoom) => {
    engine.zoomAt(pointer, newZoom);
  },
  zoomByAt: (pointer, factor) => {
    engine.zoomByAt(pointer, factor);
  },
  pan: (delta) => {
    engine.pan(delta);
  },
  panSmooth: (delta) => {
    engine.panSmooth(delta);
  },
  zoomAtCenter: (factor) => {
    engine.zoomAtCenter(factor);
  },
  reset: () => {
    engine.reset();
  },
  fit: (bounds, viewport) => {
    engine.fit(bounds, viewport);
  },
}));

// --- Wire engine → store snapshot ---
// Engine flush rAF → notifyListeners → `setState({ camera })`. Zustand
// subscribers fire, React consumer re-render 60Hz throttled.
engine.subscribe((camera) => {
  useCameraStore.setState({ camera });
});
