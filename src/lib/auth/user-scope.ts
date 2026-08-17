// ============================================================
// user-scope — Registry + cleanup cho user-scoped storage
// ============================================================
//
// Khi logout / user switch (A → B), gọi `clearUserScopedStorage()`
// để wipe cache của user cũ trong localStorage + IndexedDB.
// Chỉ giữ lại preferences không phụ thuộc user (theme, lang, prefs).
//
// Nuke KHÔNG chạy khi:
//   - F5 / refresh page
//   - Supabase auto-refresh token
//   - Mount app
// Chỉ chạy trong AuthGuard listener khi:
//   - onAuthStateChange('SIGNED_OUT')
//   - User switch (prevUserId !== nextUserId && prevUserId !== null)
//
// Rule thêm regex vào PRESERVE_LOCALSTORAGE_KEYS:
//   - Preserve = data KHÔNG phụ thuộc user
//     (theme, language, tool preferences, migration flags)
//   - KHÔNG preserve = data thuộc user cụ thể
//     (favorites, sessions, drafts, per-user cache)
//
// False positive (preserve nhầm key user-scoped) = LEAK sang user mới.
// False negative (không preserve pref) = user set lại 1 lần, UX minor.
// Nên nghiêng phía KHÔNG preserve khi chưa chắc — an toàn hơn.
// ============================================================

/**
 * localStorage key match 1 trong các regex này sẽ ĐƯỢC GIỮ khi logout.
 * Còn lại wipe hết.
 *
 * Sau `plugin-storage-facade`:
 *   - `v1:global:*` — facade global-scope (theme, reader prefs, translate, OCR pref...)
 *   - `v1:user:*` KHÔNG preserve → tự wipe khi logout, không cần enumerate từng key.
 *
 * Legacy regex (theme/translate/pdf_reader_*) giữ tạm cho user chưa boot lại
 * sau update — migration script sẽ dọn trong lần boot kế tiếp. Xoá sau 1-2 sprint.
 */
export const PRESERVE_LOCALSTORAGE_KEYS: RegExp[] = [
  // Facade convention
  /^v1:global:/,               // facade global-scope preferences
  // Auth + migration flags
  /^sb-.+-auth-token$/,        // Supabase session — signOut đã tự clear
  /^bibo:migrated:/,           // facade migration flags
  /^bibo:.*:migrated-/,        // migration flags tool riêng
  // Legacy (giữ tạm phòng user chưa migrate) — remove sau khi verify migration ổn định
  /^theme/,                    // legacy theme id + variants (nay lưu Supabase)
  /^translate_/,               // legacy translate prefs
  /^bibo:json-studio:/,        // legacy json-studio prefs
];

/**
 * IndexedDB database name TRONG list này sẽ được GIỮ khi logout.
 * Còn lại drop.
 *
 * `library-blobs`: PDF/EPUB blob cache — tenant chung sách, blob nặng,
 * preserve tránh re-download. Nếu tenant tách library per-user thì
 * đưa ra khỏi preserve list.
 * `favicon-cache`: favicon là public web resource, không sensitive.
 */
export const PRESERVE_IDB_DATABASES: string[] = [
  'library-blobs',
  'favicon-cache',
];

/**
 * Fallback list IDB DB names khi `indexedDB.databases()` không support
 * (VD Firefox < v126). Cập nhật khi tool mới thêm DB.
 */
const KNOWN_IDB_DATABASES: string[] = [
  'library-blobs',
  'favicon-cache',
  'pdf-studio',
  'pdf-studio-drafts',
  'rag-intent',
];

/**
 * Clear tất cả user-scoped storage.
 * localStorage sync, IDB async (fire-and-forget cho IDB không block navigate).
 *
 * Silent error: từng removeItem/deleteDatabase có thể fail (quota, blocked
 * connection...) — không throw, không block phần còn lại.
 */
export async function clearUserScopedStorage(): Promise<void> {
  clearLocalStorage();
  await clearIndexedDB();
}

function clearLocalStorage(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const preserve = PRESERVE_LOCALSTORAGE_KEYS.some((r) => r.test(key));
    if (!preserve) keysToRemove.push(key);
  }
  for (const k of keysToRemove) {
    try {
      localStorage.removeItem(k);
    } catch {
      // quota / SecurityError / private mode — skip
    }
  }
}

async function clearIndexedDB(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  let dbNames: string[];

  // Feature detect: indexedDB.databases() Firefox chỉ support từ v126.
  if (typeof indexedDB.databases === 'function') {
    try {
      const list = await indexedDB.databases();
      dbNames = list.map((d) => d.name).filter((n): n is string => Boolean(n));
    } catch {
      dbNames = KNOWN_IDB_DATABASES;
    }
  } else {
    dbNames = KNOWN_IDB_DATABASES;
  }

  await Promise.all(
    dbNames
      .filter((name) => !PRESERVE_IDB_DATABASES.includes(name))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();   // silent, không block
            req.onblocked = () => resolve(); // silent — có tab khác đang open
          }),
      ),
  );
}
