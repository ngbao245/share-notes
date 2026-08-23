import { useEffect, useState } from 'react';
import { Folder, Home } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import type { Board } from '../types';
import { isRootBoard } from '../types';
import { getCanvasRepository } from '../repository';

// ============================================================
// MoveToBoardDialog — Chọn target board để move selected objects.
// ============================================================
//
// List boards flat với indent theo depth. Exclude boards trong tập
// đang move (không self-move) + descendants nếu có board trong tập.
// ============================================================

interface BoardNode {
  board: Board;
  depth: number;
}

function buildFlatTree(boards: Board[], excludeIds: Set<string>): BoardNode[] {
  const map = new Map(boards.map((b) => [b.id, b]));
  const childrenOf = new Map<string | null, Board[]>();
  for (const b of boards) {
    const key = b.parentId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(b);
  }

  // Recursively check descendants of excluded — also exclude.
  const shouldExclude = (id: string): boolean => {
    if (excludeIds.has(id)) return true;
    const parent = map.get(id)?.parentId;
    if (!parent) return false;
    return shouldExclude(parent);
  };

  const result: BoardNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = childrenOf.get(parentId) ?? [];
    for (const kid of kids) {
      if (shouldExclude(kid.id)) continue;
      result.push({ board: kid, depth });
      walk(kid.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

interface MoveToBoardDialogProps {
  open: boolean;
  /** Object ids đang move — dùng để loại boards trong tập (không self-move). */
  movingObjectIds: string[];
  /** Callback với target boardId. `null` = root. */
  onSubmit: (targetBoardId: string | null) => void;
  onClose: () => void;
}

export function MoveToBoardDialog({
  open,
  movingObjectIds,
  onSubmit,
  onClose,
}: MoveToBoardDialogProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getCanvasRepository()
      .loadAllBoards()
      .then((all) => {
        if (!cancelled) setBoards(all);
      });
    setSelectedTarget(null);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const excludeIds = new Set(movingObjectIds);
  const tree = buildFlatTree(boards, excludeIds);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to board</DialogTitle>
          <DialogDescription>Chọn board đích.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[300px] overflow-auto rounded-md border border-border">
          {/* Home root */}
          <button
            type="button"
            onClick={() => setSelectedTarget(null)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
              selectedTarget === null
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            }`}
          >
            <Home className="h-4 w-4 text-primary/70" />
            <span>Home</span>
          </button>
          {tree.map(({ board, depth }) => {
            if (isRootBoard(board)) return null;
            return (
              <button
                key={board.id}
                type="button"
                onClick={() => setSelectedTarget(board.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  selectedTarget === board.id
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                }`}
                style={{ paddingLeft: `${12 + depth * 20}px` }}
              >
                <Folder className="h-4 w-4 text-primary/70" />
                <span className="truncate">{board.name || 'Untitled board'}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(selectedTarget)}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
