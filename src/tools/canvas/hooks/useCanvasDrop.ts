import { useEffect } from 'react';

import { useCameraStore } from '../store/camera-store';
import { screenToCanvas } from '../engine/coords';
import { createImageFromBlob } from '../lib/image-create';

// ============================================================
// useCanvasDrop — Drag file từ desktop drop vào canvas
// ============================================================
//
// Attach dragover (preventDefault) + drop listener trên surface.
// Chỉ nhận file đầu tiên; log warn nếu > 1 file (Phase 2).
// Vị trí drop → canvas-space.
// ============================================================

export function useCanvasDrop() {
  useEffect(() => {
    const surface = document.querySelector<HTMLElement>(
      '[data-canvas-surface="true"]'
    );
    if (!surface) return;

    const onDragOver = (e: DragEvent) => {
      // Chỉ handle drag chứa file external (không drag internal).
      if (!e.dataTransfer) return;
      const hasFile = Array.from(e.dataTransfer.items).some(
        (it) => it.kind === 'file'
      );
      if (!hasFile) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      e.preventDefault();

      if (files.length > 1) {
        // eslint-disable-next-line no-console
        console.warn(`[canvas] Drop nhiều file (${files.length}) — chỉ xử file đầu.`);
      }

      const file = files[0];
      const rect = surface.getBoundingClientRect();
      const camera = useCameraStore.getState().camera;
      const canvasPos = screenToCanvas(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        camera
      );

      void createImageFromBlob({
        blob: file,
        canvasX: canvasPos.x,
        canvasY: canvasPos.y,
      });
    };

    surface.addEventListener('dragover', onDragOver);
    surface.addEventListener('drop', onDrop);
    return () => {
      surface.removeEventListener('dragover', onDragOver);
      surface.removeEventListener('drop', onDrop);
    };
  }, []);
}
