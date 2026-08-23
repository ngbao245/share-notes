import { AlertTriangle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// ============================================================
// MigrationIncompleteDialog — Session trước đóng giữa chừng migration
// ============================================================
//
// Hiện khi localStorage migration status = 'in_progress' (user cancel /
// close tab / network fail giữa runMigration). 4 action:
//   - Resume → tiếp tục runMigration từ checkpoint (idempotent qua migratedIds)
//   - Rollback → DELETE remote + storage cleanup, migrate lại từ đầu
//   - Skip remainder → mark completed, mount canvas với data đã upload (partial)
//   - Cancel → navigate về / (stay incomplete, hiện dialog lại lần sau)
// ============================================================

interface MigrationIncompleteDialogProps {
  open: boolean;
  done: number;
  total: number;
  onResume: () => void;
  onRollback: () => void;
  onSkipRemainder: () => void;
  onCancel: () => void;
}

export function MigrationIncompleteDialog({
  open,
  done,
  total,
  onResume,
  onRollback,
  onSkipRemainder,
  onCancel,
}: MigrationIncompleteDialogProps) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <DialogTitle>Migration incomplete</DialogTitle>
          </div>
          <DialogDescription>
            Session trước đóng giữa migration. Chọn hướng xử lý.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="tabular-nums font-medium">
              {done}/{total} objects ({percent}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-warning transition-[width] duration-normal ease-standard"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          IndexedDB local vẫn giữ nguyên. Nếu Rollback, remote data sẽ bị xóa hoàn
          toàn, có thể migrate lại từ đầu.
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={onResume} className="w-full">
            Resume (upload phần còn lại)
          </Button>
          <Button variant="secondary" onClick={onRollback} className="w-full">
            Rollback (xóa remote, migrate lại từ đầu)
          </Button>
          <Button variant="secondary" onClick={onSkipRemainder} className="w-full">
            Skip remainder (mount canvas với data đã upload)
          </Button>
          <Button variant="ghost" onClick={onCancel} className="w-full">
            Cancel (về hub)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
