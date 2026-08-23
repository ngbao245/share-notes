// ============================================================
// Canvas — Sync store (Phase 5a Task 8)
// ============================================================
//
// Track realtime channel state + poll fallback + sync counters.
// Consumer subscribe qua Zustand selector — VD Breadcrumb refetch
// khi boardsSyncCount tăng, route.tsx refetch allBoards.
//
// Không persist — reset khi remount CanvasApp.
// ============================================================

import { create } from 'zustand';

import type { RealtimeChannelStatus } from '../repository/types';

interface SyncState {
  /** Realtime WS channel status. 'idle' = chưa mount. */
  channelState: 'idle' | RealtimeChannelStatus;

  /** True = poll fallback đang active (realtime disconnect > 30s). */
  pollActive: boolean;

  /** ISO timestamp của patch cuối nhận được. */
  lastSync: string | null;

  /** Tăng mỗi lần có object patch — consumer effect deps để force refresh. */
  objectsSyncCount: number;

  /** Tăng mỗi lần có board patch. */
  boardsSyncCount: number;

  /** Số task đang chờ trong optimistic queue (Phase 5a Task 9). */
  queueLength: number;

  // --- Setters ---
  setChannelState: (state: 'idle' | RealtimeChannelStatus) => void;
  setPollActive: (active: boolean) => void;
  markSync: (iso: string) => void;
  incrementObjectsSync: () => void;
  incrementBoardsSync: () => void;
  setQueueLength: (n: number) => void;
  reset: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  channelState: 'idle',
  pollActive: false,
  lastSync: null,
  objectsSyncCount: 0,
  boardsSyncCount: 0,
  queueLength: 0,

  setChannelState: (channelState) => set({ channelState }),
  setPollActive: (pollActive) => set({ pollActive }),
  markSync: (iso) => set({ lastSync: iso }),
  incrementObjectsSync: () =>
    set((s) => ({ objectsSyncCount: s.objectsSyncCount + 1 })),
  incrementBoardsSync: () =>
    set((s) => ({ boardsSyncCount: s.boardsSyncCount + 1 })),
  setQueueLength: (queueLength) => set({ queueLength }),
  reset: () =>
    set({
      channelState: 'idle',
      pollActive: false,
      lastSync: null,
      objectsSyncCount: 0,
      boardsSyncCount: 0,
      queueLength: 0,
    }),
}));
