// ============================================================
// Canvas — BoardStack store (breadcrumb path)
// ============================================================
//
// Track hierarchy: [Home, Sub1, Sub2, ...]. Root board (default) là
// item [0]. Current board = stack[stack.length - 1].
//
// Sync với URL param :boardId qua effect trong route. Store không tự
// đọc URL; component wire.
// ============================================================

import { create } from 'zustand';

import type { Board } from '../types';

interface BoardStackState {
  stack: Board[];

  /** Current board (top of stack). Null nếu chưa hydrate. */
  current: () => Board | null;

  /** Current board id (null cho root). */
  currentBoardId: () => string | null;

  /** Replace toàn bộ stack (route-driven). */
  setStack: (boards: Board[]) => void;

  /** Reset về root. */
  reset: () => void;
}

export const useBoardStackStore = create<BoardStackState>((set, get) => ({
  stack: [],

  current: () => {
    const s = get().stack;
    return s.length > 0 ? s[s.length - 1] : null;
  },

  currentBoardId: () => {
    const cur = get().stack[get().stack.length - 1];
    if (!cur) return null;
    // Root board (default, parentId=null) → treat as "null" for objects filter.
    return cur.parentId === null ? null : cur.id;
  },

  setStack: (boards) => set({ stack: boards }),

  reset: () => set({ stack: [] }),
}));
