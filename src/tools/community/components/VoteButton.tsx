import { ChevronUp } from 'lucide-react';

// ============================================================
// VoteButton — up-vote pill với số votes.
// Shared bởi IdeasPage + ProgressPage.
// TODO: wire vote action khi có backend.
// ============================================================

export function VoteButton({ votes }: { votes: number }) {
  return (
    <button
      type="button"
      className="flex w-14 h-[70px] flex-col items-center justify-center rounded border-2 border-border bg-card text-foreground shrink-0 cursor-pointer hover:border-muted-foreground transition-colors"
    >
      <ChevronUp className="h-4 w-4 text-muted-foreground" />
      <span className="text-lg font-semibold">{votes}</span>
    </button>
  );
}
