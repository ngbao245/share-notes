// ============================================================
// plugin-storage — Facade cho localStorage
// ============================================================
//
// Tool KHÔNG đụng localStorage trực tiếp. Dùng `createToolStorage()`
// factory, facade tự prefix key theo scope + userId → data cross-account
// tự isolated → không leak khi switch account.
//
// Key format:
//   scope='user'   → v1:user:{userId}:tool:{toolId}:{key}
//   scope='global' → v1:global:tool:{toolId}:{key}
//
// `userId` khi chưa login = 'anonymous'.
//
// API sync (match localStorage native). Tool cần async → dùng IndexedDB.
// Quota exceeded → console.warn silent, không throw.
// Corrupt JSON → self-heal (remove key + return null).
// ============================================================

import { useAuthStore } from '@/stores/authStore';

const KEY_VERSION = 'v1';
const ANONYMOUS_USER_ID = 'anonymous';

export type StorageScope = 'user' | 'global';

export interface StorageKeyConfig {
  toolId: string;
  key: string;
  scope: StorageScope;
}

export interface StorageConfig<T> extends StorageKeyConfig {
  /**
   * Optional runtime validator/parser. Nhận raw đã JSON.parse, trả T.
   * Nếu schema throw → coi như corrupt data, self-heal (remove + return null).
   * Ví dụ: `schema: (raw) => MySchema.parse(raw)` với zod.
   */
  schema?: (raw: unknown) => T;
}

export interface ToolStorage<T> {
  /** Get value. Return null nếu chưa có hoặc corrupt (đã self-heal). */
  get(): T | null;
  /** Set value. Silent nếu quota exceeded. */
  set(value: T): void;
  /** Remove key. Silent nếu fail. */
  remove(): void;
  /** Full key hiện tại (debug purpose). */
  readonly key: string;
}

/**
 * Build key thực tế từ config. Đọc userId từ authStore memory (sync).
 * Export cho zustand adapter + migration script dùng chung logic.
 */
export function buildKey(config: StorageKeyConfig): string {
  if (config.scope === 'user') {
    const uid = useAuthStore.getState().session?.user.id ?? ANONYMOUS_USER_ID;
    return `${KEY_VERSION}:user:${uid}:tool:${config.toolId}:${config.key}`;
  }
  return `${KEY_VERSION}:global:tool:${config.toolId}:${config.key}`;
}

/**
 * Factory function — không phải React hook, không call hook internals.
 * Tên có `use` cho consistency với hooks convention.
 *
 * Có thể gọi trong bất kỳ scope: route component, api file, utility function,
 * store action... Sync + serializable.
 *
 * @example
 * const storage = createToolStorage<Queue>({ toolId: 'audio', key: 'queue', scope: 'user' });
 * storage.set(queue);
 * const restored = storage.get(); // Queue | null
 */
export function createToolStorage<T>(config: StorageConfig<T>): ToolStorage<T> {
  const keyConfig: StorageKeyConfig = {
    toolId: config.toolId,
    key: config.key,
    scope: config.scope,
  };

  return {
    get key() {
      return buildKey(keyConfig);
    },
    get(): T | null {
      const fullKey = buildKey(keyConfig);
      let raw: string | null;
      try {
        raw = localStorage.getItem(fullKey);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[plugin-storage] getItem fail cho ${fullKey}:`, e);
        return null;
      }
      if (raw === null) return null;

      try {
        const parsed = JSON.parse(raw) as unknown;
        if (config.schema) {
          return config.schema(parsed);
        }
        return parsed as T;
      } catch {
        // Corrupt JSON hoặc schema fail — self-heal
        try {
          localStorage.removeItem(fullKey);
        } catch {
          /* ignore */
        }
        return null;
      }
    },
    set(value: T): void {
      const fullKey = buildKey(keyConfig);
      try {
        localStorage.setItem(fullKey, JSON.stringify(value));
      } catch (e) {
        // Quota exceeded / storage disabled — warn silent, không throw
        // eslint-disable-next-line no-console
        console.warn(`[plugin-storage] setItem fail cho ${fullKey}:`, e);
      }
    },
    remove(): void {
      const fullKey = buildKey(keyConfig);
      try {
        localStorage.removeItem(fullKey);
      } catch {
        /* ignore */
      }
    },
  };
}
