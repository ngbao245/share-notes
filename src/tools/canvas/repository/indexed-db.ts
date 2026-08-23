// ============================================================
// Canvas — IndexedDB implementation của CanvasRepository
// ============================================================
//
// DB `canvas-db` v1, 3 store:
//   - `objects` (keyPath 'id') — index 'boardId' để query per-board fast
//   - `boards` (keyPath 'id') — { id, name, parentId, camera, timestamps }
//   - `meta` (keyPath 'key') — key/value cho settings tương lai (Phase 4+)
//
// Debounce batch write:
//   Nhiều update trong 500ms window được gộp thành 1 transaction. Tránh
//   thrash IDB khi drag/resize spam updates. Delete/create commit ngay
//   (nhỏ, không gây thrash).
//
// Không catch error globally — bubble lên caller. Route sẽ hiện ErrorState
// khi bootstrap fail (Task 12).
// ============================================================

import { openDB, type IDBPDatabase, type DBSchema } from 'idb';

import type { CanvasObject, Camera, Board } from '../types';
import { loadUrl } from '../lib/blob-url-cache';
import type { CanvasRepository, CanvasExportData } from './types';

const DB_NAME = 'canvas-db';
const DB_VERSION = 3;
const STORE_OBJECTS = 'objects';
const STORE_BOARDS = 'boards';
const STORE_META = 'meta';
const STORE_BLOBS = 'blobs';

const WRITE_DEBOUNCE_MS = 500;

interface BlobStoreValue {
  id: string;
  mimeType: string;
  blob: Blob;
  size: number;
  createdAt: string;
}

interface CanvasDB extends DBSchema {
  objects: {
    key: string;
    value: CanvasObject;
    indexes: { boardId: string };
  };
  boards: {
    key: string;
    value: Board;
    indexes: { parentId: string };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
  blobs: {
    key: string;
    value: BlobStoreValue;
  };
}

async function openCanvasDB(): Promise<IDBPDatabase<CanvasDB>> {
  return openDB<CanvasDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
        const objStore = db.createObjectStore(STORE_OBJECTS, { keyPath: 'id' });
        objStore.createIndex('boardId', 'boardId');
      }
      if (!db.objectStoreNames.contains(STORE_BOARDS)) {
        const bs = db.createObjectStore(STORE_BOARDS, { keyPath: 'id' });
        bs.createIndex('parentId', 'parentId');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      // v2 migration: add blobs store
      if (oldVersion < 2 && !db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
      // v3 migration: add parentId index cho boards store hiện có (v1/v2 users).
      if (oldVersion < 3 && db.objectStoreNames.contains(STORE_BOARDS)) {
        const bs = transaction.objectStore(STORE_BOARDS);
        if (!bs.indexNames.contains('parentId')) {
          bs.createIndex('parentId', 'parentId');
        }
      }
    },
  });
}

export class IndexedDBRepository implements CanvasRepository {
  private dbPromise: Promise<IDBPDatabase<CanvasDB>>;

  // Debounce state — pending patches keyed by object id, flush qua timer.
  private pendingPatches = new Map<string, Partial<CanvasObject>>();
  private flushTimer: number | null = null;
  private pendingCameras = new Map<string, Camera>();

  constructor() {
    this.dbPromise = openCanvasDB();
  }

  private async db() {
    return this.dbPromise;
  }

  // --- Boards ---
  async getBoard(boardId: string): Promise<Board | null> {
    const db = await this.db();
    const board = await db.get(STORE_BOARDS, boardId);
    return board ?? null;
  }

  async loadRootBoard(): Promise<Board | null> {
    const db = await this.db();
    const all = await db.getAll(STORE_BOARDS);
    return all.find((b) => b.parentId === null) ?? null;
  }

  async createBoard(board: Board): Promise<void> {
    const db = await this.db();
    await db.put(STORE_BOARDS, board);
  }

  async saveCamera(boardId: string, camera: Camera): Promise<void> {
    // Debounce camera save — spam khi pan/zoom, không cần persist mỗi frame.
    this.pendingCameras.set(boardId, camera);
    this.scheduleFlush();
  }

  async loadAllBoards(): Promise<Board[]> {
    const db = await this.db();
    return db.getAll(STORE_BOARDS);
  }

  async updateBoard(id: string, patch: Partial<Board>): Promise<void> {
    const db = await this.db();
    const existing = await db.get(STORE_BOARDS, id);
    if (!existing) return;
    await db.put(STORE_BOARDS, {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  async deleteBoard(id: string): Promise<void> {
    const db = await this.db();
    await db.delete(STORE_BOARDS, id);
  }

  // --- Objects ---
  async loadObjects(boardId: string | null): Promise<CanvasObject[]> {
    const db = await this.db();
    if (boardId === null) {
      // Phase 1 root: filter tất cả bằng JS. Nhanh cho < 5k object.
      const all = await db.getAll(STORE_OBJECTS);
      return all.filter((o) => o.boardId === null);
    }
    return db.getAllFromIndex(STORE_OBJECTS, 'boardId', boardId);
  }

  async createObject(obj: CanvasObject): Promise<void> {
    const db = await this.db();
    await db.put(STORE_OBJECTS, obj);
  }

  async updateObject(id: string, patch: Partial<CanvasObject>): Promise<void> {
    // Merge với patch pending (nếu có) để giữ latest state.
    const prev = this.pendingPatches.get(id) ?? {};
    this.pendingPatches.set(id, { ...prev, ...patch });
    this.scheduleFlush();
  }

  async deleteObject(id: string): Promise<void> {
    // Delete commit ngay + huỷ patch pending nếu có (đã xoá thì patch vô nghĩa).
    this.pendingPatches.delete(id);
    const db = await this.db();
    await db.delete(STORE_OBJECTS, id);
  }

  async batchUpdateObjects(
    patches: Array<{ id: string; patch: Partial<CanvasObject> }>
  ): Promise<void> {
    // Batch = commit ngay 1 transaction, bypass debounce (caller đã batch rồi).
    // Cũng flush pending patches vào cùng transaction để không mất.
    await this.flushNow();
    const db = await this.db();
    const tx = db.transaction(STORE_OBJECTS, 'readwrite');
    await Promise.all(
      patches.map(async ({ id, patch }) => {
        const existing = await tx.store.get(id);
        if (!existing) return;
        await tx.store.put({ ...existing, ...patch, updatedAt: new Date().toISOString() });
      })
    );
    await tx.done;
  }

  // --- Debounce flush ---
  private scheduleFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, WRITE_DEBOUNCE_MS);
  }

  private async flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingPatches.size === 0 && this.pendingCameras.size === 0) return;

    const patches = Array.from(this.pendingPatches.entries());
    const cameras = Array.from(this.pendingCameras.entries());
    this.pendingPatches.clear();
    this.pendingCameras.clear();

    const db = await this.db();

    if (patches.length > 0) {
      const tx = db.transaction(STORE_OBJECTS, 'readwrite');
      await Promise.all(
        patches.map(async ([id, patch]) => {
          const existing = await tx.store.get(id);
          if (!existing) return;
          await tx.store.put({
            ...existing,
            ...patch,
            updatedAt: new Date().toISOString(),
          });
        })
      );
      await tx.done;
    }

    if (cameras.length > 0) {
      const tx = db.transaction(STORE_BOARDS, 'readwrite');
      await Promise.all(
        cameras.map(async ([boardId, camera]) => {
          const existing = await tx.store.get(boardId);
          if (!existing) return;
          await tx.store.put({
            ...existing,
            camera,
            updatedAt: new Date().toISOString(),
          });
        })
      );
      await tx.done;
    }
  }

  // --- Blobs (Phase 2) ---
  async saveBlob(id: string, blob: Blob, mimeType: string): Promise<void> {
    const db = await this.db();
    await db.put(STORE_BLOBS, {
      id,
      mimeType,
      blob,
      size: blob.size,
      createdAt: new Date().toISOString(),
    });
  }

  async getBlob(id: string): Promise<Blob | null> {
    const db = await this.db();
    const record = await db.get(STORE_BLOBS, id);
    return record?.blob ?? null;
  }

  async deleteBlob(id: string): Promise<void> {
    const db = await this.db();
    await db.delete(STORE_BLOBS, id);
  }

  // --- Image URL resolution (Phase 5a) ---
  // Reuse blob-url-cache — module đã handle createObjectURL + dedup + revoke lifecycle.
  async resolveImageUrl(blobId: string): Promise<string | null> {
    return loadUrl(blobId);
  }

  // --- Migration export (Phase 5a) ---
  // Dump 3 stores cho SupabaseCanvasRepository migrate. Flush pending patches trước
  // để export state consistent (không mất debounced updates).
  async exportAll(): Promise<CanvasExportData> {
    await this.flushNow();
    const db = await this.db();
    const [objects, boards, blobRecords] = await Promise.all([
      db.getAll(STORE_OBJECTS),
      db.getAll(STORE_BOARDS),
      db.getAll(STORE_BLOBS),
    ]);
    return {
      objects,
      boards,
      blobs: blobRecords.map((b) => ({
        blobId: b.id,
        blob: b.blob,
        mimeType: b.mimeType,
      })),
    };
  }

  close(): void {
    void this.flushNow().then(() => {
      void this.dbPromise.then((db) => db.close());
    });
  }
}
