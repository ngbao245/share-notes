import { useEffect } from 'react';

import type { CanvasObject } from '../types';
import { useSelectionStore } from '../store/selection-store';
import { useObjectsStore } from '../store/objects-store';
import { useInteractionStore } from '../store/interaction-store';
import { useCameraStore } from '../store/camera-store';
import { useHistoryStore } from '../engine/commands/history';
import { deleteCommand } from '../engine/commands/delete';
import { createCommand } from '../engine/commands/create';
import { moveCommand, type MovePatch } from '../engine/commands/move';
import { getAllObjectTypes } from './useObjectRegistry';
import { screenToCanvas } from '../engine/coords';
import { geometryToRect, unionRects } from '../engine/geometry';
import { useCanvasClipboard } from '../lib/canvas-clipboard';
import { useBoardStackStore } from '../store/board-stack-store';
import { collectBoardCascade } from '../lib/board-cascade';
import { expandGroupIds } from '../lib/group-helpers';
import { groupCommand } from '../engine/commands/group';
import { ungroupCommand } from '../engine/commands/ungroup';
import { useSnapStore } from '../store/snap-store';
import { toast } from '@/components/ui/sonner';

// ============================================================
// useCanvasHotkeys — Global keyboard shortcuts cho canvas
// ============================================================
//
// Bindings:
//   Ctrl/Cmd+Z         → undo
//   Ctrl/Cmd+Shift+Z   → redo (also Ctrl+Y trên Windows)
//   Delete / Backspace → delete selection (confirm nếu > 1)
//   Escape             → clear selection + reset FSM
//
// Space hold + Escape đã handle bên trong usePointerFSM. Ở đây chỉ
// handle những phím phối hợp business logic (history + selection).
//
// Skip mọi hotkey khi focus ở input/textarea/contentEditable.
// ============================================================

export function useCanvasHotkeys() {
  const performDelete = async () => {
    const sel = useSelectionStore.getState();
    const objectsStore = useObjectsStore.getState();
    const ids = Array.from(sel.selectedIds);
    if (ids.length === 0) return;

    const objects = ids
      .map((id) => objectsStore.get(id))
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    if (objects.length === 0) return;

    // Split boards vs non-boards. Board delete cascade recursive.
    const nonBoardObjects = objects.filter((o) => o.type !== 'board');
    const boardObjects = objects.filter((o) => o.type === 'board');

    // OPTIMISTIC: Non-board case đã sync qua deleteCommand. Board case
    // cần await collectBoardCascade (loadAllBoards + loadObjects per subtree)
    // → 300-900ms HTTP. Ẩn board object khỏi store NGAY để user thấy action
    // instant, cascade collection + push deleteCommand chạy background.
    // Trade-off: nếu user Ctrl+Z trong window await, history stack chưa có
    // cmd → undo no-op → data lost. Board delete là action rare + user ít
    // undo board delete → accept trade-off cho UX responsive.
    if (boardObjects.length > 0) {
      objectsStore.batchRemove(boardObjects.map((o) => o.id));
      useSelectionStore.getState().clear();
    }

    const allObjects: CanvasObject[] = [...nonBoardObjects];
    const allBoards: import('../types').Board[] = [];
    const seenObjectIds = new Set(nonBoardObjects.map((o) => o.id));
    const seenBoardIds = new Set<string>();

    for (const boardObj of boardObjects) {
      const cascade = await collectBoardCascade(boardObj.id);
      for (const o of cascade.objects) {
        if (!seenObjectIds.has(o.id)) {
          seenObjectIds.add(o.id);
          allObjects.push(o);
        }
      }
      for (const b of cascade.boards) {
        if (!seenBoardIds.has(b.id)) {
          seenBoardIds.add(b.id);
          allBoards.push(b);
        }
      }
    }

    if (allObjects.length === 0 && allBoards.length === 0) return;

    // Atomic delete — no confirm, no toast. Undo qua Ctrl+Z.
    useHistoryStore.getState().push(deleteCommand(allObjects, allBoards));
  };

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd + '=' / '+' → zoom in center. Ctrl/Cmd + '-' → zoom out
      // center. Ctrl/Cmd + '0' → reset zoom về 100%. Chặn browser page zoom
      // default. Factor 1.25 ≈ Milanote step. Anchor giữa viewport.
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        useCameraStore.getState().zoomAtCenter(1.25);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        useCameraStore.getState().zoomAtCenter(1 / 1.25);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        useCameraStore.getState().reset();
        return;
      }

      // Ctrl/Cmd+G — Group selection (Phase 4B).
      if (mod && e.key.toLowerCase() === 'g' && !e.shiftKey) {
        e.preventDefault();
        const sel = useSelectionStore.getState();
        const ids = Array.from(sel.selectedIds);
        if (ids.length < 2) {
          toast.info('Chọn ≥ 2 object để group');
          return;
        }
        const objectsStore = useObjectsStore.getState();
        const objs = ids
          .map((id) => objectsStore.get(id))
          .filter((o): o is NonNullable<typeof o> => !!o);
        if (objs.length < 2) return;
        const firstBoardId = objs[0].boardId;
        if (objs.some((o) => o.boardId !== firstBoardId)) {
          toast.error('Không group được object khác board');
          return;
        }
        useHistoryStore.getState().push(groupCommand(ids));
        return;
      }

      // Ctrl/Cmd+Shift+G — Ungroup (Phase 4B).
      if (mod && e.key.toLowerCase() === 'g' && e.shiftKey) {
        e.preventDefault();
        const sel = useSelectionStore.getState();
        if (sel.size() !== 1) return;
        const id = Array.from(sel.selectedIds)[0];
        const obj = useObjectsStore.getState().get(id);
        if (!obj || obj.type !== 'group') return;
        useHistoryStore.getState().push(ungroupCommand(id));
        return;
      }

      // Ctrl/Cmd+; — Toggle snap-to-grid (Phase 4B).
      if (mod && e.key === ';' && !e.shiftKey) {
        e.preventDefault();
        useSnapStore.getState().toggle();
        return;
      }

      // Duplicate (Ctrl+D) — tạo copies offset +20/+20 select mới.
      if (mod && e.key.toLowerCase() === 'd' && !e.shiftKey) {
        const sel = useSelectionStore.getState();
        if (sel.size() === 0) return;
        e.preventDefault();
        const objectsStore = useObjectsStore.getState();
        const objs: CanvasObject[] = [];
        sel.selectedIds.forEach((id) => {
          const o = objectsStore.get(id);
          if (o) objs.push(o);
        });
        if (objs.length === 0) return;
        const now = new Date().toISOString();
        const dupes = objs.map((src) => ({
          ...src,
          id: crypto.randomUUID(),
          geometry: {
            ...src.geometry,
            x: src.geometry.x + 20,
            y: src.geometry.y + 20,
          },
          createdAt: now,
          updatedAt: now,
        }));
        for (const d of dupes) {
          useHistoryStore.getState().push(createCommand(d));
        }
        sel.replaceAll(dupes.map((d) => d.id));
        return;
      }

      // Fit selection (Ctrl+F) — chặn browser search.
      if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        e.preventDefault();
        fitSelection();
        return;
      }

      // Select all (Ctrl+A) — canvas objects trong current board.
      // Canvas owns Ctrl+A khi ngoài editable target (isEditableTarget đã
      // filter đầu handler). preventDefault chặn browser select-all DOM.
      if (mod && e.key.toLowerCase() === 'a' && !e.shiftKey) {
        e.preventDefault();
        const currentBoardId = useBoardStackStore.getState().currentBoardId();
        const ids: string[] = [];
        useObjectsStore.getState().objects.forEach((obj) => {
          if (obj.boardId === currentBoardId) ids.push(obj.id);
        });
        if (ids.length > 0) useSelectionStore.getState().replaceAll(ids);
        return;
      }

      // Copy (Ctrl+C) — canvas objects, không phải text selection.
      if (mod && e.key.toLowerCase() === 'c' && !e.shiftKey) {
        const sel = useSelectionStore.getState();
        if (sel.size() === 0) return;
        const objectsStore = useObjectsStore.getState();
        const objs: CanvasObject[] = [];
        sel.selectedIds.forEach((id) => {
          const o = objectsStore.get(id);
          if (o) objs.push(o);
        });
        if (objs.length === 0) return;
        e.preventDefault();
        useCanvasClipboard.getState().copy(objs);
        return;
      }

      // Cut (Ctrl+X) — copy + delete atomic. Undo revert delete (clipboard giữ).
      if (mod && e.key.toLowerCase() === 'x' && !e.shiftKey) {
        const sel = useSelectionStore.getState();
        if (sel.size() === 0) return;
        const objectsStore = useObjectsStore.getState();
        const objs: CanvasObject[] = [];
        sel.selectedIds.forEach((id) => {
          const o = objectsStore.get(id);
          if (o) objs.push(o);
        });
        if (objs.length === 0) return;
        e.preventDefault();
        // Copy trước (không revert khi undo).
        useCanvasClipboard.getState().copy(objs);
        // Delete với cascade cho board.
        void performDelete();
        return;
      }

      // Undo / Redo
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useHistoryStore.getState().redo();
        else useHistoryStore.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useHistoryStore.getState().redo();
        return;
      }

      // Delete — immediate, no confirm (spec: canvas manipulation reversible).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const size = useSelectionStore.getState().size();
        if (size === 0) return;
        e.preventDefault();
        void performDelete();
        return;
      }

      // Escape — clear selection + FSM reset + exit edit
      if (e.key === 'Escape') {
        useSelectionStore.getState().clear();
        useInteractionStore.getState().reset();
        useInteractionStore.getState().exitEdit();
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        window.getSelection()?.removeAllRanges();
        return;
      }

      // Enter / F2 → enter edit mode cho selected single object
      if ((e.key === 'Enter' && !mod) || e.key === 'F2') {
        const sel = useSelectionStore.getState();
        if (sel.size() !== 1) return;
        const id = Array.from(sel.selectedIds)[0];
        e.preventDefault();
        useInteractionStore.getState().enterEdit(id);
        return;
      }

      // Arrow keys — nudge selection
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        const sel = useSelectionStore.getState();
        if (sel.size() === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
        return;
      }

      // T / N → quick add Text / Note tại center viewport
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        quickAdd('text');
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        quickAdd('note');
        return;
      }
    };

    const nudgeSelection = (dx: number, dy: number) => {
      const sel = useSelectionStore.getState();
      const objectsStore = useObjectsStore.getState();
      // Phase 4B: expand groups để nudge cả children.
      const expandedIds = expandGroupIds(
        Array.from(sel.selectedIds),
        objectsStore.objects
      );
      const patches: MovePatch[] = [];
      for (const id of expandedIds) {
        const obj = objectsStore.get(id);
        if (!obj) continue;
        const from = obj.geometry;
        const to = { ...from, x: from.x + dx, y: from.y + dy };
        patches.push({ id, from, to });
      }
      if (patches.length === 0) return;
      // moveCommand có merge trong 500ms cùng id set → arrow spam sẽ merge.
      useHistoryStore.getState().push(moveCommand(patches));
    };

    const fitSelection = () => {
      const surface = document.querySelector<HTMLElement>(
        '[data-canvas-surface="true"]'
      );
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const camera = useCameraStore.getState();
      const sel = useSelectionStore.getState();
      const objectsStore = useObjectsStore.getState();

      const rects: ReturnType<typeof geometryToRect>[] = [];
      if (sel.size() > 0) {
        sel.selectedIds.forEach((id) => {
          const obj = objectsStore.get(id);
          if (obj) rects.push(geometryToRect(obj.geometry));
        });
      } else {
        objectsStore.objects.forEach((obj) => {
          if (obj.boardId === null) rects.push(geometryToRect(obj.geometry));
        });
      }

      const bounds = unionRects(rects);
      if (!bounds) {
        camera.reset();
        return;
      }
      camera.fit(bounds, { width: rect.width, height: rect.height });
    };

    const quickAdd = (type: 'text' | 'note') => {
      const def = getAllObjectTypes().find((t) => t.type === type);
      if (!def) return;
      const surface = document.querySelector<HTMLElement>(
        '[data-canvas-surface="true"]'
      );
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const camera = useCameraStore.getState().camera;
      const canvasCenter = screenToCanvas(
        { x: rect.width / 2, y: rect.height / 2 },
        camera
      );

      const now = new Date().toISOString();
      const obj: CanvasObject = {
        id: crypto.randomUUID(),
        type,
        boardId: null,
        geometry: {
          ...def.defaultGeometry,
          x: canvasCenter.x - def.defaultGeometry.width / 2,
          y: canvasCenter.y - def.defaultGeometry.height / 2,
        },
        data: def.defaultData,
        createdAt: now,
        updatedAt: now,
      };
      useHistoryStore.getState().push(createCommand(obj));
      useSelectionStore.getState().select(obj.id);
      useInteractionStore.getState().enterEdit(obj.id);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { performDelete };
}
