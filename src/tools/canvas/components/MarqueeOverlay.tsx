import { useInteractionStore } from '../store/interaction-store';

// ============================================================
// MarqueeOverlay — Selection rectangle (screen-space)
// ============================================================
//
// Render fixed rectangle theo state.mode === 'marquee'. Ngoài camera
// transform wrapper để không scale theo zoom (marquee luôn theo pixel
// màn hình).
//
// pointer-events-none → không nuốt pointer event.
// ============================================================

export function MarqueeOverlay() {
  const state = useInteractionStore((s) => s.state);
  if (state.mode !== 'marquee') return null;

  const x = Math.min(state.startScreenX, state.currentScreenX);
  const y = Math.min(state.startScreenY, state.currentScreenY);
  const width = Math.abs(state.currentScreenX - state.startScreenX);
  const height = Math.abs(state.currentScreenY - state.startScreenY);

  return (
    <div
      className="pointer-events-none fixed z-[60] border border-primary bg-primary/15"
      style={{ left: x, top: y, width, height }}
      aria-hidden
    />
  );
}
