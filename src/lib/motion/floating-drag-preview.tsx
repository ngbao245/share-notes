import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';

// ============================================================
// useFloatingDragPreview — custom overlay drag preview.
//
// Thay cho pdnd `setCustomNativeDragPreview` (native HTML5 bitmap).
// Ly do: HTML5 native drag image bi browser tu fade ~60% + blur high-DPI,
// khong kiem soat duoc opacity/rotate/shadow chinh xac.
//
// Approach:
//   1. Disable native drag preview (browser khong ve gi)
//   2. Render 1 React portal `position: fixed` follow cursor real-time
//   3. Update position via DOM style direct (khong React rerender per frame)
//   4. Ket thuc drag → unmount portal
//
// Usage:
//   const preview = useFloatingDragPreview({
//     render: () => <MyCardReplica data={item} />,
//   });
//   ...
//   draggable({
//     element: ref.current,
//     onGenerateDragPreview: preview.onGenerateDragPreview,
//     onDragStart: (args) => {
//       preview.onDragStart(args);
//       // ... other stuff
//     },
//     onDrag: preview.onDrag,
//     onDrop: (args) => {
//       preview.onDrop();
//       // ... other stuff
//     },
//   });
//   ...
//   return <>{preview.previewNode}<li>...</li></>;
//
// Perf: 1 requestAnimationFrame + 1 style.transform per pointermove.
// GPU compositor xu ly translate3d hieu qua, ~0.1ms/frame overhead.
// ============================================================

interface DragArgs {
  location: {
    current: {
      input: {
        clientX: number;
        clientY: number;
      };
    };
  };
}

interface GeneratePreviewArgs {
  nativeSetDragImage: DataTransfer['setDragImage'] | null;
}

interface UseFloatingDragPreviewOptions {
  /** Render preview content — thuong la replica cua item duoc keo. */
  render: () => ReactNode;
  /**
   * Ref den source element (item bi keo). Neu cung cap, hook se capture
   * "grab offset" — vi tri tuong doi cua cursor trong source luc pointer down —
   * va giu offset do khi drag → cursor cam DUNG cho da click, khong lech.
   *
   * Neu KHONG cung cap, fallback default offset 8px goc phai duoi.
   */
  sourceRef?: { current: HTMLElement | null };
  /**
   * Fallback offset khi khong co sourceRef. Default: 8px goc phai duoi.
   * Bo qua khi sourceRef duoc dat va capture thanh cong.
   */
  fallbackOffset?: { x: number; y: number };
  /** Opacity cua preview overlay. Default 0.85 — subtle transparent. */
  opacity?: number;
}

export function useFloatingDragPreview({
  render,
  sourceRef,
  fallbackOffset = { x: 8, y: 8 },
  opacity = 0.85,
}: UseFloatingDragPreviewOptions) {
  const [visible, setVisible] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  // Grab offset — captured tai onDragStart. Positive value = pointer INSIDE source.
  // Preview positioned tai (cursor - grabOffset) → cursor cam DUNG relative point.
  const grabOffsetRef = useRef<{ x: number; y: number }>(fallbackOffset);
  // Stash latest render in ref → handlers ben duoi stable (khong recreate per render),
  // se render moi nhat luon duoc goi khi portal mount.
  const renderRef = useRef(render);
  renderRef.current = render;
  // Same for sourceRef so handlers luon doc ref moi nhat
  const sourceRefRef = useRef(sourceRef);
  sourceRefRef.current = sourceRef;

  const flushPosition = () => {
    rafRef.current = null;
    const pos = pendingPosRef.current;
    if (pos && previewRef.current) {
      const offset = grabOffsetRef.current;
      previewRef.current.style.transform = `translate3d(${pos.x - offset.x}px, ${pos.y - offset.y}px, 0)`;
    }
  };

  const scheduleUpdate = (x: number, y: number) => {
    pendingPosRef.current = { x, y };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flushPosition);
    }
  };

  // Cleanup RAF on unmount
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const onGenerateDragPreview = ({ nativeSetDragImage }: GeneratePreviewArgs) => {
    // Disable native — browser khong ve HTML5 drag image
    disableNativeDragPreview({ nativeSetDragImage });
  };

  const onDragStart = ({ location }: DragArgs) => {
    const { clientX, clientY } = location.current.input;
    pendingPosRef.current = { x: clientX, y: clientY };

    // Capture grab offset — pointer position RELATIVE TO source top-left.
    // Neu source hien tai bounding box khong hop le (0,0), fallback offset.
    const source = sourceRefRef.current?.current;
    if (source) {
      const rect = source.getBoundingClientRect();
      grabOffsetRef.current = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    } else {
      grabOffsetRef.current = fallbackOffset;
    }

    setVisible(true);
    // Wait 1 frame de portal mount, roi position immediately (khong flash o goc 0,0)
    requestAnimationFrame(() => {
      if (previewRef.current) {
        const offset = grabOffsetRef.current;
        previewRef.current.style.transform = `translate3d(${clientX - offset.x}px, ${clientY - offset.y}px, 0)`;
      }
    });
  };

  const onDrag = ({ location }: DragArgs) => {
    scheduleUpdate(location.current.input.clientX, location.current.input.clientY);
  };

  const onDrop = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingPosRef.current = null;
    grabOffsetRef.current = fallbackOffset;
    setVisible(false);
  };

  const previewNode = visible
    ? createPortal(
        <div
          ref={previewRef}
          className="pointer-events-none fixed left-0 top-0 z-[9999]"
          style={{ willChange: 'transform', opacity }}
        >
          {renderRef.current()}
        </div>,
        document.body,
      )
    : null;

  // Handlers ref → identity stable, safe cho useEffect deps.
  // useEffect trong component consumer chi phai depend on onDragStart etc.
  // moi frame, khong re-register drag setup.
  const handlersRef = useRef({
    onGenerateDragPreview,
    onDragStart,
    onDrag,
    onDrop,
  });
  handlersRef.current = { onGenerateDragPreview, onDragStart, onDrag, onDrop };

  const stableHandlers = useRef({
    onGenerateDragPreview: (args: GeneratePreviewArgs) => handlersRef.current.onGenerateDragPreview(args),
    onDragStart: (args: DragArgs) => handlersRef.current.onDragStart(args),
    onDrag: (args: DragArgs) => handlersRef.current.onDrag(args),
    onDrop: () => handlersRef.current.onDrop(),
  }).current;

  return {
    previewNode,
    onGenerateDragPreview: stableHandlers.onGenerateDragPreview,
    onDragStart: stableHandlers.onDragStart,
    onDrag: stableHandlers.onDrag,
    onDrop: stableHandlers.onDrop,
  };
}
