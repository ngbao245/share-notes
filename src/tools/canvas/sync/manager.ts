// ============================================================
// Canvas — SyncManager (Phase 5a Task 8)
// ============================================================
//
// Bridge SupabaseCanvasRepository realtime/loadDelta ↔ Zustand stores.
// Wire vào CanvasApp qua useRealtimeChannel hook (chỉ mount remote mode).
//
// Behavior:
//   - Subscribe realtime channel per-user
//   - Apply patches vào useObjectsStore với LWW filter (skip nếu local
//     updated_at >= remote's)
//   - Board patches: increment boardsSyncCount → route.tsx effect refetch
//   - Channel disconnect > 30s → start poll (15s interval, loadDelta since
//     lastSync)
//   - Reconnect → stop poll + full resync (loadDelta all-time since lastSync)
// ============================================================

import type { CanvasObject, Board } from '../types';
import type {
  CanvasRepository,
  RealtimeChannelStatus,
  SyncEvent,
  SyncUnsubscribe,
} from '../repository/types';
import { useObjectsStore } from '../store/objects-store';
import { useSyncStore } from '../store/sync-store';

const DISCONNECT_THRESHOLD_MS = 30_000;
const POLL_INTERVAL_MS = 15_000;

export class SyncManager {
  private repo: CanvasRepository;
  private unsubRealtime?: SyncUnsubscribe;
  private pollTimer: number | null = null;
  private disconnectSince: number | null = null;
  private disconnectCheckTimer: number | null = null;
  private lastSyncTime: Date = new Date(0);
  private running = false;

  constructor(repo: CanvasRepository) {
    this.repo = repo;
  }

  /** Start subscription. No-op nếu repo không support subscribeChanges. */
  start(): void {
    if (this.running) return;
    if (!this.repo.subscribeChanges || !this.repo.loadDelta) {
      // Local mode — no realtime
      return;
    }
    this.running = true;

    useSyncStore.getState().setChannelState('idle');

    this.unsubRealtime = this.repo.subscribeChanges(
      (event) => this.handleEvent(event),
      (status) => this.handleStateChange(status),
    );

    // Watchdog: check disconnect duration mỗi 5s
    this.disconnectCheckTimer = window.setInterval(() => {
      this.checkDisconnect();
    }, 5_000);
  }

  /** Stop subscription + poll + timers. */
  stop(): void {
    this.running = false;
    this.unsubRealtime?.();
    this.unsubRealtime = undefined;
    this.stopPoll();
    if (this.disconnectCheckTimer !== null) {
      window.clearInterval(this.disconnectCheckTimer);
      this.disconnectCheckTimer = null;
    }
    useSyncStore.getState().reset();
  }

  // ==========================================================
  // Event handling
  // ==========================================================

  private handleEvent(event: SyncEvent): void {
    // LWW filter — chỉ apply nếu remote newer than local.
    if (event.table === 'objects') {
      this.applyObjectEvent(event);
      useSyncStore.getState().incrementObjectsSync();
    } else if (event.table === 'boards') {
      // Boards store consumer sẽ refetch qua route effect deps trên boardsSyncCount
      useSyncStore.getState().incrementBoardsSync();
    }

    // Update lastSync timestamp (max của new.updatedAt hoặc now)
    const newRow = event.new as CanvasObject | Board | null;
    const eventTime = newRow?.updatedAt ? new Date(newRow.updatedAt) : new Date();
    if (eventTime > this.lastSyncTime) {
      this.lastSyncTime = eventTime;
    }
    useSyncStore.getState().markSync(this.lastSyncTime.toISOString());
  }

  private applyObjectEvent(event: SyncEvent): void {
    const store = useObjectsStore.getState();

    if (event.kind === 'DELETE') {
      const id = (event.new as CanvasObject | null)?.id
        ?? (event.old as CanvasObject | null)?.id;
      if (id) store.remove(id);
      return;
    }

    // INSERT / UPDATE
    const newObj = event.new as CanvasObject | null;
    if (!newObj) return;

    // LWW: skip nếu local newer hoặc same
    const local = store.get(newObj.id);
    if (local) {
      const localTime = new Date(local.updatedAt).getTime();
      const remoteTime = new Date(newObj.updatedAt).getTime();
      if (localTime >= remoteTime) {
        return; // local is newer, skip stale remote patch
      }
    }
    store.upsert(newObj);
  }

  // ==========================================================
  // Channel state → poll fallback
  // ==========================================================

  private handleStateChange(status: RealtimeChannelStatus): void {
    useSyncStore.getState().setChannelState(status);

    if (status === 'SUBSCRIBED') {
      // Reconnect → clear disconnect timer + full resync + stop poll
      this.disconnectSince = null;
      this.stopPoll();
      void this.fullResync();
    } else if (
      status === 'CHANNEL_ERROR' ||
      status === 'TIMED_OUT' ||
      status === 'CLOSED'
    ) {
      // Disconnect → start tracking. checkDisconnect() sẽ trigger poll sau
      // threshold (không start ngay để tránh flap channel).
      if (this.disconnectSince === null) {
        this.disconnectSince = Date.now();
      }
    }
  }

  private checkDisconnect(): void {
    if (this.disconnectSince === null || this.pollTimer !== null) return;
    if (Date.now() - this.disconnectSince >= DISCONNECT_THRESHOLD_MS) {
      this.startPoll();
    }
  }

  private startPoll(): void {
    if (this.pollTimer !== null) return;
    useSyncStore.getState().setPollActive(true);
    // Poll ngay 1 lần, rồi interval
    void this.pollDelta();
    this.pollTimer = window.setInterval(() => {
      void this.pollDelta();
    }, POLL_INTERVAL_MS);
  }

  private stopPoll(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    useSyncStore.getState().setPollActive(false);
  }

  private async pollDelta(): Promise<void> {
    if (!this.repo.loadDelta) return;
    try {
      const delta = await this.repo.loadDelta(this.lastSyncTime);
      this.applyDelta(delta.objects, delta.boards);
    } catch (err) {
      console.warn('[Canvas SyncManager] poll delta failed', err);
    }
  }

  private async fullResync(): Promise<void> {
    if (!this.repo.loadDelta) return;
    try {
      // Fetch từ lastSync để không mất patch trong gap disconnect
      const delta = await this.repo.loadDelta(this.lastSyncTime);
      this.applyDelta(delta.objects, delta.boards);
    } catch (err) {
      console.warn('[Canvas SyncManager] full resync failed', err);
    }
  }

  private applyDelta(objects: CanvasObject[], boards: Board[]): void {
    const store = useObjectsStore.getState();
    let latestTime = this.lastSyncTime;

    for (const obj of objects) {
      // LWW check
      const local = store.get(obj.id);
      if (local) {
        const localTime = new Date(local.updatedAt).getTime();
        const remoteTime = new Date(obj.updatedAt).getTime();
        if (localTime >= remoteTime) continue;
      }
      store.upsert(obj);
      const t = new Date(obj.updatedAt);
      if (t > latestTime) latestTime = t;
    }

    if (objects.length > 0) {
      useSyncStore.getState().incrementObjectsSync();
    }

    if (boards.length > 0) {
      useSyncStore.getState().incrementBoardsSync();
      for (const b of boards) {
        const t = new Date(b.updatedAt);
        if (t > latestTime) latestTime = t;
      }
    }

    this.lastSyncTime = latestTime;
    useSyncStore.getState().markSync(latestTime.toISOString());
  }
}
