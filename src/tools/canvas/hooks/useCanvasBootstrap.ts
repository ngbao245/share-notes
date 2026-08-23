// ============================================================
// useCanvasBootstrap — Canvas bootstrap state machine (Phase 5a Task 5-6)
// ============================================================
//
// State machine 8 phase:
//   auth-loading → migration-check → migration-needed → migrating → hydrating → ready
//                                  → migration-incomplete
//                                  → error
//
// Local mode: skip migration branches, đi thẳng hydrating → ready.
// Remote mode: check auth + migration status → có thể pause để user quyết định.
//
// Task 5: state machine + placeholder dispatchers
// Task 6: runMigration dispatcher + progress tracking wire
// Task 7: rollbackMigration real (hiện gọi rollbackMigration từ service)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/ui/sonner';

import type { Board } from '../types';
import { makeDefaultBoard } from '../types';
import { getCanvasRepository, isCanvasRemoteMode } from '../repository';
import {
  countLocalCanvasData,
  hasLocalData,
  type LocalCanvasCounts,
} from '../migration/detect-local';
import {
  runMigration,
  rollbackMigration as rollbackMigrationService,
  type MigrationProgress,
} from '../migration/service';
import {
  getCanvasMigrationStatus,
  setCanvasMigrationStatus,
  type CanvasMigrationInProgress,
} from '@/api/canvas';

// --- State machine ---

export type CanvasBootstrapState =
  | { phase: 'auth-loading' }
  | { phase: 'migration-check' }
  | { phase: 'migration-needed'; localCounts: LocalCanvasCounts }
  | { phase: 'migrating'; progress: MigrationProgress | null }
  | { phase: 'migration-incomplete'; status: CanvasMigrationInProgress }
  | { phase: 'hydrating' }
  | { phase: 'ready'; rootBoard: Board }
  | { phase: 'error'; message: string };

async function ensureRootBoard(): Promise<Board> {
  const repo = getCanvasRepository();
  let board = await repo.loadRootBoard();
  if (!board) {
    board = makeDefaultBoard();
    await repo.createBoard(board);
  }
  return board;
}

export interface UseCanvasBootstrapResult {
  state: CanvasBootstrapState;
  skipMigration: () => Promise<void>;
  startMigration: () => Promise<void>;
  cancelMigration: () => void;
  resumeMigration: () => Promise<void>;
  rollbackMigration: () => Promise<void>;
  skipRemainder: () => Promise<void>;
}

export function useCanvasBootstrap(): UseCanvasBootstrapResult {
  const [state, setState] = useState<CanvasBootstrapState>({
    phase: 'auth-loading',
  });

  const initializing = useAuthStore((s) => s.initializing);
  const session = useAuthStore((s) => s.session);
  const userId = session?.user?.id ?? null;
  const remoteMode = isCanvasRemoteMode();

  // Cancel token cho migration đang chạy — mutable ref để cancelMigration dispatch được.
  const cancelTokenRef = useRef<{ canceled: boolean }>({ canceled: false });

  // Nạp bootstrap lần đầu + khi user thay đổi
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        if (remoteMode && initializing) {
          setState({ phase: 'auth-loading' });
          return;
        }
        if (remoteMode && !userId) {
          setState({
            phase: 'error',
            message: 'Canvas remote mode requires authentication.',
          });
          return;
        }

        // Local mode: skip migration branches
        if (!remoteMode) {
          setState({ phase: 'hydrating' });
          const rootBoard = await ensureRootBoard();
          if (cancelled) return;
          setState({ phase: 'ready', rootBoard });
          return;
        }

        // Remote mode: check migration status
        setState({ phase: 'migration-check' });
        const status = await getCanvasMigrationStatus();
        if (cancelled) return;

        if (status === null) {
          const counts = await countLocalCanvasData();
          if (cancelled) return;
          if (hasLocalData(counts)) {
            setState({ phase: 'migration-needed', localCounts: counts });
            return;
          }
          // No local data → auto-skip
          await setCanvasMigrationStatus({
            status: 'skipped',
            skippedAt: new Date().toISOString(),
          });
          if (cancelled) return;
          setState({ phase: 'hydrating' });
          const rootBoard = await ensureRootBoard();
          if (cancelled) return;
          setState({ phase: 'ready', rootBoard });
          return;
        }

        if (status.status === 'in_progress') {
          setState({ phase: 'migration-incomplete', status });
          return;
        }

        // completed | skipped → proceed
        setState({ phase: 'hydrating' });
        const rootBoard = await ensureRootBoard();
        if (cancelled) return;
        setState({ phase: 'ready', rootBoard });
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteMode, initializing, userId]);

  // --- Dispatchers ---

  const skipMigration = useCallback(async () => {
    try {
      await setCanvasMigrationStatus({
        status: 'skipped',
        skippedAt: new Date().toISOString(),
      });
      setState({ phase: 'hydrating' });
      const rootBoard = await ensureRootBoard();
      setState({ phase: 'ready', rootBoard });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const skipRemainder = useCallback(async () => {
    try {
      await setCanvasMigrationStatus({
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      setState({ phase: 'hydrating' });
      const rootBoard = await ensureRootBoard();
      setState({ phase: 'ready', rootBoard });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const startMigration = useCallback(async () => {
    cancelTokenRef.current = { canceled: false };
    setState({ phase: 'migrating', progress: null });

    try {
      const result = await runMigration({
        cancelToken: cancelTokenRef.current,
        onProgress: (progress) => {
          setState({ phase: 'migrating', progress });
        },
      });

      if (result.status === 'completed') {
        toast.success(
          `Migration done: ${result.totalObjects} object, ${result.totalBoards} board, ${result.totalBlobs} image.`,
        );
        setState({ phase: 'hydrating' });
        const rootBoard = await ensureRootBoard();
        setState({ phase: 'ready', rootBoard });
      } else if (result.status === 'canceled') {
        toast.info('Migration canceled.');
        // Reload state → sẽ hiện migration-incomplete
        const status = await getCanvasMigrationStatus();
        if (status?.status === 'in_progress') {
          setState({ phase: 'migration-incomplete', status });
        } else {
          setState({ phase: 'error', message: 'Migration state inconsistent' });
        }
      } else {
        // failed
        toast.error(`Migration failed: ${result.error}`);
        const status = await getCanvasMigrationStatus();
        if (status?.status === 'in_progress') {
          setState({ phase: 'migration-incomplete', status });
        } else {
          setState({
            phase: 'error',
            message: `Migration failed: ${result.error}`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Migration crashed: ${msg}`);
      setState({ phase: 'error', message: msg });
    }
  }, []);

  const cancelMigration = useCallback(() => {
    cancelTokenRef.current.canceled = true;
  }, []);

  const resumeMigration = useCallback(async () => {
    // Resume = tiếp tục runMigration, service skip items đã trong migratedIds set
    await startMigration();
  }, [startMigration]);

  const rollbackMigration = useCallback(async () => {
    try {
      setState({ phase: 'migrating', progress: null });
      toast.info('Rolling back migration...');
      await rollbackMigrationService();
      toast.success('Rollback complete. Local data preserved.');

      // Reload → sẽ hiện lại migration-needed (nếu có local data) hoặc auto-skip
      setState({ phase: 'migration-check' });
      const counts = await countLocalCanvasData();
      if (hasLocalData(counts)) {
        setState({ phase: 'migration-needed', localCounts: counts });
      } else {
        await setCanvasMigrationStatus({
          status: 'skipped',
          skippedAt: new Date().toISOString(),
        });
        setState({ phase: 'hydrating' });
        const rootBoard = await ensureRootBoard();
        setState({ phase: 'ready', rootBoard });
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return {
    state,
    skipMigration,
    startMigration,
    cancelMigration,
    resumeMigration,
    rollbackMigration,
    skipRemainder,
  };
}
