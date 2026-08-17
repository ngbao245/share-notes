import { STATUS_META, type IdeaStatus } from '@/tools/community/lib/data';

// ============================================================
// StatusBadge — colored pill for Idea status.
// Shared bởi IdeasPage + ProgressPage.
// ============================================================

export function StatusBadge({ status }: { status: IdeaStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border"
      style={{
        backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  );
}
