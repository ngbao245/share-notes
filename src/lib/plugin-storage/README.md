# plugin-storage — Facade cho localStorage

Lớp trung gian duy nhất cho localStorage trong app. Tool KHÔNG đụng `localStorage` trực tiếp — dùng `createToolStorage()` factory hoặc `createFacadeStorage()` cho zustand.

## Tại sao có facade?

Trước facade:
- 12 tool tự viết `localStorage.setItem/getItem` — naming loạn, không convention
- Không có prefix user → data leak khi switch account (5 tool bị)
- Bug fix bằng `clearUserScopedStorage()` nuke-with-preserve — phải maintain whitelist thủ công, tool mới dễ vi phạm

Facade giải quyết:
- 1 API duy nhất, prefix key tự động theo scope + userId
- Data user-scope tự isolated cross-account → không leak
- Lint rule cấm `localStorage` trực tiếp → tool mới KHÔNG THỂ vi phạm (Phase 5)

## API

### `createToolStorage<T>(config)` — factory function

Không phải React hook, có thể gọi trong bất kỳ scope (route, api, utility, store action).

```ts
import { createToolStorage } from '@/lib/plugin-storage';

const storage = createToolStorage<Queue>({
  toolId: 'audio',
  key: 'queue',
  scope: 'user', // hoặc 'global'
});

storage.set(queue);
const restored = storage.get(); // Queue | null
storage.remove();
console.log(storage.key); // 'v1:user:{uid}:tool:audio:queue'
```

### `createFacadeStorage(config)` — zustand adapter

```ts
import { persist, createJSONStorage } from 'zustand/middleware';
import { createFacadeStorage } from '@/lib/plugin-storage/zustand-adapter';

export const useMyStore = create<State>()(
  persist(
    (set) => ({ /* state + actions */ }),
    {
      name: 'store', // ignored bởi facade
      storage: createJSONStorage(() => createFacadeStorage({
        toolId: 'agency-studio',
        scope: 'user',
      })),
    }
  )
);
```

## Convention

### Key format

```
scope='user'   → v1:user:{userId}:tool:{toolId}:{key}
scope='global' → v1:global:tool:{toolId}:{key}
```

- `KEY_VERSION = 'v1'` — bump khi có breaking change format
- `userId` khi chưa login = literal `'anonymous'`
- `toolId` = id tool trong `tools.ts` registry (VD `'audio'`, `'library'`, `'json-studio'`)
- `key` = tên logical (kebab-case): `'queue'`, `'active-session'`, `'pdf-reader-zoom'`

### Khi nào scope='user' vs 'global'?

Rule đơn giản: **data đó có phụ thuộc user không?**

`scope='user'` — data per user, không share cross-account:
- Queue nhạc user chọn (Audio)
- Active session RAG
- Favorites pin trong hub
- Draft campaign chưa gửi (Agency)
- Books snapshot cache theo user

`scope='global'` — preference share cross-user trên máy này:
- Theme (light/dark)
- PDF reader zoom, selection color
- Translate target language
- JSON studio graph theme, zoom-on-scroll

**Rule kiểm**: nếu logout user A → login user B, data có nên vẫn thấy không?
- Có → global
- Không → user

## Schema validation (optional)

```ts
import { z } from 'zod';

const QueueSchema = z.object({ items: z.array(z.string()) });

const storage = createToolStorage({
  toolId: 'audio',
  key: 'queue',
  scope: 'user',
  schema: (raw) => QueueSchema.parse(raw), // throw = corrupt = self-heal
});

const queue = storage.get(); // typed từ schema return, self-heal nếu invalid
```

## Error handling

- **Quota exceeded**: `set()` warn silent, không throw. Tool tiếp tục work, mất persistence.
- **Corrupt JSON hoặc schema fail**: `get()` self-heal (remove key + return null).
- **Storage disabled** (VD private browsing): tất cả method silent, return null cho get.

Tool nào cần feedback user "hết dung lượng" tự implement UI, không phải facade concern.

## Migration legacy keys

18 legacy keys map trong `migrate-legacy.ts` `LEGACY_MAPPING`. Chia 2 flow:

1. `migrateLegacyStorage()` — chạy 1 lần lúc app boot (`main.tsx`), migrate global-scope entries. Guard flag `bibo:migrated:storage-facade-v1:global`.

2. `migrateLegacyStorageForUser(userId)` — chạy sau khi có session (AuthGuard), migrate user-scope entries với real userId. Guard flag `bibo:migrated:storage-facade-v1:user:{uid}`.

Tách 2 flow để tránh case migrate với `userId='anonymous'` lúc boot → data user-scope mất khi user thật login.

## Thêm tool migrate mới

1. Xác định scope (user vs global) theo rule trên
2. Thêm 1 entry vào `LEGACY_MAPPING` trong `migrate-legacy.ts`
3. Refactor tool code: `localStorage.setItem(OLD_KEY, ...)` → `createToolStorage({toolId, key, scope}).set(...)`
4. Test manual: user cũ có data legacy → sau update thấy data giữ nguyên, key mới xuất hiện trong DevTools

## FAQ

**Q: Tại sao đổi tên từ `useToolStorage` sang `createToolStorage`?**
A: Tên bắt đầu bằng `use` bị ESLint `react-hooks/rules-of-hooks` nhận nhầm là React hook và cấm gọi ở top-level. `createToolStorage` phản ánh đúng bản chất factory function, gọi ở đâu cũng được.

**Q: Có support sessionStorage không?**
A: Chưa. Spec riêng sau nếu cần. Hiện tại tool cần ephemeral → dùng React state hoặc mở spec mới.

**Q: Có support async storage (IndexedDB) không?**
A: Không. IndexedDB tools (Library blobs, PDF drafts, favicon) giữ native. Facade sync để match localStorage native.

**Q: Zustand adapter có handle rehydration state không?**
A: Zustand persist middleware handle. Adapter chỉ cung cấp `StateStorage` (get/set/remove) — zustand tự orchestrate.

**Q: Nếu 2 tab đồng thời write?**
A: localStorage native cùng sync. Race condition không worse hơn native localStorage. Multi-tab consistency ngoài scope facade.
