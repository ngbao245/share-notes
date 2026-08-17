import { useEffect, useState } from 'react';

import { avatarBgColor, avatarLetter } from '../lib/avatar';
import { getContrastText } from '../lib/color';
import { fetchFaviconThroughCache } from '../lib/favicon-cache';

// ============================================================
// Supabase Storage Image Transformations
// ============================================================
// Convert `.../storage/v1/object/public/bucket/path.png` to
// `.../storage/v1/render/image/public/bucket/path.png?width=X&height=X&resize=contain`
// so Storage serves a Sharp-resized version at exact display size (Superdense-style,
// avoids browser bilinear blur when downsampling large source).
// Non-Storage URLs (Icon Horse, Google, direct site) pass through unchanged.

function getDPR(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(3, Math.ceil(window.devicePixelRatio || 1));
}

function transformFaviconUrl(url: string | null, targetSize: number): string | null {
  if (!url) return url;
  // Match Supabase Storage public URL pattern
  const m = url.match(
    /^(https?:\/\/[^/]+)\/storage\/v1\/(?:object|render\/image)\/public\/(.+?)(?:\?.*)?$/,
  );
  if (!m) return url;
  const [, origin, pathRest] = m;
  const px = Math.round(targetSize * getDPR());
  return `${origin}/storage/v1/render/image/public/${pathRest}?width=${px}&height=${px}&resize=contain&quality=90`;
}

// ============================================================
// BookmarkFavicon — render favicon URL, letter-avatar fallback,
// or user-defined text/emoji icon with optional background color.
// ============================================================

interface BookmarkFaviconProps {
  faviconUrl: string | null;
  title: string;
  url: string;
  size?: number;
  className?: string;

  /**
   * Global icon backdrop from profile setting.
   * If per-bookmark `iconRounded` is null → follow this.
   */
  backdrop?: boolean;

  /** Per-bookmark icon type override. Default 'image'. */
  iconType?: 'image' | 'text';
  /** Text or emoji to render when iconType='text'. */
  iconText?: string | null;
  /**
   * Per-bookmark rounded override. `null` = follow global `backdrop`.
   * true = wrap in circle (with morph on hover); false = no wrapper.
   */
  iconRounded?: boolean | null;
  /**
   * Per-bookmark background hex color. Overrides default `bg-white` of the
   * backdrop wrapper. Applies to both image and text icon types.
   */
  iconBackground?: string | null;
}

// Circle -> squircle + pop on hover. Snappy easing.
const MORPH_OUTER =
  'rounded-[50%] transition-[border-radius,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover/tile:rounded-[26%] group-hover/tile:scale-[1.08]';

// Text/avatar variant: same morph but NO scale (text stays same size, no optical jump).
const MORPH_TEXT =
  'rounded-[50%] transition-[border-radius] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover/tile:rounded-[26%]';

const MORPH_INNER =
  'rounded-[50%] transition-[border-radius] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover/tile:rounded-[22%]';

export default function BookmarkFavicon({
  faviconUrl,
  title,
  url,
  size = 30,
  className = '',
  backdrop = false,
  iconType = 'image',
  iconText = null,
  iconRounded = null,
  iconBackground = null,
}: BookmarkFaviconProps) {
  const [errored, setErrored] = useState(false);
  // blobUrl = ready-to-render local blob:URL (from IDB cache or freshly fetched).
  // While null and iconType='image' with faviconUrl → skeleton pulse.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Fetch through cache. Try transform URL first (Sharp resize), fall back to raw URL
  // if workspace doesn't have Image Transformations enabled. Cache successful blob so
  // subsequent renders (this session or next visit) are instant.
  useEffect(() => {
    if (iconType !== 'image' || !faviconUrl) {
      setBlobUrl(null);
      setErrored(false);
      return;
    }
    let cancelled = false;
    let createdBlobUrl: string | null = null;
    setErrored(false);
    setBlobUrl(null);

    const transformed = transformFaviconUrl(faviconUrl, size);
    const primary = transformed ?? faviconUrl;
    const fallback = transformed && transformed !== faviconUrl ? faviconUrl : null;

    (async () => {
      try {
        const objUrl = await fetchFaviconThroughCache(primary, size);
        if (cancelled) {
          URL.revokeObjectURL(objUrl);
          return;
        }
        createdBlobUrl = objUrl;
        setBlobUrl(objUrl);
      } catch {
        if (cancelled) return;
        if (!fallback) {
          setErrored(true);
          return;
        }
        try {
          const objUrl = await fetchFaviconThroughCache(fallback, size);
          if (cancelled) {
            URL.revokeObjectURL(objUrl);
            return;
          }
          createdBlobUrl = objUrl;
          setBlobUrl(objUrl);
        } catch {
          if (!cancelled) setErrored(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [faviconUrl, size, iconType]);

  // Resolve effective rounded/backdrop for this instance:
  // per-bookmark iconRounded wins; else fall back to global backdrop.
  const useBackdrop = iconRounded === null ? backdrop : iconRounded;

  // === Loading state ===
  // Two loading cases show the same skeleton pulse:
  //   1. faviconUrl not present yet — server enrichment in progress (create bookmark flow).
  //   2. faviconUrl present but blob not fetched yet — cache miss on first render this session.
  //      Second-visit + cache hit resolves inside useEffect within a tick → skeleton flashes briefly.
  if (iconType === 'image' && !errored && (!faviconUrl || !blobUrl)) {
    return (
      <div
        className={`shrink-0 animate-pulse rounded-[50%] bg-foreground/10 ring-1 ring-foreground/5 ${className}`}
        style={{ width: size, height: size }}
        aria-label="Loading…"
      />
    );
  }

  // === Text / Emoji icon ===
  if (iconType === 'text') {
    const text = iconText?.trim() || avatarLetter(title, url);
    // Effective bg: bookmark override → white (if backdrop) → hashed avatar color.
    const effectiveBg = iconBackground || (useBackdrop ? '#ffffff' : avatarBgColor(url));
    const textColor = getContrastText(effectiveBg);
    return (
      <div
        className={`bookmark-favicon shrink-0 font-semibold shadow-sm ${MORPH_TEXT} ${className}`}
        style={{
          width: size,
          height: size,
          background: effectiveBg,
          color: textColor,
          fontSize: size * 0.6,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label={title || url}
      >
        {text}
      </div>
    );
  }

  // === Image icon (with letter-avatar fallback) ===
  const showAvatar = !faviconUrl || errored || !blobUrl;

  if (showAvatar) {
    const letter = avatarLetter(title, url);
    const bg = iconBackground || avatarBgColor(url);
    return (
      <div
        className={`bookmark-favicon shrink-0 font-semibold text-white ${MORPH_TEXT} ${className}`}
        style={{
          width: size,
          height: size,
          background: bg,
          fontSize: size * 0.6,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label={title || url}
      >
        {letter}
      </div>
    );
  }

  if (useBackdrop) {
    // Padding scales with size (~10% of size, min 2px).
    const pad = Math.max(2, Math.round(size * 0.1));
    return (
      <div
        className={`bookmark-favicon flex shrink-0 items-center justify-center shadow-sm ${MORPH_OUTER} ${className}`}
        style={{
          width: size,
          height: size,
          padding: pad,
          background: iconBackground || '#ffffff',
        }}
        aria-label={title || url}
      >
        <img
          src={blobUrl}
          width={size - pad * 2}
          height={size - pad * 2}
          alt={title || url}
          decoding="async"
          draggable={false}
          onError={() => setErrored(true)}
          className={`h-full w-full object-contain ${MORPH_INNER}`}
        />
      </div>
    );
  }

  // No backdrop, plain image
  if (iconBackground) {
    return (
      <div
        className={`bookmark-favicon flex shrink-0 items-center justify-center shadow-sm ${MORPH_OUTER} ${className}`}
        style={{ width: size, height: size, background: iconBackground }}
        aria-label={title || url}
      >
        <img
          src={blobUrl}
          width={size}
          height={size}
          alt={title || url}
          decoding="async"
          draggable={false}
          onError={() => setErrored(true)}
          className={`h-full w-full object-contain ${MORPH_INNER}`}
          style={{ padding: Math.max(2, Math.round(size * 0.1)) }}
        />
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      width={size}
      height={size}
      alt={title || url}
      decoding="async"
      draggable={false}
      onError={() => setErrored(true)}
      className={`bookmark-favicon shrink-0 object-contain ${MORPH_OUTER} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}


