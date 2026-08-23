// ============================================================
// Canvas — CameraEngine (P6 Motion Overhaul + Milanote parity)
// ============================================================
//
// Kiến trúc:
//   - `targetRef` = camera user muốn (goal). Updated sync mỗi input event.
//   - `currentRef` = camera đang render trong DOM. Chased tới targetRef qua
//     rAF interp ramp.
//   - Pan không cần ramp (immediate 1:1 với hand movement) → cả 2 ref
//     update đồng thời.
//   - Zoom cần ramp mềm để nốt wheel to không "khựng" — targetRef update
//     sync, currentRef chase over ~5-6 frames (~80-100ms).
//   - Dynamic zoom min (content-aware) via `setDynamicZoomMin(min)`.
//     Clamp áp lúc write target, không phải lúc apply DOM.
//
// Persist:
//   - Persist targetRef (goal user cuối cùng chọn), không phải currentRef
//     (intermediate ramp value).
//   - Trailing debounce 500ms + gesture-end signal (từ CanvasSurface).
//   - Skip nếu target chưa đổi so với last persisted.
//
// Rule cứng:
//   - Interp ramp CHỈ áp cho zoom, KHÔNG cho pan.
//   - Ramp duration bounded ~5-6 frames (dưới ngưỡng perception ~100ms) →
//     feel IMMEDIATE + CONTINUOUS, không DELAYED.
//   - Convergence threshold snap để tránh floating-point ripple vô hạn.
//   - Pure math delegated cho `engine/camera.ts` (không duplicate).
// ============================================================

import type { Camera } from '../types';
import { ZOOM_MIN, ZOOM_MAX } from '../types';
import type { Point } from './coords';
import {
  clampZoom,
  panBy,
  resetCamera,
  zoomAroundPoint,
  zoomByFactor,
  fitBounds,
  type Bounds,
} from './camera';

/**
 * Clamp camera position sao cho viewport CENTER stays trong pan bounds
 * (world-space). Non-clamping nếu bounds/viewport chưa ready.
 *
 * Model: viewport center = ((viewport.w/2) - camera.x) / zoom (world coord).
 * Cần: bounds.x ≤ viewportCenterWorldX ≤ bounds.x + bounds.width.
 * Reverse cho camera.x:
 *   camMaxX = viewportW/2 - bounds.x * zoom
 *   camMinX = viewportW/2 - (bounds.x + bounds.width) * zoom
 * Nếu bounds width > 0 → range non-empty (kể cả narrow content, bounds đã
 * bao gồm margin).
 */
function clampCameraToBounds(
  camera: Camera,
  bounds: Bounds | null,
  viewport: { width: number; height: number },
): Camera {
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return camera;
  const { zoom } = camera;
  const camMaxX = viewport.width / 2 - bounds.x * zoom;
  const camMinX = viewport.width / 2 - (bounds.x + bounds.width) * zoom;
  const camMaxY = viewport.height / 2 - bounds.y * zoom;
  const camMinY = viewport.height / 2 - (bounds.y + bounds.height) * zoom;
  const clampedX = Math.max(camMinX, Math.min(camMaxX, camera.x));
  const clampedY = Math.max(camMinY, Math.min(camMaxY, camera.y));
  if (clampedX === camera.x && clampedY === camera.y) return camera;
  return { zoom, x: clampedX, y: clampedY };
}

const PERSIST_DEBOUNCE_MS = 500;
const GRID_SIZE = 40;

/**
 * Ramp rate per frame khi chase zoom target. 0.35 → convergence ~5 frames
 * (~83ms @ 60Hz). Đủ nhanh không cảm nhận delay, đủ chậm để "khựng" nốt
 * wheel biến thành sliding continuous.
 */
const ZOOM_RAMP_ALPHA = 0.35;

/** Snap threshold: |delta| < ngưỡng → snap current = target, kết thúc ramp. */
const ZOOM_SNAP_THRESHOLD = 0.0005;
const XY_SNAP_THRESHOLD = 0.1;

type CameraListener = (camera: Camera) => void;
type PersistCallback = (camera: Camera) => void;

interface EngineElements {
  wrapper: HTMLElement | null;
  grid: HTMLElement | null;
}

export class CameraEngine {
  /** Target = goal state after all queued input. Persist basis. */
  private targetRef: Camera;
  /** Current = actually rendered in DOM. Chases target via ramp. */
  private currentRef: Camera;

  private wrapperEl: HTMLElement | null = null;
  private gridEl: HTMLElement | null = null;

  /** Dynamic min zoom — content-aware (P6). Injected via `setDynamicZoomMin`. */
  private dynamicMin: number = ZOOM_MIN;
  /** Max zoom — constant Milanote-like 300%. */
  private readonly maxZoom: number = ZOOM_MAX;

  /** Pan bounds world-space (content + margin). Null = pan tự do (fallback). */
  private panBoundsRef: Bounds | null = null;
  /** Viewport size cho clamp math + shortcut zoom center. */
  private viewportRef: { width: number; height: number } = { width: 0, height: 0 };

  private rampRafId: number | null = null;
  private renderRafId: number | null = null;
  private renderDirty = false;

  private listeners = new Set<CameraListener>();
  private persistCb: PersistCallback | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedRef: Camera | null = null;

  constructor(initial: Camera) {
    // Clamp initial vào absolute range trước khi assign.
    const clampedInitial: Camera = {
      x: initial.x,
      y: initial.y,
      zoom: clampZoom(initial.zoom, ZOOM_MIN, this.maxZoom),
    };
    this.targetRef = clampedInitial;
    this.currentRef = clampedInitial;
  }

  // --- Read (sync) ---

  /** Read current rendered camera. Consumers React nên dùng snapshot qua listener. */
  getCamera(): Camera {
    return this.currentRef;
  }

  /** Read target camera (goal). Persist / debugging dùng. */
  getTargetCamera(): Camera {
    return this.targetRef;
  }

  getDynamicZoomMin(): number {
    return this.dynamicMin;
  }

  // --- Element registration ---

  setElements(el: EngineElements): void {
    this.wrapperEl = el.wrapper;
    this.gridEl = el.grid;
    if (this.wrapperEl || this.gridEl) {
      this.applyTransforms();
    }
  }

  setPersistCallback(cb: PersistCallback | null): void {
    this.persistCb = cb;
  }

  /**
   * Update dynamic zoom min. Callee từ CanvasSurface khi content bounds
   * thay đổi. Nếu target hiện tại < new min → clamp target lên, ramp
   * currentRef theo.
   */
  setDynamicZoomMin(min: number): void {
    const clamped = Math.max(ZOOM_MIN, Math.min(1, min));
    if (clamped === this.dynamicMin) return;
    this.dynamicMin = clamped;
    // Nếu target hiện tại dưới new min → clamp target lên. Camera x/y
    // re-clamp theo pan bounds vì zoom đổi.
    if (this.targetRef.zoom < clamped) {
      this.targetRef = clampCameraToBounds(
        { ...this.targetRef, zoom: clamped },
        this.panBoundsRef,
        this.viewportRef,
      );
      this.scheduleRamp();
      this.schedulePersist();
    }
  }

  /**
   * Set pan bounds (world-space, content + margin). Null → không clamp.
   * Auto re-clamp target camera nếu bounds đổi + target ngoài range.
   */
  setPanBounds(bounds: Bounds | null): void {
    this.panBoundsRef = bounds;
    const clamped = clampCameraToBounds(this.targetRef, bounds, this.viewportRef);
    if (clamped !== this.targetRef) {
      this.targetRef = clamped;
      this.scheduleRamp();
      this.schedulePersist();
    }
  }

  /**
   * Set viewport size. Callee khi ResizeObserver fire. Dùng cho pan bounds
   * clamp + shortcut zoom center anchor.
   */
  setViewport(width: number, height: number): void {
    if (this.viewportRef.width === width && this.viewportRef.height === height) return;
    this.viewportRef = { width, height };
    // Re-clamp target sau khi viewport đổi (pan range thay đổi).
    const clamped = clampCameraToBounds(this.targetRef, this.panBoundsRef, this.viewportRef);
    if (clamped !== this.targetRef) {
      this.targetRef = clamped;
      this.scheduleRamp();
    }
  }

  // --- Write actions ---

  /**
   * Rehydrate từ persisted camera. Clamp zoom vào current bounds + pan
   * bounds. Snap cả target + current, không ramp (avoid flash on board load).
   */
  hydrate(camera: Camera): void {
    const clampedZoom: Camera = {
      x: camera.x,
      y: camera.y,
      zoom: clampZoom(camera.zoom, this.dynamicMin, this.maxZoom),
    };
    const clamped = clampCameraToBounds(clampedZoom, this.panBoundsRef, this.viewportRef);
    this.targetRef = clamped;
    this.currentRef = clamped;
    this.lastPersistedRef = clamped;
    this.cancelRamp();
    this.scheduleRender();
  }

  /**
   * Pan immediate: apply cả target + current sync, không ramp. Dùng cho
   * pointer drag (space+drag, middle-drag, ctrl+drag) — cần 1:1 hand
   * movement, ramp sẽ feel như latency. Clamp cả 2 refs vào pan bounds.
   */
  pan(delta: Point): void {
    this.targetRef = clampCameraToBounds(
      panBy(this.targetRef, delta),
      this.panBoundsRef,
      this.viewportRef,
    );
    this.currentRef = clampCameraToBounds(
      panBy(this.currentRef, delta),
      this.panBoundsRef,
      this.viewportRef,
    );
    this.scheduleRender();
    this.schedulePersist();
  }

  /**
   * Pan smoothed: chỉ update target, currentRef ramp chase. Dùng cho
   * wheel/trackpad scroll — mỗi notch to (deltaY=100) sẽ được smooth qua
   * ~80ms, không cảm giác "khựng" per notch. Clamp target vào pan bounds.
   *
   * Pointer drag KHÔNG dùng cái này (ramp = latency perceptible).
   */
  panSmooth(delta: Point): void {
    this.targetRef = clampCameraToBounds(
      panBy(this.targetRef, delta),
      this.panBoundsRef,
      this.viewportRef,
    );
    this.scheduleRamp();
    this.schedulePersist();
  }

  /**
   * Zoom tới zoom cụ thể quanh 1 điểm screen. Target update sync + anchor
   * math áp cho target, currentRef ramp toward. Post-zoom clamp pan bounds
   * vì camera.x/y đổi theo zoom anchor.
   */
  zoomAt(pointer: Point, newZoom: number): void {
    this.targetRef = clampCameraToBounds(
      zoomAroundPoint(this.targetRef, pointer, newZoom, this.dynamicMin, this.maxZoom),
      this.panBoundsRef,
      this.viewportRef,
    );
    this.scheduleRamp();
    this.schedulePersist();
  }

  /**
   * Zoom theo factor (VD wheel notch). Compound theo target (KHÔNG current)
   * — user scroll nhanh nhiều notch, target compound đúng ý định, ramp
   * chase liên tục.
   */
  zoomByAt(pointer: Point, factor: number): void {
    this.targetRef = clampCameraToBounds(
      zoomByFactor(this.targetRef, pointer, factor, this.dynamicMin, this.maxZoom),
      this.panBoundsRef,
      this.viewportRef,
    );
    this.scheduleRamp();
    this.schedulePersist();
  }

  /**
   * Zoom theo factor quanh CENTER viewport. Dùng cho keyboard shortcut
   * (Ctrl+= / Ctrl+-) — không có cursor position, anchor giữa màn.
   */
  zoomAtCenter(factor: number): void {
    const cx = this.viewportRef.width / 2;
    const cy = this.viewportRef.height / 2;
    this.zoomByAt({ x: cx, y: cy }, factor);
  }

  setZoom(zoom: number, viewport?: { width: number; height: number }): void {
    const vp = viewport ?? this.viewportRef;
    const anchor = { x: vp.width / 2, y: vp.height / 2 };
    this.targetRef = clampCameraToBounds(
      zoomAroundPoint(this.targetRef, anchor, zoom, this.dynamicMin, this.maxZoom),
      this.panBoundsRef,
      this.viewportRef,
    );
    this.scheduleRamp();
    this.schedulePersist();
  }

  fit(bounds: Bounds, viewport: { width: number; height: number }): void {
    const target = fitBounds(bounds, viewport);
    this.targetRef = clampCameraToBounds(
      {
        x: target.x,
        y: target.y,
        zoom: clampZoom(target.zoom, this.dynamicMin, this.maxZoom),
      },
      this.panBoundsRef,
      this.viewportRef,
    );
    this.scheduleRamp();
    this.schedulePersist();
  }

  reset(): void {
    const initial = resetCamera();
    initial.zoom = clampZoom(1, this.dynamicMin, this.maxZoom);
    this.targetRef = clampCameraToBounds(initial, this.panBoundsRef, this.viewportRef);
    this.scheduleRamp();
    this.schedulePersist();
  }

  // --- Subscription ---
  subscribe(fn: CameraListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // --- Persist ---
  flushPersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.persistCb) return;
    if (this.targetRef === this.lastPersistedRef) return;
    const snapshot: Camera = { ...this.targetRef };
    this.lastPersistedRef = this.targetRef;
    try {
      this.persistCb(snapshot);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cameraEngine] persist callback error', err);
    }
  }

  // --- Lifecycle ---
  destroy(): void {
    this.cancelRamp();
    if (this.renderRafId !== null) {
      cancelAnimationFrame(this.renderRafId);
      this.renderRafId = null;
    }
    this.flushPersist();
    this.listeners.clear();
    this.wrapperEl = null;
    this.gridEl = null;
  }

  // --- Internal: render scheduling (rAF DOM write throttle) ---

  private scheduleRender(): void {
    this.renderDirty = true;
    if (this.renderRafId !== null) return;
    this.renderRafId = requestAnimationFrame(() => {
      this.renderRafId = null;
      this.flushRender();
    });
  }

  private flushRender(): void {
    if (!this.renderDirty) return;
    this.renderDirty = false;
    this.applyTransforms();
    this.notifyListeners();
  }

  // --- Internal: interp ramp (zoom smoothing) ---

  private scheduleRamp(): void {
    if (this.rampRafId !== null) return; // already ramping
    this.rampRafId = requestAnimationFrame(() => this.rampStep());
  }

  private cancelRamp(): void {
    if (this.rampRafId !== null) {
      cancelAnimationFrame(this.rampRafId);
      this.rampRafId = null;
    }
  }

  private rampStep(): void {
    this.rampRafId = null;

    const dx = this.targetRef.x - this.currentRef.x;
    const dy = this.targetRef.y - this.currentRef.y;
    const dz = this.targetRef.zoom - this.currentRef.zoom;

    const done =
      Math.abs(dz) < ZOOM_SNAP_THRESHOLD &&
      Math.abs(dx) < XY_SNAP_THRESHOLD &&
      Math.abs(dy) < XY_SNAP_THRESHOLD;

    if (done) {
      this.currentRef = { ...this.targetRef };
      this.applyTransforms();
      this.notifyListeners();
      return;
    }

    this.currentRef = {
      x: this.currentRef.x + dx * ZOOM_RAMP_ALPHA,
      y: this.currentRef.y + dy * ZOOM_RAMP_ALPHA,
      zoom: this.currentRef.zoom + dz * ZOOM_RAMP_ALPHA,
    };
    this.applyTransforms();
    this.notifyListeners();

    // Schedule next frame
    this.rampRafId = requestAnimationFrame(() => this.rampStep());
  }

  // --- Internal: DOM write + listener notify ---

  private applyTransforms(): void {
    const { x, y, zoom } = this.currentRef;

    if (this.wrapperEl) {
      this.wrapperEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
      this.wrapperEl.style.transformOrigin = '0 0';
    }

    if (this.gridEl) {
      const gridSize = GRID_SIZE * zoom;
      this.gridEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      const posX = ((x % gridSize) + gridSize) % gridSize;
      const posY = ((y % gridSize) + gridSize) % gridSize;
      this.gridEl.style.backgroundPosition = `${posX}px ${posY}px`;
    }
  }

  private notifyListeners(): void {
    // Notify với CURRENT (rendered) state, không target — consumers cần
    // reactive value đang thấy trên màn.
    const snapshot: Camera = { ...this.currentRef };
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[cameraEngine] listener error', err);
      }
    });
  }

  private schedulePersist(): void {
    if (!this.persistCb) return;
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }
}
