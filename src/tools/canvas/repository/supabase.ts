// ============================================================
// Canvas — SupabaseCanvasRepository (Phase 5a)
// ============================================================
//
// Remote repository dùng workspace-proxy edge function + Supabase
// Storage + Realtime. Kích hoạt khi VITE_CANVAS_REMOTE=true (Task 4).
//
// Design decisions:
// - Soft delete: deleteObject/deleteBoard set deleted_at=now(), không
//   physical DELETE. loadObjects/getBoard filter deleted_at IS NULL.
//   Realtime UPDATE với deleted_at set → client treat như DELETE.
// - Blob storage path: canvas/{userId}/{blobId} (không có extension —
//   contentType lưu qua Storage metadata). Renderer nhận URL từ signed
//   URL, browser dùng Content-Type header trả về từ storage.
// - resolveImageUrl memoize signed URL, TTL 24h buffer 1h expire.
// - subscribeChanges: 2 listener postgres_changes (canvas_objects +
//   canvas_boards). Soft-delete UPDATE → dispatch DELETE event.
// - batchUpdateObjects: serial N update (proxy chưa support PATCH_BATCH).
//   Rate limit 100 req/min OK vì optimistic queue merge trước.
// ============================================================

import {
  workspaceSelect,
  workspaceInsert,
  workspaceUpdate,
} from '@/lib/workspace/client';
import { getWorkspaceClient } from '@/lib/workspace/supabase';

import type { Board, Camera, CanvasObject } from '../types';
import { chunks } from '../lib/chunks';
import {
  boardDomainToRow,
  boardPatchToRow,
  boardRowToDomain,
  objectDomainToRow,
  objectPatchToRow,
  objectRowToDomain,
  type CanvasBoardRow,
  type CanvasObjectRow,
} from './mappers';
import type {
  CanvasDelta,
  CanvasRepository,
  RealtimeChannelStatus,
  SyncEvent,
  SyncUnsubscribe,
} from './types';

// --- Constants ---

const STORAGE_BUCKET = 'canvas-images';
const SIGNED_URL_TTL_SECONDS = 24 * 3600; // 24h
const SIGNED_URL_CACHE_BUFFER_MS = 60 * 60 * 1000; // 1h buffer trước khi expire
const SIGNED_URL_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1h — sweep expired entries
const REALTIME_CHANNEL_PREFIX = 'canvas';

// --- Helpers ---

function nowIso(): string {
  return new Date().toISOString();
}

function storagePath(userId: string, blobId: string): string {
  return `canvas/${userId}/${blobId}`;
}

// ============================================================
// Class
// ============================================================

export class SupabaseCanvasRepository implements CanvasRepository {
  private readonly userId: string;

  /** Cache signed URL: blobId → { url, expiresAt (unix ms) } */
  private signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

  /**
   * Interval handle cho periodic sweep expired signed URL cache entries.
   * `resolveImageUrl()` vẫn check expiry per-access (correctness). Sweep
   * là memory cleanup cho entries không được resolve lại (VD user scroll
   * qua image rồi delete object — entry expired giữ trong Map tới khi
   * `close()` hoặc reload). Sweep chạy background 1h/lần.
   *
   * `ReturnType<typeof setInterval>` để work cả browser (number) + node types.
   */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(userId: string) {
    if (!userId) throw new Error('SupabaseCanvasRepository requires userId');
    this.userId = userId;
    this.sweepTimer = setInterval(
      () => this.sweepSignedUrlCache(),
      SIGNED_URL_SWEEP_INTERVAL_MS,
    );
  }

  /**
   * Cleanup lifecycle. Called từ `getCanvasRepository()` khi swap instance
   * (session change / logout). Stops sweep timer để tránh leak reference.
   */
  close(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.signedUrlCache.clear();
  }

  private sweepSignedUrlCache(): void {
    const now = Date.now();
    for (const [blobId, entry] of this.signedUrlCache) {
      if (entry.expiresAt <= now) {
        this.signedUrlCache.delete(blobId);
      }
    }
  }

  // ==========================================================
  // Boards
  // ==========================================================

  async getBoard(boardId: string): Promise<Board | null> {
    const rows = await workspaceSelect<CanvasBoardRow>('canvas_boards', {
      filters: { id: boardId, deleted_at: null },
      limit: 1,
    });
    return rows.length > 0 ? boardRowToDomain(rows[0]) : null;
  }

  async loadRootBoard(): Promise<Board | null> {
    const rows = await workspaceSelect<CanvasBoardRow>('canvas_boards', {
      filters: { parent_id: null, deleted_at: null },
      order: { column: 'created_at', ascending: true },
      limit: 1,
    });
    return rows.length > 0 ? boardRowToDomain(rows[0]) : null;
  }

  async createBoard(board: Board): Promise<void> {
    await workspaceInsert<CanvasBoardRow>('canvas_boards', boardDomainToRow(board));
  }

  async saveCamera(boardId: string, camera: Camera): Promise<void> {
    await workspaceUpdate<CanvasBoardRow>('canvas_boards', boardId, { camera });
  }

  async loadAllBoards(): Promise<Board[]> {
    const rows = await workspaceSelect<CanvasBoardRow>('canvas_boards', {
      filters: { deleted_at: null },
      order: { column: 'created_at', ascending: true },
    });
    return rows.map(boardRowToDomain);
  }

  async updateBoard(id: string, patch: Partial<Board>): Promise<void> {
    const rowPatch = boardPatchToRow(patch);
    if (Object.keys(rowPatch).length === 0) return;
    await workspaceUpdate<CanvasBoardRow>('canvas_boards', id, rowPatch);
  }

  async deleteBoard(id: string): Promise<void> {
    // Soft delete
    await workspaceUpdate<CanvasBoardRow>('canvas_boards', id, {
      deleted_at: nowIso(),
    });
  }

  // ==========================================================
  // Objects
  // ==========================================================

  async loadObjects(boardId: string | null): Promise<CanvasObject[]> {
    const rows = await workspaceSelect<CanvasObjectRow>('canvas_objects', {
      filters: { board_id: boardId, deleted_at: null },
      order: { column: 'created_at', ascending: true },
      limit: 1000,
    });
    return rows.map(objectRowToDomain);
  }

  async createObject(obj: CanvasObject): Promise<void> {
    await workspaceInsert<CanvasObjectRow>('canvas_objects', objectDomainToRow(obj));
  }

  async updateObject(id: string, patch: Partial<CanvasObject>): Promise<void> {
    const rowPatch = objectPatchToRow(patch);
    if (Object.keys(rowPatch).length === 0) return;
    await workspaceUpdate<CanvasObjectRow>('canvas_objects', id, rowPatch);
  }

  async deleteObject(id: string): Promise<void> {
    await workspaceUpdate<CanvasObjectRow>('canvas_objects', id, {
      deleted_at: nowIso(),
    });
  }

  async batchUpdateObjects(
    patches: Array<{ id: string; patch: Partial<CanvasObject> }>,
  ): Promise<void> {
    // Proxy chưa support PATCH batch → serial N request, chunked 50 để pace rate limit.
    // Optimistic queue merge trước nên số patch thực tế thường thấp (drag merge 500ms).
    for (const chunk of chunks(patches, 50)) {
      await Promise.all(
        chunk.map(({ id, patch }) => {
          const rowPatch = objectPatchToRow(patch);
          if (Object.keys(rowPatch).length === 0) return Promise.resolve();
          return workspaceUpdate<CanvasObjectRow>('canvas_objects', id, rowPatch);
        }),
      );
    }
  }

  // ==========================================================
  // Blobs (Storage bucket canvas-images)
  // ==========================================================

  async saveBlob(id: string, blob: Blob, mimeType: string): Promise<void> {
    const path = storagePath(this.userId, id);
    const client = getWorkspaceClient();
    const { error } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(path, blob, {
        contentType: mimeType,
        upsert: true, // idempotent: re-upload cùng blobId thay thế
      });
    if (error) {
      throw new Error(`Storage upload failed (${path}): ${error.message}`);
    }
    // Invalidate signed URL cache entry (nếu tồn tại) — file mới, URL cũ có thể vẫn valid
    // nhưng safer để force refresh
    this.signedUrlCache.delete(id);
  }

  async getBlob(id: string): Promise<Blob | null> {
    const path = storagePath(this.userId, id);
    const client = getWorkspaceClient();
    const { data, error } = await client.storage.from(STORAGE_BUCKET).download(path);
    if (error) {
      // 404 (not found) return null; other errors throw
      const msg = error.message.toLowerCase();
      if (msg.includes('not found') || msg.includes('404')) return null;
      throw new Error(`Storage download failed (${path}): ${error.message}`);
    }
    return data;
  }

  async deleteBlob(id: string): Promise<void> {
    const path = storagePath(this.userId, id);
    const client = getWorkspaceClient();
    const { error } = await client.storage.from(STORAGE_BUCKET).remove([path]);
    if (error) {
      // 404 = already gone, no-op OK
      const msg = error.message.toLowerCase();
      if (msg.includes('not found') || msg.includes('404')) return;
      throw new Error(`Storage delete failed (${path}): ${error.message}`);
    }
    this.signedUrlCache.delete(id);
  }

  async resolveImageUrl(blobId: string): Promise<string | null> {
    // Cache hit + not expired
    const cached = this.signedUrlCache.get(blobId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const path = storagePath(this.userId, blobId);
    const client = getWorkspaceClient();
    const { data, error } = await client.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('not found') || msg.includes('404')) return null;
      throw new Error(`Signed URL failed (${path}): ${error.message}`);
    }

    const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000 - SIGNED_URL_CACHE_BUFFER_MS;
    this.signedUrlCache.set(blobId, { url: data.signedUrl, expiresAt });
    return data.signedUrl;
  }

  // ==========================================================
  // Sync (Phase 5a)
  // ==========================================================

  subscribeChanges(
    callback: (event: SyncEvent) => void,
    onStateChange?: (status: RealtimeChannelStatus) => void,
  ): SyncUnsubscribe {
    const client = getWorkspaceClient();
    const channelName = `${REALTIME_CHANNEL_PREFIX}:${this.userId}`;

    // Ensure realtime WS carries current auth token
    try {
      const token = (
        client as unknown as {
          realtime?: { setAuth?: (t: string) => void };
        }
      ).realtime;
      if (token?.setAuth) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authToken = (client.auth as any)?.session?.access_token;
        if (authToken) token.setAuth(authToken);
      }
    } catch {
      // Ignore — realtime sẽ fall back to anon nếu setAuth không available
    }

    const channel = client
      .channel(channelName)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'canvas_objects',
          filter: `user_id=eq.${this.userId}`,
        },
        (payload: unknown) => {
          this.handleObjectPayload(payload, callback);
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'canvas_boards',
          filter: `user_id=eq.${this.userId}`,
        },
        (payload: unknown) => {
          this.handleBoardPayload(payload, callback);
        },
      )
      .subscribe((status: string) => {
        // Supabase status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
        if (
          onStateChange &&
          (status === 'SUBSCRIBED' ||
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED')
        ) {
          onStateChange(status);
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }

  private handleObjectPayload(payload: unknown, callback: (event: SyncEvent) => void): void {
    const p = payload as {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: CanvasObjectRow | null;
      old: CanvasObjectRow | null;
    };

    // Soft-delete: UPDATE với deleted_at set → treat như DELETE.
    const newDeleted = p.new?.deleted_at != null;
    const effectiveKind =
      p.eventType === 'DELETE' || newDeleted ? 'DELETE' : p.eventType;

    callback({
      table: 'objects',
      kind: effectiveKind,
      new: p.new && !newDeleted ? objectRowToDomain(p.new) : null,
      old: p.old ? objectRowToDomain(p.old) : null,
    });
  }

  private handleBoardPayload(payload: unknown, callback: (event: SyncEvent) => void): void {
    const p = payload as {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: CanvasBoardRow | null;
      old: CanvasBoardRow | null;
    };

    const newDeleted = p.new?.deleted_at != null;
    const effectiveKind =
      p.eventType === 'DELETE' || newDeleted ? 'DELETE' : p.eventType;

    callback({
      table: 'boards',
      kind: effectiveKind,
      new: p.new && !newDeleted ? boardRowToDomain(p.new) : null,
      old: p.old ? boardRowToDomain(p.old) : null,
    });
  }

  async loadDelta(sinceUpdatedAt: Date): Promise<CanvasDelta> {
    const sinceIso = sinceUpdatedAt.toISOString();
    const [objectRows, boardRows] = await Promise.all([
      workspaceSelect<CanvasObjectRow>('canvas_objects', {
        filters: { updated_at: { gt: sinceIso } },
        order: { column: 'updated_at', ascending: true },
        limit: 1000,
      }),
      workspaceSelect<CanvasBoardRow>('canvas_boards', {
        filters: { updated_at: { gt: sinceIso } },
        order: { column: 'updated_at', ascending: true },
        limit: 1000,
      }),
    ]);

    // Filter out soft-deleted (client sẽ handle deleted qua realtime path riêng,
    // poll fallback không tái emit deleted event, chỉ trả về objects còn valid).
    return {
      objects: objectRows.filter((r) => r.deleted_at == null).map(objectRowToDomain),
      boards: boardRows.filter((r) => r.deleted_at == null).map(boardRowToDomain),
    };
  }
}
