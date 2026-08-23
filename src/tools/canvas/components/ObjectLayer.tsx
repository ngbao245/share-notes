import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { CANVAS_DBLCLICK_EVENT } from '../hooks/usePointerFSM';

import type { CanvasObject } from '../types';
import { useObjectsStore } from '../store/objects-store';
import { useSelectionStore } from '../store/selection-store';
import { useInteractionStore } from '../store/interaction-store';
import { useBoardStackStore } from '../store/board-stack-store';
import { getObjectTypeDefinition } from '../hooks/useObjectRegistry';

// Side-effect import: register object types khi module load.
// RectObject dev-only, giữ để debug engine. 4 content type Phase 2.
import './objects/RectObject';
import './objects/TextObject';
import './objects/NoteObject';
import './objects/ImageObject';
import './objects/LinkObject';
import './objects/TodoListObject';
import './objects/BoardObject';
import './objects/GroupObject';

// ============================================================
// ObjectLayer — Render all objects in current board
// ============================================================
//
// Read objects từ store, render qua renderer trong registry. Filter
// theo boardId (Phase 1 chỉ root/null).
//
// Ref map: giữ HTMLElement của mỗi object cho drag/resize imperative
// transform (Task 6-9). Ref map mount ở đây vì ObjectLayer là parent
// duy nhất render objects. Consumer (usePointerFSM Task 6) đọc qua
// exported hook `useObjectRef`.
// ============================================================

// Module-level ref map. Không phải React state → không trigger re-render.
// Cleared khi ObjectLayer unmount.
const objectRefMap = new Map<string, HTMLElement>();

/** Get DOM node của object (imperative, không subscribe). */
export function getObjectElement(id: string): HTMLElement | undefined {
  return objectRefMap.get(id);
}

/** Clear all refs (khi unmount hoặc reset). */
export function __clearObjectRefs() {
  objectRefMap.clear();
}

interface ObjectLayerProps {
  /** boardId hiện tại. Nếu undefined, đọc từ boardStack store. */
  boardId?: string | null;
}

export function ObjectLayer({ boardId }: ObjectLayerProps) {
  const objects = useObjectsStore((s) => s.objects);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const editingObjectId = useInteractionStore((s) => s.editingObjectId);
  const exitEditRaw = useInteractionStore((s) => s.exitEdit);
  const enterEdit = useInteractionStore((s) => s.enterEdit);
  const currentBoardId = useBoardStackStore((s) => s.currentBoardId());
  // Exit edit + clear native browser selection để không leak DOM selection
  // sau khi component chuyển sang non-edit. Fix: extension như Google
  // Translate detect selection persist mặc dù UI không show.
  const exitEdit = useCallback(() => {
    exitEditRaw();
    // Blur active element (textarea/input) nếu vẫn focus.
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    // Clear native selection.
    window.getSelection()?.removeAllRanges();
  }, [exitEditRaw]);

  const effectiveBoardId = boardId !== undefined ? boardId : currentBoardId;

  const navigate = useNavigate();

  // Listen manual dblclick từ FSM. Route theo object type:
  //  - board → navigate vào canvas con
  //  - else → enterEdit
  useEffect(() => {
    const onDbl = (e: Event) => {
      const detail = (e as CustomEvent<{ objectId: string }>).detail;
      if (!detail) return;
      const obj = useObjectsStore.getState().get(detail.objectId);
      if (!obj) return;
      if (obj.type === 'board') {
        // Clear selection TRƯỚC navigate — ring biến mất instant, không
        // đợi route effect load xong (HTTP ~300-900ms trong remote mode).
        useSelectionStore.getState().clear();
        navigate(`/canvas/${obj.id}`);
      } else {
        enterEdit(obj.id);
      }
    };
    window.addEventListener(CANVAS_DBLCLICK_EVENT, onDbl);
    return () => window.removeEventListener(CANVAS_DBLCLICK_EVENT, onDbl);
  }, [enterEdit, navigate]);

  // Fallback: native React onDoubleClick (nếu browser fire được).
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      // Skip nếu double-click bên trong input/textarea đang edit — cho
      // browser native word-select hoạt động bình thường. Bug fix:
      // preventDefault + removeAllRanges trước đây kill word-select khi
      // user đang edit.
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      const objectEl = target.closest<HTMLElement>('[data-canvas-object-id]');
      if (!objectEl) return;
      const id = objectEl.dataset.canvasObjectId;
      if (!id) return;
      // Skip nếu đang edit chính object này (no-op) — tránh side-effect.
      const currentEditingId = useInteractionStore.getState().editingObjectId;
      if (currentEditingId === id) return;

      e.stopPropagation();
      const obj = useObjectsStore.getState().get(id);
      if (obj?.type === 'board') {
        useSelectionStore.getState().clear();
        navigate(`/canvas/${obj.id}`);
      } else {
        enterEdit(id);
      }
    },
    [enterEdit, navigate]
  );

  // Register/unregister ref khi renderer mount/unmount.
  const setRef = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      if (el) objectRefMap.set(id, el);
      else objectRefMap.delete(id);
    };
  }, []);

  // Filter theo effective boardId + sort theo zIndex.
  const filtered: CanvasObject[] = [];
  objects.forEach((obj) => {
    if (obj.boardId === effectiveBoardId) filtered.push(obj);
  });
  filtered.sort((a, b) => a.geometry.zIndex - b.geometry.zIndex);

  return (
    <div onDoubleClick={handleDoubleClick}>
      {filtered.map((object) => {
        const def = getObjectTypeDefinition(object.type);
        if (!def) {
          // Unknown type — render fallback (tránh crash khi swap plugin
          // giữa chừng dev). Log 1 lần dev-only.
          if (import.meta.env.DEV) {
            console.warn(`[canvas] Unknown object type: ${object.type}`);
          }
          return null;
        }
        const Renderer = def.renderer;
        return (
          <Renderer
            key={object.id}
            object={object}
            isSelected={selectedIds.has(object.id)}
            isEditing={editingObjectId === object.id}
            onEditEnd={exitEdit}
            ref={setRef(object.id)}
          />
        );
      })}
    </div>
  );
}

// Cleanup ref map khi hot reload / route unmount handled bởi React callback
// ref (`setRef(null)` khi unmount). Không cần explicit useEffect cleanup.
