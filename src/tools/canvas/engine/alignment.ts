import type { Rect } from './geometry';

// ============================================================
// Canvas — Alignment engine (Phase 4B, pure)
// ============================================================
//
// Compute alignment candidates giữa dragging AABB vs list others.
// Return list guides + optional snap delta.
//
// Threshold nhận canvas-space (caller scale theo camera zoom nếu muốn
// consistent screen threshold).
// ============================================================

export interface AlignmentGuide {
  axis: 'horizontal' | 'vertical';
  /** Canvas-space coord: y cho horizontal, x cho vertical. */
  position: number;
  kind: 'edge' | 'center';
}

export interface AlignmentResult {
  guides: AlignmentGuide[];
  snapDelta: { dx: number; dy: number };
}

interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

function edgesOf(r: Rect): Edges {
  return {
    left: r.x,
    right: r.x + r.width,
    top: r.y,
    bottom: r.y + r.height,
    centerX: r.x + r.width / 2,
    centerY: r.y + r.height / 2,
  };
}

/**
 * Tính alignment guides + snap delta cho draggingAABB so với others.
 *
 * Algorithm:
 *   - For each candidate rect: check 6 alignment types (3 vertical: left/
 *     right/centerX + 3 horizontal: top/bottom/centerY).
 *   - Nếu diff < threshold, thêm guide + tính snap delta cho axis đó.
 *   - Snap delta axis: chọn best (smallest diff) across candidates.
 */
export function computeAlignments(
  draggingAABB: Rect,
  others: Rect[],
  threshold: number
): AlignmentResult {
  const guides: AlignmentGuide[] = [];
  const dragEdges = edgesOf(draggingAABB);

  // Track best snap per axis (smallest diff).
  let bestDx: { diff: number; delta: number } | null = null;
  let bestDy: { diff: number; delta: number } | null = null;

  for (const other of others) {
    const e = edgesOf(other);

    // Vertical alignments (x-axis snap).
    const verticalChecks: Array<{
      dragEdge: number;
      otherEdge: number;
      kind: 'edge' | 'center';
      guidePos: number;
    }> = [
      { dragEdge: dragEdges.left, otherEdge: e.left, kind: 'edge', guidePos: e.left },
      { dragEdge: dragEdges.right, otherEdge: e.right, kind: 'edge', guidePos: e.right },
      { dragEdge: dragEdges.centerX, otherEdge: e.centerX, kind: 'center', guidePos: e.centerX },
    ];

    for (const chk of verticalChecks) {
      const diff = chk.dragEdge - chk.otherEdge;
      if (Math.abs(diff) < threshold) {
        guides.push({ axis: 'vertical', position: chk.guidePos, kind: chk.kind });
        if (bestDx === null || Math.abs(diff) < bestDx.diff) {
          bestDx = { diff: Math.abs(diff), delta: -diff };
        }
      }
    }

    // Horizontal alignments (y-axis snap).
    const horizontalChecks: Array<{
      dragEdge: number;
      otherEdge: number;
      kind: 'edge' | 'center';
      guidePos: number;
    }> = [
      { dragEdge: dragEdges.top, otherEdge: e.top, kind: 'edge', guidePos: e.top },
      { dragEdge: dragEdges.bottom, otherEdge: e.bottom, kind: 'edge', guidePos: e.bottom },
      { dragEdge: dragEdges.centerY, otherEdge: e.centerY, kind: 'center', guidePos: e.centerY },
    ];

    for (const chk of horizontalChecks) {
      const diff = chk.dragEdge - chk.otherEdge;
      if (Math.abs(diff) < threshold) {
        guides.push({ axis: 'horizontal', position: chk.guidePos, kind: chk.kind });
        if (bestDy === null || Math.abs(diff) < bestDy.diff) {
          bestDy = { diff: Math.abs(diff), delta: -diff };
        }
      }
    }
  }

  return {
    guides,
    snapDelta: {
      dx: bestDx?.delta ?? 0,
      dy: bestDy?.delta ?? 0,
    },
  };
}
