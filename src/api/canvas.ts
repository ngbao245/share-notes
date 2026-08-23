// ============================================================
// Canvas — Migration status API (Phase 5a Task 5)
// ============================================================
//
// Lưu ở localStorage per-user (key = `canvas-migration-status-{userId}`)
// thay vì Supabase app_settings vì:
//   1. app_settings không có user_id column — chỉ global key-value → không
//      cách per-user với 1 key duy nhất.
//   2. app_settings RLS policy hiện tại chặn write từ non-admin user.
//   3. Cross-device inconsistency chấp nhận được:
//      - Máy không có local data → auto-skip, không cần cross-device state
//      - Máy có local data → hiện dialog, user chọn Migrate/Skip là quyết
//        định per-machine (mỗi máy migrate 1 lần)
//
// State machine:
//   null         → chưa từng migrate (fresh user hoặc chưa touch canvas remote)
//   in_progress  → đang chạy (session đóng giữa chừng, cần resume/rollback)
//   completed    → done, canvas remote sẵn sàng
//   skipped      → user chọn skip (fresh start, IndexedDB local giữ nguyên)
// ============================================================

import { useAuthStore } from '@/stores/authStore';

const KEY_PREFIX = 'canvas-migration-status';

export type CanvasMigrationInProgress = {
  status: 'in_progress';
  done: number;
  total: number;
  updatedAt: string;
};

export type CanvasMigrationStatus =
  | null
  | CanvasMigrationInProgress
  | { status: 'completed'; completedAt: string }
  | { status: 'skipped'; skippedAt: string };

function storageKey(userId: string | null): string {
  return userId ? `${KEY_PREFIX}-${userId}` : KEY_PREFIX;
}

function getCurrentUserId(): string | null {
  return useAuthStore.getState().session?.user?.id ?? null;
}

export async function getCanvasMigrationStatus(): Promise<CanvasMigrationStatus> {
  const key = storageKey(getCurrentUserId());
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CanvasMigrationStatus;
  } catch {
    return null;
  }
}

export async function setCanvasMigrationStatus(
  status: NonNullable<CanvasMigrationStatus>,
): Promise<void> {
  const key = storageKey(getCurrentUserId());
  try {
    localStorage.setItem(key, JSON.stringify(status));
  } catch (err) {
    throw new Error(
      `setCanvasMigrationStatus: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function clearCanvasMigrationStatus(): Promise<void> {
  const key = storageKey(getCurrentUserId());
  try {
    localStorage.removeItem(key);
  } catch {
    // No-op
  }
}
