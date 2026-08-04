/* Pure mapping from a repository-relative changed file path to the public
   URL(s) that a search engine should re-crawl. Used by
   scripts/collect-changed-urls.mjs and by the SEO tests.

   The rules follow the generator's output conventions (see scripts/generate.mjs)
   and never emit a private surface (/ap, /mrb, /verify). Every returned URL is
   an absolute SITE_ORIGIN URL. Functions are pure: no fs, no network. */
import { SITE_ORIGIN, MILESTONES, dayNumber, canonicalDailyUrl } from './common.mjs';

// Top-level path segments that are private/noindex and must never be submitted.
export const PRIVATE_SEGMENTS = ['ap', 'mrb', 'verify'];

export function isPrivatePath(rel) {
  const top = String(rel || '').replace(/^\.?\//, '').split('/')[0];
  return PRIVATE_SEGMENTS.includes(top);
}

function weekUrl(day) {
  return `${SITE_ORIGIN}/weeks/week-${String(Math.ceil(day / 7)).padStart(2, '0')}/`;
}

function isFrontPhoto(basename) {
  return /(?:-|_)front(?:-|_|\.)/i.test(basename);
}

/* Return the set of public URLs a changed path maps to.
   opts.manifestsByDate: optional Map<isoDate, manifest> used only to decide
   whether a changed front photo is a video thumbnail (adds sitemap-videos). */
export function urlsForChange(relPath, opts = {}) {
  const manifestsByDate = opts.manifestsByDate || new Map();
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  const urls = new Set();
  if (!rel || isPrivatePath(rel)) return [];
  const add = (u) => urls.add(u);
  const out = () => [...urls];

  // Homepage.
  if (rel === 'index.html') { add(`${SITE_ORIGIN}/`); return out(); }

  // Root feeds / sitemaps / crawler files.
  if (rel === 'feed.xml' || /^sitemap[^/]*\.xml$/.test(rel) || rel === 'robots.txt' || rel === 'llms.txt') {
    add(`${SITE_ORIGIN}/${rel}`);
    return out();
  }

  // Daily index and machine-readable record.
  if (rel === 'daily/index.html') { add(`${SITE_ORIGIN}/daily/`); return out(); }
  if (rel === 'daily/published.json') { add(`${SITE_ORIGIN}/`); add(`${SITE_ORIGIN}/daily/`); return out(); }

  // A permanent daily page.
  let m = rel.match(/^daily\/(\d{4}-\d{2}-\d{2}-day-\d{3})\/index\.html$/);
  if (m) { add(`${SITE_ORIGIN}/daily/${m[1]}/`); return out(); }

  // Weeks index / a weekly page.
  if (rel === 'weeks/index.html') { add(`${SITE_ORIGIN}/weeks/`); return out(); }
  m = rel.match(/^weeks\/(week-\d{2})\/index\.html$/);
  if (m) { add(`${SITE_ORIGIN}/weeks/${m[1]}/`); return out(); }

  // A milestone page.
  m = rel.match(/^milestones\/(\d+-lb)\/index\.html$/);
  if (m) { add(`${SITE_ORIGIN}/milestones/${m[1]}/`); return out(); }

  // An original photograph: owning daily page + image sitemap + the file, and
  // the video sitemap when it is the (front) video thumbnail.
  m = rel.match(/^photos\/(\d{4})\/(\d{2})\/(\d{2})\/(.+\.(?:jpe?g|png|webp))$/i);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const day = dayNumber(date);
    add(canonicalDailyUrl(date, day));
    add(`${SITE_ORIGIN}/sitemap-images.xml`);
    add(`${SITE_ORIGIN}/${rel}`);
    const manifest = manifestsByDate.get(date);
    const hasVideo = manifest ? Boolean(manifest.media?.video?.url) : true;
    if (isFrontPhoto(m[4]) && hasVideo) add(`${SITE_ORIGIN}/sitemap-videos.xml`);
    return out();
  }

  // A responsive variant: owning daily page + image sitemap.
  m = rel.match(/^media\/responsive\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    add(canonicalDailyUrl(date, dayNumber(date)));
    add(`${SITE_ORIGIN}/sitemap-images.xml`);
    return out();
  }

  // A manifest: its canonical day, the aggregates that include it, and every
  // milestone page (their "reached / among others" content cross-references the
  // full set of completed days, so any weight can shift them).
  m = rel.match(/^manifests\/(\d{4}-\d{2}-\d{2})\.json$/);
  if (m) {
    const date = m[1];
    const day = dayNumber(date);
    add(canonicalDailyUrl(date, day));
    add(`${SITE_ORIGIN}/daily/`);
    add(`${SITE_ORIGIN}/feed.xml`);
    add(`${SITE_ORIGIN}/sitemap-daily.xml`);
    add(`${SITE_ORIGIN}/sitemap-images.xml`);
    add(`${SITE_ORIGIN}/sitemap-videos.xml`);
    add(weekUrl(day));
    for (const t of MILESTONES) add(`${SITE_ORIGIN}/milestones/${t}-lb/`);
    return out();
  }

  // data/, scripts/, package.json, workflows, etc. have no direct public URL —
  // their effect reaches search engines through the generated files above,
  // which appear in the same merge diff.
  return out();
}

/* Map a full list of changed repo paths to a sorted, unique, same-origin URL
   array. `changed` is [{ status, path }] where status is git's letter
   (A/M/D/R/C); rename/copy callers should pass both old and new paths. */
export function collectUrls(changed, opts = {}) {
  const origin = new URL(SITE_ORIGIN).host;
  const all = new Set();
  for (const { path: p } of changed) {
    for (const u of urlsForChange(p, opts)) all.add(u);
  }
  return [...all]
    .filter((u) => { try { return new URL(u).host === origin; } catch { return false; } })
    .sort();
}
