// ============================================================
// Canvas — Optimistic commit queue (Phase 5a Task 9)
// ============================================================
//
// Commands execute local ngay (imperative store update) rồi fire-and-forget
// repository call. Local mode: gọi thẳng IndexedDB. Remote mode: enqueue vào
// serial queue với retry 3 lần backoff (1s, 3s, 5s). Fail final → toast
// error với Retry button.
//
// Coalesce theo `coalesceKey`: task mới cùng key trong debounce window
// thay thế task cũ đang chờ (Milanote pattern — text keystroke spam
// gộp thành 1 network call sau idle). Task đã vào running queue thì
// không cancel được — vẫn chạy đến khi retry-final.
//
// Layer scope Task 9: queue-level coalesce (network optimization). Layer 2
// (command-level debounce cho undo history) là mini-spec riêng nếu cần.
//
// Pattern usage trong commands:
//   enqueueRepoCall(
//     () => getCanvasRepository().updateObject(id, patch),
//     `update ${id}`,
//     { coalesceKey: `update-${id}`, debounceMs: 800 },
//   );
// ============================================================

import { toast } from '@/components/ui/sonner';

import { isCanvasRemoteMode } from '../repository';
import { useSyncStore } from '../store/sync-store';

// --- Task shape ---

interface QueueTask {
  fn: () => Promise<void>;
  description: string;
  retries: number;
  coalesceKey?: string;
}

interface PendingEntry {
  task: QueueTask;
  timer: number;
}

const RETRY_BACKOFF_MS = [1000, 3000, 5000] as const;
const MAX_RETRIES = RETRY_BACKOFF_MS.length;

// --- Queue ---

class OptimisticQueue {
  private queue: QueueTask[] = [];
  /** Tasks đang chờ debounce timer — chưa vào queue thật. Key = coalesceKey. */
  private pendingByKey = new Map<string, PendingEntry>();
  private running = false;

  enqueue(task: QueueTask, debounceMs = 0): void {
    // Không coalesce hoặc no debounce → straight vào queue
    if (!task.coalesceKey || debounceMs <= 0) {
      // Nếu có coalesceKey, dedup: xóa pending cùng key trước khi push
      if (task.coalesceKey) {
        this.cancelPending(task.coalesceKey);
      }
      this.queue.push(task);
      this.updateQueueLength();
      void this.processNext();
      return;
    }

    // Coalesce với debounce: cancel timer cũ (nếu có), start timer mới.
    // Task mới thay thế task cũ hoàn toàn (fn của nhất mới nhất thắng).
    this.cancelPending(task.coalesceKey);
    const timer = window.setTimeout(() => {
      const entry = this.pendingByKey.get(task.coalesceKey!);
      if (!entry) return;
      this.pendingByKey.delete(task.coalesceKey!);
      this.queue.push(entry.task);
      this.updateQueueLength();
      void this.processNext();
    }, debounceMs);

    this.pendingByKey.set(task.coalesceKey, { task, timer });
    this.updateQueueLength();
  }

  /** Cancel pending debounce cho key (nếu có). Không đụng running task. */
  private cancelPending(key: string): void {
    const entry = this.pendingByKey.get(key);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    this.pendingByKey.delete(key);
  }

  /** Force flush tất cả pending debounced tasks vào queue ngay lập tức. */
  flushAll(): void {
    for (const { task, timer } of this.pendingByKey.values()) {
      window.clearTimeout(timer);
      this.queue.push(task);
    }
    this.pendingByKey.clear();
    this.updateQueueLength();
    void this.processNext();
  }

  private updateQueueLength(): void {
    useSyncStore
      .getState()
      .setQueueLength(this.queue.length + this.pendingByKey.size);
  }

  private async processNext(): Promise<void> {
    if (this.running) return;
    if (this.queue.length === 0) return;
    this.running = true;

    const task = this.queue[0];

    try {
      await task.fn();
      this.queue.shift();
      this.updateQueueLength();
      this.running = false;
      void this.processNext();
    } catch (err) {
      // Retry với backoff
      if (task.retries < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[task.retries];
        task.retries++;
        this.running = false;
        window.setTimeout(() => {
          void this.processNext();
        }, backoff);
        return;
      }

      // Fail final — pop + toast Retry
      const failed = this.queue.shift();
      this.updateQueueLength();
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error(`${task.description} failed after ${MAX_RETRIES} retries`, {
        description: errMsg,
        action: failed
          ? {
              label: 'Retry',
              onClick: () => {
                this.enqueue({
                  fn: failed.fn,
                  description: failed.description,
                  retries: 0,
                  coalesceKey: failed.coalesceKey,
                });
              },
            }
          : undefined,
      });

      this.running = false;
      void this.processNext();
    }
  }

  /** Clear toàn bộ queue + pending. Dùng khi logout / mode switch. */
  clear(): void {
    for (const { timer } of this.pendingByKey.values()) {
      window.clearTimeout(timer);
    }
    this.pendingByKey.clear();
    this.queue = [];
    this.running = false;
    useSyncStore.getState().setQueueLength(0);
  }

  hasPending(): boolean {
    return this.queue.length > 0 || this.pendingByKey.size > 0;
  }
}

export const optimisticQueue = new OptimisticQueue();

// --- Public helper ---

export interface EnqueueOptions {
  /**
   * Coalesce theo key — task mới với cùng key trong debounce window
   * sẽ thay task cũ đang chờ. Bỏ qua nếu không set.
   */
  coalesceKey?: string;
  /**
   * Debounce delay ms trước khi task vào queue. Chỉ áp dụng khi có coalesceKey.
   * Default 0 = enqueue ngay (không debounce, chỉ dedup pending).
   */
  debounceMs?: number;
}

/**
 * Enqueue 1 repository call cho commit.
 * - Local mode: fire-and-forget IndexedDB, không retry / debounce.
 * - Remote mode: enqueue vào serial queue với retry 3 lần backoff.
 *   Coalesce nếu options.coalesceKey được set.
 */
export function enqueueRepoCall(
  fn: () => Promise<void>,
  description: string,
  options?: EnqueueOptions,
): void {
  if (!isCanvasRemoteMode()) {
    void fn().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[Canvas] Local ${description} failed:`, err);
    });
    return;
  }

  optimisticQueue.enqueue(
    {
      fn,
      description,
      retries: 0,
      coalesceKey: options?.coalesceKey,
    },
    options?.debounceMs ?? 0,
  );
}

// --- beforeunload safeguard ---
// Nếu có pending debounced tasks lúc user close tab → flush ngay vào queue.
// setTimeout callbacks không guaranteed chạy sau tab close, nhưng push vào
// queue giúp visibility trong Kiểm tra hasPending() (VD show unsaved warning).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (optimisticQueue.hasPending()) {
      optimisticQueue.flushAll();
    }
  });
}
