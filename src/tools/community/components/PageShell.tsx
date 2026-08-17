import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Lightbulb, TrendingUp, Megaphone } from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { path: '/community/ideas', label: 'Ideas', icon: Lightbulb },
  { path: '/community/progress', label: 'Progress', icon: TrendingUp },
  { path: '/community/announcements', label: 'Announcements', icon: Megaphone },
] as const;

export function PageShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center gap-4 px-6 h-14 border-b border-border shrink-0">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Hub</span>
        </Link>

        <nav className="flex items-center gap-1 ml-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex grow min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
