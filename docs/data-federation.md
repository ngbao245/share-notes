---
status: frozen
last_verified: 2026-07-08
reason: Library đã merge về Project A (spec library-migrate-to-project-a) — 2-project pattern chỉ còn giá trị lịch sử. Đọc để hiểu tại sao architecture cũ tồn tại, KHÔNG áp dụng cho code mới.
---

# Data Federation — 2 Supabase Project Strategy (historical)

Doc mô tả cách app hub cá nhân trước đây dùng 2 Supabase project song song và cách sync data giữa chúng khi cần.

**Đã lỗi thời**: sau spec `library-migrate-to-project-a` (apply 2026-07-08), Library data đã copy từ Project B (`hubibo`) sang Project A. Frontend chỉ còn dùng 1 client (`authClient`). Project B giữ nguyên làm snapshot rollback, không code nào query. Doc này giữ làm history — nếu sau này lại cần federation, dùng làm reference.

Đây là **kiến trúc quyết định**, không phải hướng dẫn implement. Khi thực sự cần sync sẽ code theo pattern ở đây.

## Bối cảnh

App có 2 Supabase project (mỗi project 1 free tier riêng):

| Project | Tên | URL | Vai trò |
|---|---|---|---|
| A | `bibo-tools-auth` | `fghrcpfxgdfibascmase.supabase.co` | Identity: auth.users, profiles, app_settings |
| B | `vlerovujjjsxlsxylrue` (chưa đổi tên) | `vlerovujjjsxlsxylrue.supabase.co` | Content: Library books storage (shared), RAG data |

Đây là **poly-database monolith** với data federation. Không phải microservice. Xem `docs/auth-architecture.html` cho sơ đồ trực quan.

## Nguyên tắc phân chia

**Project A giữ**:
- Identity data: user credentials, profile, role, permission
- Config sensitive: API tokens, secret keys
- Data nhẹ: 1 row / user, ít khi update

**Project B giữ**:
- Storage blob nặng: PDF books, cover images
- Vector data: RAG embeddings
- Data theo tool: bookmark, reading history, search history
- Bất kỳ data nào ăn nhiều storage/rows

**Rule cứng**:
- Bảng ở B tham chiếu user bằng `user_id UUID` — KHÔNG lưu email, name, role.
- Bảng ở A KHÔNG tham chiếu ngược sang B (A không biết B tồn tại).
- Không có cross-project foreign key. Consistency handle ở application layer.

## 3 loại sync và cách chọn

### Loại 1: Reference lookup (đọc info user từ tool khác)

**Vấn đề**: Library tool ở B có bookmark, muốn hiển thị tên user tạo bookmark.

**Solution**: On-demand fetch với cache.

```ts
// src/hooks/useUserInfo.ts
export function useUserInfo(userId: string) {
  return useQuery({
    queryKey: ['user-info', userId],
    queryFn: async () => {
      const { data } = await authClient
        .from('profiles')
        .select('id, role, allowed_tools')
        .eq('id', userId)
        .single();
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 phút
  });
}
```

**Rule**:
- Không denormalize (không copy email/name sang B).
- Cache 5 phút, user đổi info thấy delay tối đa 5 phút.
- Component ở tool B dùng hook trên bình thường.

**Khi nào dùng**: 90% trường hợp cross-project data.

### Loại 2: Permission check ở Project B

**Vấn đề**: Edge Function của B muốn check "user gọi API có `role=admin` hoặc `allowed_tools` chứa `library` không?" Không thể decode JWT vì khác secret.

**Solution**: Function ở B verify JWT + fetch profile qua Project A.

```ts
// supabase/workspace/functions/reader-download/index.ts (deploy ở B)
const AUTH_URL = 'https://fghrcpfxgdfibascmase.supabase.co';
const AUTH_SERVICE_KEY = Deno.env.get('PROJECT_A_SERVICE_KEY');

Deno.serve(async (req) => {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  
  const authClientA = createClient(AUTH_URL, AUTH_SERVICE_KEY);
  const { data: { user } } = await authClientA.auth.getUser(jwt);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile } = await authClientA
    .from('profiles')
    .select('role, allowed_tools')
    .eq('id', user.id)
    .single();
  
  const canRead = profile.role === 'admin' 
    || profile.allowed_tools.includes('*') 
    || profile.allowed_tools.includes('library');
  
  if (!canRead) return json({ error: 'Forbidden' }, 403);

  // Tiếp tục logic download từ storage B
});
```

**Setup**:
- Dashboard Project B → Edge Functions → Secrets → add `PROJECT_A_SERVICE_KEY` = service_role key của Project A.
- KHÔNG expose service key ra frontend.

**Cache tip**: dùng in-memory Map với TTL 60 giây để giảm số lần gọi Project A trong function.

**Alternative đơn giản**: check permission ở frontend trước khi gọi B. Bypass được nếu attacker gọi thẳng API, nhưng OK cho app cá nhân trust-based.

### Loại 3: Cascade cleanup khi xoá user

**Vấn đề**: Xoá user ở A → orphan bookmark/history ở B.

**Solution**: Database Webhook + Edge Function.

**Setup ở Project B**:

```ts
// supabase/workspace/functions/on-user-deleted/index.ts (deploy ở B)
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');

Deno.serve(async (req) => {
  const token = req.headers.get('x-webhook-secret');
  if (token !== WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });

  const { record } = await req.json();
  const userId = record.id;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  );

  await supabase.from('reader_bookmarks').delete().eq('user_id', userId);
  await supabase.from('rag_history').delete().eq('user_id', userId);
  await supabase.storage.from('books').remove([`user-${userId}/`]);

  return new Response('OK', { status: 200 });
});
```

**Setup ở Project A**:

Dashboard `bibo-tools-auth` → Database → Webhooks → Create:
- Name: `sync-user-deleted-to-b`
- Table: `auth.users`
- Events: `DELETE`
- URL: `https://vlerovujjjsxlsxylrue.supabase.co/functions/v1/on-user-deleted`
- HTTP Headers: `x-webhook-secret: {random-string}` (phải match secret ở B).

**Reliability layer** (optional, khi cần đảm bảo):

Thêm bảng `pending_cleanups` ở A:

```sql
CREATE TABLE pending_cleanups (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL,
  attempts int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

Trigger BEFORE DELETE trên `auth.users` insert row vào `pending_cleanups`. Cron function chạy mỗi 5 phút retry cleanup fail. Đảm bảo không lost khi B down tạm thời.

## Bảng quyết định

| Scenario | Solution | Complexity | Khi nào implement |
|---|---|---|---|
| Đọc info user từ tool B | On-demand + cache | Thấp | Khi tool B cần hiển thị info user |
| Library/RAG check permission | JWT forward | Trung | Khi cần hạn chế tool theo `allowed_tools` |
| Xoá user cần cleanup | Webhook + retry | Cao | Khi có user thật, không chỉ mình bạn |
| User đổi email/role | KHÔNG sync | 0 | Không bao giờ (cache tự expire) |
| Backup data | Manual export | Thấp | Khi có data quan trọng cần backup |

## Chi phí

Tất cả solution trên chạy trong Supabase free tier:
- Edge Function invocation: 500k/month free per project (dư sức).
- Database Webhook: không có limit riêng, tính vào Edge Function nếu URL trỏ đến function.
- Cross-project HTTP call: mất latency ~50-100ms per hop, không mất tiền.

Vấn đề chi phí thực sự: **quota storage/database size của mỗi project**. Nếu 1 project gần đầy → nghĩ đến việc mua Pro plan (25 USD/tháng) và merge 2 project. Không phải vấn đề sync.

## Anti-pattern

**Đừng làm**:

1. **Copy toàn bộ `profiles` sang B** để đọc nhanh. Duplication + stale data + phức tạp. Dùng cache TanStack Query thay thế.

2. **Real-time sync mọi thay đổi** qua webhook. Chỉ webhook khi thực sự cần cascade (xoá). Update/insert khác đọc on-demand.

3. **Thêm project thứ 3 chỉ vì "chia nhỏ để rõ ràng"**. Free tier hack, không phải kiến trúc. Càng nhiều project càng khó sync.

4. **Xây "unified data layer"** trong frontend che 2 project. Over-engineering. Cứ để rõ ràng project nào giữ gì.

5. **Cross-project SQL join**. Không làm được và cũng không nên làm.

## Roadmap

**Ngắn hạn (khi app còn cá nhân)**:
- Không sync gì. Setup hiện tại đủ.
- Chỉ dùng `authClient` cho A, `libraryClient` (từ `@/lib/library/supabase`) cho B trong code.

**Trung hạn (khi có user thứ 2)**:
- Implement Loại 1 (on-demand fetch) cho tool nào cần hiển thị user info.
- Có thể implement Loại 2 (permission check) nếu muốn hạn chế Library/RAG theo role.

**Dài hạn (khi có user ngoài + data quan trọng)**:
- Implement Loại 3 (cascade cleanup) đảm bảo không orphan data.
- Consider merge 2 project về 1 (mua Pro plan 25 USD/tháng) để có consistency thật.

## Reference

- `docs/auth-architecture.html` — sơ đồ trực quan flow auth 2 project.
- `.env` — config URL + anon key Project A.
- `src/lib/authClient.ts` — client Project A.
- `src/lib/library/supabase.ts` — client Project B (nên rename `contentClient` khi có thời gian).

---

**Last verified**: 2026-07-07  
**Status**: Active — cập nhật khi thêm/xoá project hoặc đổi rule sync.
