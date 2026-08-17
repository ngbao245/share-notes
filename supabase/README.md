# Supabase

App dùng **2 Supabase project**, mỗi project 1 subfolder ở đây.

## Layout

```
supabase/
├── auth/         → bibo-tool-auth (fghrcpfxgdfibascmase)
│   ├── functions/
│   ├── config.toml
│   └── README.md
├── workspace/    → bibohub-workspace (bdxgxlfjcytdnojclgor)
│   ├── functions/
│   ├── config.toml
│   └── README.md
└── README.md    (file này)
```

## Vì sao 2 project

- **auth**: auth + profile + app_settings (data nhạy cảm). Client dùng `authClient` (`src/lib/authClient.ts`).
- **workspace**: data user thường (notes, tasks, bookmarks, watchlist, library metadata, highlights). Client gọi qua Edge Function `workspace-proxy` với JWT của auth project.

Tách vì:
1. Isolation: nếu 1 project down, phần còn lại vẫn work
2. Different RLS complexity: auth có RLS phức tạp per-tool, workspace RLS đơn giản per-user
3. Free tier 500MB/project: chia 2 → 1GB total

## Quy ước Edge Function

Function thuộc project nào → nằm trong subfolder project đó.

**Auth functions**:
- `lookup-username` — dịch username → email (login page)
- `create-user` — admin tạo user mới
- `delete-user` — admin xoá user

**Workspace functions**:
- `workspace-proxy` — proxy CRUD qua Edge Function (verify JWT auth project)
- `fetch-bookmark-meta` — scrape OpenGraph metadata bookmark
- `get-public-bookmarks` — fetch public bookmark profile

## CLI workflow

Supabase CLI 1 folder = 1 project. Chạy CLI từ subfolder tương ứng:

```powershell
# Auth project
cd supabase/auth
supabase login                                                   # 1 lần
supabase link --project-ref fghrcpfxgdfibascmase
supabase functions deploy lookup-username

# Workspace project
cd supabase/workspace
supabase link --project-ref bdxgxlfjcytdnojclgor
supabase functions deploy workspace-proxy
```

Download source từ production:

```powershell
cd supabase/auth
supabase functions download lookup-username
```

## Legacy note

Trước đây functions của cả 2 project trộn ở `supabase/functions/` (workspace) + `backup/supabase/functions/` (auth). Đã reorganize sang layout hiện tại. `backup/supabase/` là archive, KHÔNG active — nếu source có ở đó nhưng không ở đây, coi như đã orphan.

Chi tiết technical debt còn lại: xem `.kiro/steering/context-map.md` mục "Known technical debt".
