import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

import type { Note } from '@/schemas/note';

// ============================================================
// SourceList - sidebar list bên trái Sources page
// ============================================================
//
// Tương tự NoteList nhưng filter chỉ type='source'.
// Search theo title + source URL + tags.
// ============================================================

interface SourceListProps {
  sources: Note[];
  isLoading: boolean;
  isDeleting: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleteAll?: () => void;
}

export default function SourceList({
  sources,
  isLoading,
  isDeleting,
  selectedId,
  onSelect,
  onNew,
  onDeleteAll,
}: SourceListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = sources;
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.source?.toLowerCase().includes(q) ||
          s.tags?.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [sources, query]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-secondary-foreground">
          Sources
        </h3>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={onNew} title="Tạo source mới" className="h-7 w-7">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm source..."
            className="h-8 pl-7 pr-7 text-xs"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {query ? `Không có source nào khớp "${query}"` : 'Chưa có source nào'}
          </div>
        ) : (
          <ul>
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    'w-full border-b border-border px-3 py-2 text-left transition-colors',
                    s.id === selectedId ? 'bg-popover' : 'hover:bg-popover/50',
                  )}
                >
                  <div className="truncate text-sm text-foreground">
                    {s.title || 'Untitled'}
                  </div>
                  {s.tags && (
                    <div className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
                      {s.tags}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {isDeleting ? 'Đang xóa...' : `${filtered.length} / ${sources.length} sources`}
          </span>
          {sources.length > 0 && onDeleteAll && (
            <button
              onClick={onDeleteAll}
              disabled={isDeleting}
              className="text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              {isDeleting ? 'Đang xóa...' : 'Xóa hết'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}