import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

// ============================================================
// CanvasContextMenu — Lightweight context menu
// ============================================================
//
// Không dùng shadcn/Radix ContextMenu (chưa có trong repo). Custom
// fixed div với close-on-outside-click + Escape.
//
// Consumer control open state qua props. Menu content = children.
// ============================================================

interface CanvasContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function CanvasContextMenu({ open, x, y, onClose, children }: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDocPointerDown = (e: PointerEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Delay 1 tick để không bắt event mở menu.
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onDocPointerDown);
      window.addEventListener('keydown', onKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        'fixed z-[70] min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg',
        'text-sm text-popover-foreground'
      )}
      style={{ left: x, top: y }}
      role="menu"
    >
      {children}
    </div>
  );
}

interface CanvasContextMenuItemProps {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}

export function CanvasContextMenuItem({
  onClick,
  children,
  disabled,
  destructive,
}: CanvasContextMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive'
      )}
    >
      {children}
    </button>
  );
}
