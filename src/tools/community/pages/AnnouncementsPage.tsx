import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/tools/community/components/PageShell';
import { DUMMY_ANNOUNCEMENTS } from '@/tools/community/lib/data';

// ============================================================
// Announcements Page — Timeline of product updates
// ============================================================

export default function AnnouncementsPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <PageShell>
      <div className="flex flex-col w-full max-w-3xl mx-auto px-6 py-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Announcements</h2>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Post</span>
          </Button>
        </div>

        <ol className="flex flex-col">
          {loading ? (
            <>
              {[1, 2, 3].map((i) => (
                // Skeleton match footprint of real post below.
                // No outer animate-pulse — Skeleton has built-in shimmer.
                <li key={i} className="flex py-8 border-t border-border">
                  <div className="flex flex-col sm:flex-row gap-4 w-full">
                    <div className="shrink-0 sm:w-28 sm:text-right">
                      <Skeleton className="h-3 w-20 ml-auto" />
                    </div>
                    <div className="flex flex-col gap-3 grow">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Skeleton className="h-5 w-48" />
                        <div className="flex gap-2 sm:ml-auto">
                          <Skeleton className="h-6 w-20 rounded" />
                          <Skeleton className="h-6 w-16 rounded" />
                        </div>
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  </div>
                </li>
              ))}
            </>
          ) : (
            <>
              {DUMMY_ANNOUNCEMENTS.map((post) => (
                <li key={post.id} className="flex py-8 border-t border-border">
                  <article className="flex flex-col sm:flex-row gap-4 w-full">
                    <div className="shrink-0 sm:w-28 sm:text-right">
                      <time className="text-xs text-muted-foreground whitespace-nowrap">{post.date}</time>
                    </div>
                    <div className="flex flex-col gap-3 grow min-w-0">
                      <header className="flex flex-col sm:flex-row sm:items-start gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{post.title}</h3>
                        <div className="flex gap-2 flex-wrap sm:ml-auto shrink-0">
                          {post.tags.map((tag) => (
                            <span
                              key={tag.label}
                              className="inline-flex items-center rounded px-2.5 py-1 text-xs font-medium border"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${tag.color} 16%, transparent)`,
                                borderColor: `color-mix(in srgb, ${tag.color} 16%, transparent)`,
                                color: tag.color,
                              }}
                            >
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      </header>
                      <p className="text-sm text-muted-foreground leading-relaxed">{post.content}</p>
                    </div>
                  </article>
                </li>
              ))}
            </>
          )}
        </ol>
      </div>
    </PageShell>
  );
}
