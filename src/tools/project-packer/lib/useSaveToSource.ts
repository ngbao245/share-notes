import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';
import type { PackPart, LogEntry } from './types';

// ============================================================
// useSaveToSource — hook quản lý lưu packed parts vào MockAPI Source
//
// Idempotency:
//  - packId + partIndex là identity duy nhất, tag lưu trong `tags` field.
//  - Trước khi retry (attempt >= 1), verify với server: GET /notes → filter
//    theo pack-id → parse part index từ tag "part:N/M" → mark những part
//    đã có trên server là saved.
//
// Resume:
//  - Khi user click lần 2 mà saveState còn failedIndices → reuse packId cũ,
//    chỉ POST index chưa done. Không tạo pack mới.
//  - Khi hoàn thành 100% → set failedIndices=[] để lần click sau là save mới.
//
// Timeout: 45s (MockAPI free tier P99 latency ~20-30s).
// ============================================================

export interface SaveState {
  isSaving: boolean;
  packId: string | null;
  savedIndices: number[];
  failedIndices: number[];
  saved: number;
  total: number;
}

const INITIAL_SAVE_STATE: SaveState = {
  isSaving: false,
  packId: null,
  savedIndices: [],
  failedIndices: [],
  saved: 0,
  total: 0,
};

const TIMEOUT_MS = 45_000;
const MAX_RETRIES = 2;

interface UseSaveToSourceOptions {
  /** Callback to append log entry */
  log: (message: string, type: LogEntry['type']) => void;
}

export function useSaveToSource({ log }: UseSaveToSourceOptions) {
  const [saveState, setSaveState] = useState<SaveState>(INITIAL_SAVE_STATE);
  const savedSetRef = useRef<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const resetSaveState = useCallback(() => {
    savedSetRef.current = new Set();
    setSaveState(INITIAL_SAVE_STATE);
  }, []);

  const saveToSource = useCallback(async (parts: PackPart[], selectedFileCount: number) => {
    if (parts.length === 0 || saveState.isSaving) return;

    const { fetchJson } = await import('@/api/client');
    const { API } = await import('@/lib/config');
    const now = new Date().toISOString();

    // Resume: nếu có packId + savedIndices từ lần trước cho cùng bộ parts
    const isResume =
      saveState.packId !== null &&
      saveState.total === parts.length &&
      saveState.failedIndices.length > 0;

    const packId = isResume
      ? saveState.packId!
      : `pack_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const baseTitle = `Project Packed - ${new Date().toLocaleString('vi-VN')}`;

    const savedSet = new Set<number>(isResume ? saveState.savedIndices : []);
    savedSetRef.current = savedSet;
    let pendingIndices: number[] = isResume
      ? [...saveState.failedIndices]
      : parts.map((_, i) => i);

    setSaveState({
      isSaving: true,
      packId,
      savedIndices: [...savedSet],
      failedIndices: [],
      saved: savedSet.size,
      total: parts.length,
    });

    if (isResume) {
      log(`Resume lưu Source: còn ${pendingIndices.length}/${parts.length} part`, 'info');
    } else {
      log(`Bắt đầu lưu ${parts.length} part vào Source...`, 'info');
    }

    // Helper: verify với server những index nào thực sự đã lưu (dedupe).
    async function verifyServer(): Promise<void> {
      try {
        const raw = await fetchJson<unknown[]>(API.NOTES);
        const foundIndices = new Set<number>();
        for (const item of Array.isArray(raw) ? raw : []) {
          const tags =
            item && typeof item === 'object' && 'tags' in item
              ? (item as { tags?: unknown }).tags
              : null;
          if (typeof tags !== 'string') continue;
          if (!tags.includes(`pack-id:${packId}`)) continue;
          const m = tags.match(/part:(\d+)\//);
          if (m) foundIndices.add(parseInt(m[1], 10) - 1);
        }
        let newlyFound = 0;
        for (const idx of foundIndices) {
          if (!savedSet.has(idx)) {
            savedSet.add(idx);
            newlyFound++;
          }
        }
        if (newlyFound > 0) {
          log(`Verify server: ${newlyFound} part thực ra đã lưu (skip dupe)`, 'info');
        }
        pendingIndices = pendingIndices.filter((i) => !savedSet.has(i));
        setSaveState((s) => ({
          ...s,
          savedIndices: [...savedSet],
          saved: savedSet.size,
        }));
      } catch (e) {
        log(`Verify server fail: ${String(e)} — vẫn retry bình thường`, 'warning');
      }
    }

    // Nếu resume: verify trước
    if (isResume) {
      await verifyServer();
    }

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (pendingIndices.length === 0) break;

        if (attempt > 0) {
          log(`Retry lần ${attempt}: ${pendingIndices.length} part chưa lưu được...`, 'warning');
          await verifyServer();
          if (pendingIndices.length === 0) break;
          await new Promise((r) => setTimeout(r, 2000));
        }

        const stillFailed: number[] = [];

        for (const i of pendingIndices) {
          const part = parts[i];
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

            await fetchJson(API.NOTES, {
              method: 'POST',
              signal: controller.signal,
              body: JSON.stringify({
                type: 'source',
                title: parts.length === 1 ? baseTitle : `${baseTitle} (${i + 1}/${parts.length})`,
                content: part.content,
                tags: `packed, pack-id:${packId}, part:${i + 1}/${parts.length}, ${selectedFileCount} files`,
                source: 'project-packer',
                createdAt: now,
                updatedAt: now,
              }),
            });
            clearTimeout(timeout);
            savedSet.add(i);
            log(`✓ Đã lưu part ${i + 1}/${parts.length}`, 'success');
            setSaveState((s) => ({
              ...s,
              savedIndices: [...savedSet],
              saved: savedSet.size,
            }));
          } catch (e) {
            stillFailed.push(i);
            if (attempt === MAX_RETRIES) {
              log(`✗ Part ${i + 1} fail sau ${MAX_RETRIES + 1} lần: ${String(e)}`, 'error');
            }
          }

          // Delay 300ms giữa mỗi request (MockAPI rate limit ~100 req/min)
          await new Promise((r) => setTimeout(r, 300));
        }

        pendingIndices = stillFailed;
      }

      // Verify lần cuối trước khi báo fail
      if (pendingIndices.length > 0) {
        await verifyServer();
      }

      const successCount = savedSet.size;
      const finalFailed = pendingIndices;

      setSaveState({
        isSaving: false,
        packId,
        savedIndices: [...savedSet],
        failedIndices: finalFailed,
        saved: successCount,
        total: parts.length,
      });

      if (successCount === parts.length) {
        log(`✓ Hoàn tất! Đã lưu ${parts.length} part vào Source`, 'success');
        toast.success(`Đã lưu ${parts.length} part vào Source. Vào trang Sources để download.`);
        // Invalidate sources query để tab Sources tự refresh
        queryClient.invalidateQueries({ queryKey: ['sources'] });
      } else if (successCount > 0) {
        const missingParts = finalFailed.map((i) => i + 1).join(',');
        log(`⚠ Lưu ${successCount}/${parts.length} part. Thiếu part: ${missingParts}`, 'warning');
        toast.warning(
          `Lưu ${successCount}/${parts.length} part. Click "Lưu tiếp ${finalFailed.length} part còn thiếu" để retry.`,
        );
        queryClient.invalidateQueries({ queryKey: ['sources'] });
      } else {
        log(`✗ Không lưu được part nào`, 'error');
        toast.error('Không lưu được vào Source. Kiểm tra kết nối mạng.');
      }
    } catch (e) {
      setSaveState((s) => ({
        ...s,
        isSaving: false,
        savedIndices: [...savedSet],
        failedIndices: pendingIndices,
        saved: savedSet.size,
      }));
      toast.error('Không lưu được vào Source');
      log(`Lỗi save to source: ${String(e)}`, 'error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState.isSaving, saveState.packId, saveState.total, saveState.failedIndices, saveState.savedIndices, log]);

  return { saveState, saveToSource, resetSaveState };
}
