import { forwardRef, memo } from 'react';

import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';

// ============================================================
// GroupObject — Invisible logical container (Phase 4B)
// ============================================================
//
// Data: { children: string[] }
//
// Group không render UI thật (invisible). Purpose:
//   - Là 1 CanvasObject record trong store, có id / boardId / geometry
//     (AABB cache của children lúc create).
//   - Engine chạm { geometry, boardId, zIndex } như bình thường.
//   - Drag group → expand thành N sub-patch cho children (MoveCommand
//     hoặc FSM handle Task 2).
//   - Selection: click bất kỳ child → select group thay vì child (Task 2
//     reverse map).
//
// Renderer render 1 div `display: none` để có DOM element cho engine
// ref map (getObjectElement) khi cần. Không hit-test qua nó — hit-test
// đi qua children DOM (data-canvas-object-id của child).
//
// Rule Milanote: group KHÔNG có border/background. Group chỉ là 1 khái
// niệm — user không "thấy" group, chỉ cảm nhận khi drag/select.
// ============================================================

interface GroupData {
  children: string[];
}

const GroupObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object }, ref) => {
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        data-canvas-object-id={object.id}
        data-canvas-object-type="group"
        style={{ display: 'none' }}
        aria-hidden
      />
    );
  }
);
GroupObjectImpl.displayName = 'GroupObject';

export const GroupObject = memo(GroupObjectImpl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerObjectType({
  type: 'group',
  renderer: GroupObject as any,
  defaultGeometry: { width: 0, height: 0, rotation: 0, zIndex: 0 },
  defaultData: { children: [] } as GroupData,
  label: 'Add group', // Sẽ bị filter khỏi context menu — group tạo qua Ctrl+G.
});

export type { GroupData };
