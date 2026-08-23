// ============================================================
// Canvas — Repository singleton + bootstrap util
// ============================================================
//
// Singleton pattern: 1 IndexedDBRepository / app lifecycle. Không tạo
// multiple connection. Bootstrap util wrap: load default board + all
// objects, tạo board mới nếu chưa có.
// ============================================================

import { useAuthStore } from '@/stores/authStore';
import { makeDefaultBoard } from '../types';
import { IndexedDBRepository } from './indexed-db';
import { SupabaseCanvasRepository } from './supabase';
import type { CanvasRepository, CanvasBootstrapData } from './types';

// --- Feature flag ---
// Build-time. Đổi flag → rebuild + reload app.
// - false (default): IndexedDB local repository (P1-4B behavior)
// - true: SupabaseCanvasRepository qua workspace-proxy (P5a remote)
const REMOTE_MODE =
  (import.meta.env.VITE_CANVAS_REMOTE as string | undefined) === 'true';

export function isCanvasRemoteMode(): boolean {
  return REMOTE_MODE;
}

// --- Singleton state ---
let instance: CanvasRepository | null = null;
/** Track userId đang instance để invalidate khi session change (remote mode). */
let instanceUserId: string | null = null;

/**
 * Lấy singleton repository. Chọn implementation dựa vào VITE_CANVAS_REMOTE.
 *
 * Remote mode:
 *   - Require authenticated session (AuthGuard đảm bảo đã login trước khi
 *     canvas route mount). Nếu somehow gọi khi no session → throw.
 *   - Cache per userId. Session change → subscriber phía dưới invalidate.
 *
 * Local mode:
 *   - Cache instance đơn giản, không depend auth.
 */
export function getCanvasRepository(): CanvasRepository {
  if (REMOTE_MODE) {
    const userId = useAuthStore.getState().session?.user?.id ?? null;
    if (!userId) {
      throw new Error(
        'Canvas remote mode requires authenticated user (VITE_CANVAS_REMOTE=true). ' +
          'AuthGuard should prevent this.',
      );
    }
    if (instance && instanceUserId === userId) return instance;
    instance?.close?.();
    instance = new SupabaseCanvasRepository(userId);
    instanceUserId = userId;
    return instance;
  }

  // Local mode
  if (instance && instanceUserId === null) return instance;
  instance?.close?.();
  instance = new IndexedDBRepository();
  instanceUserId = null;
  return instance;
}

// --- Auth subscriber (remote mode only): reset instance khi session change ---
// Session logout / user switch → next getCanvasRepository() sẽ tạo instance mới
// hoặc throw (nếu unauth). Guard component sẽ unmount canvas trước khi throw.
if (REMOTE_MODE) {
  let prevUserId = useAuthStore.getState().session?.user?.id ?? null;
  useAuthStore.subscribe((state) => {
    const nextUserId = state.session?.user?.id ?? null;
    if (nextUserId === prevUserId) return;
    prevUserId = nextUserId;
    instance?.close?.();
    instance = null;
    instanceUserId = null;
  });
}

/**
 * Test-only: reset instance. Không dùng trong production code path.
 */
export function __resetCanvasRepository() {
  instance?.close?.();
  instance = null;
  instanceUserId = null;
}

/**
 * Load initial data cho default board. Tạo board mới nếu chưa tồn tại.
 * Stores (camera, objects) consume kết quả này khi mount route.
 */
export async function bootstrapCanvasData(): Promise<CanvasBootstrapData> {
  const repo = getCanvasRepository();

  // Semantic lookup theo parentId=null thay vì fixed id constant — tương thích
  // cả IndexedDB legacy ('default') và Supabase UUID fresh install.
  let board = await repo.loadRootBoard();
  if (!board) {
    board = makeDefaultBoard();
    await repo.createBoard(board);
  }

  // Root board: objects có boardId=null.
  const objects = await repo.loadObjects(null);

  return { board, objects };
}

export type { CanvasRepository, CanvasBootstrapData } from './types';
