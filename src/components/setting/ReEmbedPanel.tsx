import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/shared';
import { reEmbedAll, type ReEmbedProgress } from '@/lib/rag/re-embed-all';
import { toast } from '@/components/ui/sonner';
import { isAdmin } from '@/lib/core-sdk/auth';

// ============================================================
// ReEmbedPanel — Admin only: re-embed all notes + tasks into RAG
// ============================================================

export default function ReEmbedPanel() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ReEmbedProgress | null>(null);

  if (!isAdmin()) return null;

  async function handleReEmbed() {
    if (!window.confirm('Re-embed toàn bộ notes + tasks vào RAG? Quá trình chạy background.')) return;

    setRunning(true);
    setProgress(null);

    try {
      const result = await reEmbedAll({
        onProgress: (p) => setProgress({ ...p }),
      });
      toast.success(
        `Re-embed done: ${result.notesCount} notes + ${result.tasksCount} tasks queued (${result.totalQueued} total)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-embed failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3 border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">RAG Re-embed</h3>
          <p className="text-xs text-muted-foreground">
            Scan tất cả notes + tasks, bơm lại embedding vào vector DB.
          </p>
        </div>
        <Button
          onClick={handleReEmbed}
          disabled={running}
          size="sm"
          variant="outline"
          className="gap-1.5"
        >
          {running ? (
            <LoadingState variant="inline" label="Đang scan..." />
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-embed all
            </>
          )}
        </Button>
      </div>

      {progress && (
        <div className="text-xs text-muted-foreground">
          Notes: {progress.notesCount} · Tasks: {progress.tasksCount} · Total queued: {progress.totalQueued}
        </div>
      )}
    </div>
  );
}