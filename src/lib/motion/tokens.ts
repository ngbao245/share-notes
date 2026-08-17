// ============================================================
// Motion tokens — shared constants cho framer-motion + JS-based animation
//
// SSOT: xem `.kiro/steering/motion-rules.md`
// Tailwind counterpart: `transitionDuration.fast/normal/slow` +
// `transitionTimingFunction.standard` trong tailwind.config.ts
//
// Dung cho:
//   - framer-motion `transition` prop
//   - inline style animation
//   - JS-driven animation (Web Animations API, canvas, etc.)
//
// KHONG dung: CSS class (dung Tailwind utility thay: `duration-fast ease-standard`)
// ============================================================

export const MOTION = {
  duration: {
    /** 120ms — hover, toggle, DnD settle, indicator fade. Snappy responsive feel. */
    fast: 0.12,
    /** 200ms — modal enter, panel slide */
    normal: 0.2,
    /** 300ms — page transition, skeleton fade-out */
    slow: 0.3,
  },
  easing: {
    /** Standard ease in-out — dung cho MOI transition tru khi co ly do khac */
    standard: [0.4, 0, 0.2, 1] as const,
  },
} as const;

/**
 * Preset transition cho framer-motion sortable layout animation.
 * Ap dung cho cards TO (Progress kanban, Tasks list...).
 * KHONG dung cho tile NHO day dac (Bookmark) — xem motion-rules.md.
 */
export const MOTION_LAYOUT_TRANSITION = {
  type: 'tween' as const,
  duration: MOTION.duration.fast,
  ease: MOTION.easing.standard,
};

/**
 * Hysteresis delay (ms) truoc khi commit edge change trong sortable DnD.
 * Xem motion-rules.md muc "Hysteresis" — MOI sortable interaction phai co.
 * Default 60ms — vua du tranh flicker khi pointer o midpoint, khong lag perceivable.
 */
export const HYSTERESIS_MS = 60;
