import { Database } from 'lucide-react';

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
// MigrationDialog — First-login prompt cho user quyết định migrate
// ============================================================
//
// Hiện khi remote mode + có local IndexedDB data (US-3).
// 3 action:
//   - Migrate → mount MigrationProgressDialog + call runMigration
//   - Skip (start fresh) → mark migration=skipped, canvas empty remote
//   - Cancel → navigate về / (stay on local, chờ user đổi flag lại)
// ============================================================

interface MigrationDialogProps {
  open: boolean;
  counts: {
    objects: number;
    boards: number;
    blobs: number;
    totalBlobSize: number;
  };
  onMigrate: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function MigrationDialog({
  open,
  counts,
  onMigrate,
  onSkip,
  onCancel,
}: MigrationDialogProps) {
  const sizeMB = (counts.totalBlobSize / 1024 / 1024).toFixed(1);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <DialogTitle>Migrate Canvas to cloud?</DialogTitle>
          </div>
          <DialogDescription>
            Kiro thấy dữ liệu Canvas local trên máy này. Migrate lên workspace
            cloud để sync cross-device + realtime cross-tab.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-4">
          <ul className="space-y-1 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Objects</span>
              <span className="font-medium tabular-nums">{counts.objects}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Boards</span>
              <span className="font-medium tabular-nums">{counts.boards}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Images</span>
              <span className="font-medium tabular-nums">
                {counts.blobs} ({sizeMB} MB)
              </span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          IndexedDB local giữ nguyên làm safety net cho đến khi migration success
          100%. Có thể rollback bất cứ lúc nào bằng cách đổi lại
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[10px]">
            VITE_CANVAS_REMOTE=false
          </code>
          .
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={onMigrate} className="w-full">
            Migrate
          </Button>
          <Button variant="secondary" onClick={onSkip} className="w-full">
            Skip (start fresh)
          </Button>
          <Button variant="ghost" onClick={onCancel} className="w-full">
            Cancel (stay on local)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
