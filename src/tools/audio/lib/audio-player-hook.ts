import { useCallback, useEffect, useRef, useState } from 'react';
import { parseYouTubeId, fetchYouTubeTitle } from './parse-url';
import { createToolStorage } from '@/lib/plugin-storage';

const queueStorage = createToolStorage<QueueItem[]>({
  toolId: 'audio',
  key: 'queue',
  scope: 'user',
});
const stateStorage = createToolStorage<PersistedState & { autoRepeat?: boolean }>({
  toolId: 'audio',
  key: 'state',
  scope: 'user',
});

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedAt: number;
}

export type CornerPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Chế độ lặp khi hết bài / hết queue. */
export type RepeatMode = 'off' | 'all' | 'one';

interface PersistedState {
  currentIndex: number;
  volume: number;
  repeatMode: RepeatMode;
  position: CornerPosition;
  size: { width: number; height: number };
  enabled: boolean;
}

const DEFAULT_STATE: PersistedState = {
  currentIndex: -1,
  volume: 70,
  repeatMode: 'all',
  position: 'bottom-right',
  size: { width: 280, height: 200 },
  enabled: true,
};

function loadQueue(): QueueItem[] {
  const parsed = queueStorage.get();
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (x): x is QueueItem =>
      !!x &&
      typeof (x as QueueItem).id === 'string' &&
      typeof (x as QueueItem).videoId === 'string',
  );
}

function loadState(): PersistedState {
  const parsed = stateStorage.get();
  if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE;
  // Migration v1 → v2: autoRepeat boolean → repeatMode enum
  if (parsed.repeatMode === undefined && typeof parsed.autoRepeat === 'boolean') {
    parsed.repeatMode = parsed.autoRepeat ? 'all' : 'off';
  }
  delete parsed.autoRepeat;
  return { ...DEFAULT_STATE, ...parsed };
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Hook quản state audio player: queue, current track, position/size,
 * config. Persist localStorage. Hook KHÔNG control YT iframe trực tiếp —
 * iframe lifecycle nằm trong AudioFloatingWindow component (vì cần ref
 * tới DOM element).
 *
 * Có thể gọi hook ở nhiều nơi (header mobile + desktop) — mỗi instance
 * có state riêng, nhưng đều đọc/ghi cùng localStorage. Để state share
 * đúng (không bị race), MOUNT 1 lần ở root PdfReader và pass xuống.
 */
export function useAudioPlayer() {
  const [queue, setQueue] = useState<QueueItem[]>(() => loadQueue());
  const [state, setState] = useState<PersistedState>(() => loadState());
  /** Trigger play/pause chuyển xuống component player. */
  const [playSignal, setPlaySignal] = useState(0);
  const [pauseSignal, setPauseSignal] = useState(0);
  /** Track playing status do AudioFloatingWindow report ngược lên (event onStateChange). */
  const [isPlaying, setIsPlaying] = useState(false);
  /** True khi YT IFrame API hoặc video đang buffering / chưa play được. */
  const [isLoading, setIsLoading] = useState(false);

  // Persist queue
  useEffect(() => {
    queueStorage.set(queue);
  }, [queue]);

  // Persist state (debounce nhẹ để batch các change liên tục)
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
    stateSaveTimerRef.current = setTimeout(() => {
      stateStorage.set(state);
    }, 300);
    return () => {
      if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
    };
  }, [state]);

  const addToQueue = useCallback(async (input: string, title?: string) => {
    const videoId = parseYouTubeId(input);
    if (!videoId) throw new Error('Không nhận diện được link YouTube');
    const placeholder = title?.trim() || `Video ${videoId}`;
    const item: QueueItem = {
      id: uid(),
      videoId,
      title: placeholder,
      addedAt: Date.now(),
    };
    setQueue((q) => [...q, item]);
    // Best-effort fetch title (sau khi đã add để UI responsive)
    if (!title) {
      const fetched = await fetchYouTubeTitle(videoId);
      if (fetched) {
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, title: fetched } : x)));
      }
    }
    return item;
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    let shouldFireSignal = false;
    setQueue((q) => {
      const idx = q.findIndex((x) => x.id === id);
      if (idx === -1) return q;
      const newQueue = q.filter((x) => x.id !== id);
      setState((s) => {
        if (s.currentIndex === idx) {
          // Xóa item đang play
          if (newQueue.length === 0) {
            shouldFireSignal = false;
            return { ...s, currentIndex: -1 };
          }
          // Pick item ở cùng vị trí (item kế tiếp shift lên), cap về cuối
          const nextIdx = Math.min(idx, newQueue.length - 1);
          shouldFireSignal = true;
          return { ...s, currentIndex: nextIdx };
        }
        if (s.currentIndex > idx) return { ...s, currentIndex: s.currentIndex - 1 };
        return s;
      });
      return newQueue;
    });
    if (shouldFireSignal) setPlaySignal((n) => n + 1);
  }, []);

  const moveItem = useCallback((id: string, delta: -1 | 1) => {
    setQueue((q) => {
      const idx = q.findIndex((x) => x.id === id);
      if (idx === -1) return q;
      const next = idx + delta;
      if (next < 0 || next >= q.length) return q;
      const copy = [...q];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      // Update currentIndex nếu nó vừa bị swap
      setState((s) => {
        if (s.currentIndex === idx) return { ...s, currentIndex: next };
        if (s.currentIndex === next) return { ...s, currentIndex: idx };
        return s;
      });
      return copy;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setState((s) => ({ ...s, currentIndex: -1 }));
  }, []);

  const playIndex = useCallback((index: number) => {
    setState((s) => ({ ...s, currentIndex: index, enabled: true }));
    setPlaySignal((n) => n + 1);
  }, []);

  const play = useCallback(() => {
    setState((s) => {
      const next = s.currentIndex < 0 ? 0 : s.currentIndex;
      return { ...s, currentIndex: next, enabled: true };
    });
    setPlaySignal((n) => n + 1);
  }, []);

  const pause = useCallback(() => {
    setPauseSignal((n) => n + 1);
  }, []);

  const stop = useCallback(() => {
    setState((s) => ({ ...s, currentIndex: -1 }));
    setIsPlaying(false);
  }, []);

  /** Gọi khi video kết thúc (onStateChange ENDED) — advance hoặc replay. */
  const handleEnded = useCallback(() => {
    let shouldFireSignal = false;
    setState((s) => {
      // repeat-one: phát lại bài hiện tại (signal → loadVideoById replay)
      if (s.repeatMode === 'one' && s.currentIndex >= 0) {
        shouldFireSignal = true;
        return s;
      }
      const isLast = s.currentIndex >= queue.length - 1;
      if (isLast) {
        if (s.repeatMode === 'all' && queue.length > 0) {
          shouldFireSignal = true;
          return { ...s, currentIndex: 0 };
        }
        return { ...s, currentIndex: -1 };
      }
      shouldFireSignal = true;
      return { ...s, currentIndex: s.currentIndex + 1 };
    });
    if (shouldFireSignal) setPlaySignal((n) => n + 1);
  }, [queue.length]);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    setState((s) => {
      const ni = s.currentIndex + 1 >= queue.length ? 0 : s.currentIndex + 1;
      return { ...s, currentIndex: ni, enabled: true };
    });
    setPlaySignal((n) => n + 1);
  }, [queue.length]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    setState((s) => {
      const ni = s.currentIndex - 1 < 0 ? queue.length - 1 : s.currentIndex - 1;
      return { ...s, currentIndex: ni, enabled: true };
    });
    setPlaySignal((n) => n + 1);
  }, [queue.length]);

  const setPosition = useCallback((pos: CornerPosition) => {
    setState((s) => ({ ...s, position: pos }));
  }, []);

  const setSize = useCallback((size: { width: number; height: number }) => {
    setState((s) => ({ ...s, size }));
  }, []);

  const setVolume = useCallback((v: number) => {
    setState((s) => ({ ...s, volume: Math.max(0, Math.min(100, v)) }));
  }, []);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    setState((s) => ({ ...s, repeatMode: mode }));
  }, []);

  /** Cycle: off → all → one → off */
  const cycleRepeatMode = useCallback(() => {
    setState((s) => {
      const next: RepeatMode =
        s.repeatMode === 'off' ? 'all' : s.repeatMode === 'all' ? 'one' : 'off';
      return { ...s, repeatMode: next };
    });
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setState((s) => ({ ...s, enabled: v }));
    if (!v) setIsPlaying(false);
  }, []);

  const currentItem =
    state.currentIndex >= 0 && state.currentIndex < queue.length
      ? queue[state.currentIndex]
      : null;

  return {
    // Queue
    queue,
    addToQueue,
    removeFromQueue,
    moveItem,
    clearQueue,

    // Playback
    currentIndex: state.currentIndex,
    currentItem,
    isPlaying,
    setIsPlaying,
    isLoading,
    setIsLoading,
    play,
    pause,
    stop,
    next,
    prev,
    playIndex,
    handleEnded,
    playSignal,
    pauseSignal,

    // UI
    position: state.position,
    setPosition,
    size: state.size,
    setSize,

    // Config
    volume: state.volume,
    setVolume,
    repeatMode: state.repeatMode,
    setRepeatMode,
    cycleRepeatMode,
    enabled: state.enabled,
    setEnabled,
  };
}

export type AudioPlayer = ReturnType<typeof useAudioPlayer>;