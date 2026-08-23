import { memo, forwardRef } from 'react';

import { cn } from '@/lib/cn';
import type { ObjectRendererProps } from '../../hooks/useObjectRegistry';
import { registerObjectType } from '../../hooks/useObjectRegistry';

// ============================================================
// RectObject — Debug object type Phase 1
// ============================================================
//
// Rectangle với background primary/20, border primary. Không content
// bên trong (chỉ visual box để test drag/resize/select engine).
//
// forwardRef cần thiết vì Task 6-7 sẽ set imperative transform via ref
// map trong ObjectLayer. Renderer plugin bất kỳ (Phase 2+) đều phải
// forwardRef về div ngoài cùng để engine work.
//
// memo với custom compare: chỉ re-render khi object identity hoặc
// isSelected đổi. Drag imperative bypass hoàn toàn re-render này.
// ============================================================

const RectObjectImpl = forwardRef<HTMLElement, ObjectRendererProps>(
  ({ object, isSelected }, ref) => {
    const { geometry } = object;

    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        data-canvas-object-id={object.id}
        style={{
          position: 'absolute',
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: geometry.height,
          zIndex: geometry.zIndex,
        }}
        className={cn(
          'rounded-md border-2 transition-colors',
          'border-primary/50 bg-primary/15',
          isSelected && 'border-primary bg-primary/25 shadow-md'
        )}
      />
    );
  }
);
RectObjectImpl.displayName = 'RectObject';

export const RectObject = memo(
  RectObjectImpl,
  (a, b) => a.object === b.object && a.isSelected === b.isSelected
);

// Register khi module load — Phase 1 chỉ có type 'rect'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rectRenderer = RectObject as any;
registerObjectType({
  type: 'rect',
  renderer: rectRenderer,
  defaultGeometry: {
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 0,
  },
  defaultData: {},
  label: 'Add rect',
});
