// ============================================================
// Canvas — Clipboard (in-memory + browser Clipboard API hybrid)
// ============================================================
//
// Copy object → serialize thành payload JSON + lưu Zustand store +
// try navigator.clipboard.writeText silent. Paste → check store trước
// (fast path), fallback readText khi store empty (fresh tab).
//
// Offset stack:
//   copy → offsetCount = 0
//   paste → offsetCount++ → apply {x+20*count, y+20*count}
//   copy mới → reset
// ============================================================

import { create } from 'zustand';

import type { CanvasObject } from '../types';

export interface CanvasClipboardPayload {
  __canvas: true;
  version: 1;
  objects: CanvasObject[];
}

interface ClipboardState {
  payload: CanvasClipboardPayload | null;
  offsetCount: number;

  /** Copy selection: store payload, reset counter, try write browser clipboard. */
  copy: (objects: CanvasObject[]) => void;

  /** Increment và trả về offset cho paste. Không mutate payload. */
  nextOffset: () => { x: number; y: number };

  /** Reset offset stack (khi copy mới). */
  reset: () => void;
}

const PASTE_OFFSET = 20;

export const useCanvasClipboard = create<ClipboardState>((set, get) => ({
  payload: null,
  offsetCount: 0,

  copy: (objects) => {
    if (objects.length === 0) return;
    const payload: CanvasClipboardPayload = {
      __canvas: true,
      version: 1,
      objects,
    };
    set({ payload, offsetCount: 0 });

    // Best-effort browser clipboard write (silent fail nếu no permission).
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(JSON.stringify(payload)).catch(() => {
        // ignore
      });
    }
  },

  nextOffset: () => {
    const count = get().offsetCount + 1;
    set({ offsetCount: count });
    return { x: PASTE_OFFSET * count, y: PASTE_OFFSET * count };
  },

  reset: () => set({ offsetCount: 0 }),
}));

/**
 * Parse clipboard text → CanvasClipboardPayload if valid.
 * Check marker `__canvas: true` + version.
 */
export function tryParseClipboardText(text: string): CanvasClipboardPayload | null {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.__canvas === true && obj.version === 1 && Array.isArray(obj.objects)) {
      return obj as CanvasClipboardPayload;
    }
  } catch {
    // not JSON hoặc not canvas payload
  }
  return null;
}

/**
 * Serialize objects với id mới + offset applied. Return array sẵn sàng push
 * CreateCommand batch.
 */
export function materializePaste(
  payload: CanvasClipboardPayload,
  offset: { x: number; y: number }
): CanvasObject[] {
  const now = new Date().toISOString();
  return payload.objects.map((src) => ({
    ...src,
    id: crypto.randomUUID(),
    geometry: {
      ...src.geometry,
      x: src.geometry.x + offset.x,
      y: src.geometry.y + offset.y,
    },
    createdAt: now,
    updatedAt: now,
  }));
}
