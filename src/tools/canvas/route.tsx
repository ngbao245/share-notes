import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Frame, RotateCcw, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { LoadingState, ErrorState } from '@/components/shared';

import type { Board } from './types';
import { makeDefaultBoard } from './types';
import { getCanvasRepository } from './repository';
import { useCameraStore } from './store/camera-store';
import { useObjectsStore } from './store/objects-store';
import { useSelectionStore } from './store/selection-store';
import { useInteractionStore } from './store/interaction-store';
import { useBoardStackStore } from './store/board-stack-store';
import { useSnapStore } from './store/snap-store';
import { useHistoryStore } from './engine/commands/history';
import { computeContentBounds } from './lib/content-bounds';
import { useCanvasBootstrap } from './hooks/useCanvasBootstrap';
import { useSyncStore } from './store/sync-store';
import { CanvasApp } from './components/CanvasApp';
import { Breadcrumb } from './components/Breadcrumb';
import { SnapToggle } from './components/SnapToggle';
import { MigrationDialog } from './components/MigrationDialog';
import { MigrationProgressDialog } from './components/MigrationProgressDialog';
import { MigrationIncompleteDialog } from './components/MigrationIncompleteDialog';

// ============================================================
// Canvas — Route (Phase 5a)
// ============================================================
//
// State machine từ useCanvasBootstrap:
//   auth-loading | migration-check | hydrating → LoadingState
//   migration-needed → MigrationNeededPlaceholder (Task 6 build UI thật)
//   migration-incomplete → MigrationIncompletePlaceholder (Task 7)
//   error → ErrorState
//   ready → mount CanvasApp
//
// Effect chain sau ready:
//   - Sync URL param `:boardId` → build stack + load target board objects
//   - Hydrate camera của target board
//   - Save current camera vào board cũ khi navigate
// ============================================================

export default function CanvasRoute() {
  const { boardId } = useParams<{ boardId?: string }>();
  const navigate = useNavigate();
  const bootstrap = useCanvasBootstrap();

  const resetCamera = useCameraStore((s) => s.reset);
  const fit = useCameraStore((s) => s.fit);
  const zoom = useCameraStore((s) => s.camera.zoom);
  const objectCount = useObjectsStore((s) => s.objects.size);
  const stack = useBoardStackStore((s) => s.stack);
  const currentBoard = stack[stack.length - 1] ?? null;
  // Realtime sync: refetch boards + stack khi có board patch từ tab khác.
  const boardsSyncCount = useSyncStore((s) => s.boardsSyncCount);

  const handleFit = () => {
    const surfaceEl = document.querySelector<HTMLElement>(
      '[data-canvas-surface="true"]'
    );
    if (!surfaceEl) return;
    const rect = surfaceEl.getBoundingClientRect();
    // SSOT bounds derivation: same helper mà dynamic zoom min dùng →
    // Fit target luôn khớp wheel-out clamp (không "đúp %" mismatch).
    const currentId = useBoardStackStore.getState().currentBoardId();
    const objects = useObjectsStore.getState().objects;
    const bounds = computeContentBounds(objects.values(), currentId);
    if (!bounds) {
      resetCamera();
      return;
    }
    fit(bounds, { width: rect.width, height: rect.height });
  };

  // 'F' + '0' key
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleFit();
      }
      if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        resetCamera();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate snap store từ localStorage 1 lần khi mount.
  useEffect(() => {
    useSnapStore.getState().hydrate();
  }, []);

  // Dev-only: expose stores + repository qua window
  useEffect(() => {
    if (bootstrap.state.phase !== 'ready') return;
    if (import.meta.env.DEV) {
      const w = window as unknown as {
        __canvasRepo?: unknown;
        __canvasStores?: unknown;
        __canvasBootstrap?: unknown;
      };
      w.__canvasRepo = getCanvasRepository();
      w.__canvasStores = {
        camera: useCameraStore,
        objects: useObjectsStore,
        selection: useSelectionStore,
        interaction: useInteractionStore,
        history: useHistoryStore,
        boardStack: useBoardStackStore,
      };
      w.__canvasBootstrap = bootstrap.state;
    }
  }, [bootstrap.state]);

  // Sync boardId param → boardStack + camera + objects.
  // Chỉ chạy khi bootstrap ready (rootBoard đã có).
  useEffect(() => {
    if (bootstrap.state.phase !== 'ready') return;
    const rootBoard = bootstrap.state.rootBoard;
    let cancelled = false;

    const load = async () => {
      const repo = getCanvasRepository();
      const targetId = boardId ?? rootBoard.id;

      // Save current camera vào board cũ (nếu có).
      const prevCurrent = useBoardStackStore.getState().stack.slice(-1)[0];
      if (prevCurrent) {
        const currentCamera = useCameraStore.getState().camera;
        void repo.saveCamera(prevCurrent.id, currentCamera);
      }

      // Load toàn bộ boards 1 lần. Skip separate `getBoard(targetId)`
      // vì target luôn có trong allBoards → tiết kiệm 1 HTTP round-trip.
      const allBoards = await repo.loadAllBoards();
      if (cancelled) return;
      const target = allBoards.find((b) => b.id === targetId);
      if (!target) {
        // Board không tồn tại → redirect root.
        toast.error('Board không tồn tại, quay về root');
        navigate('/canvas', { replace: true });
        return;
      }

      const boardMap = new Map(allBoards.map((b) => [b.id, b]));
      const newStack: Board[] = [];
      let cursor: Board | undefined = target;
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor.id)) {
        guard.add(cursor.id);
        newStack.unshift(cursor);
        if (cursor.parentId === null) break;
        cursor = boardMap.get(cursor.parentId);
      }
      // Đảm bảo root ở đầu (semantic parentId=null) — nếu chain không kết thúc ở root.
      if (newStack.length === 0 || newStack[0].parentId !== null) {
        const root =
          Array.from(boardMap.values()).find((b) => b.parentId === null) ??
          rootBoard ??
          makeDefaultBoard();
        newStack.unshift(root);
      }

      useBoardStackStore.getState().setStack(newStack);
      useCameraStore.getState().hydrate(target.camera);

      // Load objects của target board.
      // Root board (parentId=null) → objects có boardId=null.
      const filterId = target.parentId === null ? null : target.id;
      const objects = await repo.loadObjects(filterId);
      if (cancelled) return;
      useObjectsStore.getState().hydrate(objects);
      useSelectionStore.getState().clear();
    };

    void load();
    return () => {
      cancelled = true;
    };
    // boardsSyncCount thay đổi = có board patch từ tab khác → refetch stack + objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, bootstrap.state.phase, boardsSyncCount]);

  // --- Render branches ---

  if (bootstrap.state.phase === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <ErrorState
          message={`Không load được canvas: ${bootstrap.state.message}`}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (
    bootstrap.state.phase === 'auth-loading' ||
    bootstrap.state.phase === 'migration-check' ||
    bootstrap.state.phase === 'hydrating'
  ) {
    const label =
      bootstrap.state.phase === 'auth-loading'
        ? 'Verifying session...'
        : bootstrap.state.phase === 'migration-check'
          ? 'Checking migration status...'
          : 'Loading canvas...';
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState label={label} />
      </div>
    );
  }

  if (bootstrap.state.phase === 'migration-needed') {
    return (
      <MigrationDialog
        open
        counts={bootstrap.state.localCounts}
        onMigrate={() => void bootstrap.startMigration()}
        onSkip={() => void bootstrap.skipMigration()}
        onCancel={() => navigate('/')}
      />
    );
  }

  if (bootstrap.state.phase === 'migrating') {
    return (
      <MigrationProgressDialog
        open
        progress={bootstrap.state.progress}
        onCancel={bootstrap.cancelMigration}
      />
    );
  }

  if (bootstrap.state.phase === 'migration-incomplete') {
    return (
      <MigrationIncompleteDialog
        open
        done={bootstrap.state.status.done}
        total={bootstrap.state.status.total}
        onResume={() => void bootstrap.resumeMigration()}
        onRollback={() => void bootstrap.rollbackMigration()}
        onSkipRemainder={() => void bootstrap.skipRemainder()}
        onCancel={() => navigate('/')}
      />
    );
  }

  // phase === 'ready' — wait for stack hydrate
  if (!currentBoard) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState label="Loading board..." />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link to="/" aria-label="Về Hub">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Frame className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Canvas</h1>

        <Breadcrumb />

        <span className="ml-2 text-xs text-muted-foreground">
          {objectCount} object{objectCount === 1 ? '' : 's'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <SnapToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFit}
            className="gap-1"
            title="Fit content (F)"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetCamera}
            className="gap-1"
            title="Reset view (0)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </header>

      <CanvasApp board={currentBoard} />
    </div>
  );
}
