import { forwardRef, memo, useEffect, useRef, useState } from 'react';

import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';
import { useHistoryStore } from '../../engine/commands/history';
import { updateCommand } from '../../engine/commands/update';
import { ObjectShell } from './ObjectShell';

// ============================================================
// NoteObject — Title + body plain textarea
// ============================================================
//
// Data: { title: string, body: string }
// Layout: title header (16px bold) + separator + body (14px).
// Edit:
//   - Double-click → enter edit, title input focus
//   - Enter trong title → focus body
//   - Shift+Tab body → focus title
//   - Blur / Escape / Ctrl+Enter → commit
// ============================================================

interface NoteData {
  title: string;
  body: string;
}

const NoteObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected, isEditing, onEditEnd }, ref) => {
    const data = object.data as NoteData;
    const titleRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const [draftTitle, setDraftTitle] = useState(data.title);
    const [draftBody, setDraftBody] = useState(data.body);

    useEffect(() => {
      setDraftTitle(data.title);
      setDraftBody(data.body);
    }, [data.title, data.body]);

    useEffect(() => {
      if (isEditing) {
        const el = titleRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, [isEditing]);

    const commit = () => {
      if (draftTitle !== data.title || draftBody !== data.body) {
        useHistoryStore.getState().push(
          updateCommand(
            object.id,
            { data: { title: data.title, body: data.body } as unknown as Record<string, unknown> },
            { data: { title: draftTitle, body: draftBody } as unknown as Record<string, unknown> }
          )
        );
      }
      onEditEnd?.();
    };

    const cancel = () => {
      setDraftTitle(data.title);
      setDraftBody(data.body);
      onEditEnd?.();
    };

    const handleBlur = (e: React.FocusEvent) => {
      // Chỉ commit khi focus rời khỏi cả 2 field.
      const next = e.relatedTarget as HTMLElement | null;
      if (
        next === titleRef.current ||
        next === bodyRef.current
      ) {
        return;
      }
      commit();
    };

    return (
      <ObjectShell
        ref={ref as React.Ref<HTMLDivElement>}
        object={object}
        isSelected={isSelected}
        className="flex flex-col"
      >
        {isEditing ? (
          <>
            <input
              ref={titleRef}
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  bodyRef.current?.focus();
                }
                else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault(); commit();
                }
              }}
              placeholder="Untitled note"
              className="border-b border-border bg-transparent px-3 py-2 text-base font-semibold text-foreground outline-none"
            />
            <textarea
              ref={bodyRef}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault(); commit();
                }
                else if (e.key === 'Tab' && e.shiftKey) {
                  e.preventDefault(); titleRef.current?.focus();
                }
              }}
              placeholder="Body..."
              className="flex-1 resize-none bg-transparent p-3 text-sm text-foreground outline-none"
            />
          </>
        ) : (
          <>
            <div className="border-b border-border px-3 py-2 text-base font-semibold text-foreground">
              {data.title || <span className="text-muted-foreground/50">Untitled note</span>}
            </div>
            <div className="flex-1 overflow-hidden whitespace-pre-wrap break-words p-3 text-sm text-foreground">
              {data.body || <span className="text-muted-foreground/50">Body...</span>}
            </div>
          </>
        )}
      </ObjectShell>
    );
  }
);
NoteObjectImpl.displayName = 'NoteObject';

export const NoteObject = memo(NoteObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'note',
  renderer: NoteObject as any,
  defaultGeometry: { width: 300, height: 200, rotation: 0, zIndex: 0 },
  defaultData: { title: '', body: '' } as NoteData,
  label: 'Add note',
});
