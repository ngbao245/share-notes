// ============================================================
// Canvas — Objects store (Zustand)
// ============================================================
//
// Map<id, CanvasObject>. Source of truth cho object trong memory.
// Rehydrate từ repository lúc mount. Commands (Task 8) sẽ mutate qua
// đây, không trực tiếp gọi repository — engine layer publish qua
// Command bus.
//
// Chọn Map thay array: O(1) lookup by id (drag/select/update thường
// xuyên), stable iteration order (insertion), dễ đồng bộ với ref map.
//
// State store luôn giữ Map instance mới sau mỗi write (React re-render
// trigger). Không mutate in-place.
// ============================================================

import { create } from 'zustand';

import type { CanvasObject } from '../types';

interface ObjectsState {
  objects: Map<string, CanvasObject>;

  /** Rehydrate từ list. Gọi lúc mount route. */
  hydrate: (list: CanvasObject[]) => void;

  /** Upsert 1 object (create hoặc replace). */
  upsert: (obj: CanvasObject) => void;

  /** Batch upsert nhiều object trong 1 render commit. */
  batchUpsert: (list: CanvasObject[]) => void;

  /** Patch object (partial update). No-op nếu id không tồn tại. */
  patch: (id: string, patch: Partial<CanvasObject>) => void;

  /** Batch patch nhiều object. */
  batchPatch: (patches: Array<{ id: string; patch: Partial<CanvasObject> }>) => void;

  /** Xoá object. No-op nếu không tồn tại. */
  remove: (id: string) => void;

  /** Batch xoá. */
  batchRemove: (ids: string[]) => void;

  /** Lấy object theo id (imperative, không trigger subscribe). */
  get: (id: string) => CanvasObject | undefined;

  /** Lấy list objects sort theo zIndex (asc). */
  getAllSorted: () => CanvasObject[];
}

export const useObjectsStore = create<ObjectsState>((set, get) => ({
  objects: new Map(),

  hydrate: (list) => {
    const next = new Map<string, CanvasObject>();
    for (const obj of list) next.set(obj.id, obj);
    set({ objects: next });
  },

  upsert: (obj) => {
    const next = new Map(get().objects);
    next.set(obj.id, obj);
    set({ objects: next });
  },

  batchUpsert: (list) => {
    const next = new Map(get().objects);
    for (const obj of list) next.set(obj.id, obj);
    set({ objects: next });
  },

  patch: (id, patch) => {
    const existing = get().objects.get(id);
    if (!existing) return;
    const next = new Map(get().objects);
    next.set(id, { ...existing, ...patch, updatedAt: new Date().toISOString() });
    set({ objects: next });
  },

  batchPatch: (patches) => {
    const current = get().objects;
    const next = new Map(current);
    const now = new Date().toISOString();
    for (const { id, patch } of patches) {
      const existing = current.get(id);
      if (!existing) continue;
      next.set(id, { ...existing, ...patch, updatedAt: now });
    }
    set({ objects: next });
  },

  remove: (id) => {
    if (!get().objects.has(id)) return;
    const next = new Map(get().objects);
    next.delete(id);
    set({ objects: next });
  },

  batchRemove: (ids) => {
    const current = get().objects;
    const next = new Map(current);
    for (const id of ids) next.delete(id);
    set({ objects: next });
  },

  get: (id) => get().objects.get(id),

  getAllSorted: () => {
    return Array.from(get().objects.values()).sort(
      (a, b) => a.geometry.zIndex - b.geometry.zIndex
    );
  },
}));
