import { useEffect } from 'react';

import { useCameraStore } from '../store/camera-store';
import { screenToCanvas } from '../engine/coords';
import { createImageFromBlob } from '../lib/image-create';
import { useHistoryStore } from '../engine/commands/history';
import { createCommand } from '../engine/commands/create';
import { useSelectionStore } from '../store/selection-store';
import { useBoardStackStore } from '../store/board-stack-store';
import {
  materializePaste,
  tryParseClipboardText,
  useCanvasClipboard,
} from '../lib/canvas-clipboard';

// ============================================================
// useCanvasPaste — Ctrl+V routing: image | canvas object | no-op
// ============================================================
//
// Order:
//   1. clipboardData.items có image → paste image tại center viewport
//   2. In-memory clipboard store có canvas payload → paste objects với
//      offset stack (+20*count)
//   3. clipboardData text = canvas JSON payload → paste (cross-tab)
//   4. no-op
//
// Skip toàn bộ khi focus input/textarea.
// ============================================================

export function useCanvasPaste() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return;
      }

      // Priority 1: image trong clipboard
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (!item.type.startsWith('image/')) continue;
          const blob = item.getAsFile();
          if (!blob) continue;
          e.preventDefault();

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
          void createImageFromBlob({
            blob,
            canvasX: canvasCenter.x,
            canvasY: canvasCenter.y,
          });
          return;
        }
      }

      // Helper: override boardId của objects paste về current board (bug fix:
      // trước đây giữ boardId cũ nên paste bị "kẹt" trong board gốc).
      const rebindToCurrentBoard = (objs: ReturnType<typeof materializePaste>) => {
        const currentBoardId = useBoardStackStore.getState().currentBoardId();
        return objs.map((o) => ({ ...o, boardId: currentBoardId }));
      };

      // Priority 2: in-memory canvas clipboard
      const clip = useCanvasClipboard.getState();
      if (clip.payload) {
        e.preventDefault();
        const offset = clip.nextOffset();
        const newObjects = rebindToCurrentBoard(
          materializePaste(clip.payload, offset)
        );
        for (const obj of newObjects) {
          useHistoryStore.getState().push(createCommand(obj));
        }
        useSelectionStore.getState().replaceAll(newObjects.map((o) => o.id));
        return;
      }

      // Priority 3: cross-tab paste (canvas JSON in browser clipboard)
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        const payload = tryParseClipboardText(text);
        if (payload) {
          e.preventDefault();
          // Fresh paste — populate in-memory store + apply first offset.
          useCanvasClipboard.setState({ payload, offsetCount: 0 });
          const offset = useCanvasClipboard.getState().nextOffset();
          const newObjects = rebindToCurrentBoard(
            materializePaste(payload, offset)
          );
          for (const obj of newObjects) {
            useHistoryStore.getState().push(createCommand(obj));
          }
          useSelectionStore.getState().replaceAll(newObjects.map((o) => o.id));
          return;
        }
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
}
