import { Home, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { useBoardStackStore } from '../store/board-stack-store';
import { isRootBoard } from '../types';

// ============================================================
// Breadcrumb — Header path navigation Home > A > B
// ============================================================
//
// Click item → navigate `/canvas` (Home) hoặc `/canvas/:id` (sub).
// Camera hydrate qua route effect. Collapse "..." khi depth > 5.
// ============================================================

const MAX_VISIBLE = 5;

export function Breadcrumb() {
  const stack = useBoardStackStore((s) => s.stack);
  const navigate = useNavigate();

  if (stack.length <= 1) {
    // Root only — hiện Home không click.
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Home className="h-3.5 w-3.5" />
        <span>Home</span>
      </div>
    );
  }

  // Collapse: giữ đầu + cuối, giữa "…"
  let visible = stack;
  let collapsed = false;
  if (stack.length > MAX_VISIBLE) {
    visible = [stack[0], stack[stack.length - 2], stack[stack.length - 1]];
    collapsed = true;
  }

  const goTo = (board: (typeof stack)[number]) => {
    if (isRootBoard(board)) navigate('/canvas');
    else navigate(`/canvas/${board.id}`);
  };

  return (
    <nav className="flex items-center gap-1 text-xs" aria-label="Breadcrumb">
      {visible.map((b, i) => {
        const isLast = i === visible.length - 1;
        const isCollapsedInsert = collapsed && i === 1;
        return (
          <span key={b.id} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            )}
            {isCollapsedInsert && (
              <>
                <span className="text-muted-foreground">…</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              </>
            )}
            <button
              type="button"
              onClick={() => !isLast && goTo(b)}
              disabled={isLast}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors',
                isLast
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {isRootBoard(b) ? (
                <Home className="h-3.5 w-3.5" />
              ) : (
                b.name || 'Untitled board'
              )}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
