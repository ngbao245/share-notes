// ============================================================
// fetch-bookmark-meta — Edge Function (SSRF-hardened)
// ============================================================
// Given a URL, extracts title + high-quality icon.
// All outbound fetches validated against URL safety policy:
//   - Only http/https schemes
//   - Reject private, loopback, link-local, reserved IPs
//   - Redirects followed manually with revalidation (max 5)
//   - Response bodies capped (HTML 2MB, image 5MB, manifest 512KB)
//   - Shared abort signal kills all pending work after deadline
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { importSPKI, jwtVerify } from 'https://deno.land/x/jose@v5.2.3/index.ts';

const WORKSPACE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Auth project ES256 public key (kid=89d316af-...)
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3DNZohvO2qXxdkvUBMLF38KYpvum
PYMuI32xb7F86Gp9ADnkfEjf6MeFfDP01E8qd7qIU5p1CGO1q1Hu/vjmJA==
-----END PUBLIC KEY-----`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FAVICON_BUCKET = 'bookmark-favicons';
const HARD_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (BiboHub Bookmarks bot)';
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_MANIFEST_BYTES = 512 * 1024; // 512 KB

interface MetaRequest { url: string }
interface MetaResponse { title: string; faviconUrl: string | null }

// ── URL Safety Policy ──

/** Trusted third-party domains that are always safe to fetch (icon APIs). */
const TRUSTED_ICON_HOSTS = new Set([
  'logo.clearbit.com',
  'icon.horse',
  'www.google.com',
]);

/**
 * Returns true if hostname resolves (or looks like) a private/reserved IP.
 * Covers: loopback, private RFC1918, link-local, IPv6 local, cloud metadata.
 *
 * NOTE: This is a hostname/IP-literal check. DNS rebinding is still a TOCTOU risk
 * but Deno's fetch does not expose a connect-time pinning API. This catches the
 * vast majority of SSRF vectors including direct IP, localhost aliases and metadata.
 */
function isPrivateHost(hostname: string): boolean {
  // Normalize brackets for IPv6 literals
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // IPv4 patterns
  if (/^127\./.test(h)) return true; // loopback
  if (/^10\./.test(h)) return true; // Class A private
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // Class B private
  if (/^192\.168\./.test(h)) return true; // Class C private
  if (/^169\.254\./.test(h)) return true; // link-local / cloud metadata
  if (h === '0.0.0.0' || h === '255.255.255.255') return true;
  if (/^0\./.test(h)) return true; // 0.x.x.x

  // IPv6 patterns
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (/^fe80:/i.test(h)) return true; // link-local
  if (/^fc00:/i.test(h) || /^fd/i.test(h)) return true; // unique local
  if (/^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i.test(h)) return true; // mapped

  // Hostnames that resolve to localhost
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === 'metadata.google.internal') return true; // GCP metadata

  return false;
}

/**
 * Validate a URL is safe to fetch.
 * Throws if scheme is not http/https or host is private/reserved.
 */
function assertSafeUrl(raw: string): URL {
  const url = new URL(raw); // throws on invalid
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked scheme: ${url.protocol}`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error(`Blocked private/reserved host: ${url.hostname}`);
  }
  // Block URLs with credentials (user:pass@host)
  if (url.username || url.password) {
    throw new Error('URLs with credentials are not allowed');
  }
  return url;
}

// ── Bounded Fetch Helpers ──

/**
 * Fetch with manual redirect following + revalidation + byte cap.
 * Rejects if any redirect target fails safety check.
 */
async function safeFetch(
  url: string,
  opts: {
    signal: AbortSignal;
    accept?: string;
    maxBytes: number;
    timeoutMs?: number;
  },
): Promise<{ ok: boolean; status: number; headers: Headers; body: ArrayBuffer } | null> {
  let currentUrl = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Validate every hop
    try {
      assertSafeUrl(currentUrl);
    } catch {
      return null; // unsafe target
    }

    const perHopTimeout = opts.timeoutMs ?? 4000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perHopTimeout);

    // Combine per-hop abort with global deadline signal
    const onGlobalAbort = () => controller.abort();
    opts.signal.addEventListener('abort', onGlobalAbort, { once: true });

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        headers: { 'User-Agent': UA, Accept: opts.accept ?? '*/*' },
        redirect: 'manual', // we follow manually to revalidate
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onGlobalAbort);
    }

    // Handle redirect
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        return null;
      }
      continue; // next hop
    }

    if (!res.ok) return { ok: false, status: res.status, headers: res.headers, body: new ArrayBuffer(0) };

    // Read body with byte cap
    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > opts.maxBytes) {
          reader.cancel();
          return null; // exceeded cap
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }

    // Merge chunks
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return { ok: true, status: res.status, headers: res.headers, body: merged.buffer };
  }

  return null; // too many redirects
}

// ── Parsing Helpers (unchanged logic) ──

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  const raw = match[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return raw.length > 0 ? raw.slice(0, 300) : null;
}

interface IconCandidate { href: string; size: number; rel: string }

function extractIconCandidates(html: string, baseUrl: string): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
    if (!relMatch) continue;
    const rel = relMatch[1].toLowerCase();
    if (!rel.includes('icon')) continue;
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const sizesMatch = tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i);
    let size = 0;
    if (sizesMatch) {
      const sm = sizesMatch[1].match(/(\d+)\s*[xX]\s*(\d+)/);
      if (sm) size = parseInt(sm[1], 10);
    }
    try {
      candidates.push({ href: new URL(hrefMatch[1], baseUrl).href, size, rel });
    } catch { /* skip */ }
  }
  return candidates;
}

function pickBestIcon(candidates: IconCandidate[]): IconCandidate | null {
  if (candidates.length === 0) return null;
  const score = (c: IconCandidate) => {
    let s = c.size;
    if (c.rel.includes('apple-touch-icon')) s += 200;
    if (c.rel.includes('mask-icon')) s -= 50;
    return s;
  };
  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}

function extractManifestUrl(html: string, baseUrl: string): string | null {
  const match = html.match(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*>/i);
  if (!match) return null;
  const hrefMatch = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
  if (!hrefMatch) return null;
  try { return new URL(hrefMatch[1], baseUrl).href; }
  catch { return null; }
}

async function fetchManifestIcons(
  manifestUrl: string,
  signal: AbortSignal,
): Promise<IconCandidate[]> {
  const res = await safeFetch(manifestUrl, { signal, accept: 'application/json', maxBytes: MAX_MANIFEST_BYTES, timeoutMs: 2000 });
  if (!res || !res.ok) return [];
  try {
    const text = new TextDecoder().decode(res.body);
    const data = JSON.parse(text) as { icons?: Array<{ src?: string; sizes?: string }> };
    if (!Array.isArray(data.icons)) return [];
    const out: IconCandidate[] = [];
    for (const icon of data.icons) {
      if (!icon.src) continue;
      let size = 0;
      if (icon.sizes) {
        const sm = icon.sizes.match(/(\d+)\s*[xX]\s*(\d+)/);
        if (sm) size = parseInt(sm[1], 10);
      }
      try { out.push({ href: new URL(icon.src, manifestUrl).href, size, rel: 'manifest-icon' }); }
      catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

async function tryFetchImage(url: string, signal: AbortSignal, timeoutMs = 2500): Promise<ArrayBuffer | null> {
  // Skip private hosts (icon candidates from HTML can be arbitrary)
  try { assertSafeUrl(url); } catch { return null; }

  const res = await safeFetch(url, { signal, accept: 'image/*', maxBytes: MAX_IMAGE_BYTES, timeoutMs });
  if (!res || !res.ok) return null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.startsWith('text/') || ct.includes('html')) return null;
  if (res.body.byteLength < 100) return null;
  return res.body;
}

async function uploadIcon(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  domain: string,
  buffer: ArrayBuffer,
  contentType = 'image/png',
): Promise<string | null> {
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
  const path = `${userId}/domains/${safeDomain}.png`;
  const { error } = await supabase.storage.from(FAVICON_BUCKET).upload(path, buffer, {
    contentType, upsert: true, cacheControl: '2592000',
  });
  if (error) return null;
  const { data } = supabase.storage.from(FAVICON_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ── Main Handler ──

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 1. Verify JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const token = authHeader.slice(7);

  let userId: string;
  try {
    const publicKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256');
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['ES256'],
      clockTolerance: '30s',
    });
    userId = payload.sub as string;
    if (!userId) return json({ error: 'JWT missing sub claim' }, 401);
  } catch (err) {
    return json({ error: `JWT verification failed: ${(err as Error).message}` }, 401);
  }

  // 2. Parse body
  let body: MetaRequest;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const rawUrl = (body.url ?? '').trim();
  if (!/^https?:\/\/.+/i.test(rawUrl)) {
    return json({ error: 'URL must start with http:// or https://' }, 400);
  }

  // 3. Validate initial URL safety
  try { assertSafeUrl(rawUrl); }
  catch (e) { return json({ error: (e as Error).message }, 400); }

  const domain = extractDomain(rawUrl);
  const supabase = createClient(WORKSPACE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Shared abort controller — kills ALL pending fetches after deadline
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), HARD_TIMEOUT_MS);
  const signal = deadlineController.signal;

  try {
    let title = domain;
    let html = '';

    // 4a. Fetch HTML for title + icon links
    const htmlRes = await safeFetch(rawUrl, { signal, accept: 'text/html', maxBytes: MAX_HTML_BYTES, timeoutMs: 4000 });
    if (htmlRes?.ok) {
      html = new TextDecoder().decode(htmlRes.body);
      const parsed = extractTitle(html);
      if (parsed) title = parsed;
    }

    // 4b. Icon cascade
    let iconBuffer: ArrayBuffer | null = null;

    // Tier 1: HTML icons + manifest
    if (html && !signal.aborted) {
      const candidates = extractIconCandidates(html, rawUrl);
      const manifestUrl = extractManifestUrl(html, rawUrl);
      if (manifestUrl && !signal.aborted) {
        try {
          const manifestCandidates = await fetchManifestIcons(manifestUrl, signal);
          candidates.push(...manifestCandidates);
        } catch { /* ignore */ }
      }
      const best = pickBestIcon(candidates);
      if (best && !signal.aborted) {
        iconBuffer = await tryFetchImage(best.href, signal);
      }
    }

    // Tier 2: Well-known apple-touch-icon paths
    if (!iconBuffer && !signal.aborted) {
      try {
        const origin = new URL(rawUrl).origin;
        for (const path of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
          if (signal.aborted) break;
          iconBuffer = await tryFetchImage(`${origin}${path}`, signal, 2000);
          if (iconBuffer) break;
        }
      } catch { /* ignore */ }
    }

    // Tier 3: Clearbit Logo API (trusted host)
    if (!iconBuffer && !signal.aborted) {
      iconBuffer = await tryFetchImage(
        `https://logo.clearbit.com/${encodeURIComponent(domain)}?size=512&format=png`, signal, 2500,
      );
    }

    // Tier 4: Icon Horse (trusted host)
    if (!iconBuffer && !signal.aborted) {
      iconBuffer = await tryFetchImage(
        `https://icon.horse/icon/${encodeURIComponent(domain)}`, signal, 2500,
      );
    }

    // Tier 5: Google Favicon API (trusted host)
    if (!iconBuffer && !signal.aborted) {
      iconBuffer = await tryFetchImage(
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`, signal, 2500,
      );
    }

    let faviconUrl: string | null = null;
    if (iconBuffer && !signal.aborted) {
      faviconUrl = await uploadIcon(supabase, userId, domain, iconBuffer);
    }

    return json({ title, faviconUrl } as MetaResponse);
  } catch {
    // Any unhandled → safe fallback
    return json({ title: domain, faviconUrl: null } as MetaResponse);
  } finally {
    clearTimeout(deadlineTimer);
    if (!deadlineController.signal.aborted) deadlineController.abort(); // cleanup
  }
});

// Exported for testing (Deno allows side-effect exports alongside serve)
export { isPrivateHost, assertSafeUrl };
