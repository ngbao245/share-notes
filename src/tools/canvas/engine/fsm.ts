// ============================================================
// Canvas — Interaction FSM (types + transition table)
// ============================================================
//
// State machine cho interaction. Store (interaction-store.ts) giữ
// state hiện tại + dispatch transitions. File này chỉ declarative:
// types + guard rules, KHÔNG có Zustand.
//
// State chart (spec design.md):
//
//   IDLE ─pointerdown empty──→ MARQUEE     ─move─→ MARQUEE     ─up─→ IDLE
//   IDLE ─pointerdown obj────→ DRAG_PENDING ─move>5px→ DRAGGING ─up─→ IDLE
//                                            ─up (no move)─────────→ IDLE
//   IDLE ─pointerdown handle→ RESIZING     ─move─→ RESIZING    ─up─→ IDLE
//   IDLE ─mid/space/ctrl drag→ PANNING     ─move─→ PANNING     ─up─→ IDLE
//   IDLE ─wheel Ctrl────────→ IDLE (zoom, no state change)
//   *    ─Escape───────────→ IDLE (cancel, no commit)
//
// Guards:
//   - Wheel bị ignore khi mode ≠ 'idle' (tránh conflict với transform)
//   - Undo/redo block khi mode ≠ 'idle'
//   - DRAG_PENDING → DRAGGING chỉ khi cursor di chuyển > threshold
// ============================================================

import type { Geometry } from '../types';

export const DRAG_THRESHOLD_PX = 5;

// --- State variants ---
export interface IdleState {
  mode: 'idle';
}

export interface DragPendingState {
  mode: 'drag_pending';
  /** Object khởi động drag (id). */
  objectId: string;
  /** Whether object had been selected before pointerdown. Dùng để quyết
   *  click-select vs no-op nếu chỉ drag rồi thả không di chuyển. */
  wasAlreadySelected: boolean;
  /** Modifier lúc pointerdown (shift/ctrl) — decide click-select behavior. */
  additive: boolean;
  /** Screen coord pointerdown. */
  startScreenX: number;
  startScreenY: number;
}

export interface DraggingState {
  mode: 'dragging';
  /** Tất cả object id đang được drag (multi-select). */
  objectIds: string[];
  /** Screen coord pointerdown (để tính delta). */
  startScreenX: number;
  startScreenY: number;
  /** Geometry ban đầu của mỗi object (để restore hoặc tính patch). */
  initialGeometries: Record<string, Geometry>;
}

export type ResizeHandle =
  | 'n' | 's' | 'e' | 'w'
  | 'nw' | 'ne' | 'sw' | 'se';

export interface ResizingState {
  mode: 'resizing';
  objectId: string;
  handle: ResizeHandle;
  startScreenX: number;
  startScreenY: number;
  initialGeometry: Geometry;
}

export interface MarqueeState {
  mode: 'marquee';
  /** Screen coord của corner start. */
  startScreenX: number;
  startScreenY: number;
  currentScreenX: number;
  currentScreenY: number;
  /** Additive marquee (Shift held) — add vào selection thay vì replace. */
  additive: boolean;
}

export interface PanningState {
  mode: 'panning';
  /** Trigger source cho debug/testing. */
  trigger: 'space' | 'middle' | 'ctrl';
}

export type InteractionState =
  | IdleState
  | DragPendingState
  | DraggingState
  | ResizingState
  | MarqueeState
  | PanningState;

export type InteractionMode = InteractionState['mode'];

// --- Helpers ---

/** State là "in-progress"? (không phải idle) */
export function isBusy(state: InteractionState): boolean {
  return state.mode !== 'idle';
}

/** Cursor derived từ FSM state. */
export function cursorForState(state: InteractionState): string {
  // Milanote pattern: cursor luôn default. Không thay đổi khi drag/marquee/
  // pan/resize. Resize handles có cursor riêng qua HANDLE_CONFIG trong
  // SelectionOverlay (hover trên handle cụ thể).
  void state;
  return 'default';
}

/**
 * Detect DRAG_PENDING → DRAGGING transition: cursor moved > threshold.
 */
export function shouldPromoteToDragging(
  state: DragPendingState,
  currentScreenX: number,
  currentScreenY: number
): boolean {
  const dx = currentScreenX - state.startScreenX;
  const dy = currentScreenY - state.startScreenY;
  return Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD_PX;
}
