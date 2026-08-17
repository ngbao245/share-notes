import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import type { LogEntry } from '@/tools/project-packer/lib/types';

// ============================================================
// TerminalLog - hiển thị log scrollable kiểu terminal
// ============================================================
//
// Auto-scroll xuống dòng cuối khi có log mới.
// Giữ tối đa N dòng để tránh DOM phình to.
// ============================================================

interface TerminalLogProps {
  logs: LogEntry[];
  maxLines?: number;
  className?: string;
}

const TYPE_COLORS: Record<LogEntry['type'], string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
};

export default function TerminalLog({ logs, maxLines = 100, className }: TerminalLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 📚 Auto-scroll xuống cuối khi logs thay đổi.
  // deps = [logs] để chạy mỗi khi log mới được thêm.
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Chỉ hiển thị N dòng cuối
  const visible = logs.slice(-maxLines);

  return (
    <div className={cn('border border-border bg-background', className)}>
      <div className="border-b border-border bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Terminal {logs.length > 0 && `(${logs.length})`}
      </div>
      <div
        ref={containerRef}
        className="max-h-80 min-h-[8rem] overflow-y-auto p-2 font-mono text-xs"
      >
        {visible.length === 0 ? (
          <div className="text-[11px] italic text-muted-foreground">
            Log sẽ hiện ở đây khi bạn thao tác...
          </div>
        ) : (
          visible.map((log) => (
            <div key={log.id} className={cn('whitespace-pre-wrap', TYPE_COLORS[log.type])}>
              <span className="text-muted-foreground">
                [{log.timestamp.toLocaleTimeString('vi-VN', { hour12: false })}]
              </span>{' '}
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}