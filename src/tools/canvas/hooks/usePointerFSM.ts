import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { CanvasObject, Geometry } from '../types';
import { useCameraStore } from '../store/camera-store';
import { useObjectsStore } from '../store/objects-store';
import { useSelectionStore } from '../store/selection-store';
import { useInteractionStore } from '../store/interaction-store';
import { useSnapStore } from '../store/snap-store';
import { useBoardStackStore } from '../store/board-stack-store';
import { shouldPromoteToDragging } from '../engine/fsm';
import { screenToCanvas } from '../engine/coords';
import {
  geometryToRect,
  rectFromPoints,
  rectsIntersect,
  unionRects,
  type Rect,
} from '../engine/geometry';
import { getObjectElement } from '../components/ObjectLayer';
import { moveCommand, type MovePatch } from '../engine/commands/move';
import { useHistoryStore } from '../engine/commands/history';
import { getCanvasRepository } from '../repository';
import { expandGroupIds, resolveGroupOwner } from '../lib/group-helpers';
import { computeAlignments } from '../engine/alignment';
import {
  findBoardDropTarget,
  type BoardCandidate,
} from '../engine/board-drop';
import { snapDelta, CANVAS_GRID_SIZE } from '../engine/snap';
import {
  moveIntoBoardCommand,
  type MoveIntoBoardPatch,
} from '../engine/commands/move-into-board';

// ============================================================
// Bring-to-front on grab (Milanote/Figma pattern).
// Bump zIndex của dragIds lên trên tất cả object hiện có.
// Persist qua repository ngay (không qua Command — z-order không undo-able,
// giữ đơn giản, khớp behavior Milanote: click object = focus rank up).
// ============================================================
function bumpToFront(ids: string[]): Record<string, Geometry> {
  const objectsStore = useObjectsStore.getState();
  const repo = getCanvasRepository();

  let maxZ = 0;
  objectsStore.objects.forEach((obj) => {
    if (obj.geometry.zIndex > maxZ) maxZ = obj.geometry.zIndex;
  });

  const result: Record<string, Geometry> = {};
  const patches: Array<{ id: string; patch: { geometry: Geometry } }> = [];
  ids.forEach((id, i) => {
    const obj = objectsStore.get(id);
    if (!obj) return;
    const targetZ = maxZ + 1 + i;
    if (obj.geometry.zIndex === targetZ) {
      result[id] = obj.geometry;
      return;
    }
    const newGeo: Geometry = { ...obj.geometry, zIndex: targetZ };
    result[id] = newGeo;
    patches.push({ id, patch: { geometry: newGeo } });
  });

  if (patches.length > 0) {
    objectsStore.batchPatch(patches);
    for (const p of patches) {
      void repo.updateObject(p.id, { geometry: p.patch.geometry });
    }
  }
  return result;
}

// Set/clear data-dragging attr cho visual lift feedback (CSS trong index.css).
function markDragging(ids: string[], dragging: boolean) {
  for (const id of ids) {
    const el = getObjectElement(id);
    if (!el) continue;
    if (dragging) el.dataset.dragging = 'true';
    else delete el.dataset.dragging;
  }
}

// ============================================================
// usePointerFSM — Unified pointer routing cho canvas surface
// ============================================================
//
// Route pointer event → FSM transition:
//
//   pointerdown:
//     - middle button | space held | ctrl/meta held  → panning
//     - target = object                              → drag_pending
//     - target = handle (Task 9)                     → resizing
//     - target = empty                               → marquee (Task 7)
//                                                       (Task 6 skip: chỉ clear selection)
//
//   pointermove:
//     - drag_pending → move > threshold → dragging + first frame imperative
//     - dragging     → imperative transform trên tất cả ref
//     - panning      → camera pan delta
//     - marquee      → update rect (Task 7)
//     - resizing     → geometry patch imperative (Task 9)
//
//   pointerup:
//     - drag_pending → click select (single hoặc shift-toggle)
//     - dragging     → commit geometry vào store + repository
//     - panning/marquee/resizing → commit tương ứng
//
// FSM state trong interaction-store. Transient data (initial coords,
// initial geometries) giữ trong ref local hook — không cần persist.
// ============================================================

interface DragRef {
  ids: string[];
  startClientX: number;
  startClientY: number;
  initialGeometries: Record<string, Geometry>;
  additive: boolean;
  targetId: string;
  wasAlreadySelected: boolean;
  /** Phase 4B: cached alignment candidates (visible + non-dragging + non-board/group). */
  cachedOthers: Array<{ id: string; aabb: Rect }>;
  /** Phase 4B: cached board candidates cho drop hit-test. */
  cachedBoards: BoardCandidate[];
  /** Phase 4B: full board hierarchy Map<boardId, parentBoardId> tại drag start. */
  boardHierarchy: Map<string, string | null>;
  /** Phase 4B: dragging CanvasObject snapshot (cho circular check + moveIntoBoard patch). */
  draggingObjects: CanvasObject[];
  /** Phase 4B: current board id lúc drag start (dùng cho moveIntoBoard from/to). */
  sourceBoardId: string | null;
}

interface PanRef {
  active: boolean;
  lastX: number;
  lastY: number;
  trigger: 'space' | 'middle' | 'ctrl';
}

/**
 * Marquee pending: user pointerdown empty area, chưa move đủ threshold.
 * KHÔNG setPointerCapture ở phase này — để browser tự shift focus khỏi
 * textarea đang edit (fix bug: textarea onBlur không fire khi
 * setPointerCapture giữ pointer → activeElement vẫn = textarea → extension
 * như Google Translate không detect focus rời textarea).
 * Move > threshold → promote thành marquee mode + setPointerCapture.
 */
interface MarqueePendingRef {
  startClientX: number;
  startClientY: number;
  additive: boolean;
  promoted: boolean;
}



interface PointerFSMHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Space held? Reactive — consumer dùng để derive cursor. */
  spaceHeld: boolean;
}

const DOUBLE_CLICK_MS = 350;

export const CANVAS_DBLCLICK_EVENT = 'canvas:object-dblclick';

export function usePointerFSM(): PointerFSMHandlers {
  const dragRef = useRef<DragRef | null>(null);
  const panRef = useRef<PanRef>({
    active: false,
    lastX: 0,
    lastY: 0,
    trigger: 'space',
  });
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const marqueePendingRef = useRef<MarqueePendingRef | null>(null);
  // Manual double-click detection: FSM tự track vì native dblclick không
  // fire reliable với setPointerCapture chain.
  const lastClickRef = useRef<{ at: number; objectId: string } | null>(null);

  // --- Space hold + Escape ---
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceHeldRef.current) {
        if (isEditableTarget(e.target)) return;
        spaceHeldRef.current = true;
        setSpaceHeld(true);
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        // Cancel any in-progress interaction.
        marqueePendingRef.current = null;
        cancelDrag();
        cancelPan();
        useInteractionStore.getState().reset();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // --- Helpers ---

  const cancelDrag = () => {
    if (!dragRef.current) return;
    // Clear imperative transform + drag data-attr.
    markDragging(dragRef.current.ids, false);
    for (const id of dragRef.current.ids) {
      const el = getObjectElement(id);
      if (el) el.style.transform = '';
    }
    // Phase 4B: clear transient overlay states.
    const interaction = useInteractionStore.getState();
    interaction.setDropTarget(null);
    interaction.setAlignmentGuides([]);
    dragRef.current = null;
  };

  const cancelPan = () => {
    if (!panRef.current.active) return;
    panRef.current.active = false;
  };

  // --- Pan handlers ---

  const startPan = (
    e: React.PointerEvent<HTMLDivElement>,
    trigger: PanRef['trigger']
  ) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
      trigger,
    };
    useInteractionStore.getState().transitionTo({ mode: 'panning', trigger });
  };

  // --- Drag handlers ---

  const startDragPending = (
    e: React.PointerEvent<HTMLDivElement>,
    objectId: string
  ) => {
    // KHÔNG preventDefault — sẽ suppress native click/dblclick chain (spec:
    // pointerdown.preventDefault() cancels compat mouse events). Drag hoạt
    // động qua pointer capture + relative delta, không cần preventDefault.
    // Text selection ngăn qua CSS select-none trên surface.
    e.currentTarget.setPointerCapture(e.pointerId);

    const selection = useSelectionStore.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const wasAlreadySelected = selection.has(objectId);

    // Xác định objects sẽ drag khi promoted:
    //   - Đã selected: drag toàn selection (multi-drag).
    //   - Chưa selected + additive: drag chỉ object này (selection sẽ add ở up).
    //     Trên thực tế Milanote: shift-click chưa selected → chỉ add, không drag.
    //     Nhưng cho phép drag object mới đó luôn cùng set cũ → drag set + this.
    //   - Chưa selected + không additive: drag chỉ object này (selection sẽ replace).
    const objectsStore = useObjectsStore.getState();
    let dragIds: string[];
    if (wasAlreadySelected) {
      dragIds = Array.from(selection.selectedIds);
    } else if (additive) {
      dragIds = [...Array.from(selection.selectedIds), objectId];
    } else {
      dragIds = [objectId];
    }

    // Phase 4B: expand groups → thêm children ids (giữ group để geometry
    // của group cũng move theo).
    dragIds = expandGroupIds(dragIds, objectsStore.objects);

    // Bring dragged objects to front (z-order fix #1). Bumped geometry
    // trở thành initialGeometry để MoveCommand consistent.
    const bumped = bumpToFront(dragIds);
    const initialGeometries: Record<string, Geometry> = {};
    for (const id of dragIds) {
      const geo = bumped[id] ?? objectsStore.get(id)?.geometry;
      if (geo) initialGeometries[id] = geo;
    }

    // Phase 4B: snapshot cached candidates + hierarchy tại drag start.
    const draggingIdSet = new Set(dragIds);
    const currentBoardId = useBoardStackStore.getState().currentBoardId();
    const cachedOthers: Array<{ id: string; aabb: Rect }> = [];
    const cachedBoards: BoardCandidate[] = [];
    const boardHierarchy = new Map<string, string | null>();
    const draggingObjects: CanvasObject[] = [];

    objectsStore.objects.forEach((obj) => {
      // Full hierarchy (across boards) cho circular check.
      if (obj.type === 'board') {
        boardHierarchy.set(obj.id, obj.boardId);
      }
      // Dragging snapshot.
      if (draggingIdSet.has(obj.id)) {
        draggingObjects.push(obj);
        return;
      }
      // Chỉ candidates trong current board view.
      if (obj.boardId !== currentBoardId) return;

      if (obj.type === 'board') {
        cachedBoards.push({
          id: obj.id,
          aabb: geometryToRect(obj.geometry),
          parentId: obj.boardId,
          zIndex: obj.geometry.zIndex,
        });
        return;
      }
      // Alignment candidates: exclude group (logical) và board.
      if (obj.type === 'group') return;
      cachedOthers.push({ id: obj.id, aabb: geometryToRect(obj.geometry) });
    });

    dragRef.current = {
      ids: dragIds,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialGeometries,
      additive,
      targetId: objectId,
      wasAlreadySelected,
      cachedOthers,
      cachedBoards,
      boardHierarchy,
      draggingObjects,
      sourceBoardId: currentBoardId,
    };

    useInteractionStore.getState().transitionTo({
      mode: 'drag_pending',
      objectId,
      wasAlreadySelected,
      additive,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
    });
  };

  const promoteToDragging = () => {
    const drag = dragRef.current;
    if (!drag) return;

    // Nếu drag object chưa selected → cập nhật selection ngay khi dragging bắt đầu.
    if (!drag.wasAlreadySelected) {
      const sel = useSelectionStore.getState();
      if (drag.additive) {
        sel.add(drag.targetId);
        // Cập nhật ids để include tất cả (selection cũ + target),
        // expand groups (Phase 4B).
        drag.ids = expandGroupIds(
          Array.from(sel.selectedIds),
          useObjectsStore.getState().objects
        );
        // Bump zIndex cho toàn set (fix #1) — có thể có id mới chưa bump ở startDragPending.
        const bumped = bumpToFront(drag.ids);
        for (const id of drag.ids) {
          const geo = bumped[id] ?? useObjectsStore.getState().get(id)?.geometry;
          if (geo) drag.initialGeometries[id] = geo;
        }
      } else {
        sel.select(drag.targetId);
        drag.ids = expandGroupIds(
          [drag.targetId],
          useObjectsStore.getState().objects
        );
        // Bump + capture initial cho children đã expand (không có ở startDragPending).
        const bumped = bumpToFront(drag.ids);
        for (const id of drag.ids) {
          if (drag.initialGeometries[id]) continue;
          const geo = bumped[id] ?? useObjectsStore.getState().get(id)?.geometry;
          if (geo) drag.initialGeometries[id] = geo;
        }
      }

      // Phase 4B: refresh draggingObjects snapshot với ids đã expand.
      const objectsMap = useObjectsStore.getState().objects;
      drag.draggingObjects = drag.ids
        .map((id) => objectsMap.get(id))
        .filter((o): o is NonNullable<typeof o> => !!o);
    }

    // Visual lift feedback (fix #2). CSS trong index.css.
    markDragging(drag.ids, true);

    useInteractionStore.getState().transitionTo({
      mode: 'dragging',
      objectIds: drag.ids,
      startScreenX: drag.startClientX,
      startScreenY: drag.startClientY,
      initialGeometries: drag.initialGeometries,
    });
  };

  /**
   * Compute AABB union của dragging set với raw delta applied.
   */
  const computeDraggingAABB = (
    drag: DragRef,
    canvasDx: number,
    canvasDy: number
  ): Rect | null => {
    const rects: Rect[] = [];
    for (const id of drag.ids) {
      const initial = drag.initialGeometries[id];
      if (!initial) continue;
      rects.push({
        x: initial.x + canvasDx,
        y: initial.y + canvasDy,
        width: initial.width,
        height: initial.height,
      });
    }
    return unionRects(rects);
  };

  const applyDragTransform = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const camera = useCameraStore.getState().camera;
    const rawDx = (clientX - drag.startClientX) / camera.zoom;
    const rawDy = (clientY - drag.startClientY) / camera.zoom;

    let effDx = rawDx;
    let effDy = rawDy;

    // Phase 4B priority order.
    const interaction = useInteractionStore.getState();
    const draggingAABB = computeDraggingAABB(drag, rawDx, rawDy);

    if (draggingAABB) {
      // 1. Board drop hit-test.
      const dropTarget = findBoardDropTarget(
        draggingAABB,
        new Set(drag.ids),
        drag.cachedBoards,
        drag.boardHierarchy,
        drag.draggingObjects
      );

      if (dropTarget) {
        interaction.setDropTarget(dropTarget);
        interaction.setAlignmentGuides([]);
        // Board target: dùng raw delta (không snap/align).
      } else {
        interaction.setDropTarget(null);

        // 2. Alignment guides (threshold 6px screen-space → canvas-space).
        const threshold = 6 / camera.zoom;
        const alignResult = computeAlignments(
          draggingAABB,
          drag.cachedOthers.map((o) => o.aabb),
          threshold
        );
        interaction.setAlignmentGuides(alignResult.guides);
        if (alignResult.snapDelta.dx !== 0) effDx += alignResult.snapDelta.dx;
        if (alignResult.snapDelta.dy !== 0) effDy += alignResult.snapDelta.dy;

        // 3. Grid snap: preview KHÔNG apply live (business rule — chỉ apply on drop).
        //    Phase 4B design chọn preview-off để drag smooth.
      }
    }

    for (const id of drag.ids) {
      const el = getObjectElement(id);
      if (el) {
        el.style.transform = `translate3d(${effDx}px, ${effDy}px, 0)`;
      }
    }
  };

  const commitDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const camera = useCameraStore.getState().camera;
    const rawDx = (clientX - drag.startClientX) / camera.zoom;
    const rawDy = (clientY - drag.startClientY) / camera.zoom;

    const interaction = useInteractionStore.getState();
    const dropTargetId = interaction.dropTargetBoardId;

    // Priority 1: Board drop → moveIntoBoardCommand.
    if (dropTargetId) {
      const patches: MoveIntoBoardPatch[] = drag.draggingObjects.map((obj) => ({
        id: obj.id,
        fromBoardId: obj.boardId,
        toBoardId: dropTargetId,
      }));
      if (patches.length > 0) {
        flushSync(() => {
          useHistoryStore.getState().push(moveIntoBoardCommand(patches));
        });
      }
      // Cleanup imperative style + transient state.
      markDragging(drag.ids, false);
      for (const id of drag.ids) {
        const el = getObjectElement(id);
        if (el) el.style.transform = '';
      }
      interaction.setDropTarget(null);
      interaction.setAlignmentGuides([]);
      dragRef.current = null;
      return;
    }

    // Skip commit nếu delta ≈ 0 (click no drag).
    if (Math.abs(rawDx) < 0.01 && Math.abs(rawDy) < 0.01) {
      markDragging(drag.ids, false);
      for (const id of drag.ids) {
        const el = getObjectElement(id);
        if (el) el.style.transform = '';
      }
      interaction.setAlignmentGuides([]);
      dragRef.current = null;
      return;
    }

    let effDx = rawDx;
    let effDy = rawDy;
    let snappedByAlignment = false;

    // Priority 2: Alignment snap (nếu applyDragTransform vừa detect).
    const guides = interaction.alignmentGuides;
    if (guides.length > 0) {
      // Recompute alignment tại delta hiện tại để lấy snapDelta chính xác.
      const draggingAABB = computeDraggingAABB(drag, rawDx, rawDy);
      if (draggingAABB) {
        const threshold = 6 / camera.zoom;
        const alignResult = computeAlignments(
          draggingAABB,
          drag.cachedOthers.map((o) => o.aabb),
          threshold
        );
        if (alignResult.snapDelta.dx !== 0 || alignResult.snapDelta.dy !== 0) {
          effDx += alignResult.snapDelta.dx;
          effDy += alignResult.snapDelta.dy;
          snappedByAlignment = true;
        }
      }
    }

    // Priority 3: Grid snap (chỉ nếu Snap ON + không snapped bởi alignment).
    if (!snappedByAlignment && useSnapStore.getState().snapEnabled) {
      // Anchor = first object có initial geometry.
      const anchorId = drag.ids.find((id) => drag.initialGeometries[id]);
      const anchorInitial = anchorId ? drag.initialGeometries[anchorId] : null;
      if (anchorInitial) {
        const gridDelta = snapDelta(
          { x: anchorInitial.x, y: anchorInitial.y },
          { dx: rawDx, dy: rawDy },
          CANVAS_GRID_SIZE
        );
        effDx = gridDelta.dx;
        effDy = gridDelta.dy;
      }
    }

    // Priority 4: Free (dùng rawDx/rawDy đã set effDx/effDy).

    const patches: MovePatch[] = [];
    for (const id of drag.ids) {
      const from = drag.initialGeometries[id];
      if (!from) continue;
      const to: Geometry = { ...from, x: from.x + effDx, y: from.y + effDy };
      patches.push({ id, from, to });
    }

    // Build MoveCommand, push vào history (execute + merge với drag trước
    // nếu cùng id set trong 500ms).
    const cmd = moveCommand(patches);

    flushSync(() => {
      useHistoryStore.getState().push(cmd);
    });

    // Cleanup.
    markDragging(drag.ids, false);
    for (const id of drag.ids) {
      const el = getObjectElement(id);
      if (el) el.style.transform = '';
    }
    interaction.setAlignmentGuides([]);
    interaction.setDropTarget(null);

    dragRef.current = null;
  };

  // --- Handlers ---

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ưu tiên pan trigger.
      const isMiddle = e.button === 1;
      if (isMiddle) {
        startPan(e, 'middle');
        return;
      }
      if (e.button === 0 && spaceHeldRef.current) {
        startPan(e, 'space');
        return;
      }
      if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        // Ctrl+drag = pan (Milanote/Figma). Ctrl+click object cho multi-select
        // xử lý riêng: nếu target = object thì Ctrl-click sẽ add/toggle, không pan.
        // Route theo target.
        const target = e.target as HTMLElement;
        const objectEl = target.closest<HTMLElement>('[data-canvas-object-id]');
        if (!objectEl) {
          startPan(e, 'ctrl');
          return;
        }
        // Ctrl+click object → drag_pending với additive=true.
        startDragPending(e, objectEl.dataset.canvasObjectId!);
        return;
      }

      // Chỉ handle left button từ đây.
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;

      // Skip drag/marquee nếu pointerdown vào input/textarea (đang edit
      // object). Cho phép native input handle event.
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const objectEl = target.closest<HTMLElement>('[data-canvas-object-id]');

      if (objectEl) {
        const rawId = objectEl.dataset.canvasObjectId!;
        // Skip drag khi object đang edit (interaction store) — cho phép
        // pointerdown vào textarea/input xử lý bình thường.
        const editingId = useInteractionStore.getState().editingObjectId;
        if (editingId === rawId) return;

        // Phase 4B: nếu object thuộc 1 group → reroute target sang group.
        // Selection và drag đều làm việc trên group id.
        const groupOwner = resolveGroupOwner(rawId, useObjectsStore.getState().objects);
        const effectiveId = groupOwner ?? rawId;

        startDragPending(e, effectiveId);
        return;
      }

      // Empty area — marquee PENDING (drag-to-start pattern).
      // KHÔNG setPointerCapture + KHÔNG transition state ngay. Chờ user
      // di > threshold mới start marquee. Lý do: nếu setPointerCapture
      // ngay, browser không shift focus khỏi textarea đang edit →
      // textarea.onBlur không fire → không commit + không exit edit +
      // GT extension vẫn thấy activeElement=textarea → icon persist.
      //
      // Với marquee-pending: click empty area = browser xử lý focus shift
      // tự nhiên → textarea blur → commit + exit edit chain fire.
      // Move > 5px → promote thành marquee (setPointerCapture lúc đó).
      marqueePendingRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        additive: e.shiftKey,
        promoted: false,
      };
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Marquee pending → promote khi vượt threshold 5px.
      if (marqueePendingRef.current && !marqueePendingRef.current.promoted) {
        const mp = marqueePendingRef.current;
        const dx = e.clientX - mp.startClientX;
        const dy = e.clientY - mp.startClientY;
        if (Math.hypot(dx, dy) > 5) {
          mp.promoted = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          useInteractionStore.getState().transitionTo({
            mode: 'marquee',
            startScreenX: mp.startClientX,
            startScreenY: mp.startClientY,
            currentScreenX: e.clientX,
            currentScreenY: e.clientY,
            additive: mp.additive,
          });
          return;
        }
      }

      // Pan.
      if (panRef.current.active) {
        const dx = e.clientX - panRef.current.lastX;
        const dy = e.clientY - panRef.current.lastY;
        panRef.current.lastX = e.clientX;
        panRef.current.lastY = e.clientY;
        useCameraStore.getState().pan({ x: dx, y: dy });
        return;
      }

      // Drag pending / dragging.
      const state = useInteractionStore.getState().state;
      if (state.mode === 'drag_pending') {
        if (shouldPromoteToDragging(state, e.clientX, e.clientY)) {
          promoteToDragging();
          applyDragTransform(e.clientX, e.clientY);
        }
        return;
      }
      if (state.mode === 'dragging') {
        applyDragTransform(e.clientX, e.clientY);
        return;
      }
      if (state.mode === 'marquee') {
        useInteractionStore.getState().transitionTo({
          ...state,
          currentScreenX: e.clientX,
          currentScreenY: e.clientY,
        });
        return;
      }
    },
    []
  );

  const commitMarquee = (
    state: Extract<
      import('../engine/fsm').InteractionState,
      { mode: 'marquee' }
    >,
    surfaceEl: HTMLElement
  ) => {
    const rect = surfaceEl.getBoundingClientRect();
    const camera = useCameraStore.getState().camera;

    // Convert screen coords → canvas coords (relative to surface).
    const startCanvas = screenToCanvas(
      { x: state.startScreenX - rect.left, y: state.startScreenY - rect.top },
      camera
    );
    const endCanvas = screenToCanvas(
      { x: state.currentScreenX - rect.left, y: state.currentScreenY - rect.top },
      camera
    );
    const marqueeRect = rectFromPoints(startCanvas, endCanvas);

    // Nếu marquee quá nhỏ (< 4x4 px canvas-space) → treat như click empty.
    if (marqueeRect.width < 4 && marqueeRect.height < 4) {
      if (!state.additive) useSelectionStore.getState().clear();
      return;
    }

    // AABB intersect với objects trong CURRENT board (Phase 4A đã hỗ trợ
    // nested boards — không hard-code boardId === null nữa).
    const currentBoardId = useBoardStackStore.getState().currentBoardId();
    const objects = useObjectsStore.getState().objects;
    const hitIds = new Set<string>();
    objects.forEach((obj) => {
      if (obj.boardId !== currentBoardId) return;
      // Group là logical, skip khỏi marquee direct hit (children xử lý reroute).
      if (obj.type === 'group') return;
      // Overlap 1 phần đủ chọn (Milanote pattern — intersect).
      if (!rectsIntersect(marqueeRect, geometryToRect(obj.geometry))) return;
      // Nếu obj là child của group → select group thay vì child (consistency
      // với click behavior US-2).
      const groupOwner = resolveGroupOwner(obj.id, objects);
      hitIds.add(groupOwner ?? obj.id);
    });

    const sel = useSelectionStore.getState();
    const hitList = Array.from(hitIds);
    if (state.additive) sel.addAll(hitList);
    else sel.replaceAll(hitList);
  };

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Release capture (best-effort).
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }

      // Marquee pending — chưa promoted (không di đủ) → click empty area.
      if (marqueePendingRef.current) {
        const wasPromoted = marqueePendingRef.current.promoted;
        const additive = marqueePendingRef.current.additive;
        marqueePendingRef.current = null;
        if (!wasPromoted) {
          // Click empty: clear selection nếu không phải shift-click.
          if (!additive) useSelectionStore.getState().clear();
          return;
        }
        // Đã promoted → tiếp branch marquee bên dưới.
      }

      // Pan end.
      if (panRef.current.active) {
        panRef.current.active = false;
        useInteractionStore.getState().reset();
        return;
      }

      const state = useInteractionStore.getState().state;

      // Drag_pending → click select (chưa move đủ threshold).
      if (state.mode === 'drag_pending') {
        const drag = dragRef.current;
        const sel = useSelectionStore.getState();
        const targetId = state.objectId;
        if (state.additive) {
          sel.toggle(targetId);
        } else {
          sel.select(targetId);
        }
        // Reset transient
        if (drag) {
          for (const id of drag.ids) {
            const el = getObjectElement(id);
            if (el) el.style.transform = '';
          }
        }
        dragRef.current = null;
        useInteractionStore.getState().reset();

        // Manual double-click detection: fire custom event nếu click thứ 2
        // trên cùng object trong window.
        const now = Date.now();
        const last = lastClickRef.current;
        if (last && last.objectId === targetId && now - last.at < DOUBLE_CLICK_MS) {
          window.dispatchEvent(
            new CustomEvent(CANVAS_DBLCLICK_EVENT, {
              detail: { objectId: targetId },
            })
          );
          lastClickRef.current = null;
        } else {
          lastClickRef.current = { at: now, objectId: targetId };
        }
        return;
      }

      // Dragging → commit.
      if (state.mode === 'dragging') {
        commitDrag(e.clientX, e.clientY);
        useInteractionStore.getState().reset();
        return;
      }

      // Marquee → commit selection.
      if (state.mode === 'marquee') {
        commitMarquee(state, e.currentTarget);
        useInteractionStore.getState().reset();
        return;
      }
    },
    []
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Treat cancel như Escape: revert any transient state.
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }
      marqueePendingRef.current = null;
      cancelDrag();
      cancelPan();
      useInteractionStore.getState().reset();
    },
    []
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    spaceHeld,
  };
}
