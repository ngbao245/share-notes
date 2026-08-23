// ============================================================
// Canvas — Blob URL cache (module singleton)
// ============================================================
//
// createObjectURL không cheap khi lặp lại + cần revoke để tránh memory
// leak. Cache URL per blobId trong Map. Renderer gọi `getUrl(id)` sẽ
// nhận URL sync (nếu cached) hoặc undefined + async load.
//
// Lifecycle:
//   - Image renderer mount → getUrl(id) → nếu chưa cached, gọi load()
//     async → khi resolved, notify subscriber → re-render
//   - Route unmount → releaseAll() → revoke tất cả URL
//   - Object delete → release(id) → revoke + remove cache
// ============================================================

import { getCanvasRepository } from '../repository';

interface CacheEntry {
  url: string;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string | null>>();
const subscribers = new Map<string, Set<() => void>>();

/** Return URL nếu cached, undefined nếu chưa load. */
export function peekUrl(blobId: string): string | undefined {
  return cache.get(blobId)?.url;
}

/**
 * Load blob từ IDB rồi createObjectURL. Trả về Promise resolve URL
 * hoặc null nếu blob không tồn tại.
 *
 * Dedupe: 2 caller cùng blobId chỉ trigger 1 load.
 */
export async function loadUrl(blobId: string): Promise<string | null> {
  const cached = cache.get(blobId);
  if (cached) return cached.url;

  const inflight = pending.get(blobId);
  if (inflight) return inflight;

  const promise = (async () => {
    const blob = await getCanvasRepository().getBlob(blobId);
    if (!blob) {
      pending.delete(blobId);
      return null;
    }
    const url = URL.createObjectURL(blob);
    cache.set(blobId, { url });
    pending.delete(blobId);
    // Notify subscribers
    const subs = subscribers.get(blobId);
    if (subs) subs.forEach((cb) => cb());
    return url;
  })();

  pending.set(blobId, promise);
  return promise;
}

/** Subscribe cho re-render khi URL loaded. Return unsubscribe. */
export function subscribeUrl(blobId: string, cb: () => void): () => void {
  let set = subscribers.get(blobId);
  if (!set) {
    set = new Set();
    subscribers.set(blobId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(blobId);
  };
}

/** Revoke + xoá cache entry. Gọi khi delete object hoặc replace blob. */
export function release(blobId: string): void {
  const entry = cache.get(blobId);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  cache.delete(blobId);
}

/** Revoke tất cả — gọi khi route unmount. */
export function releaseAll(): void {
  cache.forEach((entry) => URL.revokeObjectURL(entry.url));
  cache.clear();
  subscribers.clear();
  pending.clear();
}
