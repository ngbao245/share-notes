// ============================================================
// Canvas — data model & Zod schemas
// ============================================================
//
// Object model polymorphic. Engine chỉ chạm `geometry` + `type` + `id` +
// `boardId` + `zIndex`, KHÔNG đọc `data`. Renderer plugin đọc `data` theo
// object type của mình. Rule này protect Milanote-extensibility (Phase 2-6
// thêm object type mới không cần đụng engine core).
//
// `boardId: string | null` sẵn từ Phase 1. Phase 1 luôn null (root board).
// Phase 4 enable nested boards KHÔNG phải migrate schema.
// ============================================================

import { z } from 'zod';

// --- Geometry ---
// Vị trí + kích thước + orientation của object trong canvas-space.
// x, y = top-left corner (canvas coord). Rotation reserved cho Phase 6.
export const geometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  rotation: z.number().default(0), // degrees, Phase 6
  zIndex: z.number().default(0),
});
export type Geometry = z.infer<typeof geometrySchema>;

// --- CanvasObject ---
// `type` là string, không union enum — object registry sẽ register type mới
// runtime, không compile-time. Engine không care type là gì cụ thể.
// `data: unknown` — plugin renderer tự cast sang type của mình bằng Zod.
export const canvasObjectSchema = z.object({
  id: z.string(),
  type: z.string(), // 'rect' Phase 1; 'text' | 'note' | 'image' | 'link' Phase 2; ...
  boardId: z.string().nullable(), // null = root board
  geometry: geometrySchema,
  data: z.unknown(), // renderer-specific payload
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO
});
export type CanvasObject = z.infer<typeof canvasObjectSchema>;

// --- Camera ---
// State pan + zoom của viewport. 1 camera / board.
// Schema range permissive (0.01 - 20) để tolerate legacy data. Engine
// constants ZOOM_MIN/ZOOM_MAX là UX range thực tế (0.05 - 3), hydrate
// tự clamp về UX range → backward-compat automatic.
export const cameraSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  zoom: z.number().min(0.01).max(20).default(1),
});
export type Camera = z.infer<typeof cameraSchema>;

// --- Board ---
// Phase 1 chỉ có board 'default'. Phase 4 nhiều board nested qua parentId.
export const boardSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable().default(null), // Phase 4
  camera: cameraSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Board = z.infer<typeof boardSchema>;

// --- Constants ---
export const DEFAULT_BOARD_ID = 'default';
/** Absolute safety floor. Dynamic content-aware min zoom sẽ clamp cao hơn. */
export const ZOOM_MIN = 0.05;
/** Milanote-like 300% max. Không content-aware, luôn constant. */
export const ZOOM_MAX = 3;
export const MIN_OBJECT_SIZE = 40;

// --- Helpers ---
export function makeDefaultBoard(): Board {
  const now = new Date().toISOString();
  return {
    // UUID để tương thích cả IndexedDB legacy (id='default' vẫn work qua loadRootBoard
    // semantic parentId=null) và Supabase UUID column constraint.
    id: crypto.randomUUID(),
    name: 'Home',
    parentId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

/** Semantic check: board có phải root board không? Prefer over compare id === DEFAULT_BOARD_ID. */
export function isRootBoard(board: Board): boolean {
  return board.parentId === null;
}
