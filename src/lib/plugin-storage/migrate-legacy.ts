// ============================================================
// plugin-storage/migrate-legacy — Migration script legacy keys → facade
// ============================================================
//
// Chạy 1 lần lúc app boot (main.tsx). Guard bằng flag
// `bibo:migrated:storage-facade-v1`. Idempotent: chạy 2 lần không
// nhân đôi data.
//
// Per-key try/catch silent — 1 key fail không block key khác + không
// block boot.
//
// Migration flow per key:
//   1. Đọc oldKey. Null → skip.
//   2. Build newKey từ facade convention.
//   3. Nếu newKey đã có value (VD user boot 2 tab đồng thời) → skip
//      overwrite, chỉ remove oldKey.
//   4. Ghi newKey ← oldValue.
//   5. Remove oldKey.
//
// LƯU Ý: entry `scope='user'` sẽ build key dùng userId hiện tại từ
// authStore. Migration chạy TRƯỚC khi Supabase restore session →
// userId = 'anonymous'. Điều này ĐÚNG vì data legacy không có prefix
// user, được set khi user đó đang login trên máy này → sau khi user
// đó login lại thì...
//
// Vấn đề: nếu migrate với 'anonymous' → key mới thành
// `v1:user:anonymous:tool:...` → user login xong sẽ đọc key
// `v1:user:{realUid}:...` (rỗng). Data mất!
//
// Giải pháp: `runLegacyMigrationForUser(userId)` được gọi TRONG
// AuthGuard sau khi có session, TRƯỚC KHI tool components render.
// `migrateLegacyStorage()` chỉ migrate global-scope entries lúc boot.
// User-scope entries chờ session restore rồi migrate với real userId.
// ============================================================

const MIGRATION_FLAG_GLOBAL = 'bibo:migrated:storage-facade-v1:global';
const MIGRATION_FLAG_USER_PREFIX = 'bibo:migrated:storage-facade-v1:user:';
const KEY_VERSION = 'v1';

interface LegacyEntry {
  oldKey: string;
  toolId: string;
  key: string;
  scope: 'user' | 'global';
  /**
   * `true` nếu legacy value là raw string (KHÔNG qua JSON.stringify).
   * Migration sẽ wrap `JSON.stringify(oldValue)` trước khi ghi key mới,
   * để facade `JSON.parse()` đọc lại đúng.
   *
   * VD: `rag:activeSessionId` cũ lưu `"abc-uid"` (không có quote).
   * Facade mới cần `"\"abc-uid\""` để parse ra string `"abc-uid"`.
   */
  rawString?: boolean;
}

/**
 * Full mapping 18 legacy keys → facade convention.
 *
 * Nguồn: `.kiro/specs/plugin-storage-facade/design.md` + prompt session này.
 * Khi thêm tool mới migrate, append entry vào đây.
 */
export const LEGACY_MAPPING: readonly LegacyEntry[] = [
  // Nhóm A — user-scope (5 tool leak per-user data)
  { oldKey: 'audio_player_queue', toolId: 'audio', key: 'queue', scope: 'user' },
  { oldKey: 'audio_player_state', toolId: 'audio', key: 'state', scope: 'user' },
  { oldKey: 'rag:activeSessionId', toolId: 'rag', key: 'active-session', scope: 'user', rawString: true },
  { oldKey: 'hub_favorites_local', toolId: 'hub', key: 'favorites', scope: 'user' },
  { oldKey: 'reader_books_snapshot', toolId: 'library', key: 'books-snapshot', scope: 'user' },

  // Nhóm A — user-scope (preference tracking per user)
  { oldKey: 'ilovepdf_exhausted_keys', toolId: 'library', key: 'pdf-compress-exhausted', scope: 'user' },
  { oldKey: 'packer.selectedPaths', toolId: 'project-packer', key: 'selected-paths', scope: 'user' },
  { oldKey: 'spx_tracking_history', toolId: 'spx', key: 'tracking-history', scope: 'user' },

  // Nhóm A — global-scope (7 tool preference)
  // Ghi chú: rawString=true khi legacy lưu bằng `String(value)` (number/bool/enum),
  // chưa qua JSON.stringify. Migration cần wrap lại để facade parse được.
  { oldKey: 'reader_pdf_zoom', toolId: 'library', key: 'pdf-reader-zoom', scope: 'global', rawString: true },
  { oldKey: 'reader_pdf_theme', toolId: 'library', key: 'pdf-reader-theme', scope: 'global', rawString: true },
  { oldKey: 'reader_selection_mask', toolId: 'library', key: 'pdf-reader-selection-mask', scope: 'global' },
  { oldKey: 'reader_disable_ios_callout', toolId: 'library', key: 'pdf-reader-ios-callout', scope: 'global', rawString: true },
  { oldKey: 'reader_show_page_nav', toolId: 'library', key: 'pdf-reader-page-nav', scope: 'global', rawString: true },
  { oldKey: 'reader_translate_target', toolId: 'library', key: 'translate-target', scope: 'global', rawString: true },
  { oldKey: 'reader_translate_remove_linebreak', toolId: 'library', key: 'translate-remove-linebreak', scope: 'global', rawString: true },
  { oldKey: 'pdf-studio-ocr-no-warn', toolId: 'pdf-studio', key: 'ocr-no-warn', scope: 'global', rawString: true },

  // Nhóm B — Zustand persist stores (dùng key = 'state', match zustand-adapter convention)
  { oldKey: 'agency-studio:store', toolId: 'agency-studio', key: 'state', scope: 'user' },
  { oldKey: 'bibo:json-studio:prefs', toolId: 'json-studio', key: 'state', scope: 'global' },
  // Ancient rename json-viewer → json-studio. Chỉ migrate nếu key mới chưa có
  // (LEGACY_MAPPING sort matters: entry đứng sau chỉ ghi nếu newKey null).
  { oldKey: 'bibo:json-viewer:prefs', toolId: 'json-studio', key: 'state', scope: 'global' },
];

function buildNewKey(entry: LegacyEntry, userId: string): string {
  if (entry.scope === 'user') {
    return `${KEY_VERSION}:user:${userId}:tool:${entry.toolId}:${entry.key}`;
  }
  return `${KEY_VERSION}:global:tool:${entry.toolId}:${entry.key}`;
}

function migrateEntry(entry: LegacyEntry, userId: string): void {
  try {
    const oldValue = localStorage.getItem(entry.oldKey);
    if (oldValue === null) return;

    const newKey = buildNewKey(entry, userId);
    if (localStorage.getItem(newKey) === null) {
      const newValue = entry.rawString ? JSON.stringify(oldValue) : oldValue;
      localStorage.setItem(newKey, newValue);
    }
    localStorage.removeItem(entry.oldKey);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin-storage] Migrate fail cho ${entry.oldKey}:`, e);
  }
}

/**
 * Migrate global-scope entries lúc app boot (trước khi restore session).
 * User-scope entries defer sang `migrateLegacyStorageForUser` sau khi có session.
 *
 * Idempotent: guard bằng flag. Silent per-key error.
 */
export function migrateLegacyStorage(): void {
  try {
    if (localStorage.getItem(MIGRATION_FLAG_GLOBAL)) return;

    for (const entry of LEGACY_MAPPING) {
      if (entry.scope !== 'global') continue;
      // userId không dùng cho global scope
      migrateEntry(entry, '');
    }

    localStorage.setItem(MIGRATION_FLAG_GLOBAL, new Date().toISOString());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[plugin-storage] Migration global fail:', e);
  }
}

/**
 * Migrate user-scope entries sau khi có session (real userId).
 *
 * Gọi từ AuthGuard sau `setSession()` thành công, TRƯỚC khi tool
 * components render. Guard flag per-user để không migrate lại khi
 * user re-login trên cùng máy.
 *
 * Note: legacy keys (không prefix user) đại diện data của "user cuối
 * cùng login trên máy này". Nếu user hiện tại KHÔNG phải user đó →
 * migration sẽ gán data nhầm chủ. Trade-off chấp nhận vì:
 *   1. Đa số user cá nhân dùng 1 account/máy → không gặp.
 *   2. Cross-account leak vốn là bug spec này fix → nếu có leak cũ,
 *      user đã bị leak trước rồi.
 *   3. Migration chạy 1 lần / user / máy → sau đó facade tự isolate.
 */
export function migrateLegacyStorageForUser(userId: string): void {
  if (!userId) return;
  const flag = `${MIGRATION_FLAG_USER_PREFIX}${userId}`;

  try {
    if (localStorage.getItem(flag)) return;

    for (const entry of LEGACY_MAPPING) {
      if (entry.scope !== 'user') continue;
      migrateEntry(entry, userId);
    }

    localStorage.setItem(flag, new Date().toISOString());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin-storage] Migration user ${userId} fail:`, e);
  }
}
