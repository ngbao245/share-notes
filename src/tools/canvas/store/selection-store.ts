// ============================================================
// Canvas — Selection store (Zustand)
// ============================================================
//
// Set<objectId>. Independent với objects-store — object có thể bị xoá
// khỏi objects-store nhưng id vẫn còn trong selection. Consumer phải
// filter khi dùng (VD SelectionOverlay chỉ hiện handle cho object còn
// tồn tại).
// ============================================================

import { create } from 'zustand';

interface SelectionState {
  selectedIds: Set<string>;

  /** Replace selection với 1 id (single click). */
  select: (id: string) => void;

  /** Add 1 id vào selection (shift-click). */
  add: (id: string) => void;

  /** Remove 1 id khỏi selection. */
  remove: (id: string) => void;

  /** Toggle id (thêm nếu chưa có, remove nếu có). Shift-click behavior. */
  toggle: (id: string) => void;

  /** Replace toàn bộ với list mới (marquee commit). */
  replaceAll: (ids: string[]) => void;

  /** Add nhiều id (marquee + shift). */
  addAll: (ids: string[]) => void;

  /** Clear all. */
  clear: () => void;

  /** Check 1 id có trong selection. */
  has: (id: string) => boolean;

  /** Size (imperative). */
  size: () => number;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set(),

  select: (id) => set({ selectedIds: new Set([id]) }),

  add: (id) => {
    const next = new Set(get().selectedIds);
    next.add(id);
    set({ selectedIds: next });
  },

  remove: (id) => {
    if (!get().selectedIds.has(id)) return;
    const next = new Set(get().selectedIds);
    next.delete(id);
    set({ selectedIds: next });
  },

  toggle: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  replaceAll: (ids) => set({ selectedIds: new Set(ids) }),

  addAll: (ids) => {
    const next = new Set(get().selectedIds);
    for (const id of ids) next.add(id);
    set({ selectedIds: next });
  },

  clear: () => {
    if (get().selectedIds.size === 0) return;
    set({ selectedIds: new Set() });
  },

  has: (id) => get().selectedIds.has(id),

  size: () => get().selectedIds.size,
}));
