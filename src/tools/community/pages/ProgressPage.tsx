import { useState, useEffect, useRef, useCallback } from 'react';
import { Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { motion, LayoutGroup } from 'framer-motion';
import { MOTION_LAYOUT_TRANSITION } from '@/lib/motion/tokens';
import { useFloatingDragPreview } from '@/lib/motion/floating-drag-preview';
import { PageShell } from '@/tools/community/components/PageShell';
import { IdeaDetailModal } from '@/tools/community/components/IdeaDetailModal';
import { DUMMY_IDEAS, STATUS_META, type Idea, type IdeaStatus } from '@/tools/community/lib/data';

// ============================================================
// Progress Page — Kanban with drag-and-drop (pragmatic)
//
// [done] Motion layout — framer-motion layoutId for smooth reorder
// [done] Drop indicator — thin glowing line (CSS pseudo-elements)
// [done] Collision detection — pragmatic closest-edge + column fallback
// [done] Hysteresis — 60ms debounce before committing edge change
// [ ] Optimistic update — TODO khi co backend (mutate local → sync → rollback)
// ============================================================

const COLUMNS: IdeaStatus[] = [
  'under-consideration',
  'planned',
  'in-progress',
  'shipped',
  'not-likely',
];

// --- DnD payload helpers ---

interface CardPayload {
  type: 'progress-card';
  ideaId: string;
  fromColumn: IdeaStatus;
  [key: string]: unknown;
}

function isCardPayload(data: Record<string, unknown>): data is CardPayload {
  return data.type === 'progress-card';
}

// --- Draggable Card ---
// Uses data-attributes for edge indicator + dragging state.
// CSS pseudo-elements for drop line (opacity toggled via data-edge).
// Hysteresis: edge change requires 60ms stable before committing (prevents flicker).
// motion.li with layoutId for smooth position animation on reorder.
// Hysteresis timing from shared token @/lib/motion/tokens.

// Replica card content for drag preview overlay — mirror visible card style.
// Width should match source (passed via prop) so cursor grabs same relative point.
function KanbanCardPreview({ item, width }: { item: Idea; width?: number }) {
  return (
    <div
      className="flex flex-col px-3 py-4 rounded-md border border-border/60 bg-card"
      style={{
        width: width ?? 260,
        transform: 'rotate(-1deg)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <div className="flex gap-3 items-center">
        <div className="flex items-center justify-center shrink-0 w-10 h-10 rounded-sm border-2 border-border bg-card">
          <span className="text-base font-bold text-foreground">{item.votes}</span>
        </div>
        <h4 className="text-sm font-medium text-foreground line-clamp-2 pr-6 leading-tight">
          {item.title}
        </h4>
      </div>
    </div>
  );
}

function KanbanCard({
  item,
  column,
  isSelected,
  onSelect,
}: {
  item: Idea;
  column: IdeaStatus;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // cardRef → inner visible card div (khong bao gom py-2 hitbox padding cua outer li).
  // Dung cho preview grab-offset capture → preview alignment DUNG voi visible card,
  // khong lech 8px do py-2 outer wrapper.
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Floating drag preview overlay — thay cho native HTML5 drag image.
  // sourceRef = cardRef (INNER visible card) → cursor cam DUNG cho da click.
  const preview = useFloatingDragPreview({
    sourceRef: cardRef,
    render: () => {
      const width = cardRef.current?.getBoundingClientRect().width;
      return <KanbanCardPreview item={item} width={width} />;
    },
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        getInitialData: (): CardPayload => ({
          type: 'progress-card',
          ideaId: item.id,
          fromColumn: column,
        }),
        onGenerateDragPreview: preview.onGenerateDragPreview,
        onDragStart: (args) => {
          preview.onDragStart(args);
          setDragging(true);
        },
        onDrag: preview.onDrag,
        onDrop: () => {
          preview.onDrop();
          setDragging(false);
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => isCardPayload(source.data) && source.data.ideaId !== item.id,
        getDropEffect: () => 'move',
        getData: ({ input, element }) =>
          attachClosestEdge(
            { type: 'progress-card', ideaId: item.id, fromColumn: column },
            // Cho phep ca 2 edge tren MOI card, ke ca card dau — drop len top card
            // dau = insert vao vi tri 0 (item duoc keo tro thanh card dau moi). Fix bug [A].
            { input, element, allowedEdges: ['top', 'bottom'] },
          ),
        // KHONG hysteresis cho card kanban — card to, midpoint ro rang, khong flicker.
        // Hysteresis (60ms) chi can cho favicon nho day sat (BookmarkItem) — o day khong can.
        // Cursor bang qua midpoint → edge commit ngay → line indicator responsive realtime.
        onDragEnter: ({ self }) => {
          const edge = extractClosestEdge(self.data);
          if (edge) el.setAttribute('data-edge', edge);
        },
        onDrag: ({ self }) => {
          const edge = extractClosestEdge(self.data);
          const current = el.getAttribute('data-edge');
          if (edge && edge !== current) {
            el.setAttribute('data-edge', edge);
          }
        },
        onDragLeave: () => {
          el.removeAttribute('data-edge');
        },
        onDrop: () => {
          el.removeAttribute('data-edge');
        },
      }),
    );
  }, [item.id, column]);

  return (
    <>
      {preview.previewNode}
      <motion.li
        ref={ref}
        layoutId={item.id}
        data-idea-id={item.id}
        data-dragging={dragging || undefined}
        onClick={onSelect}
        transition={MOTION_LAYOUT_TRANSITION}
        className={cn(
          // Outer wrapper — expanded hitbox (py-2 = 8px extra top/bottom for easier drop targeting)
          'group/kcard flex w-full shrink-0 relative py-2',
          'cursor-grab active:cursor-grabbing select-none',
          // Dragging source → subtle fade only, no scale
          'data-[dragging=true]:opacity-40',
          // Pseudo-elements for drop indicator lines — render tren MOI card, ke ca card dau
          // Snap opacity — khong transition. Chong cross-fade flicker khi cursor bang qua
          // boundary 2 card (A::after + B::before o cung vi tri).
          "before:absolute before:inset-x-3 before:-top-[1px] before:h-[2px] before:rounded-full before:bg-primary before:shadow-[0_0_4px_hsl(var(--primary)/0.5)] before:content-[''] before:opacity-0 before:pointer-events-none",
          "after:absolute after:inset-x-3 after:-bottom-[1px] after:h-[2px] after:rounded-full after:bg-primary after:shadow-[0_0_4px_hsl(var(--primary)/0.5)] after:content-[''] after:opacity-0 after:pointer-events-none",
          // Toggle line via data-edge
          'data-[edge=top]:before:opacity-100 data-[edge=bottom]:after:opacity-100',
        )}
      >
        {/* Visual card — bg-card noi tren column bg-muted/30, shadow nhe cho depth (fix [C]).
            Grab feedback (scale + brightness) PERSIST xuyen suot drag → source thay ro
            "bi thu nho + mo" trong khi preview follow cursor. */}
        <div
          ref={cardRef}
          className={cn(
            'flex flex-col px-3 py-4 w-full rounded-md border border-border/60 bg-card shadow-sm hover:bg-muted/40 hover:border-border',
            'transition-[background-color,border-color,transform,filter] duration-fast ease-standard',
            // Grab feedback — visible pressed state (bumped tu 0.98/95 → 0.96/90 cho ro hon).
            // KHONG disable khi dragging → source van thu nho + toi, ket hop opacity-40 outer.
            'active:scale-[0.96] active:brightness-90',
            'group-data-[dragging=true]/kcard:scale-[0.96] group-data-[dragging=true]/kcard:brightness-90',
            isSelected && 'bg-muted/40 border-primary/50',
          )}
        >
          <div className="flex gap-3 items-center">
            <div className="flex items-center justify-center shrink-0 w-10 h-10 rounded-sm border-2 border-border bg-card">
              <span className="text-base font-bold text-foreground">{item.votes}</span>
            </div>
            <h4 className="text-sm font-medium text-foreground line-clamp-2 pr-6 leading-tight">
              {item.title}
            </h4>
          </div>
          {item.topics.length > 0 && (
            <div className="flex gap-2 mt-2 min-w-0 pr-7 pl-[52px]">
              {item.topics.map((t) => (
                <span key={t} className="text-[11px] font-medium text-muted-foreground truncate">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </motion.li>
    </>
  );
}

// --- Drop target column ---

function KanbanColumn({
  status,
  items,
  selectedItem,
  onSelect,
}: {
  status: IdeaStatus;
  items: Idea[];
  selectedItem: Idea | null;
  onSelect: (item: Idea) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const meta = STATUS_META[status];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => isCardPayload(source.data),
      getDropEffect: () => 'move',
      getData: () => ({ type: 'progress-column', columnId: status }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [status]);

  return (
    <div
      ref={ref}
      className={cn(
        // Column bg-muted/30 lam nen "am" — card ben trong bg-card se noi len (fix [C])
        'flex relative flex-col flex-1 min-w-[200px] px-4 pb-6 bg-muted/30 border rounded-lg transition-colors',
        isOver ? 'border-primary/50 bg-primary/5' : 'border-border/60',
      )}
    >
      {/* Header: pb-6 tach header khoi card dau — user drop trong khoang trong nay
          se roi vao column drop (insert cuoi), khong nham lan voi card dau. */}
      <div className="flex items-center gap-2 pt-5 pb-6 shrink-0">
        <Circle className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} fill={meta.color} />
        <h3 className="text-[15px] font-semibold text-foreground leading-none">
          {meta.label}
          <span className="font-normal text-muted-foreground ml-1">({items.length})</span>
        </h3>
      </div>

      <ol className="flex flex-col list-none w-full min-h-[120px]">
        {items.map((item) => (
          <KanbanCard
            key={item.id}
            item={item}
            column={status}
            isSelected={selectedItem?.id === item.id}
            onSelect={() => onSelect(item)}
          />
        ))}
      </ol>
    </div>
  );
}

// --- Main Page ---

export default function ProgressPage() {
  const [selectedItem, setSelectedItem] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState<Record<IdeaStatus, Idea[]>>(() =>
    COLUMNS.reduce(
      (acc, status) => {
        acc[status] = DUMMY_IDEAS.filter((i) => i.status === status);
        return acc;
      },
      {} as Record<IdeaStatus, Idea[]>,
    ),
  );

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Global drop monitor — handles cross-column moves + reorder
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isCardPayload(source.data),
      onDrop: ({ source, location }) => {
        const sourceData = source.data as CardPayload;
        const dropTargets = location.current.dropTargets;

        if (dropTargets.length === 0) return;

        // Find the card-level drop target (has ideaId) or column-level (has columnId)
        const cardTarget = dropTargets.find((t) => t.data.ideaId != null);
        const columnTarget = dropTargets.find((t) => (t.data as { type?: string }).type === 'progress-column');

        let destColumn: IdeaStatus;
        let destIndex: number;

        if (cardTarget) {
          // Dropped on a specific card
          destColumn = cardTarget.data.fromColumn as IdeaStatus;
          const edge = extractClosestEdge(cardTarget.data);
          const destItems = grouped[destColumn];
          const targetIdx = destItems.findIndex((i) => i.id === cardTarget.data.ideaId);
          destIndex = edge === 'bottom' ? targetIdx + 1 : targetIdx;
        } else if (columnTarget) {
          // Dropped on empty column area
          destColumn = (columnTarget.data as { columnId: IdeaStatus }).columnId;
          destIndex = grouped[destColumn].length;
        } else {
          return;
        }

        const sourceColumn = sourceData.fromColumn;
        const sourceId = sourceData.ideaId;

        setGrouped((prev) => {
          const next = { ...prev };
          // Remove from source
          const sourceItems = [...prev[sourceColumn]];
          const sourceIdx = sourceItems.findIndex((i) => i.id === sourceId);
          if (sourceIdx === -1) return prev;
          const [movedItem] = sourceItems.splice(sourceIdx, 1);
          next[sourceColumn] = sourceItems;

          // Insert into destination
          const destItems = sourceColumn === destColumn ? sourceItems : [...prev[destColumn]];
          // Adjust index if same column and moving down
          let insertIdx = destIndex;
          if (sourceColumn === destColumn && sourceIdx < destIndex) {
            insertIdx = destIndex - 1;
          }
          destItems.splice(insertIdx, 0, movedItem);
          next[destColumn] = destItems;

          return next;
        });
      },
    });
  }, [grouped]);

  const handleSelect = useCallback((item: Idea) => {
    setSelectedItem(item);
  }, []);

  return (
    <PageShell>
      <div className="flex flex-col grow overflow-hidden px-6 py-6 relative">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Progress</h2>
          <Button variant="outline" size="sm">
            Filter
          </Button>
        </div>

        <LayoutGroup>
          <div className="flex gap-4 overflow-x-auto pb-6 grow items-start">
            {loading
              ? COLUMNS.map((col) => {
                const meta = STATUS_META[col];
                return (
                  <div
                    key={col}
                    className="flex relative flex-col flex-1 min-w-[200px] px-4 pb-6 bg-muted/30 border border-border/60 rounded-lg"
                  >
                    <div className="flex items-center gap-2 pt-5 pb-6">
                      <Circle className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} fill={meta.color} />
                      <Skeleton className="h-4 w-28" />
                    </div>
                    <div className="flex flex-col">
                      {[1, 2].map((i) => (
                        <div key={i} className="py-2">
                          <div className="flex flex-col px-3 py-4 rounded-md border border-border/60 bg-card shadow-sm">
                            <div className="flex gap-3 items-center">
                              <Skeleton className="w-10 h-10 rounded-sm shrink-0" />
                              <Skeleton className="h-3.5 w-full" />
                            </div>
                            <div className="flex gap-2 mt-2 pl-[52px]">
                              <Skeleton className="h-3 w-12" />
                              <Skeleton className="h-3 w-10" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
              : COLUMNS.map((col) => (
                <KanbanColumn
                  key={col}
                  status={col}
                  items={grouped[col]}
                  selectedItem={selectedItem}
                  onSelect={handleSelect}
                />
              ))}
          </div>
        </LayoutGroup>
      </div>

      {selectedItem && (
        <IdeaDetailModal idea={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </PageShell>
  );
}
