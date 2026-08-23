import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import type { MigrationProgress } from '../migration/service';

// ============================================================
// MigrationProgressDialog — Progress bar khi runMigration chạy
// ============================================================
//
// Non-dismissable (backdrop click / Escape không đóng — force user
// hoặc chờ done hoặc bấm Cancel explicit).
//
// 2 progress bar:
//   - Overall phase (boards/objects/blobs progress)
//   - Blob detail khi phase=blobs (filename current)
// ============================================================

interface MigrationProgressDialogProps {
  open: boolean;
  progress: MigrationProgress | null;
  onCancel: () => void;
}

const PHASE_LABEL: Record<MigrationProgress['phase'], string> = {
  boards: 'Uploading boards',
  objects: 'Uploading objects',
  blobs: 'Uploading images',
  done: 'Complete',
};

export function MigrationProgressDialog({
  open,
  progress,
  onCancel,
}: MigrationProgressDialogProps) {
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <DialogTitle>Migrating Canvas...</DialogTitle>
          </div>
          <DialogDescription>
            Đang upload lên workspace. Đừng đóng tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {progress ? PHASE_LABEL[progress.phase] : 'Starting...'}
              </span>
              <span className="tabular-nums text-foreground">
                {progress ? `${progress.done}/${progress.total}` : ''}
              </span>
            </div>
            <ProgressBar percent={percent} />
          </div>

          {progress?.currentFile && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="mb-1 text-xs text-muted-foreground">
                Current file
              </div>
              <div className="truncate font-mono text-xs text-foreground">
                {progress.currentFile}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} className="w-full">
            Cancel migration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Progress bar ---
// Inline component, không dùng shadcn Progress (chưa có trong project).
function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-primary transition-[width] duration-normal ease-standard"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
