import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './reader.css';
import { ChevronLeft, ChevronRight, Menu, Minus, Moon, Plus, Sun, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

import { getBookFileUrl } from '@/tools/library/api/books';
import { fetchThroughCache, getCached, STORE_FILES } from '@/tools/library/lib/blob-cache';
import { useProgress, useSaveProgress } from '@/tools/library/api/progress';
import { useCreateHighlight, useHighlights } from '@/tools/library/api/highlights';
import SelectionMenu from './SelectionMenu';
import TranslatePopover from './TranslatePopover';
import EdgeClickZones from './EdgeClickZones';
import ReaderSkeleton from './ReaderSkeleton';
import ReaderSidebar from './ReaderSidebar';
import HighlightList from './sidebar/HighlightList';
import TocList, { type TocItem } from './sidebar/TocList';
import PdfSearchTab from './sidebar/PdfSearchTab';
import ProgressBar from './ProgressBar';
import SettingsDropdown from './SettingsDropdown';
import type { Book, Highlight } from '@/tools/library/lib/types';
import { ReaderHeader } from './ReaderHeader';
import { useReaderStore, type PdfDocLike } from '@/stores/readerStore';
import { clearBookContextCache } from '@/lib/rag/book-context';
import { useRagStore } from '@/stores/ragStore';
import { useModalStore } from '@/stores/modalStore';
import { createToolStorage } from '@/lib/plugin-storage';

// Facade storage instances — global scope (preference cross-user).
const zoomStorage = createToolStorage<number>({ toolId: 'library', key: 'pdf-reader-zoom', scope: 'global' });
const themeStorage = createToolStorage<string>({ toolId: 'library', key: 'pdf-reader-theme', scope: 'global' });
const selectionMaskStorage = createToolStorage<SelectionMask>({ toolId: 'library', key: 'pdf-reader-selection-mask', scope: 'global' });
const iosCalloutStorage = createToolStorage<boolean>({ toolId: 'library', key: 'pdf-reader-ios-callout', scope: 'global' });
const showPageNavStorage = createToolStorage<boolean>({ toolId: 'library', key: 'pdf-reader-page-nav', scope: 'global' });

interface SelectionState {
  text: string;
  page: number;
  rectsNorm: Array<{ x: number; y: number; w: number; h: number }>;
  menuRect: { top: number; left: number; width: number; height: number };
}

interface SelectionMask {
  top: number;    // % from top
  bottom: number; // % from bottom
  enabled: boolean;
}

// Preference keys moved to facade (createToolStorage). Xem imports đầu file.
const SCROLL_POSITIONS_KEY_PREFIX = 'reader_scroll_positions_'; // sessionStorage key prefix, append book.id — sessionStorage giữ nguyên, out of scope facade

type ReaderTheme = 'light' | 'sepia' | 'dark';

const THEME_ORDER: ReaderTheme[] = ['light', 'sepia', 'dark'];

const THEME_BG: Record<ReaderTheme, string> = {
  light: '#27272a', // zinc-800 (xung quanh trang)
  sepia: '#3a2f22',
  dark: '#0a0a0a',
};

export default function PdfReader({ book, initialPage }: { book: Book; initialPage?: number }) {
  // Defensive check: ensure worker is configured
  useEffect(() => {
    const workerSrc = pdfjs.GlobalWorkerOptions.workerSrc;
    if (
      !workerSrc ||
      workerSrc === 'pdf.worker.mjs' ||
      typeof workerSrc === 'string' && !workerSrc.startsWith('http') && !workerSrc.startsWith('/')
    ) {
      console.warn('⚠️ PDF.js worker invalid, re-initializing...');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
    }
  }, []);

  const progressQuery = useProgress(book.id);
  const saveProgress = useSaveProgress();
  const highlightsQuery = useHighlights(book.id);
  const createHighlight = useCreateHighlight();

  // True khi đã biết page nào cần hiện: hoặc có initialPage (deep link),
  // hoặc progress query đã settled (loaded/error). Dùng để tránh flash page 1
  // trong lúc chờ progress fetch từ server.
  const pageResolved = initialPage !== undefined || !progressQuery.isLoading;

  type PdfSource =
    | { kind: 'data'; data: ArrayBuffer }
    | { kind: 'url'; url: string };

  const [fileData, setFileData] = useState<PdfSource | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  /** State để debounce input page number desktop. */
  const [inputPageValue, setInputPageValue] = useState(1);
  const [docLoaded, setDocLoaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [scale, setScale] = useState<number>(() => {
    const v = zoomStorage.get();
    return typeof v === 'number' && Number.isFinite(v) ? v : 1.2;
  });
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    const v = themeStorage.get();
    return v === 'sepia' || v === 'dark' || v === 'light' ? v : 'light';
  });
  const [error, setError] = useState<string | null>(null);

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [translateText, setTranslateText] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [selectionMask, setSelectionMask] = useState<SelectionMask>(() => {
    return selectionMaskStorage.get() ?? { top: 5, bottom: 5, enabled: false };
  });
  const [showMaskBorders, setShowMaskBorders] = useState(false);
  const [mobilePageInputOpen, setMobilePageInputOpen] = useState(false);
  const [disableIosCallout, setDisableIosCallout] = useState<boolean>(() => {
    return iosCalloutStorage.get() === true;
  });
  const [showPageNavButtons, setShowPageNavButtons] = useState<boolean>(() => {
    const stored = showPageNavStorage.get();
    // Default: bật
    return stored === null ? true : stored === true;
  });
  // Ref mirror để dùng trong handler mà không phá deps của useCallback.
  const disableIosCalloutRef = useRef(disableIosCallout);
  useEffect(() => {
    disableIosCalloutRef.current = disableIosCallout;
  }, [disableIosCallout]);
  /** Snapshot canvas trang trước → đè lên trong lúc react-pdf render
   * trang mới, tránh flicker nền tối. Tái sử dụng 1 offscreen canvas
   * và copy bitmap bằng drawImage — gần như free, không cần encode PNG. */
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const [snapshotVisible, setSnapshotVisible] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  /** PDFDocumentProxy — capture lúc onLoadSuccess để prefetch page kế cận. */
  const pdfDocRef = useRef<unknown>(null);
  /** Đã restore page từ progress lần đầu chưa — tránh feedback loop khi
   * saveProgress invalidate query và refetch trả về giá trị cũ giữa lúc user
   * vừa lật sang trang mới. */
  const restoredRef = useRef(false);
  /** Lưu scroll position per page: { pageNumber -> scrollY }. */
  const scrollPositionsRef = useRef(new Map<number, number>());
  /** Track lý do thay đổi page:
   * - 'next'/'input': scroll top (đi tiếp / jump intentional)
   * - 'prev'/'restore': restore scroll cũ (quay lại / tiếp tục đọc) */
  const navigationSourceRef = useRef<'next' | 'prev' | 'input' | 'restore'>('next');
  /** Forward ref tới changePage để effect ở trên có thể gọi (workaround hoisting). */
  const changePageRef = useRef<
    | ((updater: number | ((p: number) => number), source?: 'next' | 'prev' | 'input') => void)
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Check cache hit
        const cached = await getCached(STORE_FILES, book.file_path);
        if (cancelled) return;

        if (cached) {
          // ✅ CACHE HIT: load instant từ IndexedDB
          const buffer = await cached.arrayBuffer();
          if (cancelled) return;
          setFileData({ kind: 'data', data: buffer });
          return;
        }

        // 2. CACHE MISS: streaming URL mode
        const url = await getBookFileUrl(book.file_path, book.storage_node_id);
        if (cancelled) return;
        setFileData({ kind: 'url', url });

      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.file_path]);

  useEffect(() => {
    if (restoredRef.current) return;
    if (!progressQuery.data) return; // chưa load xong (kể cả null cũng coi như xong)
    restoredRef.current = true;
    const loc = progressQuery.data.location;
    if (!loc) return;
    const n = Number(loc);
    if (Number.isFinite(n) && n >= 1) {
      // Mark source = 'restore' để restore scroll from localStorage.
      navigationSourceRef.current = 'restore';
      setPageNumber(n);
    }
  }, [progressQuery.data]);

  // Deep-link ?page=X (RAG citation [p.X]) — ưu tiên hơn restore progress.
  // Re-fire mỗi khi prop đổi (cùng book, click citation khác trang).
  useEffect(() => {
    if (initialPage === undefined) return;
    if (!docLoaded || !numPages) return;
    restoredRef.current = true; // ngăn effect progress override sau này
    navigationSourceRef.current = 'input';
    const target = Math.min(numPages, Math.max(1, Math.floor(initialPage)));
    setPageNumber(target);
  }, [initialPage, docLoaded, numPages]);

  // Restore scroll positions từ sessionStorage khi mount (scope theo book.id).
  useEffect(() => {
    try {
      const key = SCROLL_POSITIONS_KEY_PREFIX + book.id;
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const positions = JSON.parse(stored) as Record<string, number>;
        scrollPositionsRef.current = new Map(
          Object.entries(positions).map(([k, v]) => [Number(k), v]),
        );
      } else {
        // Book khác → reset map.
        scrollPositionsRef.current = new Map();
      }
    } catch {
      scrollPositionsRef.current = new Map();
    }
  }, [book.id]);

  // Background prefetch: cache ngay khi render streaming mode
  // → lần sau mở lại sẽ instant từ IndexedDB
  useEffect(() => {
    if (fileData?.kind !== 'url') return;

    void fetchThroughCache(
      STORE_FILES,
      book.file_path,
      () => getBookFileUrl(book.file_path, book.storage_node_id),
    ).catch(() => {
      // best-effort, fail im lặng
    });
  }, [fileData, book.file_path]);

  useEffect(() => { zoomStorage.set(scale); }, [scale]);
  useEffect(() => { themeStorage.set(theme); }, [theme]);
  useEffect(() => { selectionMaskStorage.set(selectionMask); }, [selectionMask]);
  useEffect(() => { iosCalloutStorage.set(disableIosCallout); }, [disableIosCallout]);
  useEffect(() => { showPageNavStorage.set(showPageNavButtons); }, [showPageNavButtons]);

  const cycleTheme = useCallback(() => {
    setTheme((t) => THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length]);
  }, []);

  // Pre-fetch trang kế cận để click next/prev render gần như tức thì.
  // pdfjs cache page object nội bộ trong PDFDocumentProxy → lần sau Page
  // component fetch lại sẽ hit cache.
  useEffect(() => {
    if (!docLoaded || !numPages) return;
    const doc = pdfDocRef.current as { getPage?: (n: number) => Promise<unknown> } | null;
    const getPage = doc?.getPage;
    if (!doc || !getPage) return;
    const targets = [pageNumber + 1, pageNumber - 1].filter(
      (n) => n >= 1 && n <= numPages && n !== pageNumber,
    );
    let cancelled = false;
    (async () => {
      for (const n of targets) {
        if (cancelled) break;
        try {
          await getPage.call(doc, n);
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageNumber, numPages, docLoaded]);

  // Persist scroll positions to sessionStorage (debounced, scope theo book.id).
  // Dùng sessionStorage để scroll chỉ tồn tại trong session, đóng tab → fresh start.
  useEffect(() => {
    const timer = setTimeout(() => {
      const positions: Record<string, number> = {};
      scrollPositionsRef.current.forEach((scroll, page) => {
        positions[String(page)] = scroll;
      });
      try {
        const key = SCROLL_POSITIONS_KEY_PREFIX + book.id;
        sessionStorage.setItem(key, JSON.stringify(positions));
      } catch {
        // ignore storage quota error
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [pageNumber, book.id]);

  // Debounce save: lật trang nhanh chỉ persist 1 lần khi user dừng ~600ms.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!numPages) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProgress.mutate({
        bookId: book.id,
        location: String(pageNumber),
        progress: numPages > 0 ? pageNumber / numPages : 0,
      });
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, numPages]);

  // Sync inputPageValue khi pageNumber thay đổi từ nơi khác (button, etc.)
  useEffect(() => {
    setInputPageValue(pageNumber);
  }, [pageNumber]);

  // Sync currentPage vào readerStore để RAG ChatTab biết user đang đọc trang nào.
  useEffect(() => {
    useReaderStore.getState().setPage(pageNumber);
  }, [pageNumber]);

  // Unmount: clear reader store + WeakMap text cache.
  useEffect(() => {
    return () => {
      const doc = pdfDocRef.current;
      if (doc) clearBookContextCache(doc);
      useReaderStore.getState().clear();
    };
  }, []);

  // Restore scroll position khi quay lại trang đã visit trước.
  // Chỉ restore khi navigation source là 'prev' hoặc 'restore'.
  useEffect(() => {
    if (
      containerRef.current &&
      docLoaded &&
      (navigationSourceRef.current === 'prev' ||
        navigationSourceRef.current === 'restore')
    ) {
      const savedScroll = scrollPositionsRef.current.get(pageNumber);
      if (savedScroll !== undefined && savedScroll > 0) {
        // Delay một tick để react-pdf render xong trang mới.
        const timer = requestAnimationFrame(() => {
          containerRef.current?.scrollTo({ top: savedScroll, behavior: 'auto' });
        });
        return () => cancelAnimationFrame(timer);
      }
    }
  }, [pageNumber, docLoaded]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputPageValue !== pageNumber && Number.isFinite(inputPageValue)) {
        const n = Math.max(1, Math.min(inputPageValue, numPages || inputPageValue));
        if (n !== pageNumber) {
          changePageRef.current?.(n, 'input');
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputPageValue, pageNumber, numPages]);

  const pageHighlights = useMemo(() => {
    if (!highlightsQuery.data) return [] as Highlight[];
    return highlightsQuery.data.filter(
      (h: Highlight) => h.location.type === 'pdf' && h.location.page === pageNumber,
    );
  }, [highlightsQuery.data, pageNumber]);

  const documentFile = useMemo(() => {
    if (!fileData) return null;
    if (fileData.kind === 'data') return { data: fileData.data };
    return { url: fileData.url };
  }, [fileData]);

  const captureSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 2) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const wrap = pageWrapRef.current;
    if (!wrap) return;
    if (!wrap.contains(range.commonAncestorContainer)) return;

    const wrapRect = wrap.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    if (rects.length === 0) return;

    const rectsNorm = rects.map((r) => ({
      x: (r.left - wrapRect.left) / wrapRect.width,
      y: (r.top - wrapRect.top) / wrapRect.height,
      w: r.width / wrapRect.width,
      h: r.height / wrapRect.height,
    }));

    const first = rects[0];
    setSelection({
      text,
      page: pageNumber,
      rectsNorm,
      menuRect: {
        top: first.top,
        left: first.left,
        width: first.width,
        height: first.height,
      },
    });

    // iOS Selection Callout Bar (Copy / Look Up / Share) chỉ tồn tại khi
    // còn DOM Selection. Sau khi đã capture rects + text vào state, xóa
    // selection → iOS không có gì để hiện callout. UI vẫn show overlay
    // "fake selection" + SelectionMenu của app.
    if (disableIosCalloutRef.current) {
      // Defer ra microtask để Safari kịp dispatch touchend hoàn chỉnh
      // trước khi mình clear range.
      queueMicrotask(() => {
        const s = window.getSelection();
        if (s && !s.isCollapsed) s.removeAllRanges();
      });
    }
  }, [pageNumber]);

  useEffect(() => {
    function onUp() {
      setTimeout(captureSelection, 0);
    }
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };
  }, [captureSelection]);

  async function handleHighlight() {
    if (!selection) return;
    try {
      await createHighlight.mutateAsync({
        bookId: book.id,
        location: { type: 'pdf', page: selection.page, rects: selection.rectsNorm },
        text: selection.text,
        color: 'yellow',
      });
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function handleNote() {
    if (!selection) return;
    const note = window.prompt(`Note for: ${selection.text.slice(0, 80)}${selection.text.length > 80 ? '…' : ''}`);
    if (note === null) return;
    try {
      await createHighlight.mutateAsync({
        bookId: book.id,
        location: { type: 'pdf', page: selection.page, rects: selection.rectsNorm },
        text: selection.text,
        color: 'blue',
        note,
      });
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  function handleTranslate() {
    if (!selection) return;
    setTranslateText(selection.text);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function handleAskAi() {
    if (!selection) return;
    const quoted = selection.text.trim();
    if (!quoted) return;
    // Đẩy raw context vào ragStore + mở RAG modal.
    // ChatTab render ContextCard + QuickActions cho user chọn action, KHÔNG auto-send.
    useRagStore.getState().setPendingContext(quoted, selection.page);
    useModalStore.getState().open('rag');
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  /**
   * Snapshot canvas hiện tại → đặt làm placeholder để tránh flicker khi
   * react-pdf clear canvas trong lúc render trang mới. Dùng offscreen
   * canvas + drawImage (chỉ copy bitmap, không encode) → gần như free.
   */
  const captureSnapshot = useCallback(() => {
    const wrap = pageWrapRef.current;
    if (!wrap) return;
    const src = wrap.querySelector('canvas.react-pdf__Page__canvas');
    if (!(src instanceof HTMLCanvasElement)) return;
    let off = snapshotRef.current;
    if (!off) {
      off = document.createElement('canvas');
      off.setAttribute('aria-hidden', 'true');
      off.dataset.pdfSnapshot = 'true';
      off.className = 'pointer-events-none absolute inset-0 z-10';
      snapshotRef.current = off;
    }
    off.width = src.width;
    off.height = src.height;
    off.style.width = `${src.clientWidth}px`;
    off.style.height = `${src.clientHeight}px`;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(src, 0, 0);
    // Mount canvas vào DOM (hoặc đảm bảo còn ở đúng chỗ)
    if (off.parentElement !== wrap) wrap.appendChild(off);
    setSnapshotVisible(true);
  }, []);

  const clearSnapshot = useCallback(() => {
    setSnapshotVisible(false);
    const off = snapshotRef.current;
    if (off && off.parentElement) off.parentElement.removeChild(off);
  }, []);

  // Safety: clear snapshot sau 1.5s phòng khi onRenderSuccess không fire
  // (page bị cancel do user lật trang quá nhanh).
  useEffect(() => {
    if (!snapshotVisible) return;
    const id = setTimeout(() => clearSnapshot(), 1500);
    return () => clearTimeout(id);
  }, [snapshotVisible, clearSnapshot]);

  // Safety: clear pageTransitioning sau 1.5s phòng khi onRenderSuccess
  // không fire (user lật trang quá nhanh, page bị cancel).
  // Dùng safety timer ngoài effect (không cần state).
  const pageTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup offscreen canvas khi unmount
  useEffect(
    () => () => {
      const off = snapshotRef.current;
      if (off && off.parentElement) off.parentElement.removeChild(off);
      snapshotRef.current = null;
    },
    [],
  );

  const changePage = useCallback(
    (
      updater: number | ((p: number) => number),
      source: 'next' | 'prev' | 'input' = 'next',
    ) => {
      navigationSourceRef.current = source;

      const container = containerRef.current;
      if (!container) return;

      const prevScroll = container.scrollTop;
      const prevPage = pageNumber;
      const target = typeof updater === 'function' ? updater(prevPage) : updater;
      const next = Math.min(numPages || target, Math.max(1, target));

      if (next === prevPage) return; // No-op

      // Lưu scroll cũ.
      scrollPositionsRef.current.set(prevPage, prevScroll);

      // HIDE page wrap SYNCHRONOUSLY qua DOM ref (không chờ React state).
      // Phải hide TRƯỚC scrollTop = 0 để user không thấy đầu trang cũ.
      if (pageWrapRef.current) {
        pageWrapRef.current.style.visibility = 'hidden';
      }

      // Safety timeout phòng khi onRenderSuccess không fire.
      if (pageTransitionTimerRef.current) clearTimeout(pageTransitionTimerRef.current);
      pageTransitionTimerRef.current = setTimeout(() => {
        if (pageWrapRef.current) {
          pageWrapRef.current.style.visibility = 'visible';
        }
      }, 1500);

      // Chỉ scroll to top khi source = 'next' hoặc 'input'.
      // Source 'prev' giữ scrollTop, để restore effect chạy sau khi page render.
      if (source === 'next' || source === 'input') {
        container.scrollTop = 0;
      }

      setPageNumber(next);
    },
    [numPages, pageNumber],
  );

  // Sync changePageRef để useEffect ở trên có thể gọi.
  useEffect(() => {
    changePageRef.current = changePage;
  }, [changePage]);

  /** Zoom: snapshot canvas hiện tại, scale CSS-size theo ratio để khớp
   * canvas mới → người dùng thấy trang to/nhỏ ngay lập tức, không flicker. */
  const changeScale = useCallback(
    (updater: (s: number) => number) => {
      setScale((s) => {
        const next = Math.min(3, Math.max(0.5, updater(s)));
        if (next === s) return s;
        captureSnapshot();
        const off = snapshotRef.current;
        if (off) {
          const ratio = next / s;
          off.style.width = `${parseFloat(off.style.width) * ratio}px`;
          off.style.height = `${parseFloat(off.style.height) * ratio}px`;
        }
        return next;
      });
    },
    [captureSnapshot],
  );

  function goToPage(target: number) {
    // Jump qua input (sidebar/TOC/highlights) — không restore scroll cũ.
    changePage(target, 'input');
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') changePage((p) => Math.max(1, p - 1), 'prev');
      if (e.key === 'ArrowRight') changePage((p) => Math.min(numPages || p, p + 1), 'next');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, changePage]);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100 select-none">
      {/* Disable text selection cho toàn bộ UI.
          Chỉ enable lại cho PDF content (pageWrapRef có select-text).
          Selection mask sẽ block thêm header/footer của PDF page. */}
      <ReaderHeader title={book.title}>
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="hidden md:flex p-1.5 text-zinc-400 hover:text-zinc-100"
          title="Mục lục / Highlights"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="hidden md:block mx-1 h-4 w-px bg-zinc-800" />

        {/* Mobile: Compact controls */}
        <div className="flex items-center gap-1 md:hidden">
          <button
            onClick={() => changePage((p) => Math.max(1, p - 1), 'prev')}
            disabled={pageNumber <= 1}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Page counter - clickable to open input */}
          {mobilePageInputOpen ? (
            <input
              type="number"
              min={1}
              max={numPages || 1}
              // placeholder={String(pageNumber)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const value = e.currentTarget.value.trim();
                  const n = value === '' ? pageNumber : Number(value);
                  if (Number.isFinite(n) && n >= 1 && n <= (numPages || n)) {
                    changePage(n, 'input');
                  }
                  setMobilePageInputOpen(false);
                } else if (e.key === 'Escape') {
                  setMobilePageInputOpen(false);
                }
              }}
              onBlur={(e) => {
                const value = e.currentTarget.value.trim();
                const n = value === '' ? pageNumber : Number(value);
                if (Number.isFinite(n) && n >= 1 && n <= (numPages || n)) {
                  changePage(n, 'input');
                }
                setMobilePageInputOpen(false);
              }}
              autoFocus
              className="w-16 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-center text-xs text-zinc-200 rounded"
            />
          ) : (
            <button
              onClick={() => setMobilePageInputOpen(true)}
              className="text-xs text-zinc-500 min-w-[3rem] text-center hover:text-zinc-300 transition-colors px-1 py-0.5 rounded hover:bg-zinc-800"
              title="Click to jump to page"
            >
              {pageNumber}/{numPages || '?'}
            </button>
          )}

          <button
            onClick={() => changePage((p) => Math.min(numPages || p, p + 1), 'next')}
            disabled={pageNumber >= numPages}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            title="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 text-zinc-400 hover:text-zinc-100"
            title="Mục lục / Highlights"
          >
            <Menu className="h-4 w-4" />
          </button>
          <SettingsDropdown
            theme={theme}
            onThemeChange={cycleTheme}
            selectionMaskEnabled={selectionMask.enabled}
            onToggleSelectionMask={() => setSelectionMask((m) => ({ ...m, enabled: !m.enabled }))}
            selectionMaskTop={selectionMask.top}
            selectionMaskBottom={selectionMask.bottom}
            onMaskTopChange={(value) => setSelectionMask((m) => ({ ...m, top: value }))}
            onMaskBottomChange={(value) => setSelectionMask((m) => ({ ...m, bottom: value }))}
            scale={scale}
            onZoomIn={() => changeScale((s) => s + 0.1)}
            onZoomOut={() => changeScale((s) => s - 0.1)}
            disableIosCallout={disableIosCallout}
            onToggleIosCallout={() => setDisableIosCallout((v) => !v)}
            showPageNavButtons={showPageNavButtons}
            onTogglePageNavButtons={() => setShowPageNavButtons((v) => !v)}
          />
        </div>

        {/* Desktop: Full controls */}
        <div className="hidden md:flex items-center gap-1">
          <button
            onClick={() => changePage((p) => Math.max(1, p - 1), 'prev')}
            disabled={pageNumber <= 1}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            title="Previous page (←)"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={inputPageValue}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setInputPageValue(n);
            }}
            className="w-12 border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-center text-xs"
          />
          <span className="text-xs text-zinc-500">/ {numPages || '?'}</span>
          <button
            onClick={() => changePage((p) => Math.min(numPages || p, p + 1), 'next')}
            disabled={pageNumber >= numPages}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            title="Next page (→)"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <button
            onClick={() => changeScale((s) => s - 0.1)}
            className="p-1.5 text-zinc-400 hover:text-zinc-100"
            title="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-xs font-mono text-zinc-500">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => changeScale((s) => s + 0.1)}
            className="p-1.5 text-zinc-400 hover:text-zinc-100"
            title="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <button
            onClick={cycleTheme}
            className="p-1.5 text-zinc-400 hover:text-zinc-100"
            title={`Theme: ${theme} (click to switch)`}
          >
            {theme === 'dark' ? (
              <Moon className="h-4 w-4" />
            ) : theme === 'sepia' ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <button
            onClick={() => setSelectionMask((m) => ({ ...m, enabled: !m.enabled }))}
            className="p-1.5 text-zinc-400 hover:text-zinc-100"
            title={selectionMask.enabled ? 'Selection mask ON (click to disable)' : 'Selection mask OFF (click to enable)'}
          >
            {selectionMask.enabled ? (
              <Eye className="h-4 w-4 text-blue-400" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </button>
          {selectionMask.enabled && (
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <span>T:</span>
              <input
                type="number"
                min={0}
                max={20}
                step={1}
                value={selectionMask.top}
                onChange={(e) => setSelectionMask((m) => ({ ...m, top: Number(e.target.value) }))}
                onFocus={() => setShowMaskBorders(true)}
                onBlur={() => setShowMaskBorders(false)}
                className="w-10 border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-center"
              />
              <span>B:</span>
              <input
                type="number"
                min={0}
                max={20}
                step={1}
                value={selectionMask.bottom}
                onChange={(e) => setSelectionMask((m) => ({ ...m, bottom: Number(e.target.value) }))}
                onFocus={() => setShowMaskBorders(true)}
                onBlur={() => setShowMaskBorders(false)}
                className="w-10 border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-center"
              />
            </div>
          )}
          <SettingsDropdown
            theme={theme}
            onThemeChange={cycleTheme}
            selectionMaskEnabled={selectionMask.enabled}
            onToggleSelectionMask={() => setSelectionMask((m) => ({ ...m, enabled: !m.enabled }))}
            selectionMaskTop={selectionMask.top}
            selectionMaskBottom={selectionMask.bottom}
            onMaskTopChange={(value) => setSelectionMask((m) => ({ ...m, top: value }))}
            onMaskBottomChange={(value) => setSelectionMask((m) => ({ ...m, bottom: value }))}
            scale={scale}
            onZoomIn={() => changeScale((s) => s + 0.1)}
            onZoomOut={() => changeScale((s) => s - 0.1)}
            disableIosCallout={disableIosCallout}
            onToggleIosCallout={() => setDisableIosCallout((v) => !v)}
            showPageNavButtons={showPageNavButtons}
            onTogglePageNavButtons={() => setShowPageNavButtons((v) => !v)}
          />
        </div>
      </ReaderHeader>

      <ProgressBar current={pageNumber} total={numPages} onJump={(p) => goToPage(p)} />

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto p-4 transition-colors"
          style={{ backgroundColor: THEME_BG[theme] }}
          onScroll={(e) => {
            // Update scroll position của trang hiện tại khi user scroll.
            const scrollTop = (e.target as HTMLElement).scrollTop;
            scrollPositionsRef.current.set(pageNumber, scrollTop);
          }}
        >
          {error && <div className="text-center text-sm text-red-400">{error}</div>}
          {fileData && (
            <div className="flex justify-center">
              <Document
                file={documentFile}
                onLoadProgress={({ loaded, total }) => {
                  // Chỉ track khi streaming (cache miss)
                  if (fileData?.kind !== 'url') return;
                  setDownloadProgress({ loaded, total });
                }}
                onLoadSuccess={async (pdf) => {
                  setNumPages(pdf.numPages);
                  setDocLoaded(true);
                  pdfDocRef.current = pdf;
                  // Expose doc cho RAG ChatTab (mode Sách dùng book-context).
                  useReaderStore.getState().setReader({
                    doc: pdf as unknown as PdfDocLike,
                    bookId: book.id,
                    bookTitle: book.title,
                    numPages: pdf.numPages,
                  });
                  // Lazy build TOC từ outline
                  try {
                    const outline = await (pdf as unknown as {
                      getOutline?: () => Promise<unknown[]>;
                    }).getOutline?.();
                    if (outline) setToc(await buildPdfToc(pdf as unknown, outline));
                  } catch {
                    // ignore — không có outline cũng OK
                  }
                }}
                onLoadError={(err) => setError(err.message)}
                loading={null}
                className="shadow-2xl"
              >
                <div
                  ref={pageWrapRef}
                  className="relative select-text"
                  data-pdf-theme={theme}
                  style={
                    disableIosCallout
                      ? ({ WebkitTouchCallout: 'none' } as React.CSSProperties)
                      : undefined
                  }
                >
                  {pageResolved ? (
                    <Page
                      pageNumber={pageNumber}
                      scale={scale}
                      renderAnnotationLayer={false}
                      renderTextLayer
                      loading={null}
                      onRenderSuccess={() => {
                        clearSnapshot();
                        // Show lại page wrap SYNCHRONOUSLY qua DOM ref.
                        if (pageWrapRef.current) {
                          pageWrapRef.current.style.visibility = 'visible';
                        }
                        if (pageTransitionTimerRef.current) {
                          clearTimeout(pageTransitionTimerRef.current);
                          pageTransitionTimerRef.current = null;
                        }
                      }}
                    />
                  ) : (
                    <ReaderSkeleton withHeader={false} />
                  )}
                  <HighlightOverlay highlights={pageHighlights} />
                  {disableIosCallout &&
                    selection &&
                    selection.page === pageNumber && (
                      <SelectionRectsOverlay rects={selection.rectsNorm} />
                    )}
                  {selectionMask.enabled && (
                    <SelectionMaskOverlay
                      top={selectionMask.top}
                      bottom={selectionMask.bottom}
                      showBorders={showMaskBorders}
                    />
                  )}
                </div>
              </Document>
            </div>
          )}
        </div>

        {/* Edge zones — đặt ngoài scroll container để cố định theo viewport
            reader, không bị đẩy khuất khi user zoom rồi scroll xuống.
            Ẩn được qua SettingsDropdown (showPageNavButtons). */}
        {showPageNavButtons && (
          <EdgeClickZones
            sidebarOpen={sidebarOpen}
            onPrev={() => {
              if (pageNumber <= 1) return;
              changePage((p) => Math.max(1, p - 1), 'prev');
            }}
            onNext={() => {
              if (numPages && pageNumber >= numPages) return;
              changePage((p) => Math.min(numPages || p, p + 1), 'next');
            }}
          />
        )}

        {/* Skeleton chỉ hiện khi document chưa parse xong. Page render sau
            đó tốc độ ~100-300ms — không cần skeleton, để render canvas đè
            page cũ tự nhiên hơn. */}
        {!error && (!fileData || !docLoaded) && (
          <ReaderSkeleton withHeader={false} progress={downloadProgress} />
        )}

        <ReaderSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          renderToc={() => (
            <TocList
              items={toc}
              activeTarget={pageNumber}
              onJump={(target) => {
                if (typeof target === 'number') goToPage(target);
                // setSidebarOpen(false);
              }}
            />
          )}
          renderHighlights={() => (
            <HighlightList
              bookId={book.id}
              onJump={(h: Highlight) => {
                if (h.location.type !== 'pdf') return;
                goToPage(h.location.page);
                // setSidebarOpen(false);
              }}
            />
          )}
          renderSearch={() => (
            <PdfSearchTab
              doc={pdfDocRef.current}
              onJump={(page) => {
                goToPage(page);
                // setSidebarOpen(false);
              }}
            />
          )}
        />
      </div>

      {selection && (
        <SelectionMenu
          rect={selection.menuRect}
          onHighlight={handleHighlight}
          onNote={handleNote}
          onTranslate={handleTranslate}
          onAskAi={handleAskAi}
          onDismiss={() => {
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
        />
      )}
      {translateText && (
        <TranslatePopover text={translateText} onClose={() => setTranslateText(null)} />
      )}
    </div>
  );
}

/**
 * SelectionRectsOverlay - vẽ "fake selection" theo rects normalized khi
 * đã xóa native DOM Selection (để tránh iOS Selection Callout Bar). Màu
 * mô phỏng selection mặc định của browser.
 */
function SelectionRectsOverlay({
  rects,
}: {
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {rects.map((r, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
            backgroundColor: 'rgba(59, 130, 246, 0.35)',
            mixBlendMode: 'multiply',
          }}
        />
      ))}
    </div>
  );
}

function HighlightOverlay({ highlights }: { highlights: Highlight[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {highlights.flatMap((h) => {
        if (h.location.type !== 'pdf') return [];
        const color =
          h.color === 'blue'
            ? 'rgba(59, 130, 246, 0.35)'
            : h.color === 'green'
              ? 'rgba(34, 197, 94, 0.35)'
              : h.color === 'red'
                ? 'rgba(239, 68, 68, 0.35)'
                : 'rgba(250, 204, 21, 0.35)';
        return h.location.rects.map((r, i) => (
          <div
            key={`${h.id}-${i}`}
            title={h.note ?? undefined}
            className="absolute"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              backgroundColor: color,
              mixBlendMode: 'multiply',
            }}
          />
        ));
      })}
    </div>
  );
}

/**
 * SelectionMaskOverlay - Block text selection ở header/footer của PDF.
 * User có thể adjust top/bottom percentage để skip page numbers, running headers, etc.
 */
function SelectionMaskOverlay({
  top,
  bottom,
  showBorders,
}: {
  top: number;
  bottom: number;
  showBorders: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Top mask */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-auto transition-all cursor-not-allowed"
        style={{
          height: `${top}%`,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          backgroundColor: showBorders ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
          borderBottom: showBorders ? '2px dashed rgba(59, 130, 246, 0.6)' : 'none',
        }}
        onMouseDown={(e) => e.preventDefault()}
      />
      {/* Bottom mask */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-auto transition-all cursor-not-allowed"
        style={{
          height: `${bottom}%`,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          backgroundColor: showBorders ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
          borderTop: showBorders ? '2px dashed rgba(59, 130, 246, 0.6)' : 'none',
        }}
        onMouseDown={(e) => e.preventDefault()}
      />
    </div>
  );
}


/**
 * Convert PDF outline (recursive) → TocItem[]. Resolve dest → page number
 * qua `pdf.getPageIndex(dest[0])`. Item nào không resolve được sẽ skip.
 */
async function buildPdfToc(pdf: unknown, outline: unknown[]): Promise<TocItem[]> {
  const doc = pdf as {
    getPageIndex: (ref: unknown) => Promise<number>;
    getDestination: (name: string) => Promise<unknown[] | null>;
  };

  async function resolveDest(dest: unknown): Promise<number | null> {
    try {
      let arr: unknown[] | null = null;
      if (Array.isArray(dest)) arr = dest;
      else if (typeof dest === 'string') arr = await doc.getDestination(dest);
      if (!arr || arr.length === 0) return null;
      const idx = await doc.getPageIndex(arr[0]);
      return idx + 1; // 1-based
    } catch {
      return null;
    }
  }

  async function visit(items: unknown[], level: number): Promise<TocItem[]> {
    const out: TocItem[] = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const node = it as { title?: unknown; dest?: unknown; items?: unknown[] };
      const label = typeof node.title === 'string' ? node.title.trim() : '';
      if (!label) continue;
      const target = await resolveDest(node.dest);
      const children =
        Array.isArray(node.items) && node.items.length > 0
          ? await visit(node.items, level + 1)
          : undefined;
      if (target === null && (!children || children.length === 0)) continue;
      out.push({
        label,
        target: target ?? 1,
        level,
        children,
      });
    }
    return out;
  }

  return visit(outline, 0);
}