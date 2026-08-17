import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Minus, FileEdit, GitCompare, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { computeFolderDiff, formatBytes, type DiffEntry } from '@/tools/project-packer/lib/diff';

// ============================================================
// FolderDiff — so sánh 2 folder slot bất kỳ
// ============================================================

interface FolderSlotLite {
  id: string;
  label: string;
  files: { file: File; path: string }[];
}

interface FolderDiffProps {
  folderQueue: FolderSlotLite[];
}

/**
 * Wrapper — hiện nút "So sánh" đóng gọn. Click mới mở panel diff.
 * Tránh auto-diff gây hiểu nhầm khi user upload folder khác nesting level.
 */
export function FolderDiffToggle({ folderQueue }: FolderDiffProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <GitCompare className="h-3.5 w-3.5" />
        So sánh 2 folder
      </button>
    );
  }

  return (
    <div className="relative">
      <FolderDiff folderQueue={folderQueue} />
      <button
        onClick={() => setOpen(false)}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-popover hover:text-foreground"
        title="Đóng"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function FolderDiff({ folderQueue }: FolderDiffProps) {
  // Default: A = folder đầu, B = folder thứ 2
  const [slotAId, setSlotAId] = useState<string>(() => folderQueue[0]?.id ?? '');
  const [slotBId, setSlotBId] = useState<string>(() => folderQueue[1]?.id ?? '');

  // Guard: nếu id không còn trong queue (user xoá slot) → fallback
  const validSlotAId = folderQueue.some((s) => s.id === slotAId) ? slotAId : (folderQueue[0]?.id ?? '');
  const validSlotBId = folderQueue.some((s) => s.id === slotBId) ? slotBId : (folderQueue[1]?.id ?? '');

  const slotA = folderQueue.find((s) => s.id === validSlotAId);
  const slotB = folderQueue.find((s) => s.id === validSlotBId);

  const diff = useMemo(() => {
    if (!slotA || !slotB || slotA.id === slotB.id) return null;
    return computeFolderDiff(slotA.files, slotB.files);
  }, [slotA, slotB]);

  if (folderQueue.length < 2) return null;

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border bg-muted px-3 py-2">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          So sánh folder
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SlotSelect value={validSlotAId} onChange={setSlotAId} options={folderQueue} label="Base (A)" />
          <span className="text-muted-foreground">↔</span>
          <SlotSelect value={validSlotBId} onChange={setSlotBId} options={folderQueue} label="Compare (B)" />
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Match theo relative path. Upload 2 folder cùng nesting level để kết quả chính xác.
        </p>
      </div>

      {slotA?.id === slotB?.id ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          Chọn 2 folder khác nhau để so sánh
        </div>
      ) : diff ? (
        <div className="divide-y divide-border">
          <DiffSection
            title="Modified"
            icon={FileEdit}
            entries={diff.modified}
            colorClass="text-warning"
            showSize
          />
          <DiffSection
            title="Added"
            icon={Plus}
            entries={diff.added}
            colorClass="text-success"
            showSize
          />
          <DiffSection
            title="Removed"
            icon={Minus}
            entries={diff.removed}
            colorClass="text-destructive"
            showSize
          />
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            {diff.unchangedCount} file không đổi
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// SlotSelect — dropdown chọn folder slot
// ============================================================
function SlotSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  options: FolderSlotLite[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-[8rem] border border-input bg-background px-2 text-xs focus:border-primary focus:outline-none"
      >
        {options.map((slot) => (
          <option key={slot.id} value={slot.id}>
            {slot.label} ({slot.files.length})
          </option>
        ))}
      </select>
    </label>
  );
}

// ============================================================
// DiffSection — 1 nhóm (added / removed / modified), collapsible
// ============================================================
function DiffSection({
  title,
  icon: Icon,
  entries,
  colorClass,
  showSize,
}: {
  title: string;
  icon: typeof Plus;
  entries: DiffEntry[];
  colorClass: string;
  showSize?: boolean;
}) {
  const [expanded, setExpanded] = useState(entries.length > 0 && entries.length <= 20);

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
        <Icon className={cn('h-3 w-3', colorClass, 'opacity-50')} />
        <span className="font-medium">{title}</span>
        <span>— không có</span>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-popover"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <Icon className={cn('h-3 w-3', colorClass)} />
        <span className="font-medium text-foreground">{title}</span>
        <span className={cn('font-mono', colorClass)}>{entries.length}</span>
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-border bg-background">
          {entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center justify-between gap-2 px-4 py-1 font-mono text-[11px] hover:bg-popover"
            >
              <span className="truncate text-foreground">{entry.path}</span>
              {showSize && (
                <SizeInfo entry={entry} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SizeInfo — hiển thị size cho từng entry theo loại
// ============================================================
function SizeInfo({ entry }: { entry: DiffEntry }) {
  if (entry.sizeDelta !== undefined && entry.sizeA !== undefined && entry.sizeB !== undefined) {
    const sign = entry.sizeDelta > 0 ? '+' : '';
    return (
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {formatBytes(entry.sizeA)} → {formatBytes(entry.sizeB)}{' '}
        <span className={entry.sizeDelta > 0 ? 'text-success' : 'text-destructive'}>
          ({sign}{formatBytes(Math.abs(entry.sizeDelta))})
        </span>
      </span>
    );
  }
  const size = entry.sizeB ?? entry.sizeA;
  if (size === undefined) return null;
  return <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(size)}</span>;
}
