// ============================================================
// PDND drag payload types + type-guard helpers
//
// pragmatic-drag-and-drop passes data as `Record<string, unknown>` (loose
// typing intentional — drop targets can accept many source shapes). We
// type-guard at boundaries to keep the rest of the code type-safe.
// ============================================================

export const PDND_BOOKMARK_TYPE = 'bookmark' as const;
export const PDND_CATEGORY_TYPE = 'category' as const;

/**
 * Base payload shape — PDND wants `Record<string, unknown>` compatible.
 * All payload types below intersect this to satisfy the constraint while
 * still exposing typed properties.
 */
type LooseRecord = Record<string, unknown>;

/** Payload carried by a dragged bookmark tile. */
export type BookmarkPayload = LooseRecord & {
  type: typeof PDND_BOOKMARK_TYPE;
  id: string;
  categoryId: string;
};

/** Payload carried by a dragged category header. */
export type CategoryPayload = LooseRecord & {
  type: typeof PDND_CATEGORY_TYPE;
  id: string;
  columnIndex: number;
};

/**
 * Payload attached to a drop target for empty category (bookmark tail).
 * Marks the "drop anywhere in this category" fallback target.
 */
export type CategoryContainerPayload = LooseRecord & {
  type: 'category-container';
  categoryId: string;
};

/** Payload for the drop target of an empty column (category tail). */
export type ColumnContainerPayload = LooseRecord & {
  type: 'column-container';
  columnIndex: number;
};

export function isBookmarkPayload(
  data: Record<string, unknown>,
): data is BookmarkPayload {
  return data.type === PDND_BOOKMARK_TYPE;
}

export function isCategoryPayload(
  data: Record<string, unknown>,
): data is CategoryPayload {
  return data.type === PDND_CATEGORY_TYPE;
}

export function isCategoryContainerPayload(
  data: Record<string, unknown>,
): data is CategoryContainerPayload {
  return data.type === 'category-container';
}

export function isColumnContainerPayload(
  data: Record<string, unknown>,
): data is ColumnContainerPayload {
  return data.type === 'column-container';
}
