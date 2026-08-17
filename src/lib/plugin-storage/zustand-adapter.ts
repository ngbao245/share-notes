// ============================================================
// plugin-storage/zustand-adapter — StateStorage adapter cho zustand persist
// ============================================================
//
// Zustand `persist` middleware nhận `storage` implement `StateStorage`
// interface (getItem/setItem/removeItem sync). Adapter này wrap facade
// convention.
//
// Zustand truyền `name` từ persist config vào adapter method, nhưng
// adapter IGNORE tham số đó — key được build từ `toolId` + hardcoded
// 'state' theo facade convention. Mỗi store dùng 1 adapter instance
// → 1 key duy nhất.
//
// Usage:
//   persist(
//     (set) => ({ ... }),
//     {
//       name: 'store', // ignored
//       storage: createJSONStorage(() => createFacadeStorage({
//         toolId: 'agency-studio',
//         scope: 'user',
//       })),
//     }
//   )
// ============================================================

import type { StateStorage } from 'zustand/middleware';
import { buildKey, type StorageScope } from './index';

export interface FacadeStorageConfig {
  toolId: string;
  scope: StorageScope;
  /** Optional override key (default 'state'). */
  key?: string;
}

export function createFacadeStorage(config: FacadeStorageConfig): StateStorage {
  const keyConfig = {
    toolId: config.toolId,
    key: config.key ?? 'state',
    scope: config.scope,
  };

  return {
    getItem(_zustandName: string): string | null {
      try {
        return localStorage.getItem(buildKey(keyConfig));
      } catch {
        return null;
      }
    },
    setItem(_zustandName: string, value: string): void {
      const fullKey = buildKey(keyConfig);
      try {
        localStorage.setItem(fullKey, value);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[plugin-storage] zustand setItem fail cho ${fullKey}:`, e);
      }
    },
    removeItem(_zustandName: string): void {
      try {
        localStorage.removeItem(buildKey(keyConfig));
      } catch {
        /* ignore */
      }
    },
  };
}
