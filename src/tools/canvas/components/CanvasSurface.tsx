import { useEffect, useRef, type ReactNode } from 'react';

import { useCameraStore, getCameraEngine } from '../store/camera-store';
import { useInteractionStore } from '../store/interaction-store';
import { useBoardStackStore } from '../store/board-stack-store';
import { useObjectsStore } from '../store/objects-store';
import { getCanvasRepository } from '../repository';
import { usePointerFSM } from '../hooks/usePointerFSM';
import {
  computeContentBounds,
  computeDynamicZoomMin,
  computePanBounds,
} from '../lib/content-bounds';

// ============================================================
// CanvasSurface — Root surface (P6 Motion Overhaul + Milanote parity)
// ============================================================
//
// Trách nhiệm:
//   - Render grid overlay + camera transform wrapper cho children
//   - Wheel: pan / Shift+wheel: pan ngang / Ctrl+wheel: zoom around cursor
//     (K constant = 600 → step per notch ~15%, kết hợp interp ramp 80ms
//     trong engine → continuous feel, không "khựng")
//   - Register wrapper + grid DOM refs với CameraEngine (imperative
//     transform ownership) — không inline transform trong React
//   - Compute content-aware dynamic zoom min từ objects store + viewport
//     size → push vào engine → engine clamp zoom out tại đúng ngưỡng thấy
//     hết content (không cho zoom out vô empty space vô nghĩa — Milanote UX)
//   - Wire engine persist callback → `repository.saveCamera` (trailing
//     debounce 500ms trong engine)
//   - Spread pointer handlers từ usePointerFSM
// ============================================================

const GRID_SIZE = 40;
const GRID_DOT_RADIUS = 1;
/** Zoom curve constant K. Higher K = smaller step per notch. Với K=600 và
 *  deltaY=100 (notch chuẩn), factor = exp(-100/600) ≈ 0.847 → -15% per notch.
 *  Kết hợp interp ramp 80ms trong engine → continuous. */
const WHEEL_ZOOM_K = 600;
/** Cap max deltaY per event để tránh trackpad flick jump zoom nhiều bậc. */
const WHEEL_ZOOM_CLAMP = 50;
/**
 * Pan speed multiplier per wheel event. Browser default = 1.0 (deltaY 100 →
 * 100px pan). Với notched mouse cảm giác quá xa mỗi notch → giảm xuống 0.5.
 *
 * Trackpad delta nhỏ (5-15) cũng bị nhân — chấp nhận vì user scroll continuous.
 * Nếu trackpad feel quá chậm sau này → tách constant riêng dựa trên heuristic
 * `Math.abs(deltaY) >= 40` (wheel notch) vs < 40 (trackpad).
 */
const WHEEL_PAN_SPEED = 0.5;

interface CanvasSurfaceProps {
  children?: ReactNode;
}

function normalizeWheelDelta(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } else if (e.deltaMode === 2) {
    dx *= window.innerHeight;
    dy *= window.innerHeight;
  }
  return { dx, dy };
}

export function CanvasSurface({ children }: CanvasSurfaceProps) {
  const zoomByAt = useCameraStore((s) => s.zoomByAt);
  const panSmooth = useCameraStore((s) => s.panSmooth);
  const interactionState = useInteractionStore((s) => s.state);
  // Subscribe objects Map identity để re-compute content bounds khi
  // add/remove/patch. Store update Map instance mới sau mỗi mutation.
  const objectsMap = useObjectsStore((s) => s.objects);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Track viewport size cho FitZoom compute. */
  const viewportRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, spaceHeld } =
    usePointerFSM();

  // --- CameraEngine element registration ---
  useEffect(() => {
    const engine = getCameraEngine();
    engine.setElements({
      wrapper: wrapperRef.current,
      grid: gridRef.current,
    });
    return () => {
      engine.setElements({ wrapper: null, grid: null });
    };
  }, []);

  // --- Engine persist callback (debounced 500ms trong engine) ---
  useEffect(() => {
    const engine = getCameraEngine();
    engine.setPersistCallback((camera) => {
      const current = useBoardStackStore.getState().current();
      if (!current) return;
      void getCanvasRepository().saveCamera(current.id, camera);
    });
    return () => {
      engine.flushPersist();
      engine.setPersistCallback(null);
    };
  }, []);

  // --- Viewport size tracking (ResizeObserver) ---
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const updateViewport = () => {
      const rect = el.getBoundingClientRect();
      viewportRef.current = { width: rect.width, height: rect.height };
      // Push viewport tới engine (dùng cho pan bounds clamp + shortcut zoom center).
      getCameraEngine().setViewport(rect.width, rect.height);
      // Trigger dynamic zoom min recompute vì viewport thay đổi.
      recomputeDynamicZoomMin();
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Recompute dynamic zoom min + pan bounds ---
  // Chạy khi:
  //   - Objects thay đổi (add/remove/move/resize) — subscribe objectsMap
  //     effect fire re-render
  //   - Board switch — boardStackStore subscribe fire
  //   - Viewport resize (kể cả browser zoom) — ResizeObserver fire
  //
  // ĐỌC FRESH state qua `useObjectsStore.getState()` thay vì closure
  // objectsMap. ResizeObserver effect mount 1 lần → nếu closure objects,
  // captured render đầu (empty Map) → khi browser zoom trigger ResizeObserver
  // sẽ dùng bounds stale/null → engine.setDynamicZoomMin(1) → camera clamp
  // cứng ở zoom 1 kể cả khi browser về 100% (BUG đã hit).
  const recomputeDynamicZoomMin = () => {
    const viewport = viewportRef.current;
    if (viewport.width === 0 || viewport.height === 0) return;
    const boardId = useBoardStackStore.getState().currentBoardId();
    const objects = useObjectsStore.getState().objects;
    const bounds = computeContentBounds(objects.values(), boardId);
    const engine = getCameraEngine();
    engine.setDynamicZoomMin(computeDynamicZoomMin(bounds, viewport));
    // Pan bounds = content + margin. Null nếu empty → engine không clamp
    // (user pan tự do trên empty board, fallback thân thiện).
    engine.setPanBounds(computePanBounds(bounds));
  };

  useEffect(() => {
    recomputeDynamicZoomMin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectsMap]);

  // Subscribe board switch qua boardStack — dùng zustand subscribe pattern
  // vì boardStackStore không expose selector hook riêng cho currentBoardId.
  useEffect(() => {
    const unsub = useBoardStackStore.subscribe(() => {
      recomputeDynamicZoomMin();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Wheel: pan (default) / Shift+wheel: horizontal / Ctrl+wheel: zoom ---
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const { dx: rawDx, dy: rawDy } = normalizeWheelDelta(e);

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const clampedDy = Math.max(
          -WHEEL_ZOOM_CLAMP,
          Math.min(WHEEL_ZOOM_CLAMP, rawDy),
        );
        const factor = Math.exp(-clampedDy / WHEEL_ZOOM_K);
        zoomByAt(pointer, factor);
        return;
      }

      e.preventDefault();
      let dx = rawDx;
      let dy = rawDy;
      if (e.shiftKey && Math.abs(dx) < Math.abs(dy)) {
        dx = dy;
        dy = 0;
      }
      // panSmooth: engine ramp target → current qua ~80ms → mỗi notch
      // wheel (deltaY=100) glide smooth thay vì jump discrete 100px.
      // WHEEL_PAN_SPEED reduce khoảng cách per notch để không cảm giác "xa".
      panSmooth({
        x: -dx * WHEEL_PAN_SPEED,
        y: -dy * WHEEL_PAN_SPEED,
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomByAt, panSmooth]);

  // --- Wheel-end flush persist (200ms trailing) ---
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = () => {
      if (wheelEndTimer !== null) clearTimeout(wheelEndTimer);
      wheelEndTimer = setTimeout(() => {
        wheelEndTimer = null;
        getCameraEngine().flushPersist();
      }, 200);
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      if (wheelEndTimer !== null) clearTimeout(wheelEndTimer);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  void interactionState;
  void spaceHeld;
  const cursor = 'default';

  return (
    <div
      ref={surfaceRef}
      data-canvas-surface="true"
      className="relative flex-1 overflow-hidden bg-background select-none touch-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <div
        ref={gridRef}
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, hsl(var(--muted-foreground) / 0.25) ${GRID_DOT_RADIUS}px, transparent ${GRID_DOT_RADIUS + 0.5}px)`,
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
        }}
        aria-hidden
      />
      <div
        ref={wrapperRef}
        className="absolute left-0 top-0"
        style={{ transformOrigin: '0 0' }}
      >
        {children}
      </div>

      {!children && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-muted-foreground/50">
            Wheel to pan · Ctrl+wheel to zoom · Middle-drag to pan
          </p>
        </div>
      )}
    </div>
  );
}
