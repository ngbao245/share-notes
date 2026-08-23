import { useAuthStore } from '@/stores/authStore';
import {
  WORKSPACE_ANON_KEY,
  WORKSPACE_FETCH_META_URL as FETCH_META_URL,
  WORKSPACE_PUBLIC_BOOKMARKS_URL as PUBLIC_URL,
} from '@/lib/workspace/env';
import type { BackgroundType, BlendMode, BookmarkTheme } from '../types';

// ============================================================
// fetch-bookmark-meta
// ============================================================

export interface BookmarkMeta {
  title: string;
  faviconUrl: string | null;
}

export async function fetchBookmarkMeta(url: string): Promise<BookmarkMeta> {
  const token = useAuthStore.getState().session?.access_token;
  if (!token) throw new Error('Chưa đăng nhập — không thể fetch meta');
  const res = await fetch(FETCH_META_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: WORKSPACE_ANON_KEY,
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `fetch-bookmark-meta error ${res.status}`);
  }
  return (await res.json()) as BookmarkMeta;
}

// ============================================================
// get-public-bookmarks
// ============================================================

export interface PublicBookmark {
  id: string;
  categoryId: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  iconType: 'image' | 'text';
  iconText: string | null;
  iconRounded: boolean | null;
  iconBackground: string | null;
  orderIndex: number;
}

export interface PublicCategory {
  id: string;
  name: string;
  columnIndex: number;
  orderIndex: number;
}

export interface PublicProfile {
  slug: string;
  spaceName: string;
  displayName: string;
  bio: string;
  webpage: string;
  theme: BookmarkTheme;
  columnCount: number;
  iconSize: number;
  backgroundType: BackgroundType;
  backgroundValue: string;
  backgroundOverlayColor: string | null;
  backgroundOverlayOpacity: number;
  backgroundBlendMode: BlendMode;
  iconBackdrop: boolean;
  categoryLabelColor: string | null;
  categoryBgColor: string | null;
  bookmarkTitleColor: string | null;
  heroTitleColor: string | null;
  heroSpaceColor: string | null;
  heroUrlColor: string | null;
  customCss: string;
  openInSameTab: boolean;
  showHero: boolean;
}

export interface PublicBookmarksResponse {
  profile: PublicProfile;
  categories: PublicCategory[];
  bookmarks: PublicBookmark[];
}

export class PublicBookmarksNotFound extends Error {
  constructor(slug: string) {
    super(`Bookmarks profile not found for slug: ${slug}`);
    this.name = 'PublicBookmarksNotFound';
  }
}

export class PublicBookmarksPrivate extends Error {
  constructor(slug: string) {
    super(`Bookmarks profile is private: ${slug}`);
    this.name = 'PublicBookmarksPrivate';
  }
}

export async function fetchPublicBookmarks(slug: string): Promise<PublicBookmarksResponse> {
  const res = await fetch(`${PUBLIC_URL}?slug=${encodeURIComponent(slug)}`, {
    method: 'GET',
    headers: { apikey: WORKSPACE_ANON_KEY },
  });
  if (res.status === 404) throw new PublicBookmarksNotFound(slug);
  if (res.status === 403) throw new PublicBookmarksPrivate(slug);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `get-public-bookmarks error ${res.status}`);
  }
  return (await res.json()) as PublicBookmarksResponse;
}
