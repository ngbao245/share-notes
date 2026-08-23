
import {
  StickyNote,
  ListTodo,
  FolderOpen,
  Lock,
  Wallet,
  Truck,
  Film,
  Languages,
  Calculator,
  KeyRound,
  Package,
  Briefcase,
  Send,
  Settings2,
  ShieldCheck,
  GitCompareArrows,
  FileText,
  Network,
  Music,
  Library,
  FolderLock,
  Bookmark,
  Frame,
  type LucideIcon,
} from 'lucide-react';

// ============================================================
// Map tool ID → lucide icon
// ============================================================
//
// Thay vì dùng emoji (📝 📋 ...), dùng icon vector từ lucide-react.
// Icon thống nhất stroke-width, kích thước, theme-aware.
// ============================================================

const ICON_MAP: Record<string, LucideIcon> = {
  notes: StickyNote,
  tasks: ListTodo,
  sources: FolderOpen,
  secret: Lock,
  vault: FolderLock,
  expense: Wallet,
  spx: Truck,
  movies: Film,
  watchlist: Film,
  bookmarks: Bookmark,
  translate: Languages,
  calculator: Calculator,
  encoder: KeyRound,
  backup: Package,
  'project-packer': Briefcase,
  'p2p-transfer': Send,
  setting: Settings2,
  crypto: ShieldCheck,
  'code-compare': GitCompareArrows,
  'markdown-preview': FileText,
  'json-studio': Network,
  audio: Music,
  library: Library,
  canvas: Frame,
};

interface ToolIconProps {
  id: string;
  className?: string;
}

export function ToolIcon({ id, className }: ToolIconProps) {
  const Icon = ICON_MAP[id] ?? StickyNote;
  return <Icon className={className} />;
}