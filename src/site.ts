/* Serves the public site. Static files in public/ are answered by Workers
   Static Assets before the Worker runs; everything else lands here:
   - /photos/*  filed photographs, from R2 MEDIA photos/ (immutable)
   - the generated site, from R2 MEDIA site/ (written by src/build) */
import { contentTypeFor, SITE_PREFIX } from './build';

/* Ported from _headers: the same headers on generated pages as on static files. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://pub-944fe11d344847f68307fb252477ba11.r2.dev https://videodelivery.net https://*.cloudflarestream.com; media-src 'self' blob: mediastream:; connect-src 'self' blob: data: https://script.google.com https://script.googleusercontent.com https://api.elevenlabs.io https://www.googleapis.com https://storage.googleapis.com https://upload.videodelivery.net https://*.cloudflarestream.com https://edge-production.gateway.api.cloudflare.com; worker-src 'self' blob:; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.twitch.tv https://embed.twitch.tv https://iframe.videodelivery.net https://*.cloudflarestream.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
};

function cacheControlFor(path: string): string {
  if (path.startsWith('photos/')) return 'public, max-age=31536000, immutable';
  // max-age=0: the zone's Browser Cache TTL would otherwise stretch short lifetimes to hours.
  if (path.startsWith('data/')) return 'public, max-age=0, must-revalidate';
  if (path.startsWith('daily/') || path.startsWith('weeks/') || path.startsWith('cards/')) return 'public, max-age=3600';
  if (path.endsWith('.json')) return 'public, max-age=3600';
  return 'public, max-age=0, must-revalidate';
}

/** URL path → R2 object key under the site prefix, or null when the path can't name one. */
export function siteKey(pathname: string): string | null {
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  if (!path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('\0')) return null;
  path = path.slice(1);
  if (path === '' || path.endsWith('/')) return `${path}index.html`;
  return path;
}

async function notFound(request: Request, env: Env): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
  const res = new Response(page.body, { status: 404, headers: page.headers });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function withHeaders(body: ReadableStream | null, path: string, contentType: string, etag?: string): Response {
  const res = new Response(body, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControlFor(path) } });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (etag) res.headers.set('ETag', etag);
  return res;
}

export async function serveSite(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  const path = siteKey(url.pathname);
  if (path === null) return notFound(request, env);

  // Photographs: immutable once filed, straight from R2.
  if (path.startsWith('photos/')) {
    const object = await env.MEDIA.get(path);
    if (!object) return notFound(request, env);
    return withHeaders(request.method === 'HEAD' ? null : object.body, path, object.httpMetadata?.contentType ?? 'image/jpeg', object.httpEtag);
  }

  // Generated pages: cached per build, so a new build never serves a stale page.
  const buildId = (await env.CACHE.get('site:build', { cacheTtl: 30 })) ?? 'none';
  const cacheKey = new Request(`https://site-cache.internal/${encodeURIComponent(buildId)}/${path}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return request.method === 'HEAD' ? new Response(null, hit) : hit;

  const key = SITE_PREFIX + path;
  const object = await env.MEDIA.get(key);
  if (!object && !path.endsWith('index.html') && !/\.[a-z0-9]+$/i.test(path)) {
    // /daily → /daily/ when that directory page exists.
    if (await env.MEDIA.head(`${SITE_PREFIX}${path}/index.html`)) {
      return Response.redirect(new URL(`${url.pathname}/${url.search}`, url).toString(), 301);
    }
  }
  if (!object) return notFound(request, env);

  const res = withHeaders(object.body, path, contentTypeFor(key), object.httpEtag);
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return request.method === 'HEAD' ? new Response(null, res) : res;
}
