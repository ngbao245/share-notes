import { useInteractionStore } from '../store/interaction-store';
import { useCameraStore } from '../store/camera-store';
import { canvasToScreen } from '../engine/coords';

// ============================================================
// AlignmentGuideOverlay — Render alignment guide lines (Phase 4B)
// ============================================================
//
// Subscribe alignmentGuides state. Render fullscreen lines qua canvas.
// Position screen-space (fixed) — convert canvas coord → screen qua
// canvasToScreen + surface offset.
//
// z-index 40 (dưới SelectionOverlay z-55, dưới Marquee z-60, dưới
// ContextMenu z-70, dưới Dialog z-50 — so overlay không đè modal).
// Actually z-40 < 50 → dưới modal, đúng.
// ============================================================

export function AlignmentGuideOverlay() {
  const guides = useInteractionStore((s) => s.alignmentGuides);
  const camera = useCameraStore((s) => s.camera);

  if (guides.length === 0) return null;

  // Get surface offset for coord conversion.
  const surfaceEl = document.querySelector<HTMLElement>('[data-canvas-surface="true"]');
  const surfaceRect = surfaceEl?.getBoundingClientRect();
  if (!surfaceRect) return null;

  const surfaceLeft = surfaceRect.left;
  const surfaceTop = surfaceRect.top;
  const surfaceWidth = surfaceRect.width;
  const surfaceHeight = surfaceRect.height;

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      {guides.map((g, i) => {
        if (g.axis === 'horizontal') {
          const screenY =
            canvasToScreen({ x: 0, y: g.position }, camera).y + surfaceTop;
          return (
            <div
              key={`h-${i}-${g.position}-${g.kind}`}
              className="absolute bg-primary/60"
              style={{
                left: surfaceLeft,
                top: screenY,
                width: surfaceWidth,
                height: 1,
              }}
            />
          );
        }
        const screenX =
          canvasToScreen({ x: g.position, y: 0 }, camera).x + surfaceLeft;
        return (
          <div
            key={`v-${i}-${g.position}-${g.kind}`}
            className="absolute bg-primary/60"
            style={{
              left: screenX,
              top: surfaceTop,
              width: 1,
              height: surfaceHeight,
            }}
          />
        );
      })}
    </div>
  );
}
