import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Package, RotateCcw, FolderOpen, ChevronRight, ChevronDown, File as FileIcon, Archive, Download, Plus, X, Pencil, Search } from 'lucide-react';
import { PackerLoadingSpinner } from './PackerLoadingSpinner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/sonner';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { createToolStorage } from '@/lib/plugin-storage';

import TerminalLog from './TerminalLog';
import PartOutput from './PartOutput';
import PackerOptions from './PackerOptions';
import { FolderDiffToggle } from './FolderDiff';
import ScriptGenerator from './ScriptGenerator';

import { useSaveToSource } from '@/tools/project-packer/lib/useSaveToSource';
import { isExcluded, isExtensionAllowed } from '@/tools/project-packer/lib/filter';
import { PRESETS } from '@/tools/project-packer/lib/presets';
import { readFiles, packFiles, LARGE_FILE_WHITELIST } from '@/tools/project-packer/lib/pack';
import { downloadBlob } from '@/tools/project-packer/lib/unpack';
import type { LogEntry, PackOptions, PackPart } from '@/tools/project-packer/lib/types';

// ============================================================
// PackPanel - hiển thị cây thư mục, không crash
// ============================================================
//
// Tránh crash bằng cách:
// 1. File[] lưu trong useRef (KHÔNG vào React state) → không trigger re-render không lỗi
// 2. Tree state chỉ chứa metadata (path, type) → nhẹ
// 3. Lazy render: folder collapsed → không render children
//
// Persist (cứu khi crash):
// - Options: localStorage 'packer.options'
// - Selection paths: localStorage 'packer.selectedPaths'
//   → user mở folder lại, app tự restore tick từ paths cũ.
// ============================================================

const REACT_PRESET = PRESETS[0];
const DEFAULT_OPTIONS: PackOptions = {
  maxCharsPerPart: 50_000,
  excludePatterns: REACT_PRESET.excludePatterns,
  includeExtensions: REACT_PRESET.includeExtensions,
};

const LS_OPTIONS = 'packer.options';

// User-scope: chọn paths là data per user (nhiều user share máy, chọn khác nhau).
// `packer.options` (include/exclude patterns preset) vẫn dùng useLocalStorage hook —
// out of scope migration này vì key này không có trong LEGACY_MAPPING và có nhiều
// consumer khác của hook. Refactor sau khi migrate toàn bộ hook consumers.
const selectedPathsStorage = createToolStorage<string[]>({
  toolId: 'project-packer',
  key: 'selected-paths',
  scope: 'user',
});

// Persist folder labels — mapping fingerprint → label.
// Fingerprint = SHA-256 của sorted paths join. Khi user re-upload cùng folder,
// tự động restore label đã đặt trước đó.
const folderLabelsStorage = createToolStorage<Record<string, string>>({
  toolId: 'project-packer',
  key: 'folder-labels',
  scope: 'user',
});

async function computeFolderFingerprint(paths: string[]): Promise<string> {
  const sorted = [...paths].sort();
  const text = sorted.join('\n');
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8) // 16 hex chars, đủ unique cho use case này
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const HIDDEN_FOLDERS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vite',
  '.turbo', 'coverage', '.cache', '.parcel-cache', '.idea', '.vscode',
]);

// ============================================================
// Drag-drop traverse — skip HIDDEN_FOLDERS NGAY tại folder entry
// (tận dụng webkitGetAsEntry — KHÔNG scan node_modules)
// ============================================================
async function traverseEntry(
  entry: FileSystemEntry,
  parentPath: string,
  out: { file: File; path: string }[],
): Promise<void> {
  // Skip ngay nếu folder name nằm trong blacklist → không vào!
  if (entry.isDirectory && HIDDEN_FOLDERS.has(entry.name)) return;

  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) out.push({ file, path });
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries chỉ trả max 100 entries 1 lần, phải loop
    const entries: FileSystemEntry[] = [];
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (batch.length === 0) break;
      entries.push(...batch);
    }
    for (const e of entries) {
      await traverseEntry(e, path, out);
    }
  }
}

// ============================================================
// Tree types
// ============================================================
interface TreeNode {
  name: string;          // tên file/folder
  path: string;          // full path từ root
  isFolder: boolean;
  children: TreeNode[];  // chỉ folder mới có children
  fileCount: number;     // tổng số file con (folder), 1 (file)
  descendantPaths: string[]; // cache: tất cả path con (cho toggle nhanh)
}

/**
 * Selection store — Set<string> + per-path subscriptions.
 *
 * Lừ do KHÔNG dùng React state cho selectedPaths:
 *   - Mỗi tick → setState → re-render TOÀN BỘ tree (5000 row).
 *   - Mỗi folder phải re-compute count = O(descendants) × O(folders) = O(n²).
 *
 * Cách dùng: row subscribe vào path của mình, chỉ row đó re-render.
 * Folder count vẫn là O(descendants) NHƯNG chỉ chạy khi count đổi
 * (không phải mỗi setState).
 */
class SelectionStore {
  private set: Set<string>;
  private listeners = new Map<string, Set<() => void>>();
  private allListeners = new Set<() => void>();

  constructor(initial: Iterable<string>) {
    this.set = new Set(initial);
  }

  has(path: string): boolean {
    return this.set.has(path);
  }

  /** Snapshot toàn bộ — dùng để persist localStorage hoặc count. */
  getAll(): string[] {
    return [...this.set];
  }

  size(): number {
    return this.set.size;
  }

  /** Toggle nhiều path 1 lần, fire chỉ những path đổi. */
  toggle(paths: string[], checked: boolean) {
    const changed: string[] = [];
    for (const p of paths) {
      const has = this.set.has(p);
      if (checked && !has) {
        this.set.add(p);
        changed.push(p);
      } else if (!checked && has) {
        this.set.delete(p);
        changed.push(p);
      }
    }
    if (changed.length === 0) return;
    // Notify per-path listeners
    for (const p of changed) {
      this.listeners.get(p)?.forEach((cb) => cb());
    }
    // Notify all listeners (cho folder count, panel summary)
    this.allListeners.forEach((cb) => cb());
  }

  clear() {
    if (this.set.size === 0) return;
    const old = [...this.set];
    this.set.clear();
    for (const p of old) {
      this.listeners.get(p)?.forEach((cb) => cb());
    }
    this.allListeners.forEach((cb) => cb());
  }

  replace(paths: Iterable<string>) {
    const next = new Set(paths);
    const all = new Set([...this.set, ...next]);
    this.set = next;
    for (const p of all) {
      this.listeners.get(p)?.forEach((cb) => cb());
    }
    this.allListeners.forEach((cb) => cb());
  }

  /** Subscribe vào 1 path — return unsubscribe */
  subscribePath(path: string, cb: () => void): () => void {
    let s = this.listeners.get(path);
    if (!s) {
      s = new Set();
      this.listeners.set(path, s);
    }
    s.add(cb);
    return () => {
      s?.delete(cb);
      if (s?.size === 0) this.listeners.delete(path);
    };
  }

  /** Subscribe mọi thay đổi (cho folder count, summary) */
  subscribeAll(cb: () => void): () => void {
    this.allListeners.add(cb);
    return () => this.allListeners.delete(cb);
  }
}

const SelectionContext = createContext<SelectionStore | null>(null);

/**
 * VisibilityContext — null = show all, Set = chỉ show paths trong set.
 * Dùng cho search filter mà không cần rebuild tree.
 */
const VisibilityContext = createContext<Set<string> | null>(null);

/**
 * SlotColorMap — mapping folder label → colorIndex cho tree root nodes.
 */
const SlotColorMapContext = createContext<Map<string, number>>(new Map());

/**
 * HighlightedLabelContext — label hiện đang highlight (click slot).
 */
const HighlightedLabelContext = createContext<string | null>(null);

/**
 * TreeExpandAllContext — null = mỗi node tự quyết, true = force expand all, false = force collapse all.
 * Reset về null khi user thao tác manual (click 1 folder).
 */
const TreeExpandAllContext = createContext<{ value: boolean | null; reset: () => void }>({ value: null, reset: () => {} });

/** Hook: subscribe checked status của 1 path — chỉ row đó re-render khi đổi */
function useIsSelected(path: string): boolean {
  const store = useContext(SelectionContext);
  if (!store) throw new Error('SelectionContext missing');
  return useSyncExternalStore(
    (cb) => store.subscribePath(path, cb),
    () => store.has(path),
  );
}

/** Hook: count selected trong descendants — chỉ folder render khi store đổi */
function useFolderCount(allDescendants: string[]): { checked: number; total: number } {
  const store = useContext(SelectionContext);
  if (!store) throw new Error('SelectionContext missing');
  const subscribe = useCallback(
    (cb: () => void) => store.subscribeAll(cb),
    [store],
  );
  const getSnapshot = useCallback(() => {
    let count = 0;
    for (const p of allDescendants) if (store.has(p)) count++;
    return count;
  }, [allDescendants, store]);
  const checked = useSyncExternalStore(subscribe, getSnapshot);
  return { checked, total: allDescendants.length };
}

async function buildTree(paths: string[]): Promise<TreeNode> {
  const root: TreeNode = { name: '', path: '', isFolder: true, children: [], fileCount: 0, descendantPaths: [] };
  const map = new Map<string, TreeNode>();
  map.set('', root);

  for (let idx = 0; idx < paths.length; idx++) {
    // Yield mỗi 1000 paths để main thread không block
    if (idx % 1000 === 0 && idx > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const path = paths[idx];
    const parts = path.split('/');
    let parent = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${name}` : name;

      let node = map.get(currentPath);
      if (!node) {
        node = {
          name,
          path: currentPath,
          isFolder: !isLast,
          children: [],
          fileCount: 0,
          descendantPaths: [],
        };
        map.set(currentPath, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  // Tính fileCount + descendantPaths đệ quy + sort folder trước file
  function compute(node: TreeNode): number {
    if (!node.isFolder) {
      node.fileCount = 1;
      node.descendantPaths = [node.path];
      return 1;
    }
    let total = 0;
    const allPaths: string[] = [node.path];
    for (const child of node.children) {
      total += compute(child);
      allPaths.push(...child.descendantPaths);
    }
    node.fileCount = total;
    node.descendantPaths = allPaths;
    // Sort: folder trước, sau đó alphabet
    node.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return total;
  }
  compute(root);
  return root;
}

// ============================================================
// FolderSlot — mỗi folder user upload là 1 slot trong queue
// ============================================================
interface FolderSlot {
  id: string;
  label: string; // mặc định = folder-name (HH:mm:ss), user rename
  files: { file: File; path: string }[]; // relative paths bên trong folder
  fileCount: number;
  fingerprint?: string; // SHA-256 hash của sorted paths, để persist label
  colorIndex: number; // index vào SLOT_COLORS palette
}

// Palette 8 màu nhẹ, đủ phân biệt trên cả light/dark theme.
// Dùng Tailwind arbitrary values vì đây là data color, không phải theme token.
const SLOT_COLORS = [
  { dot: 'bg-blue-500', border: 'border-l-blue-500', text: 'text-blue-500' },
  { dot: 'bg-emerald-500', border: 'border-l-emerald-500', text: 'text-emerald-500' },
  { dot: 'bg-amber-500', border: 'border-l-amber-500', text: 'text-amber-500' },
  { dot: 'bg-purple-500', border: 'border-l-purple-500', text: 'text-purple-500' },
  { dot: 'bg-rose-500', border: 'border-l-rose-500', text: 'text-rose-500' },
  { dot: 'bg-cyan-500', border: 'border-l-cyan-500', text: 'text-cyan-500' },
  { dot: 'bg-orange-500', border: 'border-l-orange-500', text: 'text-orange-500' },
  { dot: 'bg-indigo-500', border: 'border-l-indigo-500', text: 'text-indigo-500' },
] as const;

let slotColorCounter = 0;

let slotIdCounter = 0;
function nextSlotId(): string {
  return `slot_${++slotIdCounter}_${Date.now()}`;
}

function defaultLabel(folderName?: string): string {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  return folderName ? `${folderName} (${time})` : time;
}

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

// ============================================================
// PackPanel
// ============================================================
export default function PackPanel() {
  // Multi-folder queue — mỗi slot = 1 folder user upload
  const [folderQueue, setFolderQueue] = useState<FolderSlot[]>([]);

  // State chỉ chứa data nhẹ
  const [tree, setTree] = useState<TreeNode | null>(null);

  // Selection store — không qua React state để tránh re-render toàn cây.
  // Persist qua localStorage: load 1 lần lúc mount, save khi store đổi.
  const selectionStore = useMemo(() => {
    const initial = selectedPathsStorage.get();
    return new SelectionStore(Array.isArray(initial) ? initial : []);
  }, []);

  // Persist khi store đổi (debounce 200ms để không spam facade khi tick nhanh)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return selectionStore.subscribeAll(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        selectedPathsStorage.set(selectionStore.getAll());
      }, 200);
    });
  }, [selectionStore]);

  // Options persist sang localStorage
  const [options, setOptions] = useLocalStorage<PackOptions>(
    LS_OPTIONS,
    DEFAULT_OPTIONS,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPacking, setIsPacking] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; path: string } | null>(null);
  const [parts, setParts] = useState<PackPart[]>([]);
  // Loading indicator cho các thao tác nặng (scan, toggle, zip)
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  // Search filter query cho tree
  const [searchQuery, setSearchQuery] = useState('');
  // Highlight: khi click slot trong queue → flash highlight folder tương ứng trong tree
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);
  // Global expand/collapse override — null = mỗi folder tự quyết, true = expand all, false = collapse all
  const [treeExpandAll, setTreeExpandAll] = useState<boolean | null>(true);
  const logIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const packAbortRef = useRef<AbortController | null>(null);

  // Progress hiển thị (smooth animated). Khác với `progress.current` là raw value.
  const [displayProgress, setDisplayProgress] = useState(0);

  // Auto-clear highlight sau 2s
  useEffect(() => {
    if (!highlightedLabel) return;
    const timer = setTimeout(() => setHighlightedLabel(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedLabel]);

  // Tween displayProgress về `progress.current` mỗi animation frame
  useEffect(() => {
    if (!progress || progress.total === 0) {
      setDisplayProgress(0);
      return;
    }
    const target = (progress.current / progress.total) * 100;
    let raf = 0;
    function tick() {
      setDisplayProgress((current) => {
        const diff = target - current;
        if (Math.abs(diff) < 0.1) return target;
        // Ease: di chuyển 8% khoảng cách mỗi frame → mượt + đuổi kịp
        return current + diff * 0.08;
      });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  function log(message: string, type: LogEntry['type'] = 'info') {
    setLogs((prev) => [
      ...prev,
      { id: ++logIdRef.current, message, type, timestamp: new Date() },
    ]);
  }

  // Save-to-source hook (extracted business logic)
  const { saveState, saveToSource, resetSaveState } = useSaveToSource({ log });

  function reset() {
    packAbortRef.current?.abort();
    packAbortRef.current = null;
    setFolderQueue([]);
    setTree(null);
    selectionStore.clear();
    setLogs([]);
    setParts([]);
    setIsPacking(false);
    resetSaveState();
    if (inputRef.current) inputRef.current.value = '';
  }

  // ============================================================
  // Download all parts as 1 ZIP (chứa nhiều .txt files)
  // ============================================================
  async function handleDownloadAllAsZip(parts: PackPart[]) {
    if (parts.length === 0) return;
    setBusyMessage(`Đang tạo ZIP với ${parts.length} part...`);
    await new Promise((r) => setTimeout(r, 0));
    try {
      // Lazy import JSZip
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      const padLen = String(parts.length).length;
      for (const part of parts) {
        const filename =
          parts.length === 1
            ? 'project-packed.txt'
            : `project-packed-part-${String(part.index).padStart(padLen, '0')}.txt`;
        zip.file(filename, part.content);
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 3 }, // level thấp = nén nhanh, ít block CPU
      });

      downloadBlob(blob, 'project-packed.zip');
      toast.success(`Đã tải ZIP (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (e) {
      toast.error('Không tạo được ZIP');
      log(`Lỗi tạo ZIP: ${String(e)}`, 'error');
    } finally {
      setBusyMessage(null);
    }
  }

  // Download mỗi part thành file .txt riêng (loop downloadBlob)
  function handleDownloadAllAsTxt(parts: PackPart[]) {
    const padLen = String(parts.length).length;
    for (const part of parts) {
      const filename =
        parts.length === 1
          ? 'project-packed.txt'
          : `project-packed-part-${String(part.index).padStart(padLen, '0')}.txt`;
      const blob = new Blob([part.content], { type: 'text/plain' });
      downloadBlob(blob, filename);
    }
    toast.success(`Đã tải ${parts.length} file .txt`);
  }

  // ============================================================
  // Folder queue management
  // ============================================================
  async function addFolderSlot(files: { file: File; path: string }[], folderName?: string): Promise<FolderSlot> {
    // Compute fingerprint → restore label nếu folder này đã upload trước đó
    const paths = files.map((f) => f.path);
    let fingerprint: string | undefined;
    let restoredLabel: string | null = null;
    try {
      fingerprint = await computeFolderFingerprint(paths);
      const saved = folderLabelsStorage.get();
      if (saved && typeof saved === 'object' && fingerprint in saved) {
        restoredLabel = saved[fingerprint];
      }
    } catch {
      // crypto.subtle không có → skip restore
    }

    const baseLabel = restoredLabel ?? defaultLabel(folderName);
    // Dedupe: nếu queue đã có folder cùng label → suffix "-2", "-3"...
    let label = baseLabel;
    const existingLabels = new Set(folderQueue.map((s) => s.label));
    if (existingLabels.has(label)) {
      let suffix = 2;
      while (existingLabels.has(`${baseLabel}-${suffix}`)) suffix++;
      label = `${baseLabel}-${suffix}`;
    }
    const slot: FolderSlot = {
      id: nextSlotId(),
      label,
      files,
      fileCount: files.length,
      fingerprint,
      colorIndex: slotColorCounter++ % SLOT_COLORS.length,
    };
    setFolderQueue((q) => [...q, slot]);
    return slot;
  }

  function removeFolderSlot(slotId: string) {
    setFolderQueue((q) => q.filter((s) => s.id !== slotId));
  }

  function renameFolderSlot(slotId: string, newLabel: string) {
    setFolderQueue((q) => {
      const existingLabels = new Set(q.filter((s) => s.id !== slotId).map((s) => s.label));
      let label = newLabel;
      if (existingLabels.has(label)) {
        let suffix = 2;
        while (existingLabels.has(`${label}-${suffix}`)) suffix++;
        label = `${label}-${suffix}`;
      }
      // Persist label theo fingerprint (nếu có) để lần sau upload tự restore
      const target = q.find((s) => s.id === slotId);
      if (target?.fingerprint) {
        const saved = folderLabelsStorage.get();
        const map = saved && typeof saved === 'object' ? { ...saved } : {};
        map[target.fingerprint] = label;
        folderLabelsStorage.set(map);
      }
      return q.map((s) => s.id === slotId ? { ...s, label } : s);
    });
  }

  // Rebuild tree khi queue thay đổi
  useEffect(() => {
    if (folderQueue.length === 0) {
      setTree(null);
      selectionStore.clear();
      return;
    }
    // Build merged paths (prefix = slot.label)
    let cancelled = false;
    (async () => {
      const allPaths: string[] = [];
      for (const slot of folderQueue) {
        for (const f of slot.files) {
          allPaths.push(`${slot.label}/${f.path}`);
        }
      }
      const newTree = await buildTree(allPaths);
      if (cancelled) return;
      setTree(newTree);
      // Auto-select: keep currently selected paths + add new paths as selected
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;
      const previousPaths = new Set(selectionStore.getAll());
      // New paths = paths in allPaths that weren't in previous selection
      // Strategy: keep old selection that still exists + auto-select new paths
      const result: string[] = [];
      for (const p of allPaths) {
        if (previousPaths.has(p)) {
          // Path existed before and was selected → keep selected
          result.push(p);
        } else if (!previousPaths.size) {
          // First load (nothing selected yet) → select all
          result.push(p);
        } else {
          // New path (new folder added) → auto-select
          result.push(p);
        }
      }
      selectionStore.replace(result);
      setParts([]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderQueue]);

  // ============================================================
  // Folder input — scan tên, build tree, KHÔNG đọc content
  // ============================================================
  async function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) {
      setBusyMessage(null);
      return;
    }

    setBusyMessage(`Đang xử lý ${files.length.toLocaleString('vi-VN')} file...`);
    await new Promise((r) => setTimeout(r, 0));

    // Filter hidden folders
    const filtered = files
      .map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))
      .filter(({ path }) => {
        const parts = path.split('/');
        return !parts.some((p) => HIDDEN_FOLDERS.has(p));
      });

    // Strip root folder name (webkitRelativePath always prefixes with folder name)
    const sample = filtered[0]?.path ?? '';
    const firstSegment = sample.split('/')[0];
    const hasRootPrefix =
      filtered.length > 1 &&
      firstSegment.length > 0 &&
      filtered.every((f) => f.path.startsWith(firstSegment + '/'));
    const strippedFiles = hasRootPrefix
      ? filtered.map((f) => ({ ...f, path: f.path.split('/').slice(1).join('/') }))
      : filtered;

    const slot = await addFolderSlot(strippedFiles, hasRootPrefix ? firstSegment : undefined);
    log(`Đã thêm folder "${slot.label}" (${strippedFiles.length} file)`);
    setBusyMessage(null);
    // Reset input value so same folder can be re-uploaded
    if (inputRef.current) inputRef.current.value = '';
  }

  // ============================================================
  // Pack — đọc content files đã chọn
  // ============================================================
  async function handlePack() {
    // Abort previous pack nếu đang chạy
    packAbortRef.current?.abort();
    const controller = new AbortController();
    packAbortRef.current = controller;

    setIsPacking(true);
    setParts([]);
    setLogs([]);
    setProgress({ current: 0, total: 0, path: '' });
    // Pack mới → clear save state cũ (packId cũ không còn valid)
    resetSaveState();

    // Scroll tới progress bar sau khi DOM render
    requestAnimationFrame(() => {
      progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Lấy file từ tất cả folder slots, prefix path = slot.label
    const allFiles: { file: File; path: string; prefixedPath: string }[] = [];
    for (const slot of folderQueue) {
      for (const f of slot.files) {
        allFiles.push({ file: f.file, path: f.path, prefixedPath: `${slot.label}/${f.path}` });
      }
    }

    // Log chi tiết file bị filter để user biết tại sao bị loại.
    const filteredOut: { path: string; reason: string }[] = [];
    const toRead = allFiles.filter((f) => {
      if (!selectionStore.has(f.prefixedPath)) return false;
      const filename = f.path.split('/').pop() ?? '';

      // Whitelist file lớn (package-lock.json) — bypass exclude pattern.
      const isWhitelisted = LARGE_FILE_WHITELIST.has(filename);

      if (!isWhitelisted && isExcluded(f.path, options.excludePatterns)) {
        filteredOut.push({ path: f.prefixedPath, reason: 'exclude pattern' });
        return false;
      }
      if (!isExtensionAllowed(f.path, options.includeExtensions)) {
        filteredOut.push({ path: f.prefixedPath, reason: 'extension không trong include list' });
        return false;
      }
      return true;
    });

    // Log file bị filter (giới hạn 30 dòng để không spam)
    if (filteredOut.length > 0) {
      log(`Filter: ${filteredOut.length} file bị loại (xem chi tiết bên dưới)`, 'warning');
      for (const f of filteredOut.slice(0, 30)) {
        log(`  ✗ ${f.path} — ${f.reason}`, 'warning');
      }
      if (filteredOut.length > 30) {
        log(`  ... vă ${filteredOut.length - 30} file khác`, 'warning');
      }
    }

    setProgress({ current: 0, total: toRead.length, path: '' });
    log(`Bắt đầu đọc ${toRead.length} file...`);

    const { files: packedFiles, failed } = await readFiles(
      toRead.map((f) => ({ file: f.file, path: f.prefixedPath })),
      (p) => {
        setProgress({ current: p.current, total: p.total, path: p.currentPath });
        if (p.current % 50 === 0 || p.current === p.total) {
          log(`Đọc ${p.current}/${p.total}: ${p.currentPath}`);
        }
      },
      controller.signal,
    );

    // Nếu bị abort giữa chừng → dừng sớm
    if (controller.signal.aborted) {
      log('Pack đã bị huỷ.', 'warning');
      setIsPacking(false);
      setProgress(null);
      return;
    }

    for (const f of failed.slice(0, 20)) {
      log(`Bỏ qua: ${f.path} (${f.reason})`, 'warning');
    }
    if (failed.length > 20) log(`... vă ${failed.length - 20} file khác bị bỏ qua`, 'warning');

    if (packedFiles.length === 0) {
      log('Không đọc được file năo!', 'error');
      setIsPacking(false);
      setProgress(null);
      return;
    }

    log(`Đã đọc ${packedFiles.length} file. Đang chia parts...`);
    setProgress({ current: packedFiles.length, total: packedFiles.length, path: 'Đang chia parts...' });
    const result = await packFiles(packedFiles, options);
    log(`✓ Xong! ${result.length} part`, 'success');

    setParts(result);
    setIsPacking(false);
    setProgress(null);
  }

  // Đếm file đã chọn (chỉ file, không folder paths)
  const selectedFileCount = useSyncExternalStore(
    useCallback((cb) => selectionStore.subscribeAll(cb), [selectionStore]),
    useCallback(() => {
      if (!tree) return 0;
      let count = 0;
      const filePaths = new Set<string>();
      for (const slot of folderQueue) {
        for (const f of slot.files) {
          filePaths.add(`${slot.label}/${f.path}`);
        }
      }
      for (const p of selectionStore.getAll()) {
        if (filePaths.has(p)) count++;
      }
      return count;
    }, [tree, selectionStore, folderQueue]),
  );

  // Compute visible paths cho search filter — bao gồm cả ancestor paths
  // để folder chứa file match vẫn hiện. Empty query = null (không filter).
  const visiblePaths = useMemo<Set<string> | null>(() => {
    if (!tree || !searchQuery.trim()) return null;
    const query = searchQuery.trim().toLowerCase();
    const visible = new Set<string>();
    function walk(node: TreeNode): boolean {
      let selfOrDescMatch = false;
      if (!node.isFolder) {
        // File: match theo tên hoặc full path
        if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
          visible.add(node.path);
          selfOrDescMatch = true;
        }
      } else {
        // Folder: check children
        for (const c of node.children) {
          if (walk(c)) selfOrDescMatch = true;
        }
        // Cũng match folder theo tên (VD user search "src" → toàn folder src visible)
        if (node.name.toLowerCase().includes(query)) {
          selfOrDescMatch = true;
          // Add tất cả descendants của folder này
          for (const p of node.descendantPaths) visible.add(p);
        }
        if (selfOrDescMatch) visible.add(node.path);
      }
      return selfOrDescMatch;
    }
    for (const c of tree.children) walk(c);
    return visible;
  }, [tree, searchQuery]);

  // Estimate output size cho preview
  const outputEstimate = useMemo(() => {
    if (!tree || selectedFileCount === 0) return null;
    const selected = new Set(selectionStore.getAll());
    let totalBytes = 0;
    for (const slot of folderQueue) {
      for (const f of slot.files) {
        if (selected.has(`${slot.label}/${f.path}`)) {
          totalBytes += f.file.size;
        }
      }
    }
    // Overhead ~150 bytes/file cho markers (FILE_START, PATH, CONTENT_START, FILE_END)
    const OVERHEAD_PER_FILE = 150;
    const totalChars = totalBytes + selectedFileCount * OVERHEAD_PER_FILE;
    const estimatedParts = Math.max(1, Math.ceil(totalChars / options.maxCharsPerPart));
    return { totalBytes, totalChars, estimatedParts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, folderQueue, selectedFileCount, options.maxCharsPerPart, selectionStore]);

  // Color map cho tree root folders — phải ở top-level, KHÔNG trong conditional
  const slotColorMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of folderQueue) m.set(s.label, s.colorIndex);
    return m;
  }, [folderQueue]);

  // Context value cho tree expand/collapse — stable reference
  const treeExpandCtx = useMemo(
    () => ({ value: treeExpandAll, reset: () => setTreeExpandAll(null) }),
    [treeExpandAll],
  );

  return (
    <div className="space-y-3">
      {/* Loading overlay khi xử lừ nặng */}
      {busyMessage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-3 border border-border bg-card px-6 py-4 shadow-lg">
            <PackerLoadingSpinner />
            <span className="text-sm font-medium text-foreground">{busyMessage}</span>
          </div>
        </div>
      )}

      {folderQueue.length === 0 && (
        <div className="space-y-3">
        <ScriptGenerator />
        <div
          onClick={() => {
            setBusyMessage('Đang mở dialog chọn folder...');
            const input = inputRef.current;
            if (!input) return;

            const clearIfNoFiles = () => {
              setTimeout(() => {
                if ((input.files?.length ?? 0) === 0) {
                  setBusyMessage((m) =>
                    m === 'Đang mở dialog chọn folder...' ? null : m,
                  );
                }
              }, 0);
              input.removeEventListener('cancel', clearIfNoFiles);
              window.removeEventListener('focus', clearIfNoFiles);
            };
            input.addEventListener('cancel', clearIfNoFiles);
            window.addEventListener('focus', clearIfNoFiles);

            input.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('border-primary', 'bg-popover');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('border-primary', 'bg-popover');
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('border-primary', 'bg-popover');
            setBusyMessage('Đang quét thư mục...');
            await new Promise((r) => setTimeout(r, 0));
            const items = Array.from(e.dataTransfer.items);
            const collected: { file: File; path: string }[] = [];
            let rootFolderName: string | undefined;
            for (const item of items) {
              const entry = item.webkitGetAsEntry?.();
              if (entry) {
                if (!rootFolderName && entry.isDirectory) rootFolderName = entry.name;
                await traverseEntry(entry, '', collected);
              }
            }
            if (collected.length > 0) {
              await addFolderSlot(collected, rootFolderName);
              log(`Đã thêm folder (drag-drop, ${collected.length} file)`);
            }
            setBusyMessage(null);
          }}
          className="flex cursor-pointer flex-col items-center justify-center border-2 border-dashed border-border bg-card py-10 text-center transition-colors hover:border-primary hover:bg-popover"
        >
          <FolderOpen className="mb-2 h-8 w-8 text-primary" />
          <p className="text-sm font-medium text-foreground">Kéo-thả thư mục vào đây</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hoặc click để chọn (kéo-thả nhanh hơn, không bị lag với project lớn)
          </p>
          <p className="mt-2 text-[10px] text-warning/80">
            Có thể chậm nếu kích thước folder lớn
          </p>
          <input
            ref={inputRef}
            type="file"
            // @ts-expect-error webkitdirectory
            webkitdirectory="true"
            directory="true"
            multiple
            className="hidden"
            onChange={handleFolderInput}
          />
        </div>
        </div>
      )}

      {folderQueue.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* ===== Cột trái: Input & Config ===== */}
          <div className="space-y-3">
            {/* Folder Queue */}
            <div
              className="border border-border bg-card"
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('border-primary');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('border-primary');
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-primary');
                setBusyMessage('Đang quét thư mục...');
                await new Promise((r) => setTimeout(r, 0));
                const items = Array.from(e.dataTransfer.items);
                const collected: { file: File; path: string }[] = [];
                let rootFolderName: string | undefined;
                for (const item of items) {
                  const entry = item.webkitGetAsEntry?.();
                  if (entry) {
                    if (!rootFolderName && entry.isDirectory) rootFolderName = entry.name;
                    await traverseEntry(entry, '', collected);
                  }
                }
                if (collected.length > 0) {
                  await addFolderSlot(collected, rootFolderName);
                  log(`Đã thêm folder (drag-drop, ${collected.length} file)`);
                }
                setBusyMessage(null);
              }}
            >
              <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Folder Queue — {folderQueue.length} folder
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setBusyMessage('Đang mở dialog chọn folder...');
                      const input = inputRef.current;
                      if (!input) return;
                      const clearIfNoFiles = () => {
                        setTimeout(() => {
                          if ((input.files?.length ?? 0) === 0) {
                            setBusyMessage((m) =>
                              m === 'Đang mở dialog chọn folder...' ? null : m,
                            );
                          }
                        }, 0);
                        input.removeEventListener('cancel', clearIfNoFiles);
                        window.removeEventListener('focus', clearIfNoFiles);
                      };
                      input.addEventListener('cancel', clearIfNoFiles);
                      window.addEventListener('focus', clearIfNoFiles);
                      input.click();
                    }}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" />
                    Thêm folder
                  </button>
                </div>
              </div>
              <div className="divide-y divide-border">
                {folderQueue.map((slot) => (
                  <FolderSlotRow
                    key={slot.id}
                    slot={slot}
                    onRename={(label) => renameFolderSlot(slot.id, label)}
                    onRemove={() => removeFolderSlot(slot.id)}
                    onHighlight={() => setHighlightedLabel(slot.label)}
                  />
                ))}
              </div>
            </div>

            {/* Hidden input for "Thêm folder" */}
            <input
              ref={inputRef}
              type="file"
              // @ts-expect-error webkitdirectory
              webkitdirectory="true"
              directory="true"
              multiple
              className="hidden"
              onChange={handleFolderInput}
            />

            {/* Folder Diff — on-demand, chỉ khi user bật */}
            {folderQueue.length >= 2 && (
              <FolderDiffToggle folderQueue={folderQueue} />
            )}

            <PackerOptions options={options} onChange={setOptions} />

            {/* Tree */}
            {tree && (
              <div className="border border-border bg-card">
                {/* Search bar */}
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm file theo tên hoặc đường dẫn..."
                    className="h-7 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Tree header */}
                <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {selectedFileCount}/{tree.fileCount} file đã chọn
                    {searchQuery && visiblePaths && ` · ${visiblePaths.size} kết quả`}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (selectedFileCount === tree.fileCount) {
                          selectionStore.clear();
                        } else {
                          const all: string[] = [];
                          function collect(node: TreeNode) {
                            all.push(node.path);
                            for (const c of node.children) collect(c);
                          }
                          for (const c of tree.children) collect(c);
                          selectionStore.replace(all);
                        }
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      {selectedFileCount === tree.fileCount ? 'Bỏ chọn' : 'Chọn tất cả'}
                    </button>
                    <button
                      onClick={() => setTreeExpandAll((v) => v === false ? true : false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {treeExpandAll === false ? 'Mở rộng' : 'Thu gọn'}
                    </button>
                  </div>
                </div>

                <SelectionContext.Provider value={selectionStore}>
                  <VisibilityContext.Provider value={visiblePaths}>
                  <SlotColorMapContext.Provider value={slotColorMap}>
                  <HighlightedLabelContext.Provider value={highlightedLabel}>
                  <TreeExpandAllContext.Provider value={treeExpandCtx}>
                  <div className="max-h-80 overflow-y-auto p-1 text-xs">
                    {tree.children.map((node) => (
                      <TreeNodeView
                        key={node.path}
                        node={node}
                        depth={0}
                        onToggle={(paths, checked) => selectionStore.toggle(paths, checked)}
                      />
                    ))}
                  </div>
                  </TreeExpandAllContext.Provider>
                  </HighlightedLabelContext.Provider>
                  </SlotColorMapContext.Provider>
                  </VisibilityContext.Provider>
                </SelectionContext.Provider>
              </div>
            )}

            <div className="flex items-center justify-between border border-border bg-card px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                {selectedFileCount} file sẽ được pack
                {outputEstimate && selectedFileCount > 0 && (
                  <span className="ml-2 text-[10px] text-muted-foreground/80">
                    · ~{formatKb(outputEstimate.totalBytes)} · dự kiến {outputEstimate.estimatedParts} part
                  </span>
                )}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={handlePack}
                  disabled={isPacking || selectedFileCount === 0}
                  className="gap-1.5"
                >
                  {isPacking ? (
                    <PackerLoadingSpinner size="sm" />
                  ) : (
                    <Package className="h-3 w-3" />
                  )}
                  {isPacking ? 'Đang pack...' : 'Pack'}
                </Button>
              </div>
            </div>
          </div>

          {/* ===== Cột phải: Output & Feedback ===== */}
          <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <ScriptGenerator compact />
            <TerminalLog logs={logs} />

            {/* Progress bar khi đang pack */}
            {isPacking && progress && (
              <div ref={progressRef} className="border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">
                    {progress.total > 0 ? `${progress.current}/${progress.total} file` : 'Đang chuẩn bị...'}
                  </span>
                  <span className="text-primary font-mono">
                    {progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : ''}
                  </span>
                </div>
                <div className="h-2 w-full bg-background overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: progress.total > 0 ? `${displayProgress}%` : '5%',
                    }}
                  />
                </div>
                {progress.path && (
                  <p className="truncate text-[10px] text-muted-foreground font-mono">
                    → {progress.path}
                  </p>
                )}
              </div>
            )}

            {parts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border border-border bg-card px-3 py-2 text-xs">
                  <span>
                    Output: <span className="font-semibold">{parts.length}</span> part &middot;{' '}
                    Tổng <span className="font-semibold">
                      {parts.reduce((s, p) => s + p.charCount, 0).toLocaleString('vi-VN')}
                    </span> ký tự
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveToSource(parts, selectedFileCount)}
                      disabled={saveState.isSaving}
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      {saveState.isSaving ? (
                        <PackerLoadingSpinner size="sm" />
                      ) : (
                        <Package className="h-3 w-3" />
                      )}
                      {saveState.isSaving
                        ? `Đang lưu ${saveState.saved}/${saveState.total}...`
                        : saveState.failedIndices.length > 0
                          ? `Lưu tiếp ${saveState.failedIndices.length} part còn thiếu`
                          : saveState.saved === parts.length && saveState.saved > 0
                            ? `Đã lưu ${saveState.saved}/${parts.length}`
                            : 'Lưu vào Source'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleDownloadAllAsZip(parts)}
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      <Archive className="h-3 w-3" />
                      Tải ZIP ({parts.length} parts)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadAllAsTxt(parts)}
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      <Download className="h-3 w-3" />
                      Tải .txt riêng
                    </Button>
                  </div>
                </div>

                {/* Save-to-Source progress bar — hiện khi đang lưu hoặc save dở */}
                {(saveState.isSaving || saveState.saved > 0 || saveState.failedIndices.length > 0) && (
                  <div className="border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        {saveState.isSaving
                          ? `Đang lưu vào Source: ${saveState.saved}/${saveState.total} part`
                          : saveState.failedIndices.length === 0
                            ? `Đã lưu xong ${saveState.saved}/${saveState.total} part`
                            : `Đã lưu ${saveState.saved}/${saveState.total} — thiếu part ${saveState.failedIndices.map((i) => i + 1).join(', ')}`}
                      </span>
                      <span className="font-mono text-primary">
                        {saveState.total > 0
                          ? `${Math.round((saveState.saved / saveState.total) * 100)}%`
                          : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden bg-background">
                      <div
                        className={cn(
                          'h-full transition-all',
                          saveState.failedIndices.length > 0 && !saveState.isSaving
                            ? 'bg-warning'
                            : 'bg-primary',
                        )}
                        style={{
                          width:
                            saveState.total > 0
                              ? `${(saveState.saved / saveState.total) * 100}%`
                              : '0%',
                        }}
                      />
                    </div>
                  </div>
                )}

                {parts.map((p) => (
                  <PartOutput key={p.index} part={p} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FolderSlotRow — 1 row trong folder queue (label editable + delete)
// ============================================================
function FolderSlotRow({
  slot,
  onRename,
  onRemove,
  onHighlight,
}: {
  slot: FolderSlot;
  onRename: (label: string) => void;
  onRemove: () => void;
  onHighlight: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== slot.label) {
      onRename(trimmed);
    } else {
      setDraft(slot.label);
    }
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', SLOT_COLORS[slot.colorIndex].dot)} />
      <FolderOpen className={cn('h-3.5 w-3.5 shrink-0', SLOT_COLORS[slot.colorIndex].text)} />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(slot.label); setEditing(false); }
          }}
          className="h-6 flex-1 border border-input bg-background px-1.5 text-xs focus:border-primary focus:outline-none"
        />
      ) : (
        <span
          className="flex-1 truncate text-xs font-medium text-foreground cursor-pointer hover:text-primary"
          onClick={onHighlight}
          onDoubleClick={() => setEditing(true)}
          title="Click: hiện trong cây | Double-click: đổi tên"
        >
          {slot.label}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground">{slot.fileCount} file</span>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground"
          title="Đổi tên"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        title="Xoá folder"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ============================================================
// TreeNodeView - render 1 node, lazy children (collapsed mặc định nếu > 50 children)
// ============================================================
function TreeNodeView({
  node,
  depth,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (paths: string[], checked: boolean) => void;
}) {
  const visiblePaths = useContext(VisibilityContext);
  // Filter: nếu search đang active và path không match → ẩn
  if (visiblePaths && !visiblePaths.has(node.path)) return null;

  // Folder lớn (>30 children) collapsed mặc định, nhưng khi search active thì auto-expand
  const [collapsed, setCollapsed] = useState(node.children.length > 30);
  const { value: expandAll, reset: resetExpandAll } = useContext(TreeExpandAllContext);
  // Priority: search active > global expand/collapse > local state
  const effectiveCollapsed = visiblePaths ? false : expandAll !== null ? !expandAll : collapsed;

  if (!node.isFolder) {
    return <FileRow node={node} depth={depth} onToggle={onToggle} />;
  }

  return (
    <FolderRow
      node={node}
      depth={depth}
      collapsed={effectiveCollapsed}
      onToggleCollapse={() => {
        setCollapsed((v) => !v);
        resetExpandAll();
      }}
      onToggle={onToggle}
    />
  );
}

/** File row — subscribe path mình → chỉ re-render khi tick state đổi */
function FileRow({
  node,
  depth,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (paths: string[], checked: boolean) => void;
}) {
  const checked = useIsSelected(node.path);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-1.5 py-1 transition-colors hover:bg-popover',
        !checked && 'opacity-50',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onToggle([node.path], !!c)}
        className="h-4 w-4 cursor-pointer"
      />
      <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-foreground">{node.name}</span>
    </label>
  );
}

/** Folder row — subscribe all để re-count khi descendants đổi */
function FolderRow({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggle: (paths: string[], checked: boolean) => void;
}) {
  const allDescendants = node.descendantPaths;
  const { checked: checkedCount, total } = useFolderCount(allDescendants);
  const isAllChecked = checkedCount === total;
  const isPartial = checkedCount > 0 && !isAllChecked;

  // Color accent for root-level folders (depth 0 = folder slot root)
  const slotColorMap = useContext(SlotColorMapContext);
  const slotColor = depth === 0 ? slotColorMap.get(node.name) : undefined;
  const borderClass = slotColor !== undefined ? SLOT_COLORS[slotColor].border : '';

  // Highlight flash khi user click slot trong queue
  const highlightedLabel = useContext(HighlightedLabelContext);
  const isHighlighted = depth === 0 && highlightedLabel === node.name;
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll into view khi highlighted
  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isHighlighted]);

  return (
    <div ref={rowRef}>
      <div
        onClick={onToggleCollapse}
        className={cn(
          'flex cursor-pointer items-center gap-1 py-1 transition-colors hover:bg-popover',
          depth === 0 && borderClass && `border-l-2 ${borderClass}`,
          isHighlighted && 'animate-pulse bg-primary/10',
        )}
        style={{ paddingLeft: `${depth * 16 + (depth === 0 ? 4 : 0)}px` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <Checkbox
          checked={isAllChecked}
          ref={(el) => {
            if (el) {
              const input = el as HTMLButtonElement & { indeterminate?: boolean };
              input.indeterminate = isPartial;
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(c) => onToggle(allDescendants, !!c)}
          className="h-4 w-4 cursor-pointer"
        />
        <label
          onClick={(e) => {
            e.stopPropagation();
            onToggle(allDescendants, !isAllChecked);
          }}
          className="flex cursor-pointer items-center gap-1"
        >
          <FolderOpen className="h-3 w-3 text-primary" />
          <span className="font-medium text-foreground">{node.name}/</span>
          <span className="text-muted-foreground">({node.fileCount})</span>
        </label>
      </div>

      {!collapsed && (
        <div>
          {node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
