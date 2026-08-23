// ============================================================
// ObjectShell — Shared wrapper cho tất cả CanvasObject renderer
// ============================================================
//
// Motivation: nhiều renderer trước đây copy-paste chuỗi className
// wrapper + selected/idle state variants. Extract để đồng nhất chrome
// + scale được cho object type mới (P5b+) và state mới (hover, error,
// warning...) chỉ sửa 1 chỗ.
//
// Không handle:
//   - Content bên trong (renderer tự viết)
//   - fontSize / typography (renderer tự set qua style prop)
//   - Content-specific interactions (drag reorder, edit inline...)
//
// Extension guide (khi thêm visual state mới):
//   1. Thêm token vào CARD_STATES map dưới đây (VD `hover`, `error`).
//   2. Thêm boolean prop tương ứng vào ObjectShellProps (VD `isHover`).
//   3. Update resolveState() với priority thích hợp (state cao thắng).
//   4. Consumer 8+ renderer không cần đổi gì nếu không opt-in state mới.
//
// Extension guide (khi thêm variant chrome — VD outline-only, ghost):
//   1. Thêm entry vào CARD_VARIANTS map (VD `outline`).
//   2. Thêm value vào union prop `variant`.
//   3. Consumer chọn qua `<ObjectShell variant="outline" ... />`.
// ============================================================

import { forwardRef, type CSSProperties, type ReactNode, type MouseEvent } from 'react';

import { cn } from '@/lib/cn';
import type { CanvasObject } from '../../types';

// ============================================================
// Style tokens — SSOT cho visual state
// ============================================================
//
// Đổi ring→border hay border→outline chỉ sửa các constant dưới đây,
// không phá 8 renderer consumer.
//
// Design decisions hiện tại:
// - Selection dùng `ring-2 ring-primary` (outline outside 2px, không
//   thay đổi border color) → visual lift rõ hơn border thay màu,
//   feedback mạnh khi user click select.
// - Border neutral (`border-border/50`) giữ ổn định layout dày đặc:
//   card kề nhau không cạnh tranh visual với ring outline.
// - Drop target dùng cluster (`bg-primary/10 + shadow-lg + ring-2`)
//   vì momentary state cần nổi bật hơn selection.
// ============================================================

/** Base chrome — không đổi theo state.
 *
 * Transition: bắt buộc duration + timing explicit vì Tailwind arbitrary
 * `transition-[...]` chỉ set transition-property, KHÔNG set duration →
 * default 0s → box-shadow/bg/border snap instant. Snap từ drag lift
 * shadow (CSS index.css `[data-dragging=true]`) về shadow-md khi drop
 * lộ visual flick "bóng bên dưới nhảy kích thước".
 *
 * `duration-150 ease-out` tương thích với CSS custom `transition: box-shadow 60ms`
 * bên `[data-dragging=true]`: CSS custom thắng khi attribute active
 * (drag start, lift 60ms), Tailwind class thắng khi attribute removed
 * (drop end, retract 150ms) — cả 2 chiều đều smooth.
 */
const CARD_BASE =
  'overflow-hidden rounded-md border border-border/50 bg-card shadow-md ' +
  'transition-[box-shadow,background-color,border-color] duration-150 ease-out';

/**
 * Visual state variants. Key = state name, value = className apply thêm
 * lên `CARD_BASE`. Priority resolve trong `resolveState()`.
 *
 * Thêm state mới: thêm entry ở đây + boolean prop + resolveState branch.
 */
const CARD_STATES = {
  idle: '',
  selected: 'ring-2 ring-primary',
  dropTarget: 'border-primary bg-primary/10 ring-2 ring-primary shadow-lg',
} as const;

type CardState = keyof typeof CARD_STATES;

/**
 * Chrome variants. `card` = full chrome (border/bg/shadow). `raw` =
 * chỉ position wrapper, không chrome (dùng cho debug primitive như
 * RectObject hoặc invisible như GroupObject).
 */
const CARD_VARIANTS = {
  card: CARD_BASE,
  raw: '',
} as const;

type CardVariant = keyof typeof CARD_VARIANTS;

/**
 * Priority resolver: state cao thắng khi nhiều boolean set cùng lúc.
 * dropTarget > selected > idle.
 */
function resolveState(props: Pick<ObjectShellProps, 'isSelected' | 'isDropTarget'>): CardState {
  if (props.isDropTarget) return 'dropTarget';
  if (props.isSelected) return 'selected';
  return 'idle';
}

// ============================================================
// Component
// ============================================================

export interface ObjectShellProps {
  object: CanvasObject;
  isSelected?: boolean;
  /** BoardObject only — highlight khi drag hover để drop children vào. */
  isDropTarget?: boolean;
  /** Chrome variant. `card` (default) = full chrome. `raw` = position only. */
  variant?: CardVariant;
  /** Extra classes cho renderer-specific layout (flex, padding, ...). */
  className?: string;
  /** Extra inline style (fontSize, ...). Position/geometry đã set sẵn. */
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  title?: string;
  children?: ReactNode;
}

export const ObjectShell = forwardRef<HTMLDivElement, ObjectShellProps>(
  (
    {
      object,
      isSelected,
      isDropTarget,
      variant = 'card',
      className,
      style,
      onClick,
      title,
      children,
    },
    ref,
  ) => {
    const { geometry } = object;
    const state = resolveState({ isSelected, isDropTarget });
    return (
      <div
        ref={ref}
        data-canvas-object-id={object.id}
        data-canvas-object-state={state}
        onClick={onClick}
        title={title}
        style={{
          position: 'absolute',
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: geometry.height,
          zIndex: geometry.zIndex,
          ...style,
        }}
        className={cn(CARD_VARIANTS[variant], CARD_STATES[state], className)}
      >
        {children}
      </div>
    );
  },
);
ObjectShell.displayName = 'ObjectShell';
