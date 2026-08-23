// ============================================================
// Canvas — History store (undo/redo)
// ============================================================
//
// 2 stack: undoStack + redoStack. `push(cmd)`:
//   1. cmd.execute()
//   2. Try merge với top của undoStack (consecutive move drag → 1 slot)
//   3. Push (or replace top nếu merged)
//   4. Clear redoStack
//
// Block khi FSM ≠ IDLE (usePointerFSM check).
//
// Cap size 200 để tránh memory bloat.
// ============================================================

import { create } from 'zustand';

import { useInteractionStore } from '../../store/interaction-store';
import type { Command } from './types';

const MAX_STACK = 200;

interface HistoryState {
  undoStack: Command[];
  redoStack: Command[];

  push: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;

  canUndo: () => boolean;
  canRedo: () => boolean;

  clear: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  undoStack: [],
  redoStack: [],

  push: (cmd) => {
    // Execute trước, sau đó push.
    cmd.execute();

    const stack = get().undoStack;
    let nextStack: Command[];

    // Merge với top nếu compatible.
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.merge) {
        const merged = top.merge(cmd);
        if (merged) {
          nextStack = [...stack.slice(0, -1), merged];
          set({ undoStack: nextStack.slice(-MAX_STACK), redoStack: [] });
          return;
        }
      }
    }

    nextStack = [...stack, cmd];
    set({ undoStack: nextStack.slice(-MAX_STACK), redoStack: [] });
  },

  undo: () => {
    // Block khi busy.
    if (useInteractionStore.getState().isBusy()) return;
    const stack = get().undoStack;
    if (stack.length === 0) return;
    const cmd = stack[stack.length - 1];
    cmd.undo();
    set({
      undoStack: stack.slice(0, -1),
      redoStack: [...get().redoStack, cmd],
    });
  },

  redo: () => {
    if (useInteractionStore.getState().isBusy()) return;
    const stack = get().redoStack;
    if (stack.length === 0) return;
    const cmd = stack[stack.length - 1];
    cmd.execute();
    set({
      redoStack: stack.slice(0, -1),
      undoStack: [...get().undoStack, cmd],
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  clear: () => set({ undoStack: [], redoStack: [] }),
}));
