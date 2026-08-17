# Auth project — bibo-tool-auth

**Ref**: `fghrcpfxgdfibascmase`  
**URL**: `https://fghrcpfxgdfibascmase.supabase.co`  
**Purpose**: Authentication (Supabase Auth) + `profiles` + `app_settings` (config sensitive per-tool)

## Tables

- `auth.users` — Supabase built-in
- `profiles` — role (admin/user), allowed_tools, username, avatar_url, last_login_at
- `app_settings` — key/value plaintext cho RAG tokens, Reader config, P2P config

Chi tiết schema: `.kiro/specs/setting-auth-refactor/design.md`

## Edge Functions

| Function | Public? | Verify JWT | Purpose |
|---|---|---|---|
| `lookup-username` | Có | Không | Dịch username → email cho login page |
| `create-user` | Không | Có | Admin tạo user mới (verify caller admin) |
| `delete-user` | Không | Có | Admin xoá user (verify caller admin) |

## Client SDK

`src/lib/authClient.ts` — Supabase client cho project này (session gate).

## Deploy

```powershell
cd supabase/auth
supabase link --project-ref fghrcpfxgdfibascmase
supabase functions deploy lookup-username
```
