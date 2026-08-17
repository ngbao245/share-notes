# Workspace project — bibohub-workspace

**Ref**: `bdxgxlfjcytdnojclgor`  
**URL**: `https://bdxgxlfjcytdnojclgor.supabase.co`  
**Purpose**: Data user thường — notes, tasks, bookmarks, watchlist, library metadata, highlights, reading progress

## Tables

- `notes`, `tasks`, `task_lists`
- `watchlist`
- `bookmark_profiles`, `bookmark_categories`, `bookmarks`, `bookmark_css_presets`
- `vault_meta`, `vault_entries`
- `highlights`, `reading_progress`
- (Chi tiết schema: xem migrations của project này trên Supabase Dashboard)

## Edge Functions

| Function | Public? | Verify JWT | Purpose |
|---|---|---|---|
| `workspace-proxy` | Có | Manual | Proxy CRUD qua function vì JWT kid mismatch giữa 2 project |
| `fetch-bookmark-meta` | Có | Không | Scrape OpenGraph metadata cho bookmark |
| `get-public-bookmarks` | Có | Không | Fetch public bookmark profile theo slug |

## Auth flow

Client dùng JWT của auth project → gửi cho `workspace-proxy` → function verify JWT bằng ES256 public key (hardcoded trong function) → extract user_id → CRUD với service_role + manual filter `user_id`.

## Client SDK

Không có SDK riêng — mọi call đi qua `workspace-proxy`. Gọi từ `src/api/*` với fetch + JWT auth.

## Deploy

```powershell
cd supabase/workspace
supabase link --project-ref bdxgxlfjcytdnojclgor
supabase functions deploy workspace-proxy
```
