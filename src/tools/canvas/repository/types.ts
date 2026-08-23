// ============================================================
// Canvas — Repository interface
// ============================================================
//
// Engine gọi qua interface này, KHÔNG biết implementation dưới
// (IndexedDB / Supabase / mock). Phase 1-4 dùng IndexedDBRepository,
// Phase 5 swap sang SupabaseRepository qua workspace-proxy KHÔNG đổi
// engine code.
//
// Contract:
//   - Load functions return promise, resolve empty array/null nếu chưa có
//   - Save/update/delete idempotent
//   - batchUpdateObjects atomic khi implement được (IDB transaction)
//   - Không throw khi record not found — silent no-op cho delete/update
// ============================================================

import type { CanvasObject, Camera, Board } from '../types';

export interface BlobRecord {
  id: string;
  mimeType: string;
  blob: Blob;
  size: number;
  createdAt: string;
}

// --- Sync events (Phase 5a) ---
export type SyncEventKind = 'INSERT' | 'UPDATE' | 'DELETE';
export type SyncTable = 'objects' | 'boards';

export interface SyncEvent {
  table: SyncTable;
  kind: SyncEventKind;
  /** Row mới (INSERT/UPDATE) hoặc null (DELETE). */
  new: CanvasObject | Board | null;
  /** Row cũ (UPDATE/DELETE) hoặc null (INSERT). Có thể null nếu source không gửi. */
  old: CanvasObject | Board | null;
}

export type SyncUnsubscribe = () => void;

/** Realtime channel state (Supabase-js). */
export type RealtimeChannelStatus =
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

// --- Export data cho migration (Phase 5a) ---
export interface CanvasExportData {
  objects: CanvasObject[];
  boards: Board[];
  blobs: Array<{ blobId: string; blob: Blob; mimeType: string }>;
}

// --- Delta result cho poll fallback (Phase 5a) ---
export interface CanvasDelta {
  objects: CanvasObject[];
  boards: Board[];
}

export interface CanvasRepository {
  // --- Boards ---
  /** Load 1 board. Return null nếu chưa tồn tại. */
  getBoard(boardId: string): Promise<Board | null>;
  /**
   * Load root board — board với `parentId = null`. Return null nếu chưa có.
   * (Bootstrap tạo mới nếu null.) Semantic lookup thay vì fixed id string
   * — tương thích cả IndexedDB legacy (`id='default'`) và Supabase fresh (UUID).
   */
  loadRootBoard(): Promise<Board | null>;
  /** Tạo board mới (khi chưa có). */
  createBoard(board: Board): Promise<void>;
  /** Update camera của board (Phase 1 chỉ dùng cho default board). */
  saveCamera(boardId: string, camera: Camera): Promise<void>;
  /** Phase 4: load tất cả boards để build hierarchy tree. */
  loadAllBoards(): Promise<Board[]>;
  /** Phase 4: patch board (name, camera, parentId). */
  updateBoard(id: string, patch: Partial<Board>): Promise<void>;
  /** Phase 4: xoá board record (không xoá objects — caller phải handle). */
  deleteBoard(id: string): Promise<void>;

  // --- Objects ---
  /** Load tất cả object thuộc 1 board. Root board = boardId null. */
  loadObjects(boardId: string | null): Promise<CanvasObject[]>;
  /** Insert object mới. */
  createObject(obj: CanvasObject): Promise<void>;
  /** Patch object (partial update). No-op nếu id không tồn tại. */
  updateObject(id: string, patch: Partial<CanvasObject>): Promise<void>;
  /** Xoá object. No-op nếu không tồn tại. */
  deleteObject(id: string): Promise<void>;
  /** Batch patch nhiều object trong 1 transaction. */
  batchUpdateObjects(
    patches: Array<{ id: string; patch: Partial<CanvasObject> }>
  ): Promise<void>;

  // --- Blobs (Phase 2) ---
  /** Lưu blob với id do caller cung cấp. */
  saveBlob(id: string, blob: Blob, mimeType: string): Promise<void>;
  /** Lấy blob theo id. Return null nếu không tồn tại. */
  getBlob(id: string): Promise<Blob | null>;
  /** Xoá blob theo id. No-op nếu không tồn tại. */
  deleteBlob(id: string): Promise<void>;

  // --- Image URL resolution (Phase 5a) ---
  /**
   * Resolve URL cho image blob (renderer dùng làm `<img src>`).
   * - IndexedDB impl: return `URL.createObjectURL(blob)` với cache.
   * - Supabase impl: return signed URL cho path `canvas/{userId}/{blobId}.{ext}` (TTL 24h, memoize).
   * Return null nếu blob không tồn tại (VD deleted, migration incomplete).
   */
  resolveImageUrl(blobId: string): Promise<string | null>;

  // --- Sync + migration (Phase 5a, optional per impl) ---
  /**
   * Subscribe realtime changes (Supabase only). Return unsubscribe callback.
   * IndexedDB impl không implement (local-only, không có cross-tab sync).
   *
   * `onStateChange` optional callback nhận channel status — dùng bởi SyncManager
   * để trigger poll fallback khi disconnected > 30s.
   */
  subscribeChanges?(
    callback: (event: SyncEvent) => void,
    onStateChange?: (status: RealtimeChannelStatus) => void,
  ): SyncUnsubscribe;

  /**
   * Load delta since timestamp (Supabase only, dùng cho poll fallback).
   * IndexedDB impl không implement.
   */
  loadDelta?(sinceUpdatedAt: Date): Promise<CanvasDelta>;

  /**
   * Export toàn bộ data cho migration (IndexedDB only).
   * Supabase impl không implement (không cần re-export remote data).
   */
  exportAll?(): Promise<CanvasExportData>;

  // --- Lifecycle ---
  /** Close DB connection (nếu applicable). Không bắt buộc call. */
  close?(): void;
}

// --- Bootstrap result shape ---
// Repository consumer (stores) dùng để rehydrate initial state.
export interface CanvasBootstrapData {
  board: Board;
  objects: CanvasObject[];
}
