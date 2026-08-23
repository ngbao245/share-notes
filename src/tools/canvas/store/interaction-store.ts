// ============================================================
// Canvas — Interaction FSM store (Zustand)
// ============================================================
//
// Hold current FSM state. Dispatch = `transitionTo(newState)`.
// State variants + guards ở `engine/fsm.ts`.
//
// Rule cứng: chỉ store này biết current mode. Component KHÔNG được
// duplicate với useState riêng. Cursor derived qua `cursorForState`.
// ============================================================

import { create } from 'zustand';

import {
  cursorForState,
  isBusy,
  type InteractionState,
} from '../engine/fsm';
import type { AlignmentGuide } from '../engine/alignment';

interface InteractionStoreState {
  state: InteractionState;

  /** Phase 2: object đang edit (double-click enter). Null khi không. */
  editingObjectId: string | null;

  /** Phase 4B: transient — board object hiện đang là drop target khi drag hover. */
  dropTargetBoardId: string | null;

  /** Phase 4B: transient — alignment guides đang hiện khi drag. */
  alignmentGuides: AlignmentGuide[];

  transitionTo: (next: InteractionState) => void;
  reset: () => void;

  /** Enter edit mode cho 1 object. */
  enterEdit: (id: string) => void;
  /** Exit edit mode (blur/Escape/Ctrl+Enter). */
  exitEdit: () => void;

  setDropTarget: (id: string | null) => void;
  setAlignmentGuides: (guides: AlignmentGuide[]) => void;

  cursor: () => string;
  isBusy: () => boolean;
}

export const useInteractionStore = create<InteractionStoreState>((set, get) => ({
  state: { mode: 'idle' },
  editingObjectId: null,
  dropTargetBoardId: null,
  alignmentGuides: [],

  transitionTo: (next) => set({ state: next }),
  reset: () =>
    set({ state: { mode: 'idle' }, dropTargetBoardId: null, alignmentGuides: [] }),

  enterEdit: (id) => set({ editingObjectId: id }),
  exitEdit: () => set({ editingObjectId: null }),

  setDropTarget: (id) => {
    if (get().dropTargetBoardId === id) return;
    set({ dropTargetBoardId: id });
  },
  setAlignmentGuides: (guides) => set({ alignmentGuides: guides }),

  cursor: () => cursorForState(get().state),
  isBusy: () => isBusy(get().state),
}));
