// ============================================================
// Canvas — Object registry (module-level singleton)
// ============================================================
//
// Register object type → renderer + default geometry + default data.
// KHÔNG dùng React context / hook state — registry là static map,
// register 1 lần ở module load, không thay đổi runtime.
//
// Naming: `useObjectRegistry` giữ theo spec dù không phải React hook.
// Actually exports plain functions. Rename sau nếu cần.
//
// Rule extensibility: engine chỉ chạm { type, geometry, id, boardId,
// zIndex }. Renderer nhận `object` full + `isSelected`, tự quyết
// render `data`. Không leak content-specific field ra engine.
// ============================================================

import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react';
import type { CanvasObject, Geometry } from '../types';

export interface ObjectRendererProps {
  object: CanvasObject;
  isSelected: boolean;
  /** Phase 2: true khi user double-click enter edit mode. */
  isEditing?: boolean;
  /** Renderer gọi khi finish edit (blur/Escape/Ctrl+Enter). Commit
   *  UpdateCommand nếu content đổi rồi call callback. */
  onEditEnd?: () => void;
}

/**
 * Renderer phải là `forwardRef<HTMLElement, ObjectRendererProps>` component.
 * Ref cần thiết cho engine imperative transform khi drag/resize (Task 6-9).
 */
export type ObjectRenderer = ForwardRefExoticComponent<
  PropsWithoutRef<ObjectRendererProps> & RefAttributes<HTMLElement>
>;

export interface ObjectTypeDefinition<D = unknown> {
  type: string;
  renderer: ObjectRenderer;
  /** Default geometry khi tạo mới (position sẽ được override lúc create). */
  defaultGeometry: Omit<Geometry, 'x' | 'y'>;
  /** Default data payload. */
  defaultData: D;
  /** Human-readable label cho context menu (VD "Add rect"). */
  label: string;
}

// Module-level registry.
const registry = new Map<string, ObjectTypeDefinition>();

/** Register object type. Overwrite nếu đã tồn tại (dev HMR OK). */
export function registerObjectType<D = unknown>(def: ObjectTypeDefinition<D>) {
  registry.set(def.type, def as ObjectTypeDefinition);
}

/** Get definition by type. Return undefined nếu chưa register. */
export function getObjectTypeDefinition(type: string): ObjectTypeDefinition | undefined {
  return registry.get(type);
}

/** List tất cả type đã register (cho context menu Add options). */
export function getAllObjectTypes(): ObjectTypeDefinition[] {
  return Array.from(registry.values());
}

/** Reset registry — test only. */
export function __resetRegistry() {
  registry.clear();
}
