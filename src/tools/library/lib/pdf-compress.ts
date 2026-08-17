// ============================================================
// pdf-compress client SDK — gọi iLovePDF Developer API
// ============================================================
//
// 5-step flow cho mỗi operation:
//   1. POST /v1/auth (public_key) → JWT
//   2. GET /v1/start/{tool} → server + task
//   3. POST {server}/v1/upload → server_filename
//   4. POST {server}/v1/process → complete
//   5. GET {server}/v1/download/{task} → PDF blob
//
// Key pool strategy (fail-over + remember exhausted):
//   - Persist exhausted key set trong localStorage với month stamp.
//   - Qua tháng mới → auto-clear (iLovePDF reset credit 2,500/tháng).
//   - Try key theo thứ tự trong config → nếu 429 quota_exceeded, mark
//     exhausted + try key tiếp. Nếu 401/403, mark invalid trong session
//     (không persist vì có thể user gõ nhầm rồi fix).
//
// Docs: https://developer.ilovepdf.com/docs
// ============================================================

import type {
  CompressConfigValue,
  CompressionLevel,
  IlovepdfKeyEntry,
} from '@/api/settingsApi';
import { createToolStorage } from '@/lib/plugin-storage';

export type CompressConfig = CompressConfigValue;

export type { CompressionLevel, IlovepdfKeyEntry };

export interface CompressResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  /** 0..1 ratio compressed/original */
  ratio: number;
  /** Public key đã dùng thành công (cho log/debug). */
  usedKey: string;
}

export type CompressErrorCode =
  | 'auth_failed'
  | 'quota_exceeded'
  | 'upload_failed'
  | 'process_failed'
  | 'download_failed'
  | 'file_too_large'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'no_keys';

export class CompressError extends Error {
  code: CompressErrorCode;
  status?: number;

  constructor(code: CompressErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'CompressError';
    this.code = code;
    this.status = status;
  }
}

export interface CompressOptions {
  /** Override compression_level từ config */
  level?: CompressionLevel;
  /** Milliseconds timeout PER key attempt. Default 120000. */
  timeoutMs?: number;
  /** External abort control */
  signal?: AbortSignal;
  onStageChange?: (
    stage: 'auth' | 'start' | 'upload' | 'process' | 'download',
  ) => void;
  /** Report khi phải fail-over sang key tiếp theo. */
  onKeyFallover?: (fromKey: string, toKey: string, reason: string) => void;
}

const BASE_URL = 'https://api.ilovepdf.com';
const DEFAULT_TIMEOUT_MS = 120_000;
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

interface ExhaustedState {
  /** YYYY-MM format */
  month: string;
  /** Public keys hết credit trong tháng này */
  keys: string[];
}

// User-scope: quota tracking per user (mỗi user có credit riêng qua key họ cấp).
const exhaustedStorage = createToolStorage<ExhaustedState>({
  toolId: 'library',
  key: 'pdf-compress-exhausted',
  scope: 'user',
});

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readExhausted(): Set<string> {
  const state = exhaustedStorage.get();
  if (!state) return new Set();
  if (state.month !== currentMonth()) {
    // Qua tháng mới → clear exhausted list (credit reset)
    exhaustedStorage.remove();
    return new Set();
  }
  return new Set(state.keys);
}

function markExhausted(publicKey: string): void {
  const set = readExhausted();
  set.add(publicKey);
  exhaustedStorage.set({
    month: currentMonth(),
    keys: Array.from(set),
  });
}

/** Clear exhausted state (dùng cho debug hoặc user reset manual). */
export function clearExhaustedKeys(): void {
  exhaustedStorage.remove();
}

/** Snapshot state cho UI hiển thị (Setting tab). */
export function getKeyPoolStatus(config: CompressConfig): Array<{
  slot: number;
  publicKey: string;
  status: 'active' | 'exhausted';
}> {
  const exhausted = readExhausted();
  return config.keys.map((k, i) => ({
    slot: i + 1,
    publicKey: k.public_key,
    status: exhausted.has(k.public_key) ? 'exhausted' : 'active',
  }));
}

// ============================================================
// iLovePDF flow types
// ============================================================

interface AuthResponse {
  token: string;
}

interface StartResponse {
  server: string;
  task: string;
}

interface UploadResponse {
  server_filename: string;
}

interface ProcessResponse {
  download_filename?: string;
  filesize?: number;
  output_filesize?: number;
  status?: string;
}

async function validatePdfMagic(blob: Blob): Promise<void> {
  const head = await blob.slice(0, 5).arrayBuffer();
  const bytes = new Uint8Array(head);
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) {
      throw new CompressError(
        'invalid_response',
        'Server response không phải PDF hợp lệ',
      );
    }
  }
}

function mapStatusToCode(
  status: number,
  fallback: CompressErrorCode,
): CompressErrorCode {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'quota_exceeded';
  if (status === 413) return 'file_too_large';
  return fallback;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data === 'object' && data) {
      if ('message' in data) return String((data as { message: unknown }).message);
      if ('error' in data) return String((data as { error: unknown }).error);
      if ('name' in data) return String((data as { name: unknown }).name);
    }
  } catch {
    // response không phải JSON
  }
  return `HTTP ${res.status}`;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  errorFallback: CompressErrorCode,
): Promise<Response> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt === 0) {
        // Retry once for 5xx
        continue;
      }
      if (!res.ok) {
        const message = await readErrorMessage(res);
        throw new CompressError(
          mapStatusToCode(res.status, errorFallback),
          message,
          res.status,
        );
      }
      return res;
    } catch (err) {
      if (err instanceof CompressError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CompressError('timeout', 'Compress request aborted');
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === 1) {
        throw new CompressError(
          'network',
          lastErr.message || 'Network error',
        );
      }
    }
  }
  throw new CompressError(
    'network',
    lastErr?.message || 'Network error after retry',
  );
}

// ============================================================
// 5-step flow — per key attempt
// ============================================================

async function stepAuth(
  publicKey: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetchWithRetry(
    `${BASE_URL}/v1/auth`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: publicKey }),
      signal,
    },
    'auth_failed',
  );
  const data = (await res.json()) as AuthResponse;
  if (!data.token) {
    throw new CompressError('auth_failed', 'Missing token in auth response');
  }
  return data.token;
}

async function stepStart(
  jwt: string,
  signal: AbortSignal,
): Promise<StartResponse> {
  const res = await fetchWithRetry(
    `${BASE_URL}/v1/start/compress`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
      signal,
    },
    'process_failed',
  );
  const data = (await res.json()) as StartResponse;
  if (!data.server || !data.task) {
    throw new CompressError(
      'invalid_response',
      'Missing server or task in start response',
    );
  }
  return data;
}

async function stepUpload(
  jwt: string,
  server: string,
  task: string,
  file: File,
  signal: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append('task', task);
  form.append('file', file, file.name);

  const res = await fetchWithRetry(
    `https://${server}/v1/upload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
      signal,
    },
    'upload_failed',
  );
  const data = (await res.json()) as UploadResponse;
  if (!data.server_filename) {
    throw new CompressError(
      'invalid_response',
      'Missing server_filename in upload response',
    );
  }
  return data.server_filename;
}

async function stepProcess(
  jwt: string,
  server: string,
  task: string,
  serverFilename: string,
  originalName: string,
  level: CompressionLevel,
  signal: AbortSignal,
): Promise<ProcessResponse> {
  const res = await fetchWithRetry(
    `https://${server}/v1/process`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task,
        tool: 'compress',
        files: [{ server_filename: serverFilename, filename: originalName }],
        compression_level: level,
      }),
      signal,
    },
    'process_failed',
  );
  return (await res.json()) as ProcessResponse;
}

async function stepDownload(
  jwt: string,
  server: string,
  task: string,
  signal: AbortSignal,
): Promise<Blob> {
  const res = await fetchWithRetry(
    `https://${server}/v1/download/${task}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
      signal,
    },
    'download_failed',
  );
  const blob = await res.blob();
  await validatePdfMagic(blob);
  return blob;
}

async function attemptCompressWithKey(
  file: File,
  publicKey: string,
  level: CompressionLevel,
  options: CompressOptions,
): Promise<CompressResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort);

  try {
    options.onStageChange?.('auth');
    const jwt = await stepAuth(publicKey, controller.signal);

    options.onStageChange?.('start');
    const { server, task } = await stepStart(jwt, controller.signal);

    options.onStageChange?.('upload');
    const serverFilename = await stepUpload(
      jwt,
      server,
      task,
      file,
      controller.signal,
    );

    options.onStageChange?.('process');
    await stepProcess(
      jwt,
      server,
      task,
      serverFilename,
      file.name,
      level,
      controller.signal,
    );

    options.onStageChange?.('download');
    const blob = await stepDownload(jwt, server, task, controller.signal);

    return {
      blob,
      originalSize: file.size,
      compressedSize: blob.size,
      ratio: file.size > 0 ? blob.size / file.size : 1,
      usedKey: publicKey,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Compress PDF qua iLovePDF với fail-over pool.
 * Try từng key trong config.keys — nếu 429 quota_exceeded → mark exhausted +
 * try key tiếp. Nếu 401/403 → mark invalid session-only + try key tiếp.
 * Tất cả key fail → throw error cuối cùng.
 */
export async function compressPdf(
  file: File,
  config: CompressConfig,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const level = options.level ?? config.compression_level ?? 'recommended';
  const exhausted = readExhausted();

  // Order: active keys trước (chưa exhausted), rồi mới thử lại exhausted
  // (defense in-depth: có thể user manual reset credit mid-month).
  const activeKeys: IlovepdfKeyEntry[] = [];
  const exhaustedKeys: IlovepdfKeyEntry[] = [];
  for (const k of config.keys) {
    if (!k.public_key) continue;
    if (exhausted.has(k.public_key)) exhaustedKeys.push(k);
    else activeKeys.push(k);
  }

  const orderedKeys = [...activeKeys, ...exhaustedKeys];
  if (orderedKeys.length === 0) {
    throw new CompressError('no_keys', 'Chưa có iLovePDF public key nào');
  }

  const sessionInvalid = new Set<string>();
  let lastError: CompressError | null = null;

  for (let i = 0; i < orderedKeys.length; i++) {
    const entry = orderedKeys[i];
    if (sessionInvalid.has(entry.public_key)) continue;

    try {
      const result = await attemptCompressWithKey(file, entry.public_key, level, options);
      // eslint-disable-next-line no-console
      console.info(
        `[ilovepdf] Compress OK với key#${config.keys.indexOf(entry) + 1} (${entry.public_key.slice(0, 20)}...)`,
      );
      return result;
    } catch (err) {
      if (!(err instanceof CompressError)) throw err;
      lastError = err;

      const nextEntry = orderedKeys[i + 1];
      const reason = `${err.code}: ${err.message}`;

      if (err.code === 'quota_exceeded') {
        markExhausted(entry.public_key);
         
        console.warn(
          `[ilovepdf] Key#${config.keys.indexOf(entry) + 1} exhausted (${entry.public_key.slice(0, 20)}...). Fail-over.`,
        );
      } else if (err.code === 'auth_failed') {
        sessionInvalid.add(entry.public_key);
         
        console.warn(
          `[ilovepdf] Key#${config.keys.indexOf(entry) + 1} invalid session (${err.message}). Fail-over.`,
        );
      } else {
        // Lỗi khác (network, timeout, process_failed) → throw luôn không fail-over
        throw err;
      }

      if (nextEntry) {
        options.onKeyFallover?.(entry.public_key, nextEntry.public_key, reason);
        continue;
      }
      // Không còn key nào → throw lỗi cuối
      break;
    }
  }

  throw lastError ?? new CompressError('no_keys', 'Tất cả iLovePDF key đều fail');
}

/**
 * Ping /v1/auth với 1 public key cụ thể để verify hợp lệ.
 * Setting UI dùng để test từng key riêng biệt.
 */
export async function testKey(publicKey: string): Promise<boolean> {
  if (!publicKey.trim()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${BASE_URL}/v1/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: publicKey }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    return typeof data.token === 'string' && data.token.length > 0;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/** Backward-compat: test connection cho 1 config (thử key đầu). */
export async function testConnection(config: CompressConfig): Promise<boolean> {
  const first = config.keys.find((k) => k.public_key.trim().length > 0);
  if (!first) return false;
  return testKey(first.public_key);
}
