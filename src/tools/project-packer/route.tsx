import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, PackagePlus, PackageOpen, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import PackPanel from '@/tools/project-packer/components/PackPanel';
import UnpackPanel from '@/tools/project-packer/components/UnpackPanel';
import SourcesPanel from '@/tools/project-packer/components/SourcesPanel';

// ============================================================
// ProjectPacker - 3 tabs: Đóng gói / Giải nén / Sources
// Lazy mount: tab chỉ render lần đầu khi user chuyển sang.
// Sau đó giữ mounted (hidden) để không mất state.
// ============================================================

const TABS = [
  { id: 'pack', label: 'Đóng gói', icon: PackagePlus },
  { id: 'unpack', label: 'Giải nén', icon: PackageOpen },
  { id: 'sources', label: 'Sources', icon: FolderOpen },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ProjectPacker() {
  const [activeTab, setActiveTab] = useState<TabId>('pack');
  // Track which tabs have been visited at least once
  const visitedRef = useRef<Set<TabId>>(new Set(['pack']));
  visitedRef.current.add(activeTab);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground">Project Packer</h1>
            <p className="text-xs text-muted-foreground">
              Đóng gói project, giải nén, quản lý sources
            </p>
          </div>
        </div>

        {/* Tab triggers trong header */}
        <div className="flex gap-1 rounded-md border border-border bg-muted p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Content — lazy mount: chỉ render tab khi đã visit, giữ mounted sau đó */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn('h-full p-4', activeTab !== 'pack' && 'hidden')}>
          <PackPanel />
        </div>
        {visitedRef.current.has('unpack') && (
          <div className={cn('h-full p-4', activeTab !== 'unpack' && 'hidden')}>
            <UnpackPanel />
          </div>
        )}
        {visitedRef.current.has('sources') && (
          <div className={cn('h-full p-4', activeTab !== 'sources' && 'hidden')}>
            <SourcesPanel />
          </div>
        )}
      </div>
    </div>
  );
}
