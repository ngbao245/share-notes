import { forwardRef, memo, useEffect, useRef, useState } from 'react';
import { Folder } from 'lucide-react';

import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';
import { useHistoryStore } from '../../engine/commands/history';
import { useInteractionStore } from '../../store/interaction-store';
import { updateCommand } from '../../engine/commands/update';
import { getCanvasRepository } from '../../repository';
import { ObjectShell } from './ObjectShell';

// ============================================================
// BoardObject — Folder icon + name
// ============================================================
//
// Data: { name: string }
// Rule: BoardObject.id === boardId của canvas con nó chứa.
//
// Double-click card (không phải name text) → navigate `/canvas/{id}`
// → route effect enter board.
// Double-click name → edit inline.
// ============================================================

interface BoardData {
  name: string;
}

const BoardObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected, isEditing, onEditEnd }, ref) => {
    const data = object.data as BoardData;
    const [draftName, setDraftName] = useState(data.name);
    const inputRef = useRef<HTMLInputElement>(null);

    // Phase 4B: highlight khi là drop target trong drag hover.
    const isDropTarget = useInteractionStore(
      (s) => s.dropTargetBoardId === object.id
    );

    useEffect(() => setDraftName(data.name), [data.name]);
    useEffect(() => {
      if (isEditing) {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, [isEditing]);

    const commit = () => {
      if (draftName !== data.name) {
        useHistoryStore.getState().push(
          updateCommand(
            object.id,
            { data: { name: data.name } as unknown as Record<string, unknown> },
            { data: { name: draftName } as unknown as Record<string, unknown> }
          )
        );
        // Sync board record name (tương ứng board.id)
        void getCanvasRepository().updateBoard(object.id, { name: draftName });
      }
      onEditEnd?.();
    };

    return (
      <ObjectShell
        ref={ref as React.Ref<HTMLDivElement>}
        object={object}
        isSelected={isSelected}
        isDropTarget={isDropTarget}
        className="flex flex-col items-center justify-center gap-2 p-3"
      >
        <Folder className="h-10 w-10 text-primary/70" />
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraftName(data.name);
                onEditEnd?.();
              }
            }}
            data-board-name
            className="w-full bg-transparent text-center text-sm font-medium text-foreground outline-none"
          />
        ) : (
          <span
            data-board-name
            className="w-full truncate text-center text-sm font-medium text-foreground"
          >
            {data.name || <span className="text-muted-foreground/50">Untitled board</span>}
          </span>
        )}
      </ObjectShell>
    );
  }
);
BoardObjectImpl.displayName = 'BoardObject';

export const BoardObject = memo(BoardObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'board',
  renderer: BoardObject as any,
  defaultGeometry: { width: 180, height: 140, rotation: 0, zIndex: 0 },
  defaultData: { name: 'New board' } as BoardData,
  label: 'Add board',
});
