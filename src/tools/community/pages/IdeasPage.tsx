import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Plus,
  Circle,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { PageShell } from '@/tools/community/components/PageShell';
import { StatusBadge } from '@/tools/community/components/StatusBadge';
import { VoteButton } from '@/tools/community/components/VoteButton';
import { IdeaDetailModal } from '@/tools/community/components/IdeaDetailModal';
import {
  DUMMY_IDEAS,
  STATUS_META,
  TOPICS_WITH_COUNT,
  type Idea,
  type IdeaStatus,
} from '@/tools/community/lib/data';

// --- Sidebar ---

function Sidebar({
  statusFilter,
  onStatusFilter,
  topicFilter,
  onTopicFilter,
}: {
  statusFilter: string[];
  onStatusFilter: (s: string[]) => void;
  topicFilter: string[];
  onTopicFilter: (t: string[]) => void;
}) {
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-muted/30 overflow-y-auto pt-8 px-4">
      <div className="flex flex-col gap-1 mb-5">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
          Statuses
        </span>
        {(Object.entries(STATUS_META) as [IdeaStatus, { label: string; color: string }][]).map(
          ([key, meta]) => {
            const isActive = statusFilter.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onStatusFilter(
                    isActive ? statusFilter.filter((s) => s !== key) : [...statusFilter, key],
                  )
                }
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors cursor-pointer text-left',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                <Circle className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} fill={meta.color} />
                <span className="truncate">{meta.label}</span>
              </button>
            );
          },
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
          Topics
        </span>
        {TOPICS_WITH_COUNT.map((topic) => {
          const isActive = topicFilter.includes(topic.label);
          return (
            <button
              key={topic.label}
              type="button"
              onClick={() =>
                onTopicFilter(
                  isActive ? topicFilter.filter((t) => t !== topic.label) : [...topicFilter, topic.label],
                )
              }
              className={cn(
                'flex items-center justify-between px-3 py-1.5 rounded text-sm transition-colors cursor-pointer text-left',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{topic.label}</span>
              </div>
              <span className="text-xs text-muted-foreground ml-2">{topic.count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// --- Main Page ---

export default function IdeasPage() {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [topicFilter, setTopicFilter] = useState<string[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const filteredIdeas = DUMMY_IDEAS.filter((idea) => {
    if (statusFilter.length > 0 && !statusFilter.includes(idea.status)) return false;
    if (topicFilter.length > 0 && !idea.topics.some((t) => topicFilter.includes(t))) return false;
    return true;
  });

  return (
    <PageShell>
      <Sidebar
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        topicFilter={topicFilter}
        onTopicFilter={setTopicFilter}
      />

      <div className={cn('flex flex-col overflow-y-auto grow relative')}>
        <div className="flex flex-col w-full max-w-2xl mx-auto">
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <h2 className="text-xl font-semibold text-foreground">Feature Requests</h2>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Submit Idea</span>
            </Button>
          </div>

          <div className="flex items-center justify-between px-6 pb-3 border-b border-border">
            <span className="text-sm font-medium text-muted-foreground">Trending</span>
            {!loading && <span className="text-xs text-muted-foreground">{filteredIdeas.length} ideas</span>}
          </div>

          <ol className="flex flex-col">
            {loading ? (
              <>
                {[1, 2, 3, 4, 5].map((i) => (
                  // Skeleton match footprint of real li below.
                  // No outer animate-pulse — Skeleton has built-in shimmer.
                  <li key={i} className="flex gap-4 p-5 border-t border-border">
                    <Skeleton className="w-14 h-[70px] rounded shrink-0" />
                    <div className="flex flex-col grow gap-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-1/2 mt-1" />
                      <div className="flex items-center gap-2 mt-1">
                        <Skeleton className="h-5 w-24 rounded" />
                        <Skeleton className="h-4 w-8 ml-auto" />
                      </div>
                    </div>
                  </li>
                ))}
              </>
            ) : (
              <>
                {filteredIdeas.map((idea) => (
                  <li
                    key={idea.id}
                    onClick={() => setSelectedIdea(idea)}
                    className={cn(
                      'relative flex gap-4 p-5 border-t border-border hover:bg-muted/50 transition-colors cursor-pointer',
                      selectedIdea?.id === idea.id && 'bg-muted/50',
                    )}
                  >
                    <VoteButton votes={idea.votes} />
                    <div className="flex flex-col min-w-0 grow">
                      <h3 className="text-sm font-semibold text-foreground line-clamp-2">{idea.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{idea.description}</p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{idea.author}</span>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                        <time>{idea.date}</time>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <StatusBadge status={idea.status} />
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span className="text-xs">{idea.comments.length}</span>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
                {filteredIdeas.length === 0 && (
                  <li className="p-8 text-center text-sm text-muted-foreground">No ideas match filter.</li>
                )}
              </>
            )}
          </ol>
        </div>
      </div>

      {selectedIdea && (
        <IdeaDetailModal idea={selectedIdea} onClose={() => setSelectedIdea(null)} />
      )}
    </PageShell>
  );
}
