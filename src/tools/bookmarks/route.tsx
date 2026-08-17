import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  Check,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import BookmarksSkeleton from './components/BookmarksSkeleton';
import { BookmarkOverlay } from './components/BookmarkBackground';
import { BookmarkHeader } from './components/BookmarkHeader';
import { getPublicUrl } from '@/lib/basename';
import { BookmarkStatusBar } from './components/BookmarkStatusBar';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { EmptyState, ErrorState } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useQueryClient } from '@tanstack/react-query';
import { workspaceRpc, workspaceInsert } from '@/lib/workspace/client';

import {
  QK,
  useBookmarkCategories,
  useBookmarkProfile,
  useBookmarks,
  useCreateBookmark,
  useCreateCategory,
  useDeleteBookmark,
  useDeleteCategory,
  useEnsureBookmarkProfile,
  useReorderBookmarks,
  useReorderCategories,
  useUpdateBookmark,
  useUpdateBookmarkProfile,
  useUpdateCategory,
} from './api';
import { useBookmarksStore } from './store';
import CategoryBlock from './components/CategoryBlock';
import BookmarkEditDialog from './components/BookmarkEditDialog';
import SettingsDialog from './components/SettingsDialog';
import BookmarkPageStyle from './components/BookmarkPageStyle';
import CustomCssEditor from './components/CustomCssEditor';
import type { Bookmark, BookmarkCategory } from './types';
import { CATEGORY_NAME_MAX } from './schemas';
import { fetchBookmarkMeta } from './lib/edge-functions';
import {
  isBookmarkPayload,
  isCategoryPayload,
} from './lib/pdnd-types';

// ============================================================
// BookmarksEdit — main edit page (owner)
//
// Drag-and-drop powered by `@atlaskit/pragmatic-drag-and-drop`:
//   - draggable / dropTarget declarations live inside BookmarkItem &
//     CategoryBlock (per-element useEffect).
//   - A single top-level `monitorForElements` here observes all drops and
//     commits the reorder to Zustand/TanStack Query cache.
//   - Visual state (dragging, closest edge) tracked as data-* attributes
//     via CSS — no React state cascade during drag → smooth 60fps.
// ============================================================

const OPEN_ALL_CONFIRM_THRESHOLD = 10;

const EMPTY_BOOKMARKS: Bookmark[] = [];

// Temp ID prefix cho pending category tạo trong edit mode (chưa commit lên
// server). Save button collect items có prefix này → gọi createCategory
// mutation để tạo thật. Cancel → filter chúng khỏi cache.
//
// Prefix `__pending_cat_` khác với `temp_cat_` mà `useCreateCategory` dùng
// cho optimistic update → không nhầm 2 cái với nhau.
const TEMP_CAT_PREFIX = '__pending_cat_';
const isTempCatId = (id: string) => id.startsWith(TEMP_CAT_PREFIX);

// Chọn column có ít category nhất để append category mới. Same logic
// with `pickShortestColumn` trong api.ts (không exported, inline here).
function pickShortestColumn(cats: BookmarkCategory[], colCount: number): number {
  const counts = Array.from({ length: colCount }, (_, i) =>
    cats.filter((c) => c.columnIndex === i).length,
  );
  return counts.indexOf(Math.min(...counts));
}

export default function BookmarksEdit() {
  const authProfile = useAuthStore((s) => s.profile);
  const profileQuery = useBookmarkProfile();
  const ensureProfile = useEnsureBookmarkProfile();
  const updateProfile = useUpdateBookmarkProfile();

  const categoriesQuery = useBookmarkCategories();
  const bookmarksQuery = useBookmarks();

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const reorderCategories = useReorderCategories();

  const createBookmark = useCreateBookmark();
  const updateBookmark = useUpdateBookmark();
  const deleteBookmark = useDeleteBookmark();
  const reorderBookmarks = useReorderBookmarks();
  const qc = useQueryClient();

  const search = useBookmarksStore((s) => s.search);
  const setSearch = useBookmarksStore((s) => s.setSearch);
  const dialog = useBookmarksStore((s) => s.dialog);
  const openDialog = useBookmarksStore((s) => s.openDialog);
  const closeDialog = useBookmarksStore((s) => s.closeDialog);
  const editMode = useBookmarksStore((s) => s.editMode);
  const setEditMode = useBookmarksStore((s) => s.setEditMode);

  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [hoverTitleByCat, setHoverTitleByCat] = useState<Record<string, string | null>>({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Snapshot only fields that are DEFERRED in edit mode.
  const [snapshot, setSnapshot] = useState<{
    categories: Map<string, { orderIndex: number; columnIndex: number; name: string; hiddenFromPublic: boolean }>;
    bookmarks: Map<string, { orderIndex: number; categoryId: string }>;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cssEditorOpen, setCssEditorOpen] = useState(false);

  // Reset edit mode on mount
  useEffect(() => {
    setEditMode(false);
  }, [setEditMode]);

  const enrichedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (
      profileQuery.isSuccess &&
      profileQuery.data === null &&
      authProfile &&
      !ensureProfile.isPending
    ) {
      ensureProfile.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.isSuccess, profileQuery.data, authProfile?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('');
        searchRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearch]);

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const bookmarks = useMemo(() => bookmarksQuery.data ?? [], [bookmarksQuery.data]);

  useEffect(() => {
    const targets = bookmarks.filter(
      (b) =>
        b.iconType === 'image' &&
        !b.faviconUrl &&
        !b.id.startsWith('temp_') &&
        !enrichedRef.current.has(b.id),
    );
    if (targets.length === 0) return;
    for (const b of targets) {
      enrichedRef.current.add(b.id);
      fetchBookmarkMeta(b.url)
        .then((meta) => {
          if (meta.faviconUrl) {
            updateBookmark.mutate({
              id: b.id,
              faviconUrl: meta.faviconUrl,
              ...(!b.title && meta.title ? { title: meta.title } : {}),
            });
          }
        })
        .catch(() => {
          // ignore
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarks]);

  const bookmarksByCategory = useMemo(() => {
    const map = new Map<string, Bookmark[]>();
    for (const b of bookmarks) {
      const arr = map.get(b.categoryId) ?? [];
      arr.push(b);
      map.set(b.categoryId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.orderIndex - b.orderIndex);
    return map;
  }, [bookmarks]);

  const matchesSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return () => true;
    return (b: Bookmark) =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      b.note.toLowerCase().includes(q);
  }, [search]);

  const categoryHasMatch = useMemo(() => {
    if (!search.trim()) return () => true;
    return (cat: BookmarkCategory) => {
      const list = bookmarksByCategory.get(cat.id) ?? [];
      return list.some(matchesSearch);
    };
  }, [search, bookmarksByCategory, matchesSearch]);

  // ============================================================
  // Local cache mutators (deferred in edit mode)
  // ============================================================

  function applyCategoryPatchLocal(id: string, patch: Partial<BookmarkCategory>) {
    qc.setQueryData<BookmarkCategory[]>(QK.categories(), (old) =>
      (old ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function applyReorderCategoriesLocal(
    ordered: Array<{ id: string; orderIndex: number; columnIndex?: number }>,
  ) {
    const map = new Map(ordered.map((o) => [o.id, o]));
    qc.setQueryData<BookmarkCategory[]>(QK.categories(), (old) =>
      (old ?? [])
        .map((c) => {
          const p = map.get(c.id);
          if (!p) return c;
          return {
            ...c,
            orderIndex: p.orderIndex,
            columnIndex: p.columnIndex ?? c.columnIndex,
          };
        })
        .sort((a, b) =>
          a.columnIndex !== b.columnIndex
            ? a.columnIndex - b.columnIndex
            : a.orderIndex - b.orderIndex,
        ),
    );
  }

  function applyReorderBookmarksLocal(
    ordered: Array<{ id: string; orderIndex: number; categoryId?: string }>,
  ) {
    const map = new Map(ordered.map((o) => [o.id, o]));
    qc.setQueryData<Bookmark[]>(QK.items(), (old) =>
      (old ?? []).map((b) => {
        const p = map.get(b.id);
        if (!p) return b;
        return { ...b, orderIndex: p.orderIndex, categoryId: p.categoryId ?? b.categoryId };
      }),
    );
  }

  // ============================================================
  // PDND: top-level monitor for reorder commit on drop
  //
  // Use commitRef pattern to keep monitor subscribed ONCE while still
  // accessing latest categories/bookmarks/editMode via closure.
  // ============================================================

  const commitRef = useRef<((source: Record<string, unknown>, target: Record<string, unknown> | null) => void) | null>(null);

  commitRef.current = (source, target) => {
    if (!target) return;

    // ----- Bookmark drop -----
    if (isBookmarkPayload(source)) {
      const activeBookmark = bookmarks.find((b) => b.id === source.id);
      if (!activeBookmark) return;

      let targetCategoryId: string;
      let insertIdx: number;

      if (isBookmarkPayload(target)) {
        if (target.id === source.id) return; // dropped on self
        targetCategoryId = target.categoryId;
        const edge = extractClosestEdge(target);
        const catBms = (bookmarksByCategory.get(targetCategoryId) ?? []).filter(
          (b) => b.id !== source.id,
        );
        const overIdx = catBms.findIndex((b) => b.id === target.id);
        if (overIdx === -1) return;
        insertIdx = overIdx + (edge === 'right' ? 1 : 0);
      } else if (target.type === 'category-tail' && typeof target.categoryId === 'string') {
        targetCategoryId = target.categoryId;
        const catBms = (bookmarksByCategory.get(targetCategoryId) ?? []).filter(
          (b) => b.id !== source.id,
        );
        insertIdx = catBms.length; // append
      } else {
        return; // unknown drop target
      }

      // Skip no-op: same category + same effective position
      if (activeBookmark.categoryId === targetCategoryId) {
        const sourceCatBms = bookmarksByCategory.get(activeBookmark.categoryId) ?? [];
        const sourceIdx = sourceCatBms.findIndex((b) => b.id === source.id);
        if (sourceIdx === insertIdx) return;
      }

      const targetList = (bookmarksByCategory.get(targetCategoryId) ?? []).filter(
        (b) => b.id !== source.id,
      );
      const nextTarget = [...targetList];
      nextTarget.splice(insertIdx, 0, { ...activeBookmark, categoryId: targetCategoryId });
      const payload = nextTarget.map((b, idx) => ({
        id: b.id,
        orderIndex: idx,
        categoryId: b.id === source.id ? targetCategoryId : undefined,
      }));

      if (editMode) {
        applyReorderBookmarksLocal(payload);
      } else {
        reorderBookmarks.mutate(payload);
      }
      return;
    }

    // ----- Category drop -----
    if (isCategoryPayload(source)) {
      const activeCat = categories.find((c) => c.id === source.id);
      if (!activeCat) return;

      let targetColumn: number;
      let insertIdx: number;

      if (isCategoryPayload(target)) {
        if (target.id === source.id) return;
        targetColumn = target.columnIndex;
        const edge = extractClosestEdge(target);
        const colCats = categories
          .filter((c) => c.columnIndex === targetColumn && c.id !== source.id)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const overIdx = colCats.findIndex((c) => c.id === target.id);
        if (overIdx === -1) return;
        insertIdx = overIdx + (edge === 'bottom' ? 1 : 0);
      } else if (target.type === 'column-container' && typeof target.columnIndex === 'number') {
        targetColumn = target.columnIndex;
        const colCats = categories
          .filter((c) => c.columnIndex === targetColumn && c.id !== source.id)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        insertIdx = colCats.length;
      } else {
        return;
      }

      // Skip no-op
      if (activeCat.columnIndex === targetColumn) {
        const sourceColCats = categories
          .filter((c) => c.columnIndex === activeCat.columnIndex)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const sourceIdx = sourceColCats.findIndex((c) => c.id === source.id);
        // In this column, insertIdx is in list-without-source. sourceIdx is in
        // list-WITH-source. Compare properly.
        const sourceIdxInWithout = sourceIdx; // already effectively without after filter of source
        if (sourceIdxInWithout === insertIdx) return;
      }

      const targetList = categories
        .filter((c) => c.columnIndex === targetColumn && c.id !== source.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const nextTarget = [...targetList];
      nextTarget.splice(insertIdx, 0, { ...activeCat, columnIndex: targetColumn });

      const payload: Array<{ id: string; orderIndex: number; columnIndex?: number }> = [];
      nextTarget.forEach((c, idx) => {
        payload.push({
          id: c.id,
          orderIndex: idx,
          columnIndex: c.id === source.id ? targetColumn : undefined,
        });
      });

      // Re-order source column if cross-column
      if (targetColumn !== activeCat.columnIndex) {
        const sourceList = categories
          .filter((c) => c.columnIndex === activeCat.columnIndex && c.id !== source.id)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        sourceList.forEach((c, idx) => {
          payload.push({ id: c.id, orderIndex: idx });
        });
      }

      if (editMode) {
        applyReorderCategoriesLocal(payload);
      } else {
        reorderCategories.mutate(payload);
      }
    }
  };

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0]?.data ?? null;
        commitRef.current?.(source.data, target);
      },
    });
  }, []); // subscribed once

  // ============================================================
  // Handlers (non-DnD)
  // ============================================================

  function handleQuickAdd(categoryId: string, url: string) {
    if (isTempCatId(categoryId)) {
      toast.error('Vui lòng Save category trước khi thêm bookmark');
      return;
    }
    createBookmark.mutate({ categoryId, url });
  }

  function handleOpenAll(cat: BookmarkCategory) {
    const list = bookmarksByCategory.get(cat.id) ?? [];
    if (list.length === 0) return;
    if (list.length > OPEN_ALL_CONFIRM_THRESHOLD) {
      if (!window.confirm(`Mở ${list.length} tab? Trình duyệt có thể chặn popup.`)) return;
    }
    const target = profileData?.openInSameTab ? '_self' : '_blank';
    for (const b of list) window.open(b.url, target, 'noopener,noreferrer');
  }

  function handleDeleteCategory(cat: BookmarkCategory) {
    const count = bookmarksByCategory.get(cat.id)?.length ?? 0;
    const msg =
      count > 0
        ? `Xoá category "${cat.name}" và ${count} bookmark bên trong?`
        : `Xoá category "${cat.name}"?`;
    if (!window.confirm(msg)) return;

    // Temp cat (chưa commit lên server) → chỉ xóa cache, không fire API
    if (isTempCatId(cat.id)) {
      qc.setQueryData<BookmarkCategory[]>(QK.categories(), (old) =>
        (old ?? []).filter((c) => c.id !== cat.id),
      );
      // Cascade: xóa luôn bookmarks trong temp cat (nếu có)
      qc.setQueryData<Bookmark[]>(QK.items(), (old) =>
        (old ?? []).filter((b) => b.categoryId !== cat.id),
      );
      return;
    }

    deleteCategory.mutate(cat.id, {
      onSuccess: () => toast.success('Đã xoá category'),
      onError: (e) => toast.error('Lỗi xoá: ' + (e as Error).message),
    });
  }

  function submitNewCategory(e: FormEvent) {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;

    if (editMode) {
      // Defer: chỉ add vào cache với temp ID. Commit lên server khi Save.
      const colIdx = pickShortestColumn(categories, columnCount);
      const orderIndex = categories.filter((c) => c.columnIndex === colIdx).length;
      const now = new Date().toISOString();
      const tempCat: BookmarkCategory = {
        id: `${TEMP_CAT_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId: authProfile?.id ?? '',
        name,
        columnIndex: colIdx,
        orderIndex,
        hiddenFromPublic: false,
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<BookmarkCategory[]>(QK.categories(), (old) => [...(old ?? []), tempCat]);
      setNewCategoryName('');
      return;
    }

    createCategory.mutate(
      { name },
      {
        onSuccess: () => toast.success('Đã tạo category'),
        onError: (e) => toast.error('Lỗi tạo: ' + (e as Error).message),
      },
    );
    setNewCategoryName('');
  }

  function handleEnterEditMode() {
    setSnapshot({
      categories: new Map(
        categories.map((c) => [
          c.id,
          {
            orderIndex: c.orderIndex,
            columnIndex: c.columnIndex,
            name: c.name,
            hiddenFromPublic: c.hiddenFromPublic,
          },
        ]),
      ),
      bookmarks: new Map(
        bookmarks.map((b) => [b.id, { orderIndex: b.orderIndex, categoryId: b.categoryId }]),
      ),
    });
    setEditMode(true);
  }

  function handleCancelEditMode() {
    if (snapshot) {
      // Filter out temp cats (created trong edit mode) + restore deferred
      // fields của các cat còn lại. Bookmarks trong temp cat cũng bị xóa
      // (cascade — orphan bookmarks không có sense).
      qc.setQueryData<BookmarkCategory[]>(QK.categories(), (old) =>
        (old ?? [])
          .filter((c) => !isTempCatId(c.id))
          .map((c) => {
            const snap = snapshot.categories.get(c.id);
            if (!snap) return c;
            return {
              ...c,
              orderIndex: snap.orderIndex,
              columnIndex: snap.columnIndex,
              name: snap.name,
              hiddenFromPublic: snap.hiddenFromPublic,
            };
          }),
      );
      qc.setQueryData<Bookmark[]>(QK.items(), (old) =>
        (old ?? [])
          .filter((b) => !isTempCatId(b.categoryId))
          .map((b) => {
            const snap = snapshot.bookmarks.get(b.id);
            if (!snap) return b;
            return { ...b, orderIndex: snap.orderIndex, categoryId: snap.categoryId };
          }),
      );
    }
    setSnapshot(null);
    setEditMode(false);
  }

  async function handleSaveEditMode() {
    if (!snapshot) {
      setEditMode(false);
      return;
    }
    setSavingEdit(true);
    try {
      // === Step 1: Commit pending category creates ===
      // Dùng workspaceInsert trực tiếp (bypass createCategory mutation) vì:
      //   - createCategory.mutateAsync không nhận orderIndex, luôn append cuối
      //   - Mutation optimistic update ghi đè cache → visual glitch (cat
      //     nhảy về column mặc định) trước khi batch_update fix về vị trí đúng.
      // Insert trực tiếp với FULL position user đã drag → server tạo đúng chỗ
      // ngay lần đầu, không cần batch_update cột nữa.
      const tempCats = categories.filter((c) => isTempCatId(c.id));
      const catIdMap = new Map<string, string>(); // temp → real

      for (const tempCat of tempCats) {
        const row = await workspaceInsert<{ id: string }>('bookmark_categories', {
          name: tempCat.name,
          column_index: tempCat.columnIndex,
          order_index: tempCat.orderIndex,
          hidden_from_public: tempCat.hiddenFromPublic,
        });
        catIdMap.set(tempCat.id, row.id);
      }

      // Sau khi insert xong, thay temp ID trong cache bằng real ID → tránh
      // visual glitch khi invalidate refetch cuối flow. Preserve position.
      if (catIdMap.size > 0) {
        qc.setQueryData<BookmarkCategory[]>(QK.categories(), (old) =>
          (old ?? []).map((c) => {
            const realId = catIdMap.get(c.id);
            return realId ? { ...c, id: realId } : c;
          }),
        );
      }

      // === Step 2: Batch update existing categories (rename/reorder/toggle).
      // Newly-created cats KHÔNG cần batch_update nữa vì đã insert với đúng
      // position. Chỉ diff các cat có trong snapshot.
      const catItems: Array<{ id: string; patch: Record<string, unknown> }> = [];
      for (const c of categories) {
        if (isTempCatId(c.id)) continue; // Skip temps — đã insert ở step 1
        const orig = snapshot.categories.get(c.id);
        if (!orig) continue;
        const patch: Record<string, unknown> = {};
        if (orig.name !== c.name) patch.name = c.name;
        if (orig.hiddenFromPublic !== c.hiddenFromPublic) patch.hidden_from_public = c.hiddenFromPublic;
        if (orig.orderIndex !== c.orderIndex) patch.order_index = c.orderIndex;
        if (orig.columnIndex !== c.columnIndex) patch.column_index = c.columnIndex;
        if (Object.keys(patch).length > 0) catItems.push({ id: c.id, patch });
      }

      const bmItems: Array<{ id: string; patch: Record<string, unknown> }> = [];
      for (const b of bookmarks) {
        const orig = snapshot.bookmarks.get(b.id);
        if (!orig) continue;
        const patch: Record<string, unknown> = {};
        if (orig.orderIndex !== b.orderIndex) patch.order_index = b.orderIndex;
        if (orig.categoryId !== b.categoryId) {
          // categoryId có thể trỏ tới temp cat → map sang real ID
          patch.category_id = catIdMap.get(b.categoryId) ?? b.categoryId;
        }
        if (Object.keys(patch).length > 0) bmItems.push({ id: b.id, patch });
      }

      if (catItems.length > 0) {
        await workspaceRpc('bookmark_batch_update', {
          p_table: 'bookmark_categories',
          p_items: catItems,
        });
      }
      if (bmItems.length > 0) {
        await workspaceRpc('bookmark_batch_update', {
          p_table: 'bookmarks',
          p_items: bmItems,
        });
      }

      const totalChanges = catItems.length + bmItems.length;
      if (totalChanges > 0 || tempCats.length > 0) {
        toast.success(`Đã lưu ${tempCats.length + totalChanges} thay đổi`);
      }
      setSnapshot(null);
      setEditMode(false);

      // Final invalidate để sync state với server (đặc biệt cần cho newly-created)
      qc.invalidateQueries({ queryKey: QK.categories() });
      qc.invalidateQueries({ queryKey: QK.items() });
    } catch (e) {
      toast.error('Lỗi lưu: ' + (e as Error).message);
      qc.invalidateQueries({ queryKey: QK.categories() });
      qc.invalidateQueries({ queryKey: QK.items() });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleImport(items: { url: string; title: string; category: string }[]) {
    if (items.length > 500) {
      toast.error('Tối đa 500 bookmark mỗi lần import');
      return;
    }

    const catNameSet = new Map<string, string>();
    let tempIdCounter = 0;
    const p_categories: Array<{ name: string; temp_id: string }> = [];

    for (const it of items) {
      const cleanName = it.category.trim().slice(0, CATEGORY_NAME_MAX) || 'Imported';
      const key = cleanName.toLowerCase();
      if (!catNameSet.has(key)) {
        const tid = `t_${tempIdCounter++}`;
        catNameSet.set(key, tid);
        p_categories.push({ name: cleanName, temp_id: tid });
      }
    }

    const p_bookmarks = items.map((it) => {
      const cleanName = (it.category.trim().slice(0, CATEGORY_NAME_MAX) || 'Imported').toLowerCase();
      return {
        temp_category_id: catNameSet.get(cleanName)!,
        url: it.url,
        title: it.title,
      };
    });

    try {
      await workspaceRpc('bookmark_bulk_import', { p_categories, p_bookmarks });
      toast.success(`Import ${items.length} bookmark thành công`);
      qc.invalidateQueries({ queryKey: QK.categories() });
      qc.invalidateQueries({ queryKey: QK.items() });
    } catch (e) {
      toast.error('Import thất bại (không có bookmark nào được tạo): ' + (e as Error).message);
    }
  }

  const profileData = profileQuery.data;
  const publicUrl = profileData ? getPublicUrl(`/bookmarks/${profileData.slug}`) : '';

  if (profileQuery.isLoading || categoriesQuery.isLoading || bookmarksQuery.isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <Skeleton className="h-5 w-28 rounded" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </header>
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-1.5">
          <Skeleton className="h-4 w-14 rounded-full" />
          <Skeleton className="h-4 w-32 rounded" />
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <BookmarksSkeleton />
        </div>
      </div>
    );
  }

  if (profileQuery.isError || categoriesQuery.isError || bookmarksQuery.isError) {
    const err = profileQuery.error ?? categoriesQuery.error ?? bookmarksQuery.error;
    return (
      <div className="p-4">
        <ErrorState
          message={(err as Error)?.message ?? 'Lỗi tải dữ liệu'}
          onRetry={() => {
            profileQuery.refetch();
            categoriesQuery.refetch();
            bookmarksQuery.refetch();
          }}
        />
      </div>
    );
  }

  const editingId = dialog.kind === 'bookmark-edit' ? dialog.bookmarkId : null;
  const editingBookmarkResolved = editingId
    ? bookmarks.find((b) => b.id === editingId) ?? null
    : null;

  const columnCount = profileData?.columnCount ?? 3;
  const iconSize = profileData?.iconSize ?? 30;
  const pageIsPublic = profileData?.isPublic ?? false;
  const openInSameTab = profileData?.openInSameTab ?? false;

  const displayLabel =
    profileData?.displayName || authProfile?.username || profileData?.slug || 'User';

  const gridColsClass = ['', 'grid-cols-1', 'grid-cols-1 md:grid-cols-2', 'grid-cols-1 md:grid-cols-3', 'grid-cols-1 md:grid-cols-4'][columnCount];

  return (
    <BookmarkPageStyle
      theme={profileData?.theme ?? 'system'}
      customCss={profileData?.customCss ?? ''}
      profile={profileData ?? undefined}
    >
      <div className="bibo-bookmark-page relative flex h-full flex-col overflow-hidden">
        <BookmarkOverlay
          color={profileData?.backgroundOverlayColor ?? null}
          opacity={profileData?.backgroundOverlayOpacity ?? 0}
          blend={profileData?.backgroundBlendMode ?? 'normal'}
        />
        <header className="bibo-bookmark-header sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="icon" asChild aria-label="Về trang chủ" className="h-8 w-8">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>

            <div className="flex flex-col leading-none">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">Bookmarks</h1>
              {profileData && (
                <span className="bibo-user-info mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {displayLabel}
                  {profileData.spaceName ? ` · ${profileData.spaceName}` : ''}
                </span>
              )}
            </div>

            <div className="relative ml-auto max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label="Search bookmarks"
                className="bibo-search-input h-8 pl-8 pr-16 text-xs"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : (
                  <kbd className="hidden h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                    /
                  </kbd>
                )}
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              {editMode && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5">
                      <FolderPlus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Category</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom">
                    <form onSubmit={submitNewCategory} className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Tên category</label>
                        <Input
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="VD: Dev Tools"
                          className="h-8 text-xs"
                          autoFocus
                          maxLength={CATEGORY_NAME_MAX}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <PopoverClose asChild>
                          <Button variant="outline" size="sm" type="button" className="h-7 text-xs">Huỷ</Button>
                        </PopoverClose>
                        <PopoverClose asChild>
                          <Button size="sm" type="submit" className="h-7 gap-1 text-xs">
                            <Plus className="h-3 w-3" />
                            Tạo
                          </Button>
                        </PopoverClose>
                      </div>
                    </form>
                  </PopoverContent>
                </Popover>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openDialog({ kind: 'settings' })}
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {profileData && (
            <BookmarkStatusBar
              isPublic={pageIsPublic}
              slug={profileData.slug}
              publicUrl={publicUrl}
              onEnablePublic={() => openDialog({ kind: 'settings' })}
              className="border-t border-border/50 px-4 py-1.5"
            />
          )}
        </header>

        <div className="bibo-bookmark-content relative z-10 flex-1 overflow-y-auto p-4">
          {profileData && profileData.showHero && (
            <section className="mx-auto mb-4 w-[90%] max-w-[2250px] px-8">
              <BookmarkHeader
                showHero
                displayName={displayLabel}
                spaceName={profileData.spaceName}
                publicUrl={publicUrl}
                webpage={profileData.webpage}
              />
            </section>
          )}
          {categories.length === 0 ? (
            <EmptyState
              icon={BookmarkIcon}
              title="Chưa có category nào"
              description="Tạo category đầu tiên để bắt đầu thêm bookmark."
              action={
                <p className="text-xs text-muted-foreground/70">
                  Click nút <span className="font-semibold">Category</span> ở header để tạo.
                </p>
              }
            />
          ) : (
            <div
              className={`mx-auto grid w-[90%] max-w-[2250px] gap-6 ${gridColsClass}`}
              style={{
                gridTemplateRows: `repeat(${Math.max(
                  1,
                  ...Array.from({ length: columnCount }, (_, i) =>
                    categories.filter((c) => c.columnIndex === i).length,
                  ),
                )}, auto)`,
              }}
            >
              {Array.from({ length: columnCount }, (_, colIdx) => {
                const colCats = categories
                  .filter((c) => c.columnIndex === colIdx)
                  .sort((a, b) => a.orderIndex - b.orderIndex);
                return (
                  <CategoryColumn key={colIdx} columnIndex={colIdx} readOnly={!editMode}>
                    {colCats.map((cat) => (
                      <div
                        key={cat.id}
                        className="transition-opacity"
                        style={{ opacity: categoryHasMatch(cat) ? 1 : 0.15 }}
                      >
                        <CategoryBlock
                          category={cat}
                          bookmarks={bookmarksByCategory.get(cat.id) ?? EMPTY_BOOKMARKS}
                          hoverTitle={hoverTitleByCat[cat.id] ?? null}
                          matchesSearch={matchesSearch}
                          iconSize={iconSize}
                          iconBackdrop={profileData?.iconBackdrop ?? true}
                          pageIsPublic={pageIsPublic}
                          editMode={editMode}
                          openInSameTab={openInSameTab}
                          readOnly={!editMode}
                          onEditBookmark={(b) => {
                            setEditingBookmark(b);
                            openDialog({ kind: 'bookmark-edit', bookmarkId: b.id });
                          }}
                          onHoverBookmark={(title) =>
                            setHoverTitleByCat((prev) => ({ ...prev, [cat.id]: title }))
                          }
                          onQuickAdd={handleQuickAdd}
                          onOpenAll={() => handleOpenAll(cat)}
                          onToggleHidden={() => {
                            if (editMode) {
                              applyCategoryPatchLocal(cat.id, {
                                hiddenFromPublic: !cat.hiddenFromPublic,
                              });
                            } else {
                              updateCategory.mutate({
                                id: cat.id,
                                hiddenFromPublic: !cat.hiddenFromPublic,
                              });
                            }
                          }}
                          onRename={(name) => {
                            if (editMode) {
                              applyCategoryPatchLocal(cat.id, { name });
                            } else {
                              updateCategory.mutate({ id: cat.id, name });
                            }
                          }}
                          onDelete={() => handleDeleteCategory(cat)}
                        />
                      </div>
                    ))}
                  </CategoryColumn>
                );
              })}
            </div>
          )}
        </div>

        {/* Dialogs */}
        <BookmarkEditDialog
          open={dialog.kind === 'bookmark-edit'}
          bookmark={editingBookmarkResolved ?? editingBookmark}
          categories={categories}
          onClose={closeDialog}
          onSubmit={(patch) => {
            updateBookmark.mutate(patch, {
              onSuccess: () => {
                toast.success('Đã cập nhật');
                closeDialog();
              },
              onError: (e) => toast.error('Lỗi: ' + (e as Error).message),
            });
          }}
          onDelete={(id) => {
            deleteBookmark.mutate(id, {
              onSuccess: () => {
                toast.success('Đã xoá');
                closeDialog();
              },
            });
          }}
          isSubmitting={updateBookmark.isPending || deleteBookmark.isPending}
        />

        <SettingsDialog
          open={dialog.kind === 'settings'}
          profile={profileData ?? null}
          categories={categories}
          bookmarks={bookmarks}
          onClose={closeDialog}
          onSave={(patch) =>
            updateProfile.mutate(patch, {
              onSuccess: () => {
                toast.success('Đã lưu settings');
                closeDialog();
              },
              onError: (e) => toast.error('Lỗi: ' + (e as Error).message),
            })
          }
          onImport={handleImport}
          onOpenCssEditor={() => {
            closeDialog();
            setCssEditorOpen(true);
          }}
          isSubmitting={updateProfile.isPending}
        />

        {cssEditorOpen && profileData && (
          <CustomCssEditor
            profile={profileData}
            categories={categories}
            bookmarks={bookmarks}
            onClose={() => {
              setCssEditorOpen(false);
              openDialog({ kind: 'settings' });
            }}
            isSaving={updateProfile.isPending}
          />
        )}

        {/* Floating edit-mode toggle */}
        <div className="fixed bottom-4 right-4 z-20 flex items-center gap-2">
          {editMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEditMode}
                disabled={savingEdit}
                className="gap-1.5 shadow-lg"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEditMode}
                disabled={savingEdit}
                className="gap-1.5 shadow-lg"
              >
                <Check className="h-3.5 w-3.5" />
                {savingEdit ? 'Đang lưu…' : 'Save'}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleEnterEditMode} className="gap-1.5 shadow-lg">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </div>
    </BookmarkPageStyle>
  );
}

// ============================================================
// CategoryColumn — 1 of N columns. Simple wrapper that acts as
// dropTarget for category-drag when column is empty (or cursor falls
// between categories). Individual category BEFORE/AFTER handled by
// CategoryBlock's own dropTarget with closest-edge.
// ============================================================

interface CategoryColumnProps {
  columnIndex: number;
  readOnly: boolean;
  children: React.ReactNode;
}

function CategoryColumn({ columnIndex, readOnly, children }: CategoryColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (readOnly) return;
    const el = ref.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => isCategoryPayload(source.data),
      getData: () => ({
        type: 'column-container',
        columnIndex,
      }),
      onDragEnter: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
      onDrop: () => setDragOver(false),
    });
  }, [columnIndex, readOnly]);

  const isEmpty = Array.isArray(children)
    ? (children as React.ReactNode[]).filter(Boolean).length === 0
    : !children;

  return (
    <div
      ref={ref}
      className={cn(
        'bibo-bookmark-col grid min-h-[120px] gap-6 rounded-xl border border-dashed p-2 transition-colors duration-150 [grid-template-rows:subgrid] [grid-row:1/-1]',
        dragOver && isEmpty
          ? 'border-primary/50 bg-primary/5'
          : isEmpty
            ? 'border-border/40'
            : 'border-transparent',
      )}
    >
      {children}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <FolderPlus className="h-4 w-4 text-muted-foreground/40" />
          <p className="text-[11px] text-muted-foreground/60">Kéo category vào đây</p>
        </div>
      )}
    </div>
  );
}
