import { Magnet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { useSnapStore } from '../store/snap-store';

// ============================================================
// SnapToggle — Toolbar button bật/tắt snap-to-grid (Phase 4B)
// ============================================================
//
// State ON/OFF visually obvious qua bg + icon color. Shortcut Ctrl+;
// wire ở useCanvasHotkeys.
// ============================================================

export function SnapToggle() {
  const snapEnabled = useSnapStore((s) => s.snapEnabled);
  const toggle = useSnapStore((s) => s.toggle);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className={cn(
        'gap-1 transition-colors',
        snapEnabled
          ? 'bg-primary/15 text-primary hover:bg-primary/20'
          : 'text-muted-foreground hover:text-foreground'
      )}
      title={`Snap to grid ${snapEnabled ? 'ON' : 'OFF'} (Ctrl+;)`}
    >
      <Magnet className="h-3.5 w-3.5" />
      Snap
    </Button>
  );
}
