// ============================================================
// Canvas — Link metadata fetch
// ============================================================
//
// Fetch URL metadata (title, favicon, og:image). Reuse pattern của
// Bookmark tool sau này (fetch-bookmark-meta edge function). Phase 2
// dùng microlink.io free tier (no auth, CORS enabled) để không block
// implementation vì Edge Function chưa sẵn sàng test.
//
// Swap: khi fetch-bookmark-meta edge function ready, đổi URL trong
// `fetchLinkMetadata` — signature không thay đổi.
//
// Timeout 5s. Fail silent — caller set fetchStatus='fail'.
// ============================================================

export interface LinkMetadata {
  title?: string;
  favicon?: string;
  ogImage?: string;
  hostname?: string;
}

const MICROLINK_ENDPOINT = 'https://api.microlink.io/?url=';
const TIMEOUT_MS = 5000;

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `${MICROLINK_ENDPOINT}${encodeURIComponent(url)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      data?: {
        title?: string;
        logo?: { url?: string };
        image?: { url?: string };
        url?: string;
      };
    };
    if (json.status !== 'success' || !json.data) return null;

    let hostname: string | undefined;
    try {
      hostname = new URL(json.data.url ?? url).hostname;
    } catch {
      // ignore
    }

    return {
      title: json.data.title,
      favicon: json.data.logo?.url,
      ogImage: json.data.image?.url,
      hostname,
    };
  } catch {
    return null;
  }
}

/** Fallback favicon via Google service khi microlink fail. */
export function googleFaviconUrl(url: string, size = 32): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`;
  } catch {
    return '';
  }
}
