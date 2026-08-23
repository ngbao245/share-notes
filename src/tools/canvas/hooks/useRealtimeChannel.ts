// ============================================================
// useRealtimeChannel — Mount SyncManager (Phase 5a Task 8)
// ============================================================
//
// Mount SyncManager cho current repository trong lifecycle của CanvasApp.
// - Local mode: no-op (SyncManager.start() sẽ skip khi không có subscribeChanges).
// - Remote mode: subscribe realtime + poll fallback.
//
// Cleanup on unmount: stop manager, unsub channel, clear timers.
// ============================================================

import { useEffect } from 'react';

import { getCanvasRepository } from '../repository';
import { SyncManager } from '../sync/manager';

export function useRealtimeChannel(): void {
  useEffect(() => {
    const repo = getCanvasRepository();
    const manager = new SyncManager(repo);
    manager.start();

    return () => {
      manager.stop();
    };
  }, []);
}
