import { useCallback, useEffect, useRef, useState } from 'react';

import { releaseAll as releaseAllBlobUrls } from '../lib/blob-url-cache';

import type { Board, CanvasObject } from '../types';
import { useCameraStore } from '../store/camera-store';
import { useObjectsStore } from '../store/objects-store';
import { useSelectionStore } from '../store/selection-store';
import { useInteractionStore } from '../store/interaction-store';
import { useBoardStackStore } from '../store/board-stack-store';
import { useCanvasHotkeys } from '../hooks/useCanvasHotkeys';
import { useCanvasPaste } from '../hooks/useCanvasPaste';
import { useCanvasDrop } from '../hooks/useCanvasDrop';
import { useRealtimeChannel } from '../hooks/useRealtimeChannel';
import { useHistoryStore } from '../engine/commands/history';
import { createCommand } from '../engine/commands/create';
import { deleteCommand } from '../engine/commands/delete';
import { getAllObjectTypes } from '../hooks/useObjectRegistry';
import { screenToCanvas } from '../engine/coords';
import { createImageFromBlob } from '../lib/image-create';
import { getCanvasRepository } from '../repository';

import { CanvasSurface } from './CanvasSurface';
import { ObjectLayer } from './ObjectLayer';
import { MarqueeOverlay } from './MarqueeOverlay';
import { SelectionOverlay } from './SelectionOverlay';
import { AlignmentGuideOverlay } from './AlignmentGuideOverlay';
import {
  CanvasContextMenu,
  CanvasContextMenuItem,
} from './CanvasContextMenu';
import { AddLinkDialog } from './AddLinkDialog';
import { MoveToBoardDialog } from './MoveToBoardDialog';
import { collectBoardCascade } from '../lib/board-cascade';
import { updateCommand } from '../engine/commands/update';

// ============================================================
// CanvasApp — Orchestrator: overlays + hotkeys + context menu
// ============================================================

interface CanvasAppProps {
  board: Board;
}

interface ContextMenuState {
  open: boolean;
  screenX: number;
  screenY: number;
  targetObjectId: string | null;
}

export function CanvasApp(_props: CanvasAppProps) {
  useCanvasHotkeys();
  useCanvasPaste();
  useCanvasDrop();
  useRealtimeChannel();

  useEffect(() => {
    return () => {
      releaseAllBlobUrls();
    };
  }, []);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    screenX: 0,
    screenY: 0,
    targetObjectId: null,
  });
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [moveToOpen, setMoveToOpen] = useState(false);

  // Vị trí canvas-space đã lưu cho Add link dialog (context menu đóng
  // trước khi dialog mở → cần cache).
  const pendingCanvasPosRef = useRef<{ x: number; y: number } | null>(null);
  const imageMenuInputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const objectEl = target.closest<HTMLElement>('[data-canvas-object-id]');
    setContextMenu({
      open: true,
      screenX: e.clientX,
      screenY: e.clientY,
      targetObjectId: objectEl?.dataset.canvasObjectId ?? null,
    });
  }, []);

  const closeMenu = () => setContextMenu((s) => ({ ...s, open: false }));

  const getCanvasPosFromMenu = (): { x: number; y: number } | null => {
    const surface = document.querySelector<HTMLElement>(
      '[data-canvas-surface="true"]'
    );
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const camera = useCameraStore.getState().camera;
    return screenToCanvas(
      {
        x: contextMenu.screenX - rect.left,
        y: contextMenu.screenY - rect.top,
      },
      camera
    );
  };

  const buildBaseObject = (
    type: string,
    canvasPos: { x: number; y: number },
    defaultGeometry: { width: number; height: number; rotation: number; zIndex: number },
    defaultData: unknown
  ): CanvasObject => {
    const now = new Date().toISOString();
    const currentBoardId = useBoardStackStore.getState().currentBoardId();
    return {
      id: crypto.randomUUID(),
      type,
      boardId: currentBoardId,
      geometry: {
        ...defaultGeometry,
        x: canvasPos.x - defaultGeometry.width / 2,
        y: canvasPos.y - defaultGeometry.height / 2,
      },
      data: defaultData,
      createdAt: now,
      updatedAt: now,
    };
  };

  const handleAddText = (canvasPos: { x: number; y: number }) => {
    const def = getAllObjectTypes().find((t) => t.type === 'text');
    if (!def) return;
    const obj = buildBaseObject('text', canvasPos, def.defaultGeometry, def.defaultData);
    useHistoryStore.getState().push(createCommand(obj));
    useSelectionStore.getState().select(obj.id);
    // Auto-enter edit — user thường tạo text để gõ ngay.
    useInteractionStore.getState().enterEdit(obj.id);
  };

  const handleAddNote = (canvasPos: { x: number; y: number }) => {
    const def = getAllObjectTypes().find((t) => t.type === 'note');
    if (!def) return;
    const obj = buildBaseObject('note', canvasPos, def.defaultGeometry, def.defaultData);
    useHistoryStore.getState().push(createCommand(obj));
    useSelectionStore.getState().select(obj.id);
    useInteractionStore.getState().enterEdit(obj.id);
  };

  const handleAddImage = () => {
    imageMenuInputRef.current?.click();
  };

  const handleImageFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const pos = pendingCanvasPosRef.current;
    if (!pos) return;
    await createImageFromBlob({ blob: file, canvasX: pos.x, canvasY: pos.y });
  };

  const handleAddLink = () => {
    // Save canvas pos, mở dialog. Menu đã đóng.
    const pos = getCanvasPosFromMenu();
    if (!pos) return;
    pendingCanvasPosRef.current = pos;
    setAddLinkOpen(true);
  };

  const handleLinkSubmit = (url: string) => {
    const pos = pendingCanvasPosRef.current;
    if (!pos) return;
    const def = getAllObjectTypes().find((t) => t.type === 'link');
    if (!def) return;
    const obj = buildBaseObject('link', pos, def.defaultGeometry, {
      ...(def.defaultData as Record<string, unknown>),
      url,
      fetchStatus: 'pending',
    });
    useHistoryStore.getState().push(createCommand(obj));
    useSelectionStore.getState().select(obj.id);
    setAddLinkOpen(false);
    pendingCanvasPosRef.current = null;
  };

  const handleAddObject = (type: string) => {
    const pos = getCanvasPosFromMenu();
    if (!pos) return closeMenu();
    closeMenu();

    switch (type) {
      case 'text':
        handleAddText(pos);
        break;
      case 'note':
        handleAddNote(pos);
        break;
      case 'image':
        pendingCanvasPosRef.current = pos;
        handleAddImage();
        break;
      case 'link':
        pendingCanvasPosRef.current = pos;
        handleAddLink();
        break;
      case 'board': {
        // Board object đặc biệt: cần tạo Board record đồng thời với object.
        // Board.id === CanvasObject.id để enter board dựa trên object id.
        const def = getAllObjectTypes().find((t) => t.type === 'board');
        if (!def) return;
        const obj = buildBaseObject('board', pos, def.defaultGeometry, def.defaultData);
        const now = new Date().toISOString();
        // parentId của board mới = board hiện tại (default = 'default' cho root).
        const parentBoardId = useBoardStackStore.getState().current()?.id ?? 'default';
        void getCanvasRepository().createBoard({
          id: obj.id,
          name: (obj.data as { name: string }).name,
          parentId: parentBoardId,
          camera: { x: 0, y: 0, zoom: 1 },
          createdAt: now,
          updatedAt: now,
        });
        useHistoryStore.getState().push(createCommand(obj));
        useSelectionStore.getState().select(obj.id);
        useInteractionStore.getState().enterEdit(obj.id);
        break;
      }
      case 'rect':
      default: {
        const def = getAllObjectTypes().find((t) => t.type === type);
        if (!def) return;
        const obj = buildBaseObject(type, pos, def.defaultGeometry, def.defaultData);
        useHistoryStore.getState().push(createCommand(obj));
        useSelectionStore.getState().select(obj.id);
        break;
      }
    }
  };

  const handleDeleteObject = async (id: string) => {
    const obj = useObjectsStore.getState().get(id);
    if (!obj) return;
    closeMenu();

    let objectsToDelete = [obj];
    let boardsToDelete: import('../types').Board[] = [];

    if (obj.type === 'board') {
      // OPTIMISTIC: ẩn board object ngay để UI responsive. Cascade
      // collection await 300-900ms HTTP background. Xem note ở
      // useCanvasHotkeys performDelete để hiểu trade-off undo edge case.
      useObjectsStore.getState().batchRemove([obj.id]);
      useSelectionStore.getState().clear();

      const cascade = await collectBoardCascade(obj.id);
      objectsToDelete = cascade.objects;
      boardsToDelete = cascade.boards;
    }

    useHistoryStore.getState().push(
      deleteCommand(objectsToDelete, boardsToDelete)
    );
  };

  const handleMoveToBoard = (targetBoardId: string | null) => {
    const sel = useSelectionStore.getState();
    const objectsStore = useObjectsStore.getState();
    const patches: Array<{ id: string; from: { boardId: string | null }; to: { boardId: string | null } }> = [];
    sel.selectedIds.forEach((id) => {
      const obj = objectsStore.get(id);
      if (!obj) return;
      if (obj.type === 'board') return; // Board không move (Phase 4A rule)
      patches.push({
        id,
        from: { boardId: obj.boardId },
        to: { boardId: targetBoardId },
      });
    });
    if (patches.length === 0) {
      setMoveToOpen(false);
      return;
    }
    for (const p of patches) {
      useHistoryStore.getState().push(
        updateCommand(
          p.id,
          p.from as unknown as Record<string, unknown>,
          p.to as unknown as Record<string, unknown>
        )
      );
    }
    useSelectionStore.getState().clear();
    setMoveToOpen(false);
  };

  // Filter register types: prod build ẩn 'rect' debug + luôn ẩn 'group'
  // (tạo qua Ctrl+G, không qua context menu).
  const availableTypes = getAllObjectTypes().filter((def) => {
    if (def.type === 'rect') return import.meta.env.DEV;
    if (def.type === 'group') return false;
    return true;
  });

  return (
    <>
      <div className="flex flex-1 flex-col" onContextMenu={handleContextMenu}>
        <CanvasSurface>
          <ObjectLayer />
        </CanvasSurface>
      </div>

      <MarqueeOverlay />
      <SelectionOverlay />
      <AlignmentGuideOverlay />

      <CanvasContextMenu
        open={contextMenu.open}
        x={contextMenu.screenX}
        y={contextMenu.screenY}
        onClose={closeMenu}
      >
        {contextMenu.targetObjectId ? (
          <>
            {(() => {
              const obj = useObjectsStore
                .getState()
                .get(contextMenu.targetObjectId);
              const isBoard = obj?.type === 'board';
              return (
                <>
                  {!isBoard && (
                    <CanvasContextMenuItem
                      onClick={() => {
                        // Ensure target object selected khi trigger move.
                        const sel = useSelectionStore.getState();
                        if (!sel.has(contextMenu.targetObjectId!)) {
                          sel.select(contextMenu.targetObjectId!);
                        }
                        closeMenu();
                        setMoveToOpen(true);
                      }}
                    >
                      Move to board...
                    </CanvasContextMenuItem>
                  )}
                  <CanvasContextMenuItem
                    destructive
                    onClick={() => handleDeleteObject(contextMenu.targetObjectId!)}
                  >
                    Delete
                  </CanvasContextMenuItem>
                </>
              );
            })()}
          </>
        ) : (
          availableTypes.map((def) => (
            <CanvasContextMenuItem
              key={def.type}
              onClick={() => handleAddObject(def.type)}
            >
              {def.label}
            </CanvasContextMenuItem>
          ))
        )}
      </CanvasContextMenu>

      <AddLinkDialog
        open={addLinkOpen}
        onSubmit={handleLinkSubmit}
        onClose={() => {
          setAddLinkOpen(false);
          pendingCanvasPosRef.current = null;
        }}
      />

      <input
        ref={imageMenuInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handleImageFilePick}
        className="hidden"
      />

      <MoveToBoardDialog
        open={moveToOpen}
        movingObjectIds={Array.from(useSelectionStore.getState().selectedIds)}
        onSubmit={handleMoveToBoard}
        onClose={() => setMoveToOpen(false)}
      />

    </>
  );
}


