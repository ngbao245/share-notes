// ============================================================
// Canvas — Migrated IDs tracker (Phase 5a Task 5)
// ============================================================
//
// localStorage key `canvas-migrated-ids` — track object/board/blob ids
// đã upload thành công lên Supabase. Dùng cho resume migration idempotent:
// task 6 skip re-upload item đã trong set này.
//
// Clear khi migration success 100% hoặc user chọn rollback.
// ============================================================

const KEY = 'canvas-migrated-ids';

export interface MigratedIds {
  objects: Set<string>;
  boards: Set<string>;
  blobs: Set<string>;
}

interface StoredShape {
  objects: string[];
  boards: string[];
  blobs: string[];
}

export function loadMigratedIds(): MigratedIds {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyIds();
    const parsed = JSON.parse(raw) as Partial<StoredShape>;
    return {
      objects: new Set(parsed.objects ?? []),
      boards: new Set(parsed.boards ?? []),
      blobs: new Set(parsed.blobs ?? []),
    };
  } catch {
    // Corrupted JSON → reset (không throw để không break bootstrap)
    return emptyIds();
  }
}

export function saveMigratedIds(ids: MigratedIds): void {
  try {
    const stored: StoredShape = {
      objects: [...ids.objects],
      boards: [...ids.boards],
      blobs: [...ids.blobs],
    };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Quota exceeded rare — silently ignore (migration vẫn tiếp, chỉ mất resume speedup).
  }
}

export function clearMigratedIds(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // No-op
  }
}

function emptyIds(): MigratedIds {
  return {
    objects: new Set(),
    boards: new Set(),
    blobs: new Set(),
  };
}
