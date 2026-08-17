
import { useEffect, useState } from 'react';
import { Search, ExternalLink, ArrowLeft, Trash2, Truck } from 'lucide-react';

import { createToolStorage } from '@/lib/plugin-storage';

import ToolModal from '@/components/ToolModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';

const SPX_BASE_URL = 'https://spx.vn/track?';

interface HistoryItem {
  code: string;
  timestamp: string;
}

const historyStorage = createToolStorage<HistoryItem[]>({
  toolId: 'spx',
  key: 'tracking-history',
  scope: 'user',
});

export default function Spx() {
  return (
    <ToolModal id="spxTracking" title="SPX Tracking" className="max-w-3xl">
      <Content />
    </ToolModal>
  );
}

function Content() {
  const [history, setHistory] = useState<HistoryItem[]>(() => historyStorage.get() ?? []);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  useEffect(() => {
    historyStorage.set(history);
  }, [history]);

  function track(code: string) {
    const trimmed = code.trim();
    if (trimmed.length < 10) {
      toast.error('Mã vận đơn không hợp lệ');
      return;
    }
    const next = [
      { code: trimmed, timestamp: new Date().toISOString() },
      ...history.filter((h) => h.code !== trimmed),
    ].slice(0, 10);
    setHistory(next);
    setActiveCode(trimmed);
  }

  if (activeCode) {
    return (
      <IframeView
        code={activeCode}
        onBack={() => setActiveCode(null)}
        onOpenNewTab={() => window.open(SPX_BASE_URL + activeCode, '_blank')}
      />
    );
  }

  return (
    <InputView
      history={history}
      onTrack={track}
      onClearHistory={async () => {
        if (window.confirm('Clear lookup history?')) {
          setHistory([]);
          toast.success('Đã xoá lịch sử');
        }
      }}
    />
  );
}

function InputView({
  history,
  onTrack,
  onClearHistory,
}: {
  history: HistoryItem[];
  onTrack: (code: string) => void;
  onClearHistory: () => void;
}) {
  const [code, setCode] = useState('');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Mã vận đơn
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Truck className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onTrack(code)}
              placeholder="VD: SPXVN..."
              className="pl-8"
              autoFocus
            />
          </div>
          <Button onClick={() => onTrack(code)} className="gap-1.5">
            <Search className="h-4 w-4" />
            Tra cứu
          </Button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tra cứu gần đây ({history.length})
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearHistory}
              className="h-6 gap-1 px-2 text-xs"
            >
              <Trash2 className="h-3 w-3" />
              Xoá hết
            </Button>
          </div>
          <ul className="space-y-1">
            {history.map((item) => (
              <li key={item.code}>
                <button
                  onClick={() => onTrack(item.code)}
                  className="flex w-full items-center justify-between border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary"
                >
                  <span className="font-mono text-sm text-foreground">{item.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(new Date(item.timestamp))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function IframeView({
  code,
  onBack,
  onOpenNewTab,
}: {
  code: string;
  onBack: () => void;
  onOpenNewTab: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" />
          Quay lại
        </Button>
        <span className="font-mono text-sm text-foreground">{code}</span>
        <Button variant="outline" size="sm" onClick={onOpenNewTab} className="gap-1.5">
          <ExternalLink className="h-3.5 w-3.5" />
          Tab mới
        </Button>
      </div>
      <iframe
        src={SPX_BASE_URL + code}
        title="SPX Tracking"
        className="h-[60vh] w-full border border-border bg-background"
      />
    </div>
  );
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  if (hours < 24) return `${hours} giờ trước`;
  if (days < 7) return `${days} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}