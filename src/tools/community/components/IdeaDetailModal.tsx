import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Idea } from '@/tools/community/lib/data';
import { ActivitySection } from './ActivitySection';
import { StatusBadge } from './StatusBadge';
import { VoteButton } from './VoteButton';

// ============================================================
// IdeaDetailModal — slide-over panel showing full idea detail.
// Shared bởi IdeasPage + ProgressPage.
//
// Layout: backdrop click-to-close + right-side panel with
//   header X button, VoteButton + title/description/meta,
//   comment input, ActivitySection.
//
// Escape key = close (handled here, không cần parent wire).
// ============================================================

interface IdeaDetailModalProps {
  idea: Idea;
  onClose: () => void;
}

export function IdeaDetailModal({ idea, onClose }: IdeaDetailModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      <div
        className="absolute inset-0 z-20 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="absolute top-0 right-0 bottom-0 z-30 flex flex-col w-full max-w-[55%] overflow-y-auto border-l border-border bg-background shadow-xl">
        <div className="flex flex-col grow w-full">
          <div className="flex gap-5 flex-col px-4 md:px-10 pt-5 pb-14">
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded p-1"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex gap-5">
              <VoteButton votes={idea.votes} />
              <div className="flex flex-col grow min-w-0">
                <h2 className="text-lg font-semibold text-foreground break-words">
                  {idea.title}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">{idea.description}</p>
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{idea.author}</span>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  <time>{idea.date}</time>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {idea.topics.map((t) => (
                    <span key={t} className="text-xs text-muted-foreground">
                      #{t}
                    </span>
                  ))}
                  <StatusBadge status={idea.status} />
                </div>
              </div>
            </div>
          </div>

          {/* Comment input */}
          <div className="flex px-4 md:px-10">
            <div className="w-full border border-border rounded-md shadow-sm overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <div
                className="min-h-[100px] px-4 py-3 text-sm text-muted-foreground outline-none"
                contentEditable
                suppressContentEditableWarning
              />
              <div className="flex items-center justify-end px-4 py-2.5 border-t border-border">
                <Button size="sm">Add comment</Button>
              </div>
            </div>
          </div>

          {/* Activity / Comments */}
          <ActivitySection comments={idea.comments} />
        </div>
      </div>
    </>
  );
}
