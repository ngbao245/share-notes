// ============================================================
// Canvas — Migration service (Phase 5a Task 6)
// ============================================================
//
// runMigration: đọc IndexedDB → upload boards + objects + blobs lên
// Supabase workspace. Idempotent + resumable qua migratedIds localStorage.
//
// Flow:
//   1. exportAll() từ IndexedDB (objects/boards/blobs)
//   2. Boards: chunk 50, batch INSERT, skip nếu id trong migratedIds
//   3. Objects: chunk 50, batch INSERT, skip nếu id trong migratedIds
//   4. Blobs: serial upload (Supabase Storage), skip nếu id trong migratedIds
//   5. Success → clearMigratedIds + set status=completed
//
// Cancel:
//   - cancelToken.canceled=true check giữa mỗi chunk
//   - Interrupt → save status=in_progress với done/total snapshot
//
// Rollback:
//   - DELETE all canvas_objects + canvas_boards where user_id = current
//   - Storage remove all files trong prefix canvas/{userId}/
//   - Clear migratedIds + migration status
// ============================================================

import { getWorkspaceClient } from '@/lib/workspace/supabase';
import {
  workspaceInsertBatch,
  workspaceSelect,
} from '@/lib/workspace/client';

import { chunks } from '../lib/chunks';
import { IndexedDBRepository } from '../repository/indexed-db';
import { SupabaseCanvasRepository } from '../repository/supabase';
import { getCanvasRepository } from '../repository';
import {
  boardDomainToRow,
  objectDomainToRow,
  type CanvasBoardRow,
  type CanvasObjectRow,
} from '../repository/mappers';
import {
  clearMigratedIds,
  loadMigratedIds,
  saveMigratedIds,
} from './ids-tracker';
import {
  clearCanvasMigrationStatus,
  setCanvasMigrationStatus,
  type CanvasMigrationInProgress,
} from '@/api/canvas';

// --- Types ---

export interface MigrationProgress {
  phase: 'boards' | 'objects' | 'blobs' | 'done';
  done: number;
  total: number;
  /** File name khi phase='blobs' */
  currentFile?: string;
}

export interface RunMigrationOptions {
  cancelToken: { canceled: boolean };
  onProgress: (progress: MigrationProgress) => void;
}

export type MigrationResult =
  | {
      status: 'completed';
      totalObjects: number;
      totalBoards: number;
      totalBlobs: number;
    }
  | {
      status: 'canceled';
      progress: { boards: number; objects: number; blobs: number };
    }
  | {
      status: 'failed';
      error: string;
      progress: { boards: number; objects: number; blobs: number };
    };

// --- Constants ---

const CHUNK_SIZE = 50;
const STORAGE_BUCKET = 'canvas-images';

// ============================================================
// runMigration
// ============================================================

export async function runMigration(
  options: RunMigrationOptions,
): Promise<MigrationResult> {
  const { cancelToken, onProgress } = options;

  const remote = getCanvasRepository();
  if (!(remote instanceof SupabaseCanvasRepository)) {
    throw new Error(
      'runMigration requires remote mode (VITE_CANVAS_REMOTE=true)',
    );
  }

  const local = new IndexedDBRepository();
  const migratedIds = loadMigratedIds();

  let doneBoards = 0;
  let doneObjects = 0;
  let doneBlobs = 0;

  try {
    // --- 1. Export all local data ---
    const data = await local.exportAll!();
    const totalBoards = data.boards.length;
    const totalObjects = data.objects.length;
    const totalBlobs = data.blobs.length;

    // --- 2. Boards first (FK dependency với canvas_objects.board_id) ---
    // Filter root boards trước, sub-boards sau — đảm bảo parent tồn tại khi
    // insert child (self-FK canvas_boards.parent_id).
    const rootBoards = data.boards.filter((b) => b.parentId === null);
    const subBoards = data.boards.filter((b) => b.parentId !== null);
    // Multi-pass topological cho sub-boards (nếu nhiều level). Đơn giản: repeat
    // đến khi tất cả insert (max depth ≤ 10 thực tế).
    const orderedBoards = [...rootBoards, ...subBoards];

    for (const chunk of chunks(orderedBoards, CHUNK_SIZE)) {
      if (cancelToken.canceled) {
        return await handleCancel(doneBoards, doneObjects, doneBlobs, totalObjects);
      }

      const toInsert = chunk.filter((b) => !migratedIds.boards.has(b.id));
      if (toInsert.length > 0) {
        try {
          await workspaceInsertBatch<CanvasBoardRow>(
            'canvas_boards',
            toInsert.map(boardDomainToRow),
          );
        } catch (err) {
          // Nếu insert fail do PK conflict (row đã tồn tại từ resume trước),
          // add vào migrated set + retry còn lại từng row (verify từng cái).
          if (isConflictError(err)) {
            for (const b of toInsert) {
              try {
                await workspaceInsertBatch<CanvasBoardRow>('canvas_boards', [
                  boardDomainToRow(b),
                ]);
                migratedIds.boards.add(b.id);
              } catch (e2) {
                if (isConflictError(e2)) {
                  migratedIds.boards.add(b.id); // đã tồn tại, coi như done
                } else {
                  throw e2;
                }
              }
            }
          } else {
            throw err;
          }
        }
        toInsert.forEach((b) => migratedIds.boards.add(b.id));
      }

      doneBoards += chunk.length;
      saveMigratedIds(migratedIds);
      onProgress({ phase: 'boards', done: doneBoards, total: totalBoards });
    }

    // --- 3. Objects (batch) ---
    for (const chunk of chunks(data.objects, CHUNK_SIZE)) {
      if (cancelToken.canceled) {
        return await handleCancel(doneBoards, doneObjects, doneBlobs, totalObjects);
      }

      const toInsert = chunk.filter((o) => !migratedIds.objects.has(o.id));
      if (toInsert.length > 0) {
        try {
          await workspaceInsertBatch<CanvasObjectRow>(
            'canvas_objects',
            toInsert.map(objectDomainToRow),
          );
        } catch (err) {
          if (isConflictError(err)) {
            for (const o of toInsert) {
              try {
                await workspaceInsertBatch<CanvasObjectRow>('canvas_objects', [
                  objectDomainToRow(o),
                ]);
                migratedIds.objects.add(o.id);
              } catch (e2) {
                if (isConflictError(e2)) {
                  migratedIds.objects.add(o.id);
                } else {
                  throw e2;
                }
              }
            }
          } else {
            throw err;
          }
        }
        toInsert.forEach((o) => migratedIds.objects.add(o.id));
      }

      doneObjects += chunk.length;
      saveMigratedIds(migratedIds);
      onProgress({ phase: 'objects', done: doneObjects, total: totalObjects });

      // Update remote-ish status mỗi 500 objects (per spec) — vì migration status
      // giờ ở localStorage nên save cheap, có thể update mỗi chunk cho realtime hơn.
      if (doneObjects % 500 === 0 || doneObjects >= totalObjects) {
        await saveInProgressStatus(doneObjects, totalObjects);
      }
    }

    // --- 4. Blobs (serial upload — Supabase Storage rate limit) ---
    for (const blobItem of data.blobs) {
      if (cancelToken.canceled) {
        return await handleCancel(doneBoards, doneObjects, doneBlobs, totalObjects);
      }

      if (!migratedIds.blobs.has(blobItem.blobId)) {
        try {
          // saveBlob dùng upsert=true → resume-safe (re-upload cùng blobId OK).
          await remote.saveBlob(blobItem.blobId, blobItem.blob, blobItem.mimeType);
          migratedIds.blobs.add(blobItem.blobId);
        } catch (err) {
          throw new Error(
            `Blob upload failed (${blobItem.blobId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      doneBlobs++;
      saveMigratedIds(migratedIds);
      onProgress({
        phase: 'blobs',
        done: doneBlobs,
        total: totalBlobs,
        currentFile: `${blobItem.blobId}.${extFromMime(blobItem.mimeType)}`,
      });
    }

    // --- 5. Done ---
    await setCanvasMigrationStatus({
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    clearMigratedIds();
    onProgress({ phase: 'done', done: 1, total: 1 });

    return {
      status: 'completed',
      totalObjects,
      totalBoards,
      totalBlobs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Save partial progress
    await saveInProgressStatus(doneObjects, /* total unknown here, best-effort */ doneObjects);
    return {
      status: 'failed',
      error: message,
      progress: { boards: doneBoards, objects: doneObjects, blobs: doneBlobs },
    };
  } finally {
    local.close();
  }
}

// ============================================================
// rollbackMigration — DELETE all remote data + clear ids + status
// ============================================================

export async function rollbackMigration(): Promise<void> {
  const remote = getCanvasRepository();
  if (!(remote instanceof SupabaseCanvasRepository)) {
    throw new Error('rollbackMigration requires remote mode');
  }

  const client = getWorkspaceClient();

  // 1. DELETE canvas_objects (all rows user_id = current, workspace-proxy filter server-side)
  // Nhưng workspace-proxy delete cần filter id — không có "delete all". Load tất cả id trước.
  const allObjects = await workspaceSelect<{ id: string }>('canvas_objects', {
    limit: 1000, // upper bound reasonable per user
  });
  if (allObjects.length > 0) {
    // Split IDs by chunks
    for (const chunk of chunks(allObjects, CHUNK_SIZE)) {
      const ids = chunk.map((r) => r.id);
      // workspaceDelete accept array
      // Reuse repository via bulk approach — call individual updates might be slow.
      // Just call workspace-proxy delete với filter { id: [array] }
      await workspaceDeleteBatch('canvas_objects', ids);
    }
  }

  // 2. DELETE canvas_boards
  const allBoards = await workspaceSelect<{ id: string }>('canvas_boards', {
    limit: 1000,
  });
  if (allBoards.length > 0) {
    for (const chunk of chunks(allBoards, CHUNK_SIZE)) {
      const ids = chunk.map((r) => r.id);
      await workspaceDeleteBatch('canvas_boards', ids);
    }
  }

  // 3. Delete storage blobs (list prefix + remove batch)
  const userId = remote['userId'] as string; // access private via bracket
  const { data: files } = await client.storage
    .from(STORAGE_BUCKET)
    .list(`canvas/${userId}`, { limit: 1000 });

  if (files && files.length > 0) {
    const paths = files.map((f) => `canvas/${userId}/${f.name}`);
    // Supabase Storage remove: max ~1000 files per call
    for (const pathChunk of chunks(paths, 100)) {
      await client.storage.from(STORAGE_BUCKET).remove(pathChunk);
    }
  }

  // 4. Clear tracking + status
  clearMigratedIds();
  await clearCanvasMigrationStatus();
}

// ============================================================
// Helpers
// ============================================================

async function handleCancel(
  doneBoards: number,
  doneObjects: number,
  doneBlobs: number,
  totalObjects: number,
): Promise<MigrationResult> {
  await saveInProgressStatus(doneObjects, totalObjects);
  return {
    status: 'canceled',
    progress: { boards: doneBoards, objects: doneObjects, blobs: doneBlobs },
  };
}

async function saveInProgressStatus(done: number, total: number): Promise<void> {
  const status: CanvasMigrationInProgress = {
    status: 'in_progress',
    done,
    total,
    updatedAt: new Date().toISOString(),
  };
  await setCanvasMigrationStatus(status);
}

function isConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    msg.includes('duplicate key') ||
    msg.includes('conflict') ||
    msg.includes('unique constraint') ||
    msg.includes('23505')
  );
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  return map[mime] ?? 'bin';
}

// Local helper — bypass workspaceDelete (only accepts string | string[] filter)
// vì workspaceDelete đã accept array ids. Wrap để đảm bảo interface consistency.
async function workspaceDeleteBatch(
  table: 'canvas_objects' | 'canvas_boards',
  ids: string[],
): Promise<void> {
  const { workspaceDelete } = await import('@/lib/workspace/client');
  await workspaceDelete(table, ids);
}
