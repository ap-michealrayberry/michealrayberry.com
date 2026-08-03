/* Validation: proves the spreadsheet snapshot, manifests, media files,
   generated pages, published.json, homepage data, and sitemaps agree.
   Any contradiction is a nonzero exit — a failed validation blocks deploy.
   `--remote` adds live HTTP verification of every inspection video. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT, SITE_ORIGIN, DATA_DIR, MANIFEST_DIR, ANGLES,
  dayNumber, daySlug, pad3, exists, readMaybe, readJsonMaybe, sha256,
  loadSyncState,
} from './lib/common.mjs';
import { loadSnapshots } from './lib/sheet.mjs';
import { loadManifests, validateManifestShape, deriveStatus } from './lib/manifest.mjs';
import { publishedJson } from './generate.mjs';

const REMOTE = process.argv.includes('--remote');
const problems = [];
const notes = [];
function bad(msg) { problems.push(msg); }

async function checkManifestCollection(manifests) {
  const byDay = new Map();
  const byDate = new Map();
  for (const m of manifests) {
    if (byDay.has(m.day)) bad(`duplicate manifests for Day ${m.day} (${byDay.get(m.day).date} and ${m.date})`);
    if (byDate.has(m.date)) bad(`duplicate manifests for date ${m.date}`);
    byDay.set(m.day, m); byDate.set(m.date, m);
    for (const p of validateManifestShape(m, `manifest ${m.date}`)) bad(p);
    if (deriveStatus(m) === 'complete' && m.status !== 'complete') bad(`manifest ${m.date}: media is fully verified but status is "${m.status}"`);
    if (m.status === 'complete' && deriveStatus(m) !== 'complete') bad(`manifest ${m.date}: status is complete but media does not support it`);
  }
  const last = manifests.at(-1)?.day || 0;
  for (let d = 1; d <= last; d++) if (!byDay.has(d)) bad(`no manifest for Day ${d} — exactly one manifest per published day is required`);
  return { byDay, byDate };
}

async function checkAgainstSheet(manifests) {
  const { weighIns } = await loadSnapshots();
  const byDay = new Map(manifests.map((m) => [m.day, m]));
  for (const r of weighIns) {
    const m = byDay.get(r.day);
    if (!m) { bad(`sheet row for Day ${r.day} (${r.date}) has no manifest`); continue; }
    if (m.date !== r.date) bad(`Day ${r.day}: manifest date ${m.date} != sheet date ${r.date}`);
    if ((m.weight_lb ?? null) !== (r.weight_lb ?? null)) bad(`Day ${r.day}: manifest weight ${m.weight_lb} != sheet weight ${r.weight_lb}`);
  }
}

async function checkMedia(manifests) {
  const approved = (await readJsonMaybe(path.join(DATA_DIR, 'approved-hash-changes.json')))?.changes || [];
  for (const m of manifests) {
    for (const angle of ANGLES) {
      const p = m.media.photos[angle];
      if (!p) continue;
      const file = path.join(ROOT, p.path);
      const buffer = await readMaybe(file);
      if (!buffer) { bad(`manifest ${m.date}: photo ${angle} file missing: ${p.path}`); continue; }
      const hash = sha256(buffer);
      if (hash !== p.sha256 && !approved.some((c) => c.path === p.path && c.new === hash)) {
        bad(`manifest ${m.date}: EVIDENCE HASH MISMATCH for ${p.path} — recorded ${p.sha256}, actual ${hash}. Requires explicit approval in data/approved-hash-changes.json.`);
      }
      try {
        const meta = await sharp(buffer).metadata();
        const oriented = meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
        if (!meta.width || !meta.height) bad(`manifest ${m.date}: photo ${angle} not decodable: ${p.path}`);
        else if (oriented.width !== p.width || oriented.height !== p.height) bad(`manifest ${m.date}: photo ${angle} dimensions ${oriented.width}x${oriented.height} != manifest ${p.width}x${p.height}`);
      } catch (e) {
        bad(`manifest ${m.date}: photo ${angle} failed to decode (${e.message}): ${p.path}`);
      }
      for (const v of p.responsive || []) {
        const vf = path.join(ROOT, v.path);
        const vb = await readMaybe(vf);
        if (!vb) { bad(`manifest ${m.date}: responsive variant missing: ${v.path}`); continue; }
        if (sha256(vb) !== v.sha256) bad(`manifest ${m.date}: responsive variant hash mismatch: ${v.path}`);
      }
    }
    const v = m.media.video;
    if (v) {
      if (!/^https:\/\//.test(v.url)) bad(`manifest ${m.date}: video URL not HTTPS: ${v.url}`);
      if (/drive\.google\.com/.test(v.url)) bad(`manifest ${m.date}: video URL is a Google Drive URL: ${v.url}`);
      if (m.status === 'complete' && !v.verified) bad(`manifest ${m.date}: complete day with unverified video`);
    }
  }
}

async function checkRemoteVideos(manifests) {
  for (const m of manifests) {
    const v = m.media.video;
    if (!v?.url) continue;
    try {
      const response = await fetch(v.url, { headers: { range: 'bytes=0-1' }, redirect: 'follow' });
      const ct = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!(response.status === 206 || response.status === 200)) bad(`remote video ${v.url}: HTTP ${response.status}`);
      else if (!ct.startsWith('video/')) bad(`remote video ${v.url}: content-type ${ct || 'none'} is not video/*`);
      else if (response.status !== 206 && !/bytes/i.test(response.headers.get('accept-ranges') || '')) bad(`remote video ${v.url}: no byte-range support`);
      else notes.push(`remote video OK (${response.status}, ${ct}): Day ${m.day}`);
    } catch (e) {
      bad(`remote video ${v.url}: ${e.message}`);
    }
  }
}

async function readPage(m) {
  return (await readMaybe(path.join(ROOT, 'daily', daySlug(m.date, m.day), 'index.html')))?.toString('utf8') ?? null;
}

async function checkPages(manifests) {
  for (const m of manifests) {
    const html = await readPage(m);
    if (!html) { bad(`missing generated page: daily/${daySlug(m.date, m.day)}/index.html`); continue; }
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (canonical !== m.canonical_url) bad(`page Day ${m.day}: canonical ${canonical} != manifest ${m.canonical_url}`);
    // The page must show exactly the media the manifest verifies.
    for (const angle of ANGLES) {
      const p = m.media.photos[angle];
      if (p && !html.includes(p.url)) bad(`page Day ${m.day}: verified ${angle} photo not displayed`);
    }
    const photoCount = ANGLES.filter((a) => m.media.photos[a]).length;
    if (m.status !== 'complete' && photoCount < 4 && /four photographs below/.test(html)) bad(`page Day ${m.day}: claims four photographs but manifest has ${photoCount}`);
    if (m.media.video?.verified) {
      if (!html.includes(m.media.video.url)) bad(`page Day ${m.day}: verified video not displayed`);
      if (!/<video[\s>]/.test(html)) bad(`page Day ${m.day}: verified video but no HTML5 player`);
    } else if (/<video[\s>]/.test(html)) bad(`page Day ${m.day}: shows a video player without a verified video`);
    if (/drive\.google\.com\/file\/[^"]+\/preview/.test(html)) bad(`page Day ${m.day}: uses a Google Drive preview embed`);
    if (m.status === 'partial') {
      if (!/Not filed:/.test(html)) bad(`page Day ${m.day}: partial record does not list missing components`);
      if (Number.isFinite(m.weight_lb) && !html.includes(m.weight_lb.toFixed(1))) bad(`page Day ${m.day}: filed weight not displayed`);
    }
    // Navigation continuity.
    const prev = manifests.find((x) => x.day === m.day - 1);
    const next = manifests.find((x) => x.day === m.day + 1);
    if (prev && !html.includes(`/daily/${daySlug(prev.date, prev.day)}/`)) bad(`page Day ${m.day}: missing prev link to Day ${prev.day}`);
    if (next && !html.includes(`/daily/${daySlug(next.date, next.day)}/`)) bad(`page Day ${m.day}: missing next link to Day ${next.day}`);
  }
}

async function checkLocalLinks() {
  const pages = [];
  for (const dir of ['daily', 'weeks', 'milestones']) {
    const base = path.join(ROOT, dir);
    if (!(await exists(base))) continue;
    const stack = [base];
    while (stack.length) {
      const d = stack.pop();
      for (const item of await fs.readdir(d, { withFileTypes: true })) {
        const full = path.join(d, item.name);
        if (item.isDirectory()) stack.push(full);
        else if (item.name.endsWith('.html')) pages.push(full);
      }
    }
  }
  const routeExceptions = new Set(['/', '/dashboard', '/milestones', '/about', '/agreement', '/penalties', '/uniform', '/updates', '/verify', '/mrb', '/ap']);
  for (const page of pages) {
    const html = (await fs.readFile(page, 'utf8'));
    const refs = new Set();
    for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) refs.add(match[1]);
    for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const part of match[1].split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url.startsWith(SITE_ORIGIN)) refs.add(url.slice(SITE_ORIGIN.length));
        else if (url.startsWith('/')) refs.add(url);
      }
    }
    for (const match of html.matchAll(new RegExp(`(?:href|src)="${SITE_ORIGIN}(/[^"#?]*)`, 'g'))) refs.add(match[1]);
    for (const ref of refs) {
      if (routeExceptions.has(ref.replace(/\/$/, '') || '/')) continue;
      const decoded = decodeURIComponent(ref);
      const target = decoded.endsWith('/') ? path.join(ROOT, decoded, 'index.html') : path.join(ROOT, decoded);
      if (!(await exists(target))) bad(`${path.relative(ROOT, page)}: broken local link ${ref}`);
    }
  }
  notes.push(`link audit covered ${pages.length} generated pages`);
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function checkSitemaps(manifests) {
  const daily = (await readMaybe(path.join(ROOT, 'sitemap-daily.xml')))?.toString() || '';
  const dailyLocs = new Set(extractLocs(daily));
  for (const m of manifests) {
    if (!dailyLocs.has(m.canonical_url)) bad(`sitemap-daily.xml: missing ${m.canonical_url}`);
  }
  for (const loc of dailyLocs) {
    if (loc === `${SITE_ORIGIN}/daily/`) continue;
    const slugMatch = loc.match(/\/daily\/(\d{4}-\d{2}-\d{2})-day-(\d{3})\/$/);
    if (!slugMatch) { bad(`sitemap-daily.xml: unexpected URL ${loc}`); continue; }
    if (!manifests.some((m) => m.canonical_url === loc)) bad(`sitemap-daily.xml: ${loc} has no manifest`);
  }
  const images = (await readMaybe(path.join(ROOT, 'sitemap-images.xml')))?.toString() || '';
  for (const m of manifests) {
    for (const angle of ANGLES) {
      const p = m.media.photos[angle];
      if (p && !images.includes(p.url)) bad(`sitemap-images.xml: missing ${angle} photo for Day ${m.day}`);
    }
  }
  const videos = (await readMaybe(path.join(ROOT, 'sitemap-videos.xml')))?.toString() || '';
  for (const m of manifests) {
    if (m.media.video?.verified && m.media.photos.front && !videos.includes(m.media.video.url)) {
      bad(`sitemap-videos.xml: missing video for Day ${m.day}`);
    }
    if (/drive\.google\.com/.test(videos)) bad('sitemap-videos.xml: contains a Google Drive URL');
  }
  const index = (await readMaybe(path.join(ROOT, 'sitemap.xml')))?.toString() || '';
  for (const name of ['sitemap-static.xml', 'sitemap-daily.xml', 'sitemap-pages.xml', 'sitemap-images.xml', 'sitemap-videos.xml']) {
    if (!index.includes(`${SITE_ORIGIN}/${name}`)) bad(`sitemap.xml: index missing ${name}`);
    if (!(await exists(path.join(ROOT, name)))) bad(`missing generated file: ${name}`);
  }
}

async function checkPublishedJson(manifests) {
  const actual = (await readMaybe(path.join(ROOT, 'daily', 'published.json')))?.toString() || '';
  const expected = publishedJson(manifests);
  if (actual !== expected) bad('daily/published.json does not match the manifest collection — regenerate.');
}

async function checkHomepage(manifests) {
  const html = (await readMaybe(path.join(ROOT, 'index.html')))?.toString() || '';
  if (!html) { bad('index.html missing'); return; }
  if (!html.includes('/daily/published.json')) {
    bad('index.html does not load /daily/published.json — homepage daily-record data must come from the generated record.');
  }
}

async function checkExpectedOutputs(manifests) {
  const expected = [
    'daily/index.html', 'daily/published.json', 'feed.xml', 'weeks/index.html',
    'sitemap.xml', 'sitemap-static.xml', 'sitemap-daily.xml', 'sitemap-pages.xml',
    'sitemap-images.xml', 'sitemap-videos.xml',
    ...manifests.map((m) => `daily/${daySlug(m.date, m.day)}/index.html`),
    ...manifests.map((m) => `manifests/${m.date}.json`),
    ...[300, 275, 250, 225, 200, 175].map((t) => `milestones/${t}-lb/index.html`),
  ];
  const maxWeek = Math.ceil((manifests.at(-1)?.day || 1) / 7);
  for (let w = 1; w <= maxWeek; w++) expected.push(`weeks/week-${String(w).padStart(2, '0')}/index.html`);
  for (const rel of expected) {
    if (!(await exists(path.join(ROOT, rel)))) bad(`missing generated file: ${rel}`);
  }
}

async function main() {
  await loadSyncState();
  const manifests = await loadManifests();
  manifests.sort((a, b) => a.day - b.day);
  if (!manifests.length) { bad('no v2 manifests found'); }

  await checkManifestCollection(manifests);
  await checkAgainstSheet(manifests);
  await checkMedia(manifests);
  await checkPages(manifests);
  await checkLocalLinks();
  await checkSitemaps(manifests);
  await checkPublishedJson(manifests);
  await checkHomepage(manifests);
  await checkExpectedOutputs(manifests);
  if (REMOTE) await checkRemoteVideos(manifests);

  for (const n of notes) console.log(`  ${n}`);
  if (problems.length) {
    console.error(`\nVALIDATION FAILED — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(`\nValidation passed: ${manifests.length} days consistent across manifests, pages, published.json, homepage, and sitemaps.`);
  for (const m of manifests) console.log(`  Day ${pad3(m.day)}  ${m.date}  ${m.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
