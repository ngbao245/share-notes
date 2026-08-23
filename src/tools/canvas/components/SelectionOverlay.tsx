import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { Geometry } from '../types';
import { MIN_OBJECT_SIZE } from '../types';
import { useSelectionStore } from '../store/selection-store';
import { useObjectsStore } from '../store/objects-store';
import { useCameraStore } from '../store/camera-store';
import { useInteractionStore } from '../store/interaction-store';
import { canvasToScreen } from '../engine/coords';
import type { ResizeHandle } from '../engine/fsm';
import { getObjectElement } from './ObjectLayer';
import { useHistoryStore } from '../engine/commands/history';
import { resizeCommand } from '../engine/commands/resize';
import { updateCommand } from '../engine/commands/update';

// ============================================================
// SelectionOverlay — Outline + 8 resize handles cho single selection
// ============================================================
//
// Chỉ hiện khi selection.size === 1 (multi-select không có handle Phase 1).
// Mount ngoài camera transform wrapper (portal-style trong route), position
// screen-space tính từ object geometry + camera.
//
// Resize:
//   - pointerdown trên handle → FSM = resizing, capture initial geometry
//   - pointermove → tính geometry mới theo handle direction, apply
//     imperative qua ref map + update overlay position
//   - pointerup → commit ResizeCommand
// ============================================================

const HANDLE_SIZE = 10;

const HANDLES: readonly ResizeHandle[] = [
  'nw', 'n', 'ne',
  'w',       'e',
  'sw', 's', 'se',
] as const;

// Cursor + relative position cho 8 handle.
const HANDLE_CONFIG: Record<
  ResizeHandle,
  { cursor: string; left: string; top: string; translateX: string; translateY: string }
> = {
  nw: { cursor: 'nwse-resize', left: '0%',   top: '0%',   translateX: '-50%', translateY: '-50%' },
  n:  { cursor: 'ns-resize',   left: '50%',  top: '0%',   translateX: '-50%', translateY: '-50%' },
  ne: { cursor: 'nesw-resize', left: '100%', top: '0%',   translateX: '-50%', translateY: '-50%' },
  w:  { cursor: 'ew-resize',   left: '0%',   top: '50%',  translateX: '-50%', translateY: '-50%' },
  e:  { cursor: 'ew-resize',   left: '100%', top: '50%',  translateX: '-50%', translateY: '-50%' },
  sw: { cursor: 'nesw-resize', left: '0%',   top: '100%', translateX: '-50%', translateY: '-50%' },
  s:  { cursor: 'ns-resize',   left: '50%',  top: '100%', translateX: '-50%', translateY: '-50%' },
  se: { cursor: 'nwse-resize', left: '100%', top: '100%', translateX: '-50%', translateY: '-50%' },
};

interface ResizeSession {
  id: string;
  objectType: string;
  handle: ResizeHandle;
  startClientX: number;
  startClientY: number;
  initial: Geometry;
}

function computeNewGeometry(
  handle: ResizeHandle,
  initial: Geometry,
  canvasDx: number,
  canvasDy: number,
  lockAspect: boolean
): Geometry {
  let { x, y, width, height } = initial;

  if (lockAspect) {
    // Aspect-locked resize: chọn axis dominant, tính cạnh còn lại theo
    // initial ratio. Reference: Figma/Milanote image resize.
    const aspect = initial.width / initial.height;
    const isCorner = handle.length === 2;
    const isEdgeH = handle === 'e' || handle === 'w';
    const isEdgeV = handle === 'n' || handle === 's';

    let widthDelta = 0;
    if (handle.includes('e')) widthDelta = canvasDx;
    else if (handle.includes('w')) widthDelta = -canvasDx;

    let heightDelta = 0;
    if (handle.includes('s')) heightDelta = canvasDy;
    else if (handle.includes('n')) heightDelta = -canvasDy;

    let newWidth: number;
    let newHeight: number;

    if (isEdgeH) {
      newWidth = Math.max(MIN_OBJECT_SIZE, initial.width + widthDelta);
      newHeight = newWidth / aspect;
    } else if (isEdgeV) {
      newHeight = Math.max(MIN_OBJECT_SIZE, initial.height + heightDelta);
      newWidth = newHeight * aspect;
    } else if (isCorner) {
      // Corner: pick axis dominant theo abs delta.
      if (Math.abs(widthDelta) * initial.height >= Math.abs(heightDelta) * initial.width) {
        newWidth = Math.max(MIN_OBJECT_SIZE, initial.width + widthDelta);
        newHeight = newWidth / aspect;
      } else {
        newHeight = Math.max(MIN_OBJECT_SIZE, initial.height + heightDelta);
        newWidth = newHeight * aspect;
      }
    } else {
      newWidth = initial.width;
      newHeight = initial.height;
    }

    // Enforce min
    if (newWidth < MIN_OBJECT_SIZE) {
      newWidth = MIN_OBJECT_SIZE;
      newHeight = newWidth / aspect;
    }
    if (newHeight < MIN_OBJECT_SIZE) {
      newHeight = MIN_OBJECT_SIZE;
      newWidth = newHeight * aspect;
    }

    // Update x/y for anchor stay put on opposite corner/edge.
    if (handle.includes('w')) x = initial.x + (initial.width - newWidth);
    if (handle.includes('n')) y = initial.y + (initial.height - newHeight);

    return { ...initial, x, y, width: newWidth, height: newHeight };
  }

  // Free resize (Phase 1 behavior).
  if (handle.includes('e')) {
    width = Math.max(MIN_OBJECT_SIZE, initial.width + canvasDx);
  } else if (handle.includes('w')) {
    const newWidth = Math.max(MIN_OBJECT_SIZE, initial.width - canvasDx);
    x = initial.x + (initial.width - newWidth);
    width = newWidth;
  }
  if (handle.includes('s')) {
    height = Math.max(MIN_OBJECT_SIZE, initial.height + canvasDy);
  } else if (handle.includes('n')) {
    const newHeight = Math.max(MIN_OBJECT_SIZE, initial.height - canvasDy);
    y = initial.y + (initial.height - newHeight);
    height = newHeight;
  }

  return { ...initial, x, y, width, height };
}

export function SelectionOverlay() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const objects = useObjectsStore((s) => s.objects);
  const camera = useCameraStore((s) => s.camera);
  const isBusy = useInteractionStore(
    (s) => s.state.mode === 'dragging' || s.state.mode === 'resizing' || s.state.mode === 'marquee'
  );

  const resizeSessionRef = useRef<ResizeSession | null>(null);

  // Fix: hide overlay khi Radix Dialog đang mở. Overlay z-55 đè lên Dialog
  // z-50 → resize handles + outline nổi lên trên modal. Detect qua
  // MutationObserver watching document.body cho `[role="dialog"][data-state="open"]`.
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = document.body.querySelector('[role="dialog"][data-state="open"]');
      setDialogOpen(!!el);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    return () => observer.disconnect();
  }, []);

  if (dialogOpen) return null;
  // Hide overlay khi đang drag (visual noise).
  if (isBusy && useInteractionStore.getState().state.mode !== 'resizing') return null;
  if (selectedIds.size !== 1) return null;

  const id = Array.from(selectedIds)[0];
  const obj = objects.get(id);
  if (!obj) return null;

  const { geometry } = obj;
  // canvasToScreen return coord relative đến surface. Overlay dùng position:fixed
  // (viewport-relative) → phải cộng surface offset trong viewport.
  const surfaceEl = document.querySelector<HTMLElement>('[data-canvas-surface="true"]');
  const surfaceRect = surfaceEl?.getBoundingClientRect();
  const surfaceLeft = surfaceRect?.left ?? 0;
  const surfaceTop = surfaceRect?.top ?? 0;
  const topLeftSurface = canvasToScreen({ x: geometry.x, y: geometry.y }, camera);
  const topLeftViewport = {
    x: topLeftSurface.x + surfaceLeft,
    y: topLeftSurface.y + surfaceTop,
  };
  const screenWidth = geometry.width * camera.zoom;
  const screenHeight = geometry.height * camera.zoom;

  const handleResizeDown = (
    e: React.PointerEvent<HTMLDivElement>,
    handle: ResizeHandle
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    resizeSessionRef.current = {
      id: obj.id,
      objectType: obj.type,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initial: { ...geometry },
    };

    useInteractionStore.getState().transitionTo({
      mode: 'resizing',
      objectId: obj.id,
      handle,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      initialGeometry: { ...geometry },
    });
  };

  const computeLockAspect = (
    session: ResizeSession,
    shiftKey: boolean
  ): boolean => {
    if (session.objectType !== 'image') return false;
    // Image default lock; Shift invert (Milanote/Figma convention).
    return !shiftKey;
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session) return;
    const cam = useCameraStore.getState().camera;
    const canvasDx = (e.clientX - session.startClientX) / cam.zoom;
    const canvasDy = (e.clientY - session.startClientY) / cam.zoom;
    const lockAspect = computeLockAspect(session, e.shiftKey);
    const newGeo = computeNewGeometry(
      session.handle,
      session.initial,
      canvasDx,
      canvasDy,
      lockAspect
    );

    const el = getObjectElement(session.id);
    if (el) {
      el.style.left = `${newGeo.x}px`;
      el.style.top = `${newGeo.y}px`;
      el.style.width = `${newGeo.width}px`;
      el.style.height = `${newGeo.height}px`;
    }
  };

  const handleResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }

    const cam = useCameraStore.getState().camera;
    const canvasDx = (e.clientX - session.startClientX) / cam.zoom;
    const canvasDy = (e.clientY - session.startClientY) / cam.zoom;
    const lockAspect = computeLockAspect(session, e.shiftKey);
    const newGeo = computeNewGeometry(
      session.handle,
      session.initial,
      canvasDx,
      canvasDy,
      lockAspect
    );

    // Reset imperative style trước, sau đó push command (React re-render sẽ apply đúng).
    const el = getObjectElement(session.id);
    if (el) {
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
    }

    flushSync(() => {
      useHistoryStore.getState().push(resizeCommand(session.id, session.initial, newGeo));
    });

    resizeSessionRef.current = null;
    useInteractionStore.getState().reset();
  };

  return (
    <div
      className="pointer-events-none fixed z-[55]"
      style={{
        left: topLeftViewport.x,
        top: topLeftViewport.y,
        width: screenWidth,
        height: screenHeight,
      }}
      aria-hidden
    >
      {/* Outline */}
      <div className="absolute inset-0 rounded-md ring-2 ring-primary" />

      {/* Text font-size dropdown (chỉ Text object) */}
      {obj.type === 'text' && (
        <TextFontSizeControl
          object={obj as unknown as TextObjectShape}
        />
      )}

      {/* 8 handles */}
      {/* eslint-disable-next-line @typescript-eslint/no-shadow */}
      {HANDLES.map((h) => {
        const cfg = HANDLE_CONFIG[h];
        return (
          <div
            key={h}
            className="pointer-events-auto absolute rounded-sm border border-primary bg-background shadow-sm"
            style={{
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              left: cfg.left,
              top: cfg.top,
              transform: `translate(${cfg.translateX}, ${cfg.translateY})`,
              cursor: cfg.cursor,
            }}
            onPointerDown={(e) => handleResizeDown(e, h)}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            onPointerCancel={handleResizeUp}
          />
        );
      })}
    </div>
  );
}



// ============================================================
// TextFontSizeControl — Small dropdown attach top-right của Text object
// selection outline. Thay fontSize + push UpdateCommand.
// ============================================================

const FONT_SIZES = [12, 14, 18, 24, 32] as const;

interface TextObjectShape {
  id: string;
  data: { content: string; fontSize?: number };
}

function TextFontSizeControl({ object }: { object: TextObjectShape }) {
  const current = object.data.fontSize ?? 16;

  const setSize = (size: number) => {
    if (size === current) return;
    useHistoryStore.getState().push(
      updateCommand(
        object.id,
        { data: { ...object.data } as unknown as Record<string, unknown> },
        {
          data: {
            ...object.data,
            fontSize: size,
          } as unknown as Record<string, unknown>,
        }
      )
    );
  };

  return (
    <div
      className="pointer-events-auto absolute -top-9 right-0 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-1 text-xs shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {FONT_SIZES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSize(s)}
          className={`rounded px-1.5 py-0.5 transition-colors ${
            s === current
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
