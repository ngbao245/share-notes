import { create } from 'zustand';

// ============================================================
// Canvas — Snap-to-grid store (Phase 4B)
// ============================================================
//
// Persist qua localStorage. Hydrate manual từ route mount (không auto-
// load lúc module init — SSR safety, dù canvas là client-only).
// ============================================================

const STORAGE_KEY = 'canvas-snap-enabled';

interface SnapState {
  snapEnabled: boolean;
  toggle: () => void;
  set: (value: boolean) => void;
  hydrate: () => void;
}

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

function persist(value: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // no-op (private mode, quota, ...)
  }
}

export const useSnapStore = create<SnapState>((set, get) => ({
  snapEnabled: false,

  toggle: () => {
    const next = !get().snapEnabled;
    persist(next);
    set({ snapEnabled: next });
  },

  set: (value) => {
    persist(value);
    set({ snapEnabled: value });
  },

  hydrate: () => {
    set({ snapEnabled: readInitial() });
  },
}));
