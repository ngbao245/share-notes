import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { Idea } from '@/tools/community/lib/data';

// ============================================================
// ActivitySection — comment list với fake loading state.
// Shared bởi IdeasPage + ProgressPage DetailModal.
//
// TODO: replace setTimeout(2000) fake loading khi wire backend.
//   Nên nhận isLoading prop từ parent (TanStack Query) thay vì tự fake.
// ============================================================

interface ActivitySectionProps {
  comments: Idea['comments'];
}

export function ActivitySection({ comments }: ActivitySectionProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, [comments]);

  return (
    <div className="flex gap-3 flex-col mt-8 w-full">
      <p className="text-xs text-muted-foreground px-5 md:px-10">Activity</p>
      <ul className="flex flex-col w-full">
        {loading ? (
          <>
            {[1, 2, 3].map((i) => (
              // Skeleton match footprint of real comment li below.
              // No outer animate-pulse — Skeleton component đã có shimmer built-in.
              <li key={i} className="flex gap-5 py-4 px-5 md:px-10">
                <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                <div className="flex flex-col grow gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-28 mt-1" />
                </div>
              </li>
            ))}
          </>
        ) : (
          <>
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-5 py-4 px-5 md:px-10">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                  {comment.author[0]}
                </div>
                <div className="flex flex-col grow min-w-0 gap-2">
                  <span className="text-xs font-medium text-foreground leading-none">
                    {comment.author}
                  </span>
                  <p className="text-sm text-muted-foreground">{comment.content}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <time>{comment.date}</time>
                    <button
                      type="button"
                      className="underline hover:text-foreground cursor-pointer"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {comments.length === 0 && (
              <li className="py-8 text-sm text-muted-foreground text-center">
                No comments yet.
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
}
