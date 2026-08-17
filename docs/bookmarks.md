# Bookmarks Tool - Knowledge Base

## Overview

Clone Superdense-style bookmark manager. Quick links dạng favicon grid, nhóm theo category, drag & drop reorder, public profile share qua URL, custom CSS, theme riêng per user.

- Tool ID: `bookmarks`
- Route edit: `/bookmarks` (AuthGuard)
- Route public: `/bookmarks/:slug` (ngoài AuthGuard, không cần login)
- Spec: `.kiro/specs/bookmarks/`
- Workspace Supabase project: `bdxgxlfjcytdnojclgor`

---

## Architecture

### Data layer

**3 tables** in workspace DB:

- `bookmark_profiles` (1 per user):
  - `user_id` PK
  - `slug` unique, `[a-z0-9-]{3,30}`, not reserved keyword
  - `space_name`, `display_name`, `bio`, `webpage`
  - `is_public` (page-level toggle)
  - `theme` `light|dark|system`
  - `column_count` 1-4
  - `icon_size` 20-60 (px)
  - `background_type` `default|solid|gradient|image`, `background_value` (hex/CSS/URL/base64 data URL for uploaded image)
  - `background_overlay_color` (nullable hex), `background_overlay_opacity` (0-100, default 0 = off), `background_blend_mode` (default `'normal'`, 10 CSS blend modes)
  - `category_label_color`, `bookmark_title_color` (nullable hex, null = theme default)
  - `custom_css` (max 4000 char)
  - `icon_backdrop` bool (default true — wrap favicon in white circle so transparent PNG icons show on dark backgrounds)
  - `open_in_same_tab` bool
  - `header_mode` — DB enum col (`'default'|'hero'|'hidden'|'both'` legacy); domain simplified xuống `showHero: boolean` (`!== 'hidden'` = true). Chỉ toggle Hero header on/off; owner status bar independent.

- `bookmark_categories` (N per user):
  - `id` UUID
  - `user_id`, `name` (1-60 char)
  - `column_index` 0-based (which column in the multi-col layout)
  - `order_index` (order within column)
  - `hidden_from_public` (opt-out from public view)
  - `is_public` (dead column, kept for backward compat)

- `bookmarks` (N per category):
  - `id` UUID
  - `user_id`, `category_id` FK
  - `url` (https?://), `title`, `note`
  - `favicon_url` (nullable) — Supabase Storage public URL
  - `icon_type` `'image' | 'text'` default `'image'` — render fetched favicon or user-defined text/emoji
  - `icon_text` (nullable, 1-3 chars/emoji, used when `icon_type='text'`)
  - `icon_rounded` bool nullable — per-bookmark override (null = follow profile `icon_backdrop`)
  - `icon_background` hex color nullable — background color for icon (both text and image variants); `''` empty string = intentional transparent
  - `order_index`

**Storage bucket**: `bookmark-favicons` (public read, authenticated write scoped by user_id folder). Path convention:
- Auto-fetched: `{user_id}/domains/{domain}.png`
- Custom upload: `{user_id}/custom/{bookmark_id}.{ext}`

**Image transformations**: client rewrites Storage URLs from `/storage/v1/object/public/...` to `/storage/v1/render/image/public/...?width=X&height=X&resize=contain&quality=90` for on-the-fly Sharp resize. `X` = display size × DPR (clamped 1-3). Requires Supabase Image Transformations enabled on workspace. 2-step fallback: transform URL → raw URL → letter-avatar (on img error).

### Edge Functions

- `workspace-proxy` (shared) - CRUD proxy. Whitelist includes `bookmark_profiles`, `bookmark_categories`, `bookmarks`, `bookmark_css_presets`. Verifies Core JWT via ES256 shared key, injects `user_id`, uses service_role. **Hardened**: per-table field allowlist strips `user_id`/`id`/`created_at` and unknown fields from client data; conflict target fixed server-side for bookmark tables; supports `action: 'rpc'` for whitelisted PL/pgSQL functions (`bookmark_batch_update`, `bookmark_bulk_import`, `bookmark_enrich_meta`) with `p_user_id` always injected from JWT.
- `fetch-bookmark-meta` (authenticated) - fetches page HTML title + favicon, uploads to Storage. **SSRF-hardened**: URL safety policy rejects private/loopback/link-local/reserved/metadata IPs, blocks non-http(s) schemes and credentials in URLs; redirects followed manually with revalidation (max 5 hops); response bodies capped (HTML 2MB, image 5MB, manifest 512KB); shared AbortController deadline kills all pending work after 8s. **5-tier cascade** (updated to prioritize origin's native retina asset):
  1. HTML `<link rel="icon">` + `<link rel="apple-touch-icon">` + `manifest.json` icons (origin native 180-512px)
  2. Well-known paths `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png`
  3. Clearbit Logo API `?size=512&format=png` (brand logo fallback)
  4. Icon Horse `icon.horse/icon/{domain}` (256px third-party proxy)
  5. Google Favicon API `?sz=256` (last resort)
- `get-public-bookmarks` (public, no auth) - looks up profile by slug. Returns 404 if not found OR private (no info leak). Filters `hidden_from_public = false` categories. Select includes all icon customization columns. **Defense-in-depth**: bookmark query now filters by `user_id = profile.user_id` in addition to `category_id IN (...)`, preventing cross-tenant content even if composite FK is somehow bypassed.

All 3 functions need **Verify JWT = OFF** on Supabase dashboard settings. Supabase may re-enable after each redeploy — check every time.

### Frontend layer

```
src/tools/bookmarks/
  route.tsx              - edit page (owner, full CRUD + DnD + edit mode)
  route-public.tsx       - public page (read-only, no auth, no nav buttons)
  api.ts                 - TanStack Query hooks (profile, categories, bookmarks)
  store.ts               - Zustand UI state (search, dialog, editMode)
  types.ts               - TS interfaces + row mappers
  schemas.ts             - Zod validation (slug, URL, space name)
  components/
    CategoryBlock.tsx        - category header + favicon grid + visibility badge
    BookmarkItem.tsx         - sortable favicon tile
    BookmarkFavicon.tsx      - img/text/letter avatar + backdrop + hover morph + loading skeleton
    BookmarkEditDialog.tsx   - edit bookmark with Icon section (type/text/rounded/background popover)
    BookmarkPageStyle.tsx    - inject theme + custom CSS into document
    BookmarkBackground.tsx   - buildBookmarkBgStyle() + <BookmarkOverlay> (shared owner/public/preview)
    BookmarkHeader.tsx       - Hero header block (toggle showHero) — dùng cả owner + public
    BookmarkStatusBar.tsx    - Public/Private badge + slug URL pill + Preview link (owner-only)
    BookmarksSkeleton.tsx    - shared loading skeleton (3-col grid, shimmer beam)
    CustomCssEditor.tsx      - fullscreen split-view CSS editor with live preview
    SettingsDialog.tsx       - sidebar nav settings (5 sections, Appearance has Live Preview split)
  lib/
    avatar.ts                - letter-avatar color hash (HSL)
    color.ts                 - hexLuminance + getContrastText + contrastPair (WCAG util, shared)
    edge-functions.ts        - client callers (fetchBookmarkMeta, fetchPublicBookmarks)
    import-export.ts         - HTML/CSV parse + export (papaparse + DOMParser)
```

---

## Key Behaviors

### Privacy model

- **Page-level toggle** (`bookmark_profiles.is_public`):
  - OFF (default): entire page private, `/bookmarks/{slug}` returns 404 (indistinguishable from non-existent slug for privacy)
  - ON: public page shows non-hidden categories
- **Category opt-out** (`bookmark_categories.hidden_from_public`):
  - Only relevant when page is public
  - Default false (visible). Toggle true = hide from public
  - UI: visibility badge (`Public` / `Hidden` pill with Eye/EyeOff icon) shown next to category name, ONLY in edit mode + page public ON. Click badge to toggle. NOT in kebab menu.
- Edge Function `get-public-bookmarks` enforces both.

### Edit mode

Floating "Edit" button bottom-right. Two modes:

- **View mode** (default): favicons clickable links. No drag. No inline add/rename. Kebab menu hidden.
- **Edit mode**: click Edit button. Drag reorder enabled, click favicon opens edit dialog, quick-add + rename + visibility badge visible.

Save/Cancel buttons appear in edit mode. On enter, snapshot deferred fields:
- Category: `orderIndex`, `columnIndex`, `name`, `hiddenFromPublic`
- Bookmark: `orderIndex`, `categoryId`

**Non-deferred (immediate commits) even in edit mode**:
- Bookmark edit dialog changes (title/URL/note/favicon/iconType/iconText/iconRounded/iconBackground) — committed via `updateBookmark.mutate`
- Create/delete category/bookmark, profile settings

**Save**: builds batch payloads per table and calls `bookmark_batch_update` RPC (all-or-nothing transaction). On failure, invalidates queries and keeps edit mode for retry.
**Cancel**: restore only deferred fields. Content changes remain (Superdense pattern).

**Important**: `useUpdateBookmark` + `useUpdateCategory` do NOT invalidate query on success (would wipe pending drag state). They merge server fields into cache preserving local positioning.

**Route mount**: `editMode` auto-resets to `false` on mount → prevents stale edit state after navigation.

#### DnD interaction (rewrite 2026-08-13: pragmatic-drag-and-drop)

Drag-and-drop MIGRATED từ `@dnd-kit` sang `@atlaskit/pragmatic-drag-and-drop` (PDND) để fix performance issues (dnd-kit `useSortable × N items × 60fps` = re-render cascade). PDND dùng browser-native HTML5 drag API + imperative DOM updates → không React state per drag frame.

**Package deps:**
- `@atlaskit/pragmatic-drag-and-drop` (core, ~4.7kB)
- `@atlaskit/pragmatic-drag-and-drop-hitbox` (closest-edge module, ~1-2kB)
- Total: ~7kB (vs `@dnd-kit/*` ~17kB — giảm ~10kB bundle)

**Note**: `@dnd-kit/*` vẫn được giữ trong dependencies vì `pdf-studio` tool dùng. Chỉ bookmarks migrate.

**Architecture:**

Mỗi thành phần drag được declare qua `useEffect` với `draggable` / `dropTargetForElements` / `combine`:

- **BookmarkItem** (`src/tools/bookmarks/components/BookmarkItem.tsx`):
  - `draggable`: bookmark có thể pick up
  - `dropTargetForElements`: nhận drop từ bookmark khác, dùng `attachClosestEdge({allowedEdges: ['left', 'right']})` để mark left/right insertion
  - Local state: `dragging` (source), `edge` (target closest edge)
  - Visual: line indicator qua CSS pseudo-elements `::before` (edge=left) / `::after` (edge=right) → **zero React state cascade** → indicator updates purely qua DOM data attribute

- **CategoryBlock** (`src/tools/bookmarks/components/CategoryBlock.tsx`):
  - Header row `draggable` với `type: 'category'`
  - Category root `dropTargetForElements` với `attachClosestEdge({allowedEdges: ['top', 'bottom']})` cho category-drag
  - Bookmark tail `<li>` = `dropTargetForElements` với `type: 'category-tail'` → nhận bookmark drop khi cursor ở tail area
  - Line indicator TOP/BOTTOM qua data-cat-edge + CSS

- **CategoryColumn** (trong `route.tsx`):
  - `dropTargetForElements` với `type: 'column-container'` cho category-drag
  - Chỉ trigger khi column empty (fallback drop position)

- **Top-level monitor** (`route.tsx`):
  - Single `monitorForElements` subscribe ONCE on mount
  - Listens to all drops, extracts `closestEdge` from target data
  - Commits reorder to Zustand/TanStack Query cache via `commitRef` pattern (fresh closures over latest state)

**Drop position determination:**

`attachClosestEdge` from `@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge` tự động tính closest edge của cursor tới drop target rect (left/right cho horizontal, top/bottom cho vertical). Stamp edge vào target data qua Symbol key → `extractClosestEdge(target.data)` returns edge trong onDrop handler.

**Not needed anymore** (đã xóa):
- Custom collision detection (`dnd-collision.ts`)
- `dragOverCtx` React state (drop position lưu trong DOM data-* attribute)
- Phantom bookmark clone (PDND custom drag preview qua `setCustomNativeDragPreview` — outside React tree)
- `useSortable` per item — mỗi item chỉ có 1 useEffect subscribe DOM adapter
- Line indicator IndicatorSlot component (replaced by CSS `::before`/`::after`)

**Custom drag preview:** `setCustomNativeDragPreview` + `pointerOutsideOfPreview({x: '8px', y: '8px'})` — creates a native browser drag image outside React tree. For bookmark: ring-2 primary + favicon icon. For category: rounded pill badge.

**Type isolation:** `canDrop` gate bookmark vs category drops:
- Bookmark drop target chỉ accept `isBookmarkPayload(source.data)`
- Category drop target chỉ accept `isCategoryPayload(source.data)`
- Type guards định nghĩa trong `src/tools/bookmarks/lib/pdnd-types.ts`

**Deferred save (edit mode):** giữ nguyên. Monitor's commit path dispatches to `applyReorderCategoriesLocal` / `applyReorderBookmarksLocal` (edit mode) hoặc `reorderCategories.mutate` / `reorderBookmarks.mutate` (view mode). Save button vẫn flush qua `bookmark_batch_update` RPC.

**A11y gap:** PDND không có KeyboardSensor built-in như dnd-kit. Cho tool personal chấp nhận được. Có thể add `@atlaskit/pragmatic-drag-and-drop-react-accessibility` sau nếu cần.

- **Sortable strategy**: bookmark grid dùng `rectSortingStrategy` (hỗ trợ flex-wrap layout). Category column vẫn `verticalListSortingStrategy`.

- **DragOverlay ghost**: giữ nguyên favicon (bookmark) / badge (category) follow cursor với `ring-2 ring-primary shadow-lg`.

- **Ngoại lệ khi cancel**: `onDragCancel` (Esc hoặc drop ngoài valid target) reset `activeDrag` + `dragOverCtx` → không commit.

- **Deferred save trong edit mode**: reorder chỉ cập nhật local cache qua `applyReorderCategoriesLocal` / `applyReorderBookmarksLocal`. Save button flush qua `bookmark_batch_update` RPC. Cancel button rollback qua snapshot (giữ nguyên behavior cũ).

### Favicon strategy

**Server-side fetch** (`fetch-bookmark-meta`): 5-tier cascade (see Edge Functions above). Uploads to Storage `{user_id}/domains/{domain}.png` (upsert).

**Client-side render** (`BookmarkFavicon`):
- Storage URLs → transform endpoint (Sharp resize on-the-fly) with DPR-aware size for pixel-perfect on retina
- 2-step img fallback: transform → raw storage URL → letter-avatar
- Loading state: `animate-pulse rounded-full bg-foreground/10 ring-1 ring-foreground/5` circle when fetching
- No favicon → letter-avatar (HSL hash bg, first char of title)

**Enrichment retry on load**: `route.tsx` useEffect scans bookmarks for `iconType='image' && !faviconUrl && !temp_id && !enrichedRef.has(id)`, refires `fetchBookmarkMeta` + conditional `bookmark_enrich_meta` RPC (only fills title/favicon if field is still blank at DB level — never overwrites user edits). `enrichedRef` (useRef Set) prevents infinite loop; resets per route mount.

**Refresh favicon manually**: in Edit Bookmark dialog → "Refresh favicon" button re-runs cascade + upserts Storage with cache-bust `?v=timestamp`.

### Icon customization (per-bookmark)

Superdense-style icon config in `BookmarkEditDialog` "Icon" section:

- **Icon type dropdown**: `Image (favicon)` or `Text / Emoji`
  - Image → fetch/upload favicon (default flow)
  - Text/Emoji → user types 1-3 chars/emoji. Preview rendered as `IconTextEditable` circle (inline editable `<input>` styled as favicon). Auto-focus + select-all on switch to text (via `focusToken` counter — increments on dropdown pick, not initial mount, so opening existing text-icon bookmark doesn't steal focus from URL/Title fields)
  - Grapheme-aware `Array.from().slice(0,3)` preserves multi-codepoint emojis
- **Rounded checkbox**: per-bookmark override (`icon_rounded`) — null = follow profile `icon_backdrop`, true/false = explicit
- **Background checkbox + swatch**:
  - Unchecked (`null`): no background
  - Checked with no color (`''`): transparent, swatch shows red diagonal slash on white (Superdense empty state)
  - Checked with hex: colored bg
  - Swatch is **Popover trigger**: 4x4 grid of 16 Superdense preset colors + native color picker + hex input + Clear button
- **Preview real-time** at top of dialog (size 48px) matches actual rendered favicon

Text color auto-picked via WCAG luminance (`lib/color.ts::getContrastText`).

### Hover animation

`BookmarkFavicon` circle-to-squircle morph on hover (only inside `group/tile` = `BookmarkItem <li>`):

- **Image variant** (`MORPH_OUTER`): `rounded-[50%]` → `rounded-[26%]` + `scale-[1.08]` pop; inner img `50%` → `22%`
- **Text/emoji variant** (`MORPH_TEXT`): morph radius only, NO scale (text stays same size → no optical jump)
- Transition: `200ms cubic-bezier(0.2, 0, 0, 1)` (snappy) on `border-radius, transform`
- No ring border (removed for clean edge)

Font size for text/letter avatar: `size * 0.6` (60% container).

Text centering: `display: flex; alignItems: center; justifyContent: center; lineHeight: 1`.

### Column layout

- User selects 1-4 columns via Settings > Appearance > Layout (`column_count`)
- Each category has `column_index` (0-based)
- Auto-assign new categories to shortest column
- Drag category cross-column updates `column_index`
- Column-drop droppable enabled only when dragging **category** (not bookmark)
- Bookmark drop area = whole category block (header + grid)
- `gap-6` (24px) between categories within a column
- **Column count honored on desktop**: mobile `grid-cols-1`, `md:grid-cols-{n}` — user chọn 4 cols thì mọi breakpoint ≥ md hiển thị đúng 4 cols, không xuống 2/3 khi viewport nhỏ (chỉ mobile mới stack).
- **Row-aligned via CSS Subgrid**: parent grid có `grid-template-rows: repeat(maxRows, auto)`, mỗi CategoryColumn dùng `[grid-template-rows:subgrid] [grid-row:1/-1]` → categories cùng row có bottom thẳng hàng (không masonry-style độc lập height). Requires Chrome 117+, Firefox 71+, Safari 16+.

### Fluid layout

- Content container `mx-auto w-[90%] max-w-[2250px]` — content chiếm 90% viewport, tối đa 2250px, tự căn giữa với `mx-auto`.
- Khi viewport < 2250px, margin hai bên là 5% viewport (giảm liên tục theo viewport, không stepped breakpoint).
- Khi viewport > 2250px, content max 2250px, margin auto tăng tiếp.
- Áp dụng cho owner route, public route, và BookmarksSkeleton.

### Header (Hero toggle + Status bar)

Từ 2026-08-07 header đơn giản hoá xuống 2 khối độc lập:

**1. Owner status bar** — LUÔN hiện trên owner route `/bookmarks`:
- Public/Private badge (Globe/Lock icon)
- Slug URL pill (click = copy tới clipboard, toast confirm)
- Preview link (mở public URL tab mới) — hoặc "Bật public" button khi private
- Render qua shared `BookmarkStatusBar.tsx`
- Không có setting bật/tắt — owner-only management chrome.
- Public visitor KHÔNG bao giờ thấy status bar này.

**2. Hero header** — toggle `bookmark_profiles.show_hero` (domain field, mapped từ DB column `header_mode`):
- Bật (`showHero=true`, mặc định): Superdense-style `<h1>displayName</h1>` + `spaceName` link cùng dòng + URL nhỏ dòng dưới. Render trong body area trên grid.
- Tắt (`showHero=false`): grid bắt đầu ngay, không có block header trên đầu.
- Áp dụng cho CẢ owner + public route.
- Render qua `BookmarkHeader.tsx` (đơn nhất, chỉ có prop `showHero: boolean`).

**Data mapping** (legacy backward compat):
- DB column `header_mode` giữ nguyên (chưa migrate), enum `('default','hero','hidden','both')`.
- Domain `showHero: boolean` = `header_mode !== 'hidden'`.
- Update: `showHero=true` → DB `'hero'`, `showHero=false` → `'hidden'`.
- Legacy `'default'`/`'both'` values đọc lên = `showHero=true`. Có thể cleanup sau bằng migration `20260807000003_...` (không cấp bách).

Class hooks Superdense-compat: `col dense`, `bibo-hero-title`, `spaces-link`, `user-static-link`.

### Loading skeleton

Shared `BookmarksSkeleton` component (both routes):

- Matches real page footprint: 3-column grid, each column `min-h-[120px] rounded-xl border border-dashed border-transparent p-2`
- Multiple category blocks stacked per column with same inner spacing as data-loaded (`mb-2` badge row, `min-h-[36px]` grid, `mt-1.5 min-h-[14px]` hover title spacer)
- **Shimmer beam** (`animate-shimmer`, `w-1/3 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent`) sweeps only content area, not entire page
- Zero CLS: skeleton = loaded footprint

Owner route also has status bar skeleton (Public badge + slug URL row).

### Custom CSS

- Stored in `bookmark_profiles.custom_css` (max 4000 char)
- Injected via `<style id="bookmark-custom-css">` by `BookmarkPageStyle`; removed on unmount
- Fullscreen split editor: left textarea, right live preview. Preview has Light/Dark toggle via `data-theme`.
- Editor opened from Settings > Advanced. Back reopens Settings dialog.

**Precedence rule (custom CSS > Settings)**:

Settings (background, overlay, label color, title color) are NOT applied as inline `style={...}` on elements. Instead `BookmarkPageStyle` composes them into scoped CSS rules and injects them BEFORE user custom CSS inside the same `<style id="bookmark-custom-css">` tag. Order inside the tag:

1. Base structural rules (overlay positioning)
2. Dynamic rules from Settings — all wrapped in `:where(.bibo-bookmark-page)` (specificity 0-1-0)
3. User custom CSS (appended last)

Because rules 2 use `:where()` and rules 3 are appended after, user CSS wins the cascade at equal specificity without needing `!important`. See `buildBookmarkPageCss` in `BookmarkBackground.tsx`.

**Class hooks for user CSS**:
- `.bibo-bookmark-page` — root wrapper of both owner + public routes
- `.bibo-bookmark-header` — top header bar
- `.bibo-bookmark-overlay` — overlay layer element (visible only when overlay enabled)
- `.bibo-bookmark-content` — content region wrapper
- `.bibo-bookmark-col` — column wrapper
- `.bibo-bookmark-hover-title` — hover title paragraph under each category grid
- `.bibo-search-input` — header search input
- `.bookmark-category` — category block wrapper
- `.bookmark-category-badge` — category name badge (solid pill; target this for `categoryLabelColor` override or full style override)
- `.bookmark-favicon` — favicon tile
- **Hero elements** (chỉ hiện khi `showHero=true`):
  - `.bibo-hero-title` — h1 displayName (font-size, color, letter-spacing, font-family)
  - `.spaces-link` — space name link bên phải displayName
  - `.user-static-link` — URL dòng dưới (webpage nếu có, fallback publicUrl)
  - `.col.dense` — hero wrapper Superdense-compat class

**Example custom CSS** (advanced customization qua Settings > Advanced > Custom CSS editor):

```css
/* Hero displayName — bigger + custom font + gradient */
.bibo-hero-title {
  font-family: 'Playfair Display', serif;
  font-size: 5rem;
  background: linear-gradient(90deg, #a855f7, #ec4899);
  -webkit-background-clip: text;
  color: transparent;
}

/* Space name — inline pill style */
.spaces-link {
  padding: 4px 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.75rem;
}

/* URL — hide entirely nếu không muốn hiện */
.user-static-link { display: none; }

/* Category badge — override solid primary sang outline style */
.bookmark-category-badge {
  background: transparent;
  color: #64748b;
  border: 1px solid #e2e8f0;
}
```

Custom CSS luôn win over cả Tailwind utility classes lẫn Settings-derived rules:
- Settings inject qua `:where()` = specificity 0-0-0
- Tailwind utilities (VD `.bg-primary`) = specificity 0-1-0
- User CSS class selector (VD `.bookmark-category-badge`) = specificity 0-1-0

User CSS tie với Tailwind utilities theo specificity nhưng inject SAU trong document order → user CSS thắng cascade. KHÔNG cần `!important` trong trường hợp bình thường.

### Import/Export

Settings > Import / Export tab.

- **Export HTML**: Netscape bookmark format (Chrome/Firefox compatible). Folders = categories.
- **Export CSV**: `url,title,category,note` via papaparse.
- **Import HTML**: DOMParser parses `<a>` inside `<DL>/<DT>`. Nearest H3 = category.
- **Import CSV**: url required, category fallback "Imported". Max 500/batch. Uses `bookmark_bulk_import` RPC (all-or-nothing transaction; failure creates zero rows).
- Import creates missing categories within the same transaction. After successful import, client refetches all data and background enrichment fires per bookmark.

### Text colors

Settings > Appearance > Text colors:
- **Category label color** — overrides badge text (`category_label_color`)
- **Bookmark title hover color** — overrides hover title (`bookmark_title_color`)

Null = theme default. Solid + gradient presets auto-assign contrast-matching colors via `contrastPair`.

### Public route (route-public.tsx)

Non-owner view, no auth. Read-only. **No navigation buttons** (Hub link + Edit button removed) — user reaches page only via direct URL, returns via browser back.

Owner-visited public URL: no special treatment. Owner reaches edit only via `/bookmarks` route.

---

## Settings Dialog Architecture

**Responsive sizing**:
- Mobile (< 768px): full-screen sheet (`h-[100dvh] w-screen rounded-none`), sidebar chuyển thành horizontal scroll tabs ở top.
- Desktop (≥ md): dialog `max-w-4xl w-[95vw] max-h-[85vh]` — responsive theo viewport, không ép fixed 980x620 nữa.

5 sections:

| Section | Contents |
|---------|----------|
| Profile | Display name, space name, bio, webpage, **Header** subgroup (Hero on/off Switch + 3 ColorPicker khi bật: title/space/url) + `<LivePreview>` sticky right |
| Sharing | Public toggle, slug editor with `/bookmarks/{slug}` preview + copy/open |
| Appearance | **Split 60/40**: controls left + `<LivePreview>` sticky right. Theme (light/dark/system with icons), Columns (1-4 visual picker), Icon size (slider), Background (4 tabs default/solid/gradient/image with mini swatch inside each tab; presets auto-set contrast label + title colors), Overlay (color + blend mode dropdown + opacity slider), Text colors (2 pickers), Behavior (Icon backdrop toggle + Open in same tab) |
| Import / Export | Upload file button (HTML/CSV), Export buttons |
| Advanced | Open CSS editor button + **Reset to default** button (resets appearance + custom CSS; keeps profile/slug/public toggle) |

**Live Preview panel** (`LivePreview`) — shared giữa Profile và Appearance sections: real-time mini bookmark page with background + overlay + icon size + column count + text colors + **mini hero header (conditional on `showHero`)** applied. Uses `buildBookmarkBgStyle` + `<BookmarkOverlay>` from shared `BookmarkBackground` module.

**Gradient presets** (20): Twilight, Sunset, Peach, Coral, Golden, Ocean, Mint, Sky, Forest, Purple, Berry, Candy, Night, Cyber, Nordic, Paper, Slate, Aurora, Rose, Midnight — each shows real gradient thumbnail with sample "Social" badge + favicon dots + preset name in exact `labelColor`/`titleColor`.

**Solid presets** (17): 16 preset hex colors (4x6 grid) + "Pick" slot (native color picker with conic-gradient rainbow indicator) — each auto-sets contrast text via `contrastPair`.

**Image tab**: drag-and-drop upload zone → client-side compress (canvas resize max 1920px + JPEG q=0.85) → base64 data URL saved to `background_value`. URL paste fallback. Preview thumbnail with Change/Clear buttons. Aspect ratio warning toast if `< 1.2` or `> 4`.

**Overlay subgroup**: color picker + blend mode `<select>` (10 CSS modes) + opacity slider `0-100%`. Opacity 0 = off. Rendered by `<BookmarkOverlay>` as absolute layer `z-0`, content elevated to `z-10`.

---

## CSS Presets

User can save named CSS bundles as presets, each optionally including a snapshot of appearance Settings. Switch between presets to apply a saved look instantly.

### Data

- New table `bookmark_css_presets` (workspace DB):
  - `id`, `user_id`, `name` (1-60 unique per user), `css` (≤ 4000)
  - `includes_settings` bool, `settings_snapshot` JSONB (only populated when `includes_settings = true`)
  - Snapshot shape covers: background (type/value/overlay/blend), category label color, bookmark title color, icon backdrop, column count, icon size, theme.
- 2 new columns on `bookmark_profiles`:
  - `active_preset_id` UUID FK ON DELETE SET NULL — currently applied preset (null = detached, custom_css is standalone)
  - `custom_css_draft` text nullable — debounce-saved unsaved changes (10s idle)

### Behaviors

- **Save as new preset** — user names it + optional "Include current Settings" checkbox. New preset auto becomes active. Modal blocks if name duplicates per user.
- **Save changes** — updates active preset's CSS (dropdown option next to "Save as new").
- **Apply preset** — sets `active_preset_id` + copies `css` to `profile.custom_css`. If preset has `includes_settings = true`, a confirm dialog appears before overwriting appearance fields.
- **Detach from preset** — item in dropdown "Tách khỏi preset (giữ CSS)". Sets `active_preset_id = null` without touching CSS.
- **Rename / Delete** — kebab per row in dropdown. Rename inline (Enter/Esc). Delete via `window.confirm`. On delete of active preset, DB FK sets `active_preset_id` NULL; profile keeps CSS.
- **Modified indicator** — `*` bên tên preset trong dropdown khi `draft !== baseline`. Baseline = active preset CSS if any, else `profile.custom_css`.
- **Discard** — button appears only when modified. Confirm dialog → restore draft to baseline, clear DB draft field.
- **Debounce 10s draft** — user gõ CSS → `useEffect` debounce 10s → save into `bookmark_profiles.custom_css_draft`. If draft matches baseline again → clear draft (after same 10s idle). On editor mount, draft (if present) is loaded as initial state and marks modified.
- **Live Preview parity** — CSS editor preview wraps content in `.bibo-bookmark-page > header + .flex-1 > .grid` (same as actual page) and passes `profile` to `BookmarkPageStyle`, so Settings + custom CSS combined preview matches saved result 1:1.

### Constraints

- 4000 char CSS limit (DB CHECK constraint + textarea maxLength)
- Preset name unique per user (DB unique index + client validation)
- Soft cap 50 preset per user (not hard-enforced yet)
- Snapshot consistency: `includes_settings = true` ↔ `settings_snapshot IS NOT NULL` (CHECK constraint)

### Not implemented

- Built-in system presets
- Import/export preset JSON
- Public preset sharing / marketplace
- Preset version history

## Migrations (chronological)

Run in order on workspace project SQL Editor:

| File | What |
|------|------|
| `20260805000000_rename_bookmarks_to_watchlist.sql` | Rename old media tracker table `bookmarks` → `watchlist` |
| `20260805000001_bookmarks_tool.sql` | Create 3 new tables + RLS + Storage bucket + triggers |
| `20260805000002_bookmark_columns.sql` | Add `column_index` to categories |
| `20260805000003_bookmarks_settings.sql` | Extended profile settings (theme, public, bio) + `hidden_from_public` |
| `20260805000004_bookmark_colors.sql` | Add `category_label_color`, `bookmark_title_color` |
| `20260805000005_bookmark_overlay.sql` | Add `background_overlay_color/opacity/blend_mode` + relax `background_type` check to include `'solid'` |
| `20260805000006_bookmark_icon_backdrop.sql` | Add `icon_backdrop` bool (default true) |
| `20260805000007_bookmark_icon_customize.sql` | Add `icon_type/icon_text/icon_rounded/icon_background` to `bookmarks` |
| `20260806000000_bookmark_css_presets.sql` | Table `bookmark_css_presets` + `active_preset_id`/`custom_css_draft` on `bookmark_profiles` |
| `20260807000000_bookmark_tenant_isolation.sql` | Composite FK enforcing bookmark-category same owner + fix `background_type` CHECK to include `solid` |
| `20260807000001_bookmark_transactional_ops.sql` | PL/pgSQL functions: `bookmark_batch_update`, `bookmark_bulk_import`, `bookmark_enrich_meta` (atomic operations) |
| `20260807000002_bookmark_header_mode.sql` | Add `header_mode` column to `bookmark_profiles` with CHECK IN ('default','hero','hidden','both') |
| `20260807000003_bookmark_header_mode_cleanup.sql` | Normalize legacy 'default'/'both' → 'hero' + tighten CHECK IN ('hero','hidden') + default 'hero' |
| `20260807000004_bookmark_hero_colors.sql` | Add `hero_title_color`, `hero_space_color`, `hero_url_color` nullable TEXT — native color pickers cho Hero elements |

All in `backup/supabase/workspace/migrations/`. After migrations if PostgREST cache is stale: `NOTIFY pgrst, 'reload schema';`.

---

## Rename note: old Bookmarks → Watchlist (Phase 0)

Old "Bookmarks" tool was a media tracker. Renamed to `Watchlist`:
- Folder: `src/tools/watchlist/`
- Route: `/watchlist` (redirects from old `/bookmarks` and `/movies`)
- DB table: `watchlist` (renamed from `bookmarks`)
- Icon: `Film` (lucide)
- The new Bookmarks tool took the `/bookmarks` route and `Bookmark` lucide icon

---

## Known Issues / Pending

- **Supabase Image Transformations may be Pro-only** — `BookmarkFavicon` gracefully falls back to raw URL if transform endpoint returns 4xx. Free workspace: raw URL renders (may be slightly softer on retina).

- **Base64 background image** — Image tab stores compressed JPEG data URL in `background_value` (text). Row can hit ~500KB. Future migration to Supabase Storage: parse `data:` prefix, upload, replace with public URL.

- **`get-public-bookmarks` needs redeploy** after migration 07 — select query includes new icon columns. If not redeployed, function crashes on missing column.

## Deferred features (not implemented)

- Team tab
- Password protect public page
- Chrome extension
- Multiple spaces per user
- Custom drag overlay ghost
- Slug uniqueness live check (DB constraint enforces; client shows format validation only)
- Cancel edit mode does NOT revert creates/deletes (only positional/rename/hidden changes)

---

## Session resume checklist

When continuing in a new session:

### 1. Verify all migrations run

```sql
-- Check profile has all new columns
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='bookmark_profiles'
ORDER BY ordinal_position;
```
Must include: `background_overlay_color`, `background_overlay_opacity`, `background_blend_mode`, `icon_backdrop`, `category_label_color`, `bookmark_title_color`.

```sql
-- Check bookmarks has icon customization columns
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='bookmarks'
ORDER BY ordinal_position;
```
Must include: `icon_type`, `icon_text`, `icon_rounded`, `icon_background`.

```sql
-- Check preset table exists
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='bookmark_css_presets'
ORDER BY ordinal_position;
```
Must include: `id`, `user_id`, `name`, `css`, `includes_settings`, `settings_snapshot`, `created_at`, `updated_at`.

```sql
-- Check profile has preset-related columns
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='bookmark_profiles'
  AND column_name IN ('active_preset_id', 'custom_css_draft');
```
Must return 2 rows.

```sql
-- Check profile has header_mode column with cleaned-up CHECK (2 giá trị)
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'bookmark_profiles_header_mode_check';
```
Sau migration 20260807000003 phải trả về `CHECK ((header_mode = ANY (ARRAY['hero', 'hidden'])))`. Nếu vẫn thấy 4 giá trị legacy (`'default','hero','hidden','both'`) → chưa chạy migration cleanup.

```sql
-- Check background_type check constraint allows 'solid'
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'bookmark_profiles_background_type_check';
```

If missing → run relevant migrations in `backup/supabase/workspace/migrations/`.

### 2. Verify Edge Functions deployed + JWT off

- `workspace-proxy` — Verify JWT **OFF** (function verifies ES256 manually inside code; Supabase built-in verifier dùng khác kid → reject nếu ON)
- `fetch-bookmark-meta` — Verify JWT OFF (uses ES256 manual verify)
- `get-public-bookmarks` — Verify JWT OFF (public endpoint)

Test `get-public-bookmarks`: `curl https://bdxgxlfjcytdnojclgor.supabase.co/functions/v1/get-public-bookmarks?slug=baobibo` — must return 200 with JSON (or 404 if slug not public).

### 3. Verify Supabase Image Transformations enabled

Dashboard → Settings → Storage → Image Transformations. Free tier: 100 transform/month. If disabled, `BookmarkFavicon` still works (raw URL fallback) but favicons may look slightly softer on retina.

### 4. Test flow

- Login → `/bookmarks`
- Add bookmark URL → refresh page mid-add → verify favicon eventually loads (client retry-on-load kicks in)
- Settings > Appearance → Live Preview shows real-time; try all 4 background tabs, overlay, text colors
- Settings > Sharing → toggle Public ON → open incognito `/bookmarks/{slug}` → must render (no buttons)
- Edit bookmark → change icon type to Text → type emoji → verify preview inline editable + save
- Enter edit mode → verify visibility badge (Public/Hidden) appears next to each category name
- Reset button in Advanced → confirm dialog → verify appearance resets, profile/slug preserved
- Settings > Profile → toggle "Hero header" Switch on/off; Live Preview updates real-time; owner status bar luôn hiện độc lập với toggle

### 5. Tests (Vitest)

- `npm test` — chạy 61 unit tests (< 2s): tenant-isolation + ssrf-policy pure logic tests
- Test infrastructure ở `tests/`:
  - `tests/bookmarks/tenant-isolation.test.ts` — verify proxy sanitizeData (14 tests)
  - `tests/bookmarks/ssrf-policy.test.ts` — verify URL safety policy (47 tests)
  - `tests/README.md` cho human dev
  - `tests/AGENT.md` cho AI agent (rule: không đụng test khác, không mock trừ bắt buộc, không xoá test để pass)
- Config: `vitest.config.ts` (Vitest 4.1.10 pinned in package.json devDependencies).
