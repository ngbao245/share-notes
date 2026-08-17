// ============================================================
// Sources Panel — embedded as tab in Project Packer
// ============================================================

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Menu } from 'lucide-react';

import { useSources, useCreateSource } from '@/tools/project-packer/api';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

import SourceList from './SourceList';
import SourceEditor from './SourceEditor';

export default function SourcesPanel() {
  const sourcesQuery = useSources();
  const createSource = useCreateSource();

  const sources = sourcesQuery.data ?? [];

  const [selectedId, setSelectedId] = useLocalStorage<string | null>(
    'sources_selectedId',
    null,
  );
  const [listOpenMobile, setListOpenMobile] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Deep-link: /project-packer?noteId=X (from RAG)
  const [searchParams, setSearchParams] = useSearchParams();
  const noteIdParam = searchParams.get('noteId');
  useEffect(() => {
    if (!noteIdParam) return;
    if (!sourcesQuery.data) return;
    const exists = sources.some((s) => s.id === noteIdParam);
    if (exists) setSelectedId(noteIdParam);
    const next = new URLSearchParams(searchParams);
    next.delete('noteId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIdParam, sourcesQuery.data]);

  // Auto-select source mới nhất
  useEffect(() => {
    if (!sourcesQuery.data) return;
    if (selectedId) {
      const exists = sources.some((s) => s.id === selectedId);
      if (!exists) setSelectedId(null);
      return;
    }
    if (sources.length > 0) {
      const sorted = [...sources].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
      setSelectedId(sorted[0].id);
    }
  }, [sourcesQuery.data, sources, selectedId, setSelectedId]);

  const selectedNote = sources.find((s) => s.id === selectedId) ?? null;

  function handleNew() {
    createSource.mutate(
      { title: 'Source mới', content: '', source: '' },
      {
        onSuccess: (newNote) => {
          setSelectedId(newNote.id);
          toast.success('Đã tạo source mới');
        },
        onError: () => toast.error('Không tạo được source'),
      },
    );
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    setListOpenMobile(false);
  }

  async function handleDeleteAll() {
    if (sources.length === 0) return;
    const confirmMsg = `XÓA HẾT ${sources.length} SOURCE?\n\nKhông thể hoàn tác!\n\nOK để xác nhận.`;
    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(true);
    try {
      const { fetchJson } = await import('@/api/client');
      const { API } = await import('@/lib/config');

      // Batch delete với concurrency limit 5
      const CONCURRENCY = 5;
      let deleted = 0;
      for (let i = 0; i < sources.length; i += CONCURRENCY) {
        const batch = sources.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((source) =>
            fetchJson(`${API.NOTES}/${source.id}`, { method: 'DELETE' }),
          ),
        );
        deleted += results.filter((r) => r.status === 'fulfilled').length;
      }

      toast.success(`Đã xóa ${deleted}/${sources.length} sources`);
      setSelectedId(null);
      sourcesQuery.refetch();
    } catch {
      toast.error('Không xóa được');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex h-full border border-border">
      {/* Source list */}
      <aside
        className={cn(
          'flex w-[260px] shrink-0 flex-col border-r border-border bg-card',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[1000] max-md:transition-transform',
          listOpenMobile ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
        <SourceList
          sources={sources}
          isLoading={sourcesQuery.isLoading}
          isDeleting={isDeleting}
          selectedId={selectedId}
          onSelect={handleSelect}
          onNew={handleNew}
          onDeleteAll={handleDeleteAll}
        />
      </aside>

      {listOpenMobile && (
        <div
          className="fixed inset-0 z-[999] bg-black/50 md:hidden"
          onClick={() => setListOpenMobile(false)}
        />
      )}

      {/* Editor */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Mobile hamburger */}
        <header className="hidden items-center gap-2 border-b border-border bg-card px-3 py-2 max-md:flex">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setListOpenMobile((v) => !v)}
            className="h-8 w-8"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <h2 className="truncate text-sm font-medium">
            {selectedNote?.title || 'Sources'}
          </h2>
        </header>

        {selectedNote ? (
          <SourceEditor
            key={selectedNote.id}
            note={selectedNote}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="mb-4 text-sm text-muted-foreground">
                Chọn source hoặc tạo mới
              </p>
              <Button onClick={handleNew} size="sm">+ Tạo source</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
