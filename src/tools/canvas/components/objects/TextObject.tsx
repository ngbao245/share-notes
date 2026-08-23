import { forwardRef, memo, useEffect, useRef, useState } from 'react';

import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';
import { useHistoryStore } from '../../engine/commands/history';
import { updateCommand } from '../../engine/commands/update';
import { ObjectShell } from './ObjectShell';

// ============================================================
// TextObject — Plain text với inline edit
// ============================================================
//
// Data: { content: string, fontSize?: number }
// Edit trigger: double-click (dispatch qua handler bên trên) hoặc auto
// khi create. Enter edit → textarea focus + select all.
// Exit: blur / Escape / Ctrl+Enter → commit UpdateCommand nếu changed.
// ============================================================

interface TextData {
  content: string;
  fontSize?: number;
}

const TextObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected, isEditing, onEditEnd }, ref) => {
    const data = object.data as TextData;
    const fontSize = data.fontSize ?? 16;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [draft, setDraft] = useState(data.content);

    // Sync draft khi object.data change từ external (undo, sync).
    useEffect(() => {
      setDraft(data.content);
    }, [data.content]);

    // Focus + cursor ở cuối văn bản khi enter edit (Milanote pattern).
    // KHÔNG auto-select-all: user double-click để chọn từng word,
    // Ctrl+A nếu muốn select all.
    useEffect(() => {
      if (isEditing && textareaRef.current) {
        const el = textareaRef.current;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, [isEditing]);

    const commit = () => {
      if (draft !== data.content) {
        useHistoryStore.getState().push(
          updateCommand(
            object.id,
            { data: { ...data, content: data.content } as unknown as Record<string, unknown> },
            { data: { ...data, content: draft } as unknown as Record<string, unknown> }
          )
        );
      }
      onEditEnd?.();
    };

    const cancel = () => {
      setDraft(data.content);
      onEditEnd?.();
    };

    return (
      <ObjectShell
        ref={ref as React.Ref<HTMLDivElement>}
        object={object}
        isSelected={isSelected}
        style={{ fontSize }}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit();
              }
            }}
            className="h-full w-full resize-none bg-transparent p-2 outline-none text-foreground"
            style={{ fontSize }}
          />
        ) : (
          <div
            className="h-full w-full whitespace-pre-wrap break-words p-2 text-foreground"
            style={{ fontSize }}
          >
            {data.content || <span className="text-muted-foreground/50">Text</span>}
          </div>
        )}
      </ObjectShell>
    );
  }
);
TextObjectImpl.displayName = 'TextObject';

export const TextObject = memo(TextObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'text',
  renderer: TextObject as any,
  defaultGeometry: { width: 220, height: 60, rotation: 0, zIndex: 0 },
  defaultData: { content: 'Text', fontSize: 16 } as TextData,
  label: 'Add text',
});
