// ============================================================
// Canvas — Detect local IndexedDB data (Phase 5a Task 5)
// ============================================================
//
// Count objects / boards / blobs từ IndexedDB `canvas-db`. Dùng bởi
// bootstrap để quyết định có cần hiển thị MigrationDialog không.
//
// Nếu DB chưa tồn tại (fresh install) → return zeros. Nếu open thất bại
// (corruption / permission) → throw để caller hiển thị error state.
// ============================================================

import { openDB } from 'idb';

export interface LocalCanvasCounts {
  objects: number;
  boards: number;
  blobs: number;
  /** Tổng bytes của tất cả blob (dùng estimate migration bandwidth). */
  totalBlobSize: number;
}

const DB_NAME = 'canvas-db';
const DB_VERSION = 3;

export async function countLocalCanvasData(): Promise<LocalCanvasCounts> {
  const db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Rare: DB chưa tồn tại → openDB tạo mới với v3 empty stores.
      // Repository sẽ setup stores khi mount thật. Ở đây chỉ tạo stub để count = 0.
      if (!db.objectStoreNames.contains('objects')) {
        db.createObjectStore('objects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('boards')) {
        db.createObjectStore('boards', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    },
  });

  const [objectCount, boardCount, blobCount] = await Promise.all([
    db.count('objects'),
    db.count('boards'),
    db.count('blobs'),
  ]);

  // Sum blob sizes (chỉ khi có blob để tránh full-load unnecessary)
  let totalBlobSize = 0;
  if (blobCount > 0) {
    const blobs = await db.getAll('blobs');
    totalBlobSize = blobs.reduce(
      (sum: number, b: { size?: number }) => sum + (b.size ?? 0),
      0,
    );
  }

  db.close();

  return {
    objects: objectCount,
    boards: boardCount,
    blobs: blobCount,
    totalBlobSize,
  };
}

/**
 * Có data local đáng migrate không? Threshold: bất kỳ object nào,
 * hoặc bất kỳ board custom (> 1 tức có board custom ngoài default root).
 */
export function hasLocalData(counts: LocalCanvasCounts): boolean {
  return counts.objects > 0 || counts.boards > 1 || counts.blobs > 0;
}
