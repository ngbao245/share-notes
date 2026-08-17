// ============================================================
// get-public-bookmarks — Edge Function (unauthenticated)
// ============================================================
// Public view of a user's bookmark profile by slug.
// Only returns data when profile.is_public = true.
// Categories with hidden_from_public = true are excluded.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WORKSPACE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let slug = '';
  if (req.method === 'GET') {
    const u = new URL(req.url);
    slug = (u.searchParams.get('slug') ?? '').trim().toLowerCase();
  } else if (req.method === 'POST') {
    try {
      const body = await req.json();
      slug = String(body?.slug ?? '').trim().toLowerCase();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
  } else {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!SLUG_REGEX.test(slug)) {
    return json({ error: 'Invalid slug' }, 400);
  }

  const supabase = createClient(WORKSPACE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileErr } = await supabase
    .from('bookmark_profiles')
    .select(
      'user_id, slug, space_name, is_public, theme, display_name, bio, webpage, column_count, icon_size, background_type, background_value, background_overlay_color, background_overlay_opacity, background_blend_mode, icon_backdrop, category_label_color, category_bg_color, bookmark_title_color, hero_title_color, hero_space_color, hero_url_color, custom_css, open_in_same_tab, header_mode',
    )
    .eq('slug', slug)
    .maybeSingle();

  if (profileErr) return json({ error: profileErr.message }, 500);
  if (!profile) return json({ error: 'Profile not found', code: 'PROFILE_NOT_FOUND' }, 404);

  // Private profile → treat as not found (privacy: don't leak existence).
  if (!profile.is_public) {
    return json({ error: 'Profile not found', code: 'PROFILE_NOT_FOUND' }, 404);
  }

  const { data: categories, error: catErr } = await supabase
    .from('bookmark_categories')
    .select('id, name, column_index, order_index, hidden_from_public')
    .eq('user_id', profile.user_id)
    .eq('hidden_from_public', false)
    .order('column_index', { ascending: true })
    .order('order_index', { ascending: true });

  if (catErr) return json({ error: catErr.message }, 500);

  const categoryIds = (categories ?? []).map((c) => c.id);

  let bookmarks: unknown[] = [];
  if (categoryIds.length > 0) {
    const { data, error } = await supabase
      .from('bookmarks')
      .select('id, category_id, url, title, favicon_url, icon_type, icon_text, icon_rounded, icon_background, order_index')
      .in('category_id', categoryIds)
      .eq('user_id', profile.user_id) // defense-in-depth: only owner's bookmarks
      .order('order_index', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    bookmarks = data ?? [];
  }

  return json({
    profile: {
      slug: profile.slug,
      spaceName: profile.space_name ?? '',
      displayName: profile.display_name ?? '',
      bio: profile.bio ?? '',
      webpage: profile.webpage ?? '',
      theme: profile.theme ?? 'system',
      columnCount: Math.max(1, Math.min(4, profile.column_count ?? 3)),
      iconSize: Math.max(20, Math.min(60, profile.icon_size ?? 30)),
      backgroundType: profile.background_type ?? 'default',
      backgroundValue: profile.background_value ?? '',
      backgroundOverlayColor: profile.background_overlay_color ?? null,
      backgroundOverlayOpacity: Math.max(
        0,
        Math.min(100, profile.background_overlay_opacity ?? 0),
      ),
      backgroundBlendMode: profile.background_blend_mode ?? 'normal',
      iconBackdrop: profile.icon_backdrop ?? true,
      categoryLabelColor: profile.category_label_color ?? null,
      categoryBgColor: profile.category_bg_color ?? null,
      bookmarkTitleColor: profile.bookmark_title_color ?? null,
      heroTitleColor: profile.hero_title_color ?? null,
      heroSpaceColor: profile.hero_space_color ?? null,
      heroUrlColor: profile.hero_url_color ?? null,
      customCss: profile.custom_css ?? '',
      openInSameTab: profile.open_in_same_tab ?? false,
      showHero: profile.header_mode !== 'hidden', // legacy: 'default'/'both'/'hero' -> true, 'hidden' -> false
    },
    categories: (categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      columnIndex: c.column_index ?? 0,
      orderIndex: c.order_index,
    })),
    bookmarks: (bookmarks as Array<Record<string, unknown>>).map((b) => ({
      id: b.id as string,
      categoryId: b.category_id as string,
      url: b.url as string,
      title: b.title as string,
      faviconUrl: (b.favicon_url as string | null) ?? null,
      iconType: b.icon_type === 'text' ? 'text' : 'image',
      iconText: (b.icon_text as string | null) ?? null,
      iconRounded: (b.icon_rounded as boolean | null) ?? null,
      iconBackground: (b.icon_background as string | null) ?? null,
      orderIndex: b.order_index as number,
    })),
  });
});
