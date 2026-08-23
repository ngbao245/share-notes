// ============================================================
// Canvas — Row (Supabase) ↔ Domain (in-memory) mappers
// ============================================================
//
// Row shape: snake_case, có user_id, deleted_at.
// Domain shape (types.ts): camelCase, không user_id (client-scope
// đã filtered), không deleted_at (soft delete filter tại repository layer).
//
// Migration (Task 6) + SupabaseCanvasRepository (Task 3) dùng.
// ============================================================

import type { CanvasObject, Board, Camera, Geometry } from '../types';

// --- Row shapes (Supabase columns) ---

export interface CanvasObjectRow {
  id: string;
  user_id: string;
  board_id: string | null;
  type: string;
  geometry: Geometry;
  data: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CanvasBoardRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  camera: Camera;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// --- Object mappers ---

export function objectRowToDomain(row: CanvasObjectRow): CanvasObject {
  return {
    id: row.id,
    type: row.type,
    boardId: row.board_id,
    geometry: row.geometry,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Full domain → row cho INSERT. Không include user_id (server inject).
 * Không include created_at / updated_at (server default).
 * Include deleted_at = null explicit (rõ nghĩa cho debug).
 */
export function objectDomainToRow(obj: CanvasObject): Record<string, unknown> {
  return {
    id: obj.id,
    board_id: obj.boardId,
    type: obj.type,
    geometry: obj.geometry,
    data: obj.data,
    deleted_at: null,
  };
}

/**
 * Partial domain patch → partial row cho UPDATE.
 * Bỏ qua id / user_id / createdAt / updatedAt (immutable hoặc server-managed).
 */
export function objectPatchToRow(patch: Partial<CanvasObject>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('boardId' in patch) row.board_id = patch.boardId;
  if ('type' in patch) row.type = patch.type;
  if ('geometry' in patch) row.geometry = patch.geometry;
  if ('data' in patch) row.data = patch.data;
  return row;
}

// --- Board mappers ---

export function boardRowToDomain(row: CanvasBoardRow): Board {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    camera: row.camera,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function boardDomainToRow(board: Board): Record<string, unknown> {
  return {
    id: board.id,
    parent_id: board.parentId,
    name: board.name,
    camera: board.camera,
    deleted_at: null,
  };
}

export function boardPatchToRow(patch: Partial<Board>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('parentId' in patch) row.parent_id = patch.parentId;
  if ('name' in patch) row.name = patch.name;
  if ('camera' in patch) row.camera = patch.camera;
  return row;
}
