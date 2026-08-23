import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';
import { useHistoryStore } from '../../engine/commands/history';
import { updateCommand } from '../../engine/commands/update';
import { ObjectShell } from './ObjectShell';

// ============================================================
// TodoListObject — Milanote-style todo list card
// ============================================================
//
// Data: { title, items: [{ id, text, done }] }
//
// Interactions:
//   - Click title/item text → focus input (draft local, commit on blur)
//   - Click checkbox → toggle done (immediate commit)
//   - Enter tại item cuối → add new + focus
//   - Backspace tại item empty → delete item + focus prev
//   - "+ Add item" button → add + focus
//   - Trash icon per-item → delete
//   - Drag grip → reorder trong list (Phase 3 Task 4)
//
// Text edits batch commit khi blur (không per-keystroke → tránh
// UpdateCommand storm).
// ============================================================

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface TodoListData {
  title: string;
  items: TodoItem[];
}

const TodoListObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected }, ref) => {
    const data = object.data as TodoListData;

    // Local draft cho text edits (title + item text).
    const [draftTitle, setDraftTitle] = useState(data.title);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const itemInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    // Reorder drag state
    const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
    const [dropIdx, setDropIdx] = useState<number | null>(null);
    const dragStateRef = useRef<{
      startY: number;
      itemHeight: number;
      pointerId: number;
    } | null>(null);

    // Sync draft khi data change external (undo).
    useEffect(() => {
      setDraftTitle(data.title);
    }, [data.title]);
    useEffect(() => {
      setDrafts({});
    }, [data.items]);

    const commitData = useCallback(
      (next: TodoListData) => {
        useHistoryStore.getState().push(
          updateCommand(
            object.id,
            { data: { ...data } as unknown as Record<string, unknown> },
            { data: next as unknown as Record<string, unknown> }
          )
        );
      },
      [object.id, data]
    );

    const commitTitle = () => {
      if (draftTitle === data.title) return;
      commitData({ ...data, title: draftTitle });
    };

    const commitItemText = (itemId: string) => {
      const draft = drafts[itemId];
      if (draft === undefined) return;
      const item = data.items.find((i) => i.id === itemId);
      if (!item || item.text === draft) {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        return;
      }
      const nextItems = data.items.map((i) =>
        i.id === itemId ? { ...i, text: draft } : i
      );
      commitData({ ...data, items: nextItems });
    };

    const toggleDone = (itemId: string) => {
      const nextItems = data.items.map((i) =>
        i.id === itemId ? { ...i, done: !i.done } : i
      );
      commitData({ ...data, items: nextItems });
    };

    const addItem = (afterIdx?: number, initialText = '') => {
      const newItem: TodoItem = {
        id: crypto.randomUUID(),
        text: initialText,
        done: false,
      };
      const idx = afterIdx === undefined ? data.items.length : afterIdx + 1;
      const nextItems = [
        ...data.items.slice(0, idx),
        newItem,
        ...data.items.slice(idx),
      ];
      commitData({ ...data, items: nextItems });

      // Focus new item next tick.
      setTimeout(() => {
        itemInputRefs.current.get(newItem.id)?.focus();
      }, 0);
    };

    const deleteItem = (itemId: string) => {
      const idx = data.items.findIndex((i) => i.id === itemId);
      if (idx === -1) return;
      const nextItems = data.items.filter((i) => i.id !== itemId);
      commitData({ ...data, items: nextItems });
      // Focus prev
      setTimeout(() => {
        const prev = data.items[idx - 1];
        if (prev) itemInputRefs.current.get(prev.id)?.focus();
      }, 0);
    };

    // --- Reorder drag ---
    const handleGripDown = (
      e: React.PointerEvent<HTMLDivElement>,
      idx: number
    ) => {
      e.stopPropagation();
      e.preventDefault();
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-todo-item]');
      if (!li) return;
      const itemHeight = li.getBoundingClientRect().height;
      dragStateRef.current = {
        startY: e.clientY,
        itemHeight,
        pointerId: e.pointerId,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDraggingIdx(idx);
      setDropIdx(idx);
    };

    const handleGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (state === null || draggingIdx === null) return;
      const dy = e.clientY - state.startY;
      const offset = Math.round(dy / state.itemHeight);
      const next = Math.max(
        0,
        Math.min(data.items.length - 1, draggingIdx + offset)
      );
      if (next !== dropIdx) setDropIdx(next);
    };

    const handleGripUp = (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }
      dragStateRef.current = null;
      if (
        state === null ||
        draggingIdx === null ||
        dropIdx === null ||
        draggingIdx === dropIdx
      ) {
        setDraggingIdx(null);
        setDropIdx(null);
        return;
      }
      const items = [...data.items];
      const [moved] = items.splice(draggingIdx, 1);
      items.splice(dropIdx, 0, moved);
      commitData({ ...data, items });
      setDraggingIdx(null);
      setDropIdx(null);
    };

    return (
      <ObjectShell
        ref={ref as React.Ref<HTMLDivElement>}
        object={object}
        isSelected={isSelected}
        className="flex flex-col"
      >
        {/* Title */}
        <input
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTitle();
              if (data.items.length > 0) {
                itemInputRefs.current.get(data.items[0].id)?.focus();
              } else {
                addItem();
              }
            }
          }}
          placeholder="Todo list"
          className="border-b border-border/60 bg-transparent px-3 py-2 text-base font-semibold text-foreground outline-none"
        />

        {/* Items */}
        <div className="flex-1 overflow-auto py-1">
          {data.items.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground/60">
              No items. Click "+ Add item" to start.
            </p>
          )}
          {data.items.map((item, idx) => {
            const isDragging = draggingIdx === idx;
            const isDropAbove = dropIdx === idx && draggingIdx !== null && draggingIdx > idx;
            const isDropBelow = dropIdx === idx && draggingIdx !== null && draggingIdx < idx;
            const draft = drafts[item.id] ?? item.text;
            return (
              <div
                key={item.id}
                data-todo-item
                className={cn(
                  'group flex items-center gap-1.5 px-2 py-1.5 transition-opacity',
                  isDragging && 'opacity-40',
                  isDropAbove && 'border-t-2 border-primary',
                  isDropBelow && 'border-b-2 border-primary'
                )}
              >
                <div
                  className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
                  onPointerDown={(e) => handleGripDown(e, idx)}
                  onPointerMove={handleGripMove}
                  onPointerUp={handleGripUp}
                  onPointerCancel={handleGripUp}
                  aria-label="Drag to reorder"
                >
                  <GripVertical className="h-4 w-4" />
                </div>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleDone(item.id)}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                />
                <input
                  ref={(el) => {
                    if (el) itemInputRefs.current.set(item.id, el);
                    else itemInputRefs.current.delete(item.id);
                  }}
                  type="text"
                  value={draft}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                  onBlur={() => commitItemText(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitItemText(item.id);
                      addItem(idx);
                    } else if (e.key === 'Backspace' && draft === '') {
                      e.preventDefault();
                      deleteItem(item.id);
                    }
                  }}
                  className={cn(
                    'min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none',
                    item.done && 'text-muted-foreground line-through opacity-70'
                  )}
                  placeholder="Item..."
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteItem(item.id);
                  }}
                  className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete item"
                  tabIndex={-1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Add button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            addItem();
          }}
          className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Add item
        </button>
      </ObjectShell>
    );
  }
);
TodoListObjectImpl.displayName = 'TodoListObject';

export const TodoListObject = memo(TodoListObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'todo-list',
  renderer: TodoListObject as any,
  defaultGeometry: { width: 280, height: 240, rotation: 0, zIndex: 0 },
  defaultData: { title: '', items: [] } as TodoListData,
  label: 'Add todo list',
});
