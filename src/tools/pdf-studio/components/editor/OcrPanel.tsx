// ============================================================
// PDF Studio Edit PDF — OCR panel (non-blocking UX)
// ============================================================
// Shows when Edit Text finds no text layer:
// - Empty state with OCR CTA
// - Warning dialog (first time) with "don't ask again" preference
// - Progress status while running (real steps, elapsed time)
// - Viewer remains interactive throughout
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { FileSearch, CloudUpload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { runOcr } from '../../lib/ocr-service';
import type { OcrJobStatus } from '../../lib/ocr-service';
import { createToolStorage } from '@/lib/plugin-storage';

const noWarnStorage = createToolStorage<boolean>({
  toolId: 'pdf-studio',
  key: 'ocr-no-warn',
  scope: 'global',
});

interface OcrPanelProps {
  file: Blob;
  filename: string;
  onOcrComplete: (resultBlob: Blob) => void;
  onCancel: () => void;
}

const STATUS_LABELS: Record<OcrJobStatus, string> = {
  idle: '',
  requesting: 'Dang ket noi dich vu...',
  uploading: 'Dang tai tai lieu len...',
  processing: 'Dang nhan dien van ban...',
  downloading: 'Dang tai ket qua...',
  done: 'Hoan tat!',
  error: 'Loi',
  cancelled: 'Da huy',
};

export function OcrPanel({ file, filename, onOcrComplete, onCancel }: OcrPanelProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<OcrJobStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if user already dismissed warning
  const noWarn = noWarnStorage.get() === true;

  const startOcr = useCallback(async () => {
    setRunning(true);
    setError(null);
    setElapsed(0);
    setStatus('requesting');

    // Start elapsed timer
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    abortRef.current = new AbortController();

    const result = await runOcr(
      file,
      filename,
      (s) => setStatus(s),
      abortRef.current.signal,
    );

    // Cleanup timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (result.success && result.outputBlob) {
      toast.success('OCR hoan tat. Cac vung text da san sang de chinh sua.');
      onOcrComplete(result.outputBlob);
    } else if (result.error) {
      setError(result.error);
      setStatus('error');
    }
    // cancelled: do nothing
    setRunning(false);
  }, [file, filename, onOcrComplete]);

  const handleStartClick = useCallback(() => {
    if (noWarn) {
      startOcr();
    } else {
      setShowWarning(true);
    }
  }, [noWarn, startOcr]);

  const handleConfirmWarning = useCallback(() => {
    if (dontAskAgain) {
      noWarnStorage.set(true);
    }
    setShowWarning(false);
    startOcr();
  }, [dontAskAgain, startOcr]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRunning(false);
    setStatus('cancelled');
    onCancel();
  }, [onCancel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ─── Warning dialog ────────────────────────────────────────

  if (showWarning) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-96 rounded-lg border border-border bg-card p-5 shadow-lg space-y-3">
          <div className="flex items-center gap-2">
            <CloudUpload className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Nhan dien van ban truoc khi chinh sua</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Tai lieu nay chua co lop van ban. File se duoc gui toi dich vu OCR tren cloud de nhan dien.
            Qua trinh co the mat vai phut tuy so trang. Ban van co the xem tai lieu trong luc cho.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="rounded border-input"
            />
            <span className="text-xs text-muted-foreground">Khong hien canh bao nay lan sau</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowWarning(false)}>Huy</Button>
            <Button size="sm" onClick={handleConfirmWarning}>Bat dau OCR</Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Running state ─────────────────────────────────────────

  if (running) {
    return (
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <div className="flex-1">
          <p className="text-xs font-medium text-foreground">{STATUS_LABELS[status]}</p>
          <p className="text-[10px] text-muted-foreground">{elapsed}s</p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs" onClick={handleCancel}>Huy</Button>
      </div>
    );
  }

  // ─── Error state ───────────────────────────────────────────

  if (error) {
    return (
      <div className="flex items-center gap-3 border-b border-border bg-destructive/5 px-4 py-2">
        <FileSearch className="h-4 w-4 text-destructive" />
        <div className="flex-1">
          <p className="text-xs font-medium text-destructive">OCR that bai</p>
          <p className="text-[10px] text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs" onClick={startOcr}>Thu lai</Button>
      </div>
    );
  }

  // ─── Idle — offer OCR ──────────────────────────────────────

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-2">
      <FileSearch className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-xs font-medium text-foreground">Khong tim thay van ban co the chinh sua</p>
        <p className="text-[10px] text-muted-foreground">Tai lieu nay co the la PDF scan. Chay OCR de nhan dien van ban.</p>
      </div>
      <Button size="sm" className="text-xs gap-1.5" onClick={handleStartClick}>
        <CloudUpload className="h-3.5 w-3.5" />
        Nhan dien van ban (OCR)
      </Button>
    </div>
  );
}
