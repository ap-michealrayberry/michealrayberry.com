import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Netlify sets no workspace var; the build runs from the repo root.
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
const SHEET_CSV = process.env.WEIGHINS_CSV ||
  'https://docs.google.com/spreadsheets/d/1zW3QQ4J3e4i-VmM75dhq7O3ayIDRgsjrA0mOEB5bB7o/gviz/tq?tqx=out:csv&sheet=Weigh-ins';
const VIOLATION_CSV = process.env.VIOLATION_CSV ||
  'https://docs.google.com/spreadsheets/d/1zW3QQ4J3e4i-VmM75dhq7O3ayIDRgsjrA0mOEB5bB7o/gviz/tq?tqx=out:csv&sheet=Violation%20Log';
const ATTEST_CSV = process.env.ATTESTATION_CSV ||
  'https://docs.google.com/spreadsheets/d/1zW3QQ4J3e4i-VmM75dhq7O3ayIDRgsjrA0mOEB5bB7o/gviz/tq?tqx=out:csv&sheet=Attestation';
const SITE_STATE_CSV = process.env.SITE_STATE_CSV ||
  'https://docs.google.com/spreadsheets/d/1zW3QQ4J3e4i-VmM75dhq7O3ayIDRgsjrA0mOEB5bB7o/gviz/tq?tqx=out:csv&sheet=Site%20State';
const HEALTH_CSV = process.env.HEALTH_CSV ||
  'https://docs.google.com/spreadsheets/d/1zW3QQ4J3e4i-VmM75dhq7O3ayIDRgsjrA0mOEB5bB7o/gviz/tq?tqx=out:csv&sheet=Health';
const START_DATE = '2026-08-13';
const START_WEIGHT = 340;
const GOAL_WEIGHT = 175;
const PERSON_ID = `${SITE_ORIGIN}/#micheal-ray-berry`;
const INDEXNOW_OUTPUT = path.join(ROOT, '.indexnow-urls.json');
const MILESTONES = [300, 275, 250, 225, 200, 175];

const STATIC_PAGES = [
  ['', 'daily'],
  ['dashboard', 'daily'],
  ['milestones', 'weekly'],
  ['about', 'weekly'],
  ['agreement', 'weekly'],
  ['penalties', 'daily'],
  ['corner-time', 'weekly'],
  ['positions', 'monthly'],
  ['consent', 'monthly'],
  ['uniform', 'weekly'],
  ['updates', 'daily'],
  ['verify', 'monthly'],
  ['daily/', 'daily'],
];

function xmlEscape(value = '') {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function htmlEscape(value = '') {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

function dayNumber(date) {
  const start = Date.parse(`${START_DATE}T12:00:00Z`);
  const current = Date.parse(`${date}T12:00:00Z`);
  return Math.round((current - start) / 86400000) + 1;
}

function longDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readMaybe(file) {
  try { return await fs.readFile(file); } catch { return null; }
}

async function writeIfChanged(file, data) {
  const next = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const current = await readMaybe(file);
  if (current && current.equals(next)) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  return true;
}

async function walk(dir) {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function relUrl(file) {
  return '/' + path.relative(ROOT, file).split(path.sep).map(encodeURIComponent).join('/');
}

function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s;
}

function youtubeId(url = '') {
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : '';
}

function driveId(url = '') {
  const match = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
  return match ? match[1] : '';
}

/* YouTube (@michealrayberry) is the official player — day and violation
   pages embed the posted video. Self-hosted R2 and Drive links still render
   so legacy rows keep working. */
function isSelfHosted(url) {
  // Either the eventual custom subdomain or the bucket's r2.dev URL, which is
  // what is in use until DNS can move to Cloudflare.
  return /^https?:\/\/(video\.michealrayberry\.com|pub-[0-9a-f]+\.r2\.dev)\//i.test(String(url || ''));
}

function videoEmbed(url) {
  if (isSelfHosted(url)) return '';
  const yid = youtubeId(url);
  if (yid) return `https://www.youtube-nocookie.com/embed/${yid}`;
  const did = driveId(url);
  if (did) return `https://drive.google.com/file/d/${did}/preview`;
  return '';
}

function imageLabel(angle) {
  return ({
    front: 'front view',
    left: 'left-side view',
    rear: 'rear view',
    right: 'right-side view',
  })[angle] || angle;
}

async function fetchText(url, optional = false) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'MRB-SEO-Publisher/1.0' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    if (optional) {
      console.warn(`Optional fetch failed: ${url}: ${error.message}`);
      return '';
    }
    throw error;
  }
}

function findPhoto(files, date, day, angle) {
  const padded = String(day).padStart(3, '0');
  const expected = new RegExp(
    `micheal-ray-berry-(?:daily-photo-)?(?:day-${padded}-)?${angle}-${date}\\.(?:jpe?g|png|webp)$`,
    'i'
  );
  const broader = new RegExp(
    `micheal-ray-berry.*(?:day-${padded}.*)?${angle}.*${date}\\.(?:jpe?g|png|webp)$`,
    'i'
  );
  return files.find((f) => expected.test(path.basename(f))) ||
    files.find((f) => broader.test(path.basename(f))) || null;
}

async function generateResponsive(source, date, angle, day) {
  const image = sharp(source, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error(`Unable to read image dimensions: ${source}`);
  const maxPublicWidth = Math.min(meta.width, 1600);
  const targetWidths = [...new Set([480, 960, maxPublicWidth].filter((w) => w <= maxPublicWidth))].sort((a, b) => a - b);
  const stem = `micheal-ray-berry-day-${String(day).padStart(3, '0')}-${angle}-${date}`;
  const targetDir = path.join(ROOT, 'media', 'responsive', date.slice(0, 4), date.slice(5, 7), date.slice(8, 10));
  const variants = [];
  const changedUrls = [];
  for (const width of targetWidths) {
    const dest = path.join(targetDir, `${stem}-${width}.webp`);
    const buffer = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer();
    if (await writeIfChanged(dest, buffer)) changedUrls.push(`${SITE_ORIGIN}${relUrl(dest)}`);
    variants.push({
      width,
      height: Math.round(meta.height * (width / meta.width)),
      path: dest,
      url: `${SITE_ORIGIN}${relUrl(dest)}`,
      sha256: sha256(buffer),
      bytes: buffer.length,
    });
  }
  return {
    source,
    sourceUrl: `${SITE_ORIGIN}${relUrl(source)}`,
    sourceSha256: sha256(await fs.readFile(source)),
    width: meta.width,
    height: meta.height,
    variants,
    changedUrls,
  };
}

function dailyPage({ record, photos, previous, next, attestation, health }) {
  const { date, weight, note, video, day } = record;
  const canonical = `${SITE_ORIGIN}/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const title = `Micheal Ray Berry Day ${day} — ${weight.toFixed(1)} lb | ${longDate(date)}`;
  const description = `Day ${day} of Micheal Ray Berry’s public weight-loss accountability record: ${weight.toFixed(1)} pounds on ${longDate(date)}, with four-angle photographs and the daily inspection video.`;
  const front = photos.front.sourceUrl;
  const embed = videoEmbed(video);
  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      datePublished: date,
      dateModified: date,
      primaryImageOfPage: { '@id': `${canonical}#front-photo` },
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: 'Micheal Ray Berry',
      alternateName: 'Ray Berry',
      url: SITE_ORIGIN + '/',
      image: front,
      // Must match the sameAs on the home page exactly: one entity, one set of
      // profiles. A day page claiming a narrower set makes the Person node
      // ambiguous instead of corroborating it.
      sameAs: ["https://www.youtube.com/@michealrayberry", "https://x.com/michealrayberry", "https://bsky.app/profile/michealrayberry.bsky.social", "https://gravatar.com/michealrayberry"],
    },
    ...Object.entries(photos).map(([angle, p]) => ({
      '@type': 'ImageObject',
      '@id': `${canonical}#${angle}-photo`,
      contentUrl: p.sourceUrl,
      thumbnailUrl: p.variants[0]?.url || p.sourceUrl,
      name: `Micheal Ray Berry Day ${day} ${imageLabel(angle)} — ${date}`,
      caption: `Micheal Ray Berry, ${imageLabel(angle)}, Day ${day} of the Public Accountability Project on ${longDate(date)}.`,
      dateCreated: date,
      width: p.width,
      height: p.height,
      creator: { '@id': PERSON_ID },
      representativeOfPage: angle === 'front',
    })),
    {
      '@type': 'Article',
      '@id': `${canonical}#article`,
      headline: title,
      description,
      articleSection: 'Daily Record',
      datePublished: `${date}T22:00:00-04:00`,
      dateModified: `${date}T22:00:00-04:00`,
      author: { '@id': PERSON_ID },
      publisher: { '@id': `${SITE_ORIGIN}/#website` },
      mainEntityOfPage: { '@id': canonical },
      image: Object.keys(photos).map((a) => ({ '@id': `${canonical}#${a}-photo` })),
      video: { '@id': `${canonical}#inspection-video` },
      about: { '@id': PERSON_ID },
      isAccessibleForFree: true,
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Daily Record', item: `${SITE_ORIGIN}/daily/` },
        { '@type': 'ListItem', position: 3, name: `Day ${day} — ${longDate(date)}`, item: canonical },
      ],
    },
    {
      '@type': 'VideoObject',
      '@id': `${canonical}#inspection-video`,
      name: `Micheal Ray Berry Day ${day} daily inspection video — ${date}`,
      description: `Four-angle daily inspection video for Day ${day} of the Micheal Ray Berry Public Accountability Project, recorded at ${weight.toFixed(1)} pounds.`,
      thumbnailUrl: front,
      uploadDate: date,
      contentUrl: video,
      ...(embed ? { embedUrl: embed } : {}),
      ...(isSelfHosted(video)
        ? { encodingFormat: /\.webm(\?|$)/i.test(video) ? 'video/webm' : 'video/mp4' }
        : {}),
      creator: { '@id': PERSON_ID },
    },
  ];
  const figures = Object.entries(photos).map(([angle, p]) => {
    const srcset = p.variants.map((v) => `${v.url} ${v.width}w`).join(', ');
    const alt = `Micheal Ray Berry ${imageLabel(angle)} accountability photograph on ${longDate(date)}, Day ${day}, at ${weight.toFixed(1)} pounds`;
    return `<figure id="${angle}-photo">
      <picture>
        <source type="image/webp" srcset="${htmlEscape(srcset)}" sizes="(max-width: 720px) 100vw, 50vw">
        <img src="${htmlEscape(p.sourceUrl)}" width="${p.width}" height="${p.height}" alt="${htmlEscape(alt)}" loading="${angle === 'front' ? 'eager' : 'lazy'}" decoding="async">
      </picture>
      <figcaption>Micheal Ray Berry — ${htmlEscape(imageLabel(angle))}, Day ${day}, ${htmlEscape(longDate(date))}.</figcaption>
    </figure>`;
  }).join('\n');
  const videoHtml = isSelfHosted(video)
    ? `<div class="video"><video controls preload="none" playsinline poster="${htmlEscape(front)}" width="720" height="1280" title="${htmlEscape(`Micheal Ray Berry Day ${day} inspection video`)}">
        <source src="${htmlEscape(video)}" type="video/mp4">
        <a href="${htmlEscape(video)}">Download the Day ${day} inspection video</a>
      </video></div>`
    : (embed
      ? `<div class="video"><iframe src="${htmlEscape(embed)}" title="${htmlEscape(`Micheal Ray Berry Day ${day} inspection video`)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : `<p class="video-link"><a href="${htmlEscape(video)}" rel="noopener">Watch the Day ${day} inspection video</a></p>`);
  const week = Math.ceil(day / 7);
  const nav = `<nav aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/daily/">All days</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>
    <p class="also"><a href="/weeks/week-${String(week).padStart(2, '0')}/">Week ${week}</a> · <a href="/milestones/${MILESTONES.filter((m) => m < weight).sort((a, b) => b - a)[0] || 175}-lb/">Next milestone</a> · <a href="/dashboard">Weigh-in log</a> · <a href="/">michealrayberry.com</a></p>`;
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry — Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Micheal Ray Berry — Public Accountability Project">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${htmlEscape(front)}">
  <meta property="article:published_time" content="${date}T22:00:00-04:00">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(description)}">
  <meta name="twitter:image" content="${htmlEscape(front)}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:400;font-size:11px;letter-spacing:.08em;color:var(--muted);padding:5px 9px}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}.stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px 'IBM Plex Mono',ui-monospace,monospace}
    .intro{max-width:760px;font-size:1.15rem}.attest{border-left:4px solid var(--accent);padding:10px 14px;background:#f1f0ea}
    .gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:36px 0}.gallery figure{margin:0;border:1px solid var(--ink);background:#fff}
    .gallery img{display:block;width:100%;height:auto}.gallery figcaption{padding:10px 12px;font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
    .video{margin:24px 0;background:#000}.video video{display:block;width:100%;max-width:420px;height:auto;margin:auto}
    .video:has(iframe){position:relative;padding-top:56.25%}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    nav{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--rule);padding-top:24px;margin-top:36px}nav a:nth-child(2){text-align:center}nav a:last-child{text-align:right}
    .also{font:12px/1.8 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:12px 0 0}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:720px){.gallery{grid-template-columns:1fr}nav{grid-template-columns:1fr;text-align:left!important}nav a:nth-child(2),nav a:last-child{text-align:left}}
  </style>
</head>
<body>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Micheal Ray Berry — Day ${day}</h1>
  <div class="stats"><span>${htmlEscape(longDate(date))}</span><span>${weight.toFixed(1)} LB</span><span>340 → 175 LB</span></div>
</header>
<main>
  <p class="intro">This page permanently documents Day ${day} of the Micheal Ray Berry Public Accountability Project. On ${htmlEscape(longDate(date))}, the official recorded weight was ${weight.toFixed(1)} pounds. The four photographs below show the required front, left-side, rear, and right-side documentation views.</p>
  ${note ? `<p>${htmlEscape(note)}</p>` : ''}
  <p class="attest">${attestation ? `Capture attestation recorded: ${htmlEscape(attestation)}.` : 'The public photo and video record is preserved with this daily page and its GitHub manifest.'}</p>
  ${health ? `<p style="font:13px/1.7 'IBM Plex Mono',ui-monospace,monospace;border:1px solid var(--rule);background:#fff;padding:10px 14px">Device-synced activity: <strong>${Number(health.steps).toLocaleString('en-US')} steps</strong>${health.zone ? ` · ${Math.round(health.zone)} active-zone minutes` : ''}${health.mi ? ` · ${health.mi.toFixed(1)} mi` : ''}${health.cal ? ` · ${Math.round(health.cal).toLocaleString('en-US')} calories out` : ''} — synced automatically from the connected device, not self-reported.</p>` : ''}
  <section aria-labelledby="photos-heading"><h2 id="photos-heading">Daily accountability photographs</h2><div class="gallery">${figures}</div></section>
  <section aria-labelledby="video-heading"><h2 id="video-heading">Daily inspection video</h2>${videoHtml}</section>
  <p><a href="/manifests/${date}.json">View the machine-readable manifest and SHA-256 evidence hashes</a></p>
  ${nav}
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* The /daily/ index. Built from the same list that produced the day pages,
   so "documented" always means "a page exists" — the index can never claim a
   day is missing while its page sits published. Days between the start and
   the latest record with no page are shown as gaps, which is the point. */
const PAGE_CSS = `
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:400;font-size:11px;letter-spacing:.08em;color:var(--muted);padding:5px 9px}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    h2{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:22px;margin:36px 0 12px;font-size:1.5rem;margin:32px 0 8px}
    .intro{max-width:760px;font-size:1.1rem}
    .stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px 'IBM Plex Mono',ui-monospace,monospace;margin:.5rem 0}
    table{width:100%;border-collapse:collapse;margin:20px 0;font:14px 'IBM Plex Mono',ui-monospace,monospace}
    th{text-align:left;background:var(--ink);color:var(--paper);padding:8px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    td{padding:8px 10px;border-bottom:1px solid var(--rule)}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:24px 0}
    .gallery figure{margin:0;border:1px solid var(--ink);background:#fff}.gallery img{display:block;width:100%;height:auto}
    .gallery figcaption{padding:8px 10px;font:11px/1.5 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
    .pending{border-left:4px solid var(--accent);padding:12px 16px;background:#f1f0ea}
    nav.crumbs{font:12px 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
`;

function crumbs(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.url })),
  };
}

/* ── Milestone pages ──────────────────────────────────────────────────
   One page per contract milestone (300/275/250/225/200/175). Each one
   targets a distinct long-tail query and either documents the day the
   milestone was reached or states plainly that it has not been, with how
   far there is to go. Unreached milestones are still published — the
   distance remaining is part of the record. */
function milestonePage(target, entries) {
  const reached = entries.find(({ record }) => record.weight <= target) || null;
  const latest = entries.at(-1)?.record || null;
  const start = entries[0]?.record.weight ?? START_WEIGHT;
  const canonical = `${SITE_ORIGIN}/milestones/${target}-lb/`;
  const title = reached
    ? `Micheal Ray Berry Reached ${target} lb — Day ${reached.record.day}, ${longDate(reached.record.date)}`
    : `Micheal Ray Berry — ${target} lb Milestone (Not Yet Reached)`;
  const toGo = latest ? (latest.weight - target) : (START_WEIGHT - target);
  const description = reached
    ? `Micheal Ray Berry passed the ${target}-pound milestone of his public accountability project on ${longDate(reached.record.date)}, Day ${reached.record.day}, at ${reached.record.weight.toFixed(1)} pounds. Verified with four-angle photographs and the daily inspection video.`
    : `The ${target}-pound milestone of the Micheal Ray Berry Public Accountability Project has not been reached. Current recorded weight: ${latest ? latest.weight.toFixed(1) : START_WEIGHT} pounds — ${toGo.toFixed(1)} pounds to go.`;
  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    crumbs([
      { name: 'Micheal Ray Berry', url: `${SITE_ORIGIN}/` },
      { name: 'Milestones', url: `${SITE_ORIGIN}/milestones` },
      { name: `${target} lb`, url: canonical },
    ]),
  ];
  if (reached) {
    graph.push({
      '@type': 'Achievement', name: `${target} pounds`,
      description: `Reached ${target} pounds on Day ${reached.record.day}.`,
      dateAchieved: reached.record.date, agent: { '@id': PERSON_ID },
    });
  }
  const body = reached
    ? `<p class="intro">Micheal Ray Berry reached the <strong>${target}-pound</strong> milestone on <strong>${htmlEscape(longDate(reached.record.date))}</strong>, Day ${reached.record.day} of the Public Accountability Project, at a recorded weight of ${reached.record.weight.toFixed(1)} pounds — ${(start - reached.record.weight).toFixed(1)} pounds down from the starting weight of ${start.toFixed(1)}.</p>
    <div class="gallery">${Object.entries(reached.photos).map(([angle, ph]) => `<figure>
      <picture><source type="image/webp" srcset="${htmlEscape(ph.variants.map((v) => `${v.url} ${v.width}w`).join(', '))}" sizes="(max-width:720px) 50vw, 25vw">
      <img src="${htmlEscape(ph.sourceUrl)}" width="${ph.width}" height="${ph.height}" alt="${htmlEscape(`Micheal Ray Berry ${imageLabel(angle)} at the ${target} pound milestone, Day ${reached.record.day}`)}" loading="lazy" decoding="async"></picture>
      <figcaption>${htmlEscape(imageLabel(angle))} · Day ${reached.record.day}</figcaption></figure>`).join('')}</div>
    <p><a href="/daily/${reached.record.date}-day-${String(reached.record.day).padStart(3, '0')}/">Full record for Day ${reached.record.day} →</a></p>`
    : `<p class="intro">The <strong>${target}-pound</strong> milestone has not been reached.</p>
    <div class="pending"><strong>${toGo.toFixed(1)} pounds to go.</strong> Latest recorded weight: ${latest ? latest.weight.toFixed(1) : START_WEIGHT} pounds${latest ? ` on ${htmlEscape(longDate(latest.date))}, Day ${latest.day}` : ''}. This page publishes the moment the milestone is recorded.</div>`;
  const others = MILESTONES.filter((m) => m !== target)
    .map((m) => `<a href="/milestones/${m}-lb/">${m} lb</a>`).join(' · ');
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry — Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <meta property="og:type" content="article"><meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}"><meta property="og:url" content="${canonical}">
  ${reached ? `<meta property="og:image" content="${htmlEscape(reached.photos.front.sourceUrl)}">` : ''}
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / <a href="/milestones">Milestones</a> / ${target} lb</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>${target} Pound Milestone</h1>
  <div class="stats"><span>340 → 175 LB</span><span>${reached ? 'REACHED' : 'NOT YET REACHED'}</span></div>
</header>
<main>
  ${body}
  <h2>Other milestones</h2>
  <p>${others}</p>
  <p><a href="/daily/">Full daily record</a> · <a href="/dashboard">Weigh-in log</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* ── Weekly summary pages ─────────────────────────────────────────────
   Project weeks run Day 1–7, 8–14, and so on. Each page carries that
   week's weights, the net change, and every documented day, giving the
   archive a second navigable axis and a lot more indexable surface. */
function weekPage(week, weekEntries, allEntries, healthMap) {
  const firstDay = (week - 1) * 7 + 1;
  const wkHealth = [...(healthMap || new Map()).entries()]
    .filter(([d]) => { const n = dayNumber(d); return n >= firstDay && n <= firstDay + 6; })
    .map(([, a]) => a);
  const avgSteps = wkHealth.length ? Math.round(wkHealth.reduce((t, a) => t + a.steps, 0) / wkHealth.length) : 0;
  const zoneTotal = Math.round(wkHealth.reduce((t, a) => t + a.zone, 0));
  const canonical = `${SITE_ORIGIN}/weeks/week-${String(week).padStart(2, '0')}/`;
  const weights = weekEntries.map((e) => e.record.weight);
  const net = weights.length > 1 ? weights[weights.length - 1] - weights[0] : 0;
  const dates = weekEntries.map((e) => e.record.date);
  const span = dates.length ? `${longDate(dates[0])} – ${longDate(dates[dates.length - 1])}` : `Days ${firstDay}–${firstDay + 6}`;
  const title = `Micheal Ray Berry Week ${week} — Days ${firstDay}–${firstDay + 6} | Public Accountability Project`;
  const description = weights.length
    ? `Week ${week} of the Micheal Ray Berry Public Accountability Project, ${span}: ${weights[0].toFixed(1)} to ${weights[weights.length - 1].toFixed(1)} pounds across ${weekEntries.length} documented days.`
    : `Week ${week} of the Micheal Ray Berry Public Accountability Project. No documented days in this week.`;
  const rows = weekEntries.map(({ record }) => `<tr>
    <td><a href="/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/">Day ${record.day}</a></td>
    <td>${htmlEscape(longDate(record.date))}</td>
    <td><strong>${record.weight.toFixed(1)} lb</strong></td>
    <td>${htmlEscape(record.note || '')}</td>
  </tr>`).join('\n');
  const maxWeek = Math.ceil((allEntries.at(-1)?.record.day || 1) / 7);
  const nav = [
    week > 1 ? `<a rel="prev" href="/weeks/week-${String(week - 1).padStart(2, '0')}/">← Week ${week - 1}</a>` : '',
    week < maxWeek ? `<a rel="next" href="/weeks/week-${String(week + 1).padStart(2, '0')}/">Week ${week + 1} →</a>` : '',
  ].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry — Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <meta property="og:type" content="article"><meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}"><meta property="og:url" content="${canonical}">
  ${weekEntries[0] ? `<meta property="og:image" content="${htmlEscape(weekEntries[0].photos.front.sourceUrl)}">` : ''}
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID } },
    crumbs([
      { name: 'Micheal Ray Berry', url: `${SITE_ORIGIN}/` },
      { name: 'Weeks', url: `${SITE_ORIGIN}/weeks/` },
      { name: `Week ${week}`, url: canonical },
    ]),
  ] })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / <a href="/weeks/">Weeks</a> / Week ${week}</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Week ${week}</h1>
  <div class="stats"><span>DAYS ${firstDay}–${firstDay + 6}</span><span>${htmlEscape(span)}</span>${weights.length > 1 ? `<span>${net <= 0 ? '−' : '+'}${Math.abs(net).toFixed(1)} LB</span>` : ''}</div>
</header>
<main>
  <p class="intro">${htmlEscape(description)}</p>
  ${wkHealth.length ? `<p style="font:13px/1.7 'IBM Plex Mono',ui-monospace,monospace;border:1px solid var(--rule);background:#fff;padding:10px 14px;display:inline-block">Device-synced activity, ${wkHealth.length} synced ${wkHealth.length === 1 ? 'day' : 'days'}: avg ${avgSteps.toLocaleString('en-US')} steps/day${zoneTotal ? ` · ${zoneTotal} active-zone minutes total` : ''}.</p>` : ''}
  ${rows ? `<table><thead><tr><th>Day</th><th>Date</th><th>Weight</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="pending">No documented days in this week.</div>'}
  <p>${nav}</p>
  <p><a href="/daily/">Full daily record</a> · <a href="/dashboard">Weigh-in log</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

function weeksIndexPage(entries) {
  const maxWeek = Math.ceil((entries.at(-1)?.record.day || 1) / 7);
  const canonical = `${SITE_ORIGIN}/weeks/`;
  const items = [];
  for (let w = 1; w <= maxWeek; w++) {
    const inWeek = entries.filter(({ record }) => Math.ceil(record.day / 7) === w);
    const weights = inWeek.map((e) => e.record.weight);
    items.push(`<tr><td><a href="/weeks/week-${String(w).padStart(2, '0')}/">Week ${w}</a></td>
      <td>Days ${(w - 1) * 7 + 1}–${w * 7}</td>
      <td>${inWeek.length} documented</td>
      <td>${weights.length ? `${weights[0].toFixed(1)} → ${weights[weights.length - 1].toFixed(1)} lb` : '—'}</td></tr>`);
  }
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Weekly Record — Micheal Ray Berry Public Accountability Project</title>
  <meta name="description" content="Week-by-week summary of the Micheal Ray Berry Public Accountability Project: documented days and net weight change for every project week.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${canonical}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / Weeks</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Weekly Record</h1>
</header>
<main>
  <div class="viewsw"><a href="/daily/">Days</a><a href="/weeks/" aria-current="page">Weeks</a><a href="/dashboard">Dashboard</a></div>
  <p class="intro">Every project week, Day 1 onward. Each week page lists that week's documented days, recorded weights, and net change.</p>
  <table><thead><tr><th>Week</th><th>Days</th><th>Documented</th><th>Weight</th></tr></thead><tbody>${items.reverse().join('\n')}</tbody></table>
  <p><a href="/daily/">Full daily record</a> · <a href="/milestones">Milestones</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* True while today's 10 PM Eastern deadline is still ahead. Derived from the
   date rather than a fixed offset so it holds across the DST change. */
function deadlinePending(iso) {
  const now = new Date();
  const todayEt = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayIso = `${todayEt.getFullYear()}-${String(todayEt.getMonth() + 1).padStart(2, '0')}-${String(todayEt.getDate()).padStart(2, '0')}`;
  if (iso > todayIso) return true;
  if (iso < todayIso) return false;
  return todayEt.getHours() < 22;
}

function dailyIndexPage(entries, gapKinds = new Map()) {
  const byDate = new Map(entries.map((e) => [e.record.date, e]));
  /* Run to today, not to the last finalized day. Stopping at the last
     complete record makes an unfiled day vanish from the index instead of
     showing as a gap — which is the one thing this page exists to prevent. */
  const today = new Date().toISOString().slice(0, 10);
  const lastEntry = entries.at(-1)?.record.date || START_DATE;
  const latest = today > lastEntry ? today : lastEntry;
  const days = [];
  for (let d = new Date(`${START_DATE}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, day: dayNumber(iso), entry: byDate.get(iso) || null });
    if (iso >= latest) break;
  }
  days.reverse();
  const documented = days.filter((d) => d.entry).length;
  const incomplete = days.filter((d) => !d.entry && gapKinds.get(d.date) === 'incomplete').length;
  const pending = days.filter((d) => !d.entry && deadlinePending(d.date)).length;
  const gaps = days.length - documented - incomplete - pending;
  const canonical = `${SITE_ORIGIN}/daily/`;
  const title = 'Daily Record — Micheal Ray Berry Public Accountability Project';
  const description = `Every published day of the Micheal Ray Berry Public Accountability Project: ${documented} documented days with four-angle photographs, recorded weight, inspection video, and SHA-256 evidence manifests.`;
  const cards = days.map(({ date, day, entry }) => {
    const href = `/daily/${date}-day-${String(day).padStart(3, '0')}/`;
    if (!entry) {
      const partial = gapKinds.get(date) === 'incomplete';
      // A day still inside its filing window is open, not missed.
      if (!partial && deadlinePending(date)) {
        return `<li class="card gap pending"><div class="thumb"><span>DUE TONIGHT</span></div>
        <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="flag">Due by 10 PM ET</span></div></li>`;
      }
      const flag = partial ? 'Incomplete record' : 'No record';
      const inner = `<div class="thumb"><span>${flag.toUpperCase()}</span></div>
        <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="flag">${flag}</span></div>`;
      // An incomplete day links to its page, which states what was filed and
      // what was not; a day with nothing filed has nothing to open.
      return partial ? `<li class="card gap"><a href="${href}">${inner}</a></li>` : `<li class="card gap">${inner}</li>`;
    }
    const front = entry.photos.front;
    const srcset = front.variants.map((v) => `${v.url} ${v.width}w`).join(', ');
    return `<li class="card"><a href="${href}">
      <picture><source type="image/webp" srcset="${htmlEscape(srcset)}" sizes="(max-width:720px) 50vw, 25vw">
      <img src="${htmlEscape(front.sourceUrl)}" width="${front.width}" height="${front.height}" alt="${htmlEscape(`Micheal Ray Berry front view, Day ${day}, ${longDate(date)}`)}" loading="lazy" decoding="async"></picture>
      <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="wt">${entry.record.weight.toFixed(1)} lb</span></div>
    </a></li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry — Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonical,
    url: canonical,
    name: title,
    description,
    about: { '@id': PERSON_ID },
    hasPart: days.filter((d) => d.entry).map((d) => ({
      '@type': 'WebPage',
      url: `${SITE_ORIGIN}/daily/${d.date}-day-${String(d.day).padStart(3, '0')}/`,
      name: `Day ${d.day} — ${longDate(d.date)}`,
    })),
  })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:400;font-size:11px;letter-spacing:.08em;color:var(--muted);padding:5px 9px}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main,footer{max-width:1200px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    .intro{max-width:760px}.count{font:600 14px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em}
    ul{list-style:none;padding:0;margin:28px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
    .card{border:1px solid var(--ink);background:#fff}.card a{display:block;color:inherit;text-decoration:none}
    .card img{display:block;width:100%;height:auto}
    .card .meta{display:flex;flex-direction:column;gap:2px;padding:10px 12px;font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
    .card .wt{font-weight:700}.card.gap{border-color:var(--accent)}
    .card .thumb{aspect-ratio:9/16;background:repeating-linear-gradient(45deg,#f1f0ea,#f1f0ea 10px,#e8e6df 10px,#e8e6df 20px);display:flex;align-items:center;justify-content:center}
    .card .thumb span{font:700 13px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;color:var(--accent)}
    .card .flag{color:var(--accent);font-weight:700}
    .card.pending{border-color:var(--rule)}
    .card.pending .thumb{background:repeating-linear-gradient(45deg,#f6f5f1,#f6f5f1 10px,#eeece6 10px,#eeece6 20px)}
    .card.pending .thumb span,.card.pending .flag{color:var(--muted)}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
  </style>
</head>
<body>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Daily Record</h1>
</header>
<main>
  <div class="viewsw"><a href="/daily/" aria-current="page">Days</a><a href="/weeks/">Weeks</a><a href="/dashboard">Dashboard</a></div>
  <p class="intro">Every published day of the Micheal Ray Berry Public Accountability Project, newest first. Documented days hold that day's four-angle photographs, the recorded weight, the inspection video, and a machine-readable manifest with SHA-256 evidence hashes. Days where the required documentation was not delivered are published too, marked <strong>No record</strong>; days whose record was filed but is missing a required element are marked <strong>Incomplete record</strong>, naming what is absent. The current day shows as <strong>due</strong> until its 10 PM Eastern deadline passes. The gaps are part of the record.</p>
  <p class="count"><strong>${documented}</strong> documented days${incomplete ? ` · <strong>${incomplete}</strong> incomplete ${incomplete === 1 ? 'record' : 'records'}` : ''}${gaps ? ` · <strong>${gaps}</strong> ${gaps === 1 ? 'day' : 'days'} without a record` : ''}${pending ? ` · <strong>${pending}</strong> still due` : ''}</p>
  <p><a href="/">Return to michealrayberry.com</a> · <a href="/weeks/">Weekly record</a> · <a href="/milestones">Milestones</a> · <a href="/dashboard">Weigh-in log and progress grid</a></p>
  <ul>${cards}</ul>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* RSS feed of the daily record. Feed readers, aggregators, and crawlers all
   poll it, so a new day is discovered without waiting for a sitemap re-crawl. */
function rssFeed(entries) {
  const items = entries.slice(-50).reverse().map(({ record, photos }) => {
    const url = `${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`;
    return `    <item>
      <title>${xmlEscape(`Day ${record.day} — ${record.weight.toFixed(1)} lb — ${longDate(record.date)}`)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${record.date}T22:00:00-04:00`).toUTCString()}</pubDate>
      <description>${xmlEscape(`Day ${record.day} of the Micheal Ray Berry Public Accountability Project. Recorded weight ${record.weight.toFixed(1)} pounds on ${longDate(record.date)}, with four-angle documentation photographs and the daily inspection video.`)}</description>
      <enclosure url="${xmlEscape(photos.front.sourceUrl)}" type="image/jpeg" length="0"/>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Micheal Ray Berry — Public Accountability Project</title>
    <link>${SITE_ORIGIN}/daily/</link>
    <atom:link href="${SITE_ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>The official daily public record: weight, four-angle photographs, and inspection video, published every day from 340 pounds to 175.</description>
    <language>en-US</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function staticSitemap(latestDate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${STATIC_PAGES.map(([slug, freq]) => `  <url><loc>${SITE_ORIGIN}/${slug}</loc><lastmod>${latestDate}</lastmod><changefreq>${freq}</changefreq><priority>${slug ? '0.7' : '1.0'}</priority></url>`).join('\n')}
</urlset>
`;
}

/* A Project Day with no complete record still gets a page. Two reasons: the
   prev/next chain stays unbroken (a crawler following Day 10 → Day 13 sees a
   sequence with a hole and no explanation), and the absence is itself part of
   the record — stated neutrally, exactly as the agreement requires. These
   pages carry no photographs, no video, and no consequence detail. */
function noRecordPage({ date, day, previous, next, reason, kind = 'none' }) {
  const label = kind === 'incomplete' ? 'Incomplete record' : 'No record';
  const canonical = `${SITE_ORIGIN}/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const title = `Day ${day} — ${label} — ${longDate(date)} — Micheal Ray Berry`;
  const description = `Day ${day} of the Micheal Ray Berry Public Accountability Project, ${longDate(date)}: ${kind === 'incomplete' ? 'the record filed for this date is incomplete' : 'no record was filed for this date'}.`;
  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      datePublished: date,
      dateModified: date,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Daily Record', item: `${SITE_ORIGIN}/daily/` },
        { '@type': 'ListItem', position: 3, name: `Day ${day} — ${longDate(date)}`, item: canonical },
      ],
    },
  ];
  const week = Math.ceil(day / 7);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:400;font-size:11px;letter-spacing:.08em;color:var(--muted);padding:5px 9px}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}
    .card{border:1px solid var(--ink);background:#f1f0ea;border-left:6px solid var(--accent);padding:22px 24px;margin:32px 0;max-width:760px}
    .card p{margin:0 0 12px}.card p:last-child{margin:0}
    nav{display:flex;justify-content:space-between;gap:16px;margin:36px 0 12px;font:600 14px 'IBM Plex Mono',ui-monospace,monospace}
    nav a{color:var(--ink)}footer{border-top:1px solid var(--rule);color:var(--muted);font-size:14px}
    a{color:var(--ink)}a:hover{color:var(--accent)}
  </style>
</head>
<body>
  <div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
  <header>
    <div class="eyebrow"><a href="/">Micheal Ray Berry</a> · Public Accountability Project</div>
    <h1>Day ${day} — ${label}</h1>
    <p>${htmlEscape(longDate(date))}</p>
  </header>
  <main>
    <div class="card">
      <p><strong>${kind === 'incomplete' ? 'The record for this date is incomplete.' : 'No record was filed for this date.'}</strong> ${htmlEscape(reason)}</p>
      <p>The Daily Compliance Packet for a Project Day is the four-angle inspection video, four accountability photographs, and the day's weight, all delivered by 10 PM Eastern. A packet counts only when every element is filed on time; a partial packet is an incomplete record, not a completed one. This page exists because the day exists: a gap is documented rather than omitted.</p>
    </div>
    <nav aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/daily/">All days</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>
    <p><a href="/weeks/week-${String(week).padStart(2, '0')}/">Week ${week}</a> · <a href="/penalties">Violation log</a> · <a href="/">michealrayberry.com</a></p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
  </body>
</html>
`;
}

// Inverse of dayNumber(): the calendar date a Project Day falls on, used when
// a gap day has no row in the sheet to read a date from.
function dateForDay(day) {
  const start = new Date(`${START_DATE}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() + (day - 1));
  return start.toISOString().slice(0, 10);
}

const CONFIRMATIONS = [
  // { version, date, url } — newest last. Added when a confirmation is recorded.
];

function consentPage() {
  const canonical = `${SITE_ORIGIN}/consent/`;
  const title = 'Consent and Confirmation — Micheal Ray Berry Public Accountability Project';
  const description =
    'The recorded confirmation that Micheal Ray Berry conceived this project, wrote and signed the ' +
    'agreement that governs it, and understood before signing that the record is permanent, public, ' +
    'and outside his control.';
  const latest = CONFIRMATIONS[CONFIRMATIONS.length - 1] || null;

  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description,
      about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    ...(latest ? [{
      '@type': 'VideoObject',
      '@id': `${canonical}#confirmation-${latest.version}`,
      name: `Project confirmation statement — version ${latest.version}`,
      description,
      contentUrl: latest.url,
      embedUrl: canonical,
      uploadDate: latest.date,
      publisher: { '@id': `${SITE_ORIGIN}/#website` },
      isFamilyFriendly: true,
    }] : []),
    { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Consent and Confirmation', item: canonical },
    ] },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .statement{border:1px solid var(--ink);padding:0;margin:20px 0}
    .statement div{display:grid;grid-template-columns:150px 1fr;border-bottom:1px solid var(--rule)}
    .statement div:last-child{border-bottom:none}
    .statement b{padding:16px 14px;border-right:1px solid var(--rule);font:600 11px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
    .statement p{padding:16px 14px;margin:0;line-height:1.65}
    .vid{max-width:420px;background:var(--ink);border:1px solid var(--ink);display:block;width:100%}
    .versions{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:9px}
    .versions a{display:flex;justify-content:space-between;gap:14px;border:1px solid var(--rule);padding:12px 15px;text-decoration:none}
    .versions a:hover{border-color:var(--ink)}
    @media(max-width:620px){.statement div{grid-template-columns:1fr}.statement b{border-right:none;border-bottom:1px solid var(--rule)}}
  </style>
</head>
<body>
  <div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
  <header>
    <div class="eyebrow">Consent</div>
    <h1>Confirmation</h1>
    <p>Whether this was agreed to, by whom, and what was understood before signing.</p>
  </header>
  <main>
    <p>Everything else on this site assumes consent. The agreement is signed, the name is real, and
    an Accountability Partner administers the record — but a document proves a document exists, not
    that its terms were understood or entered into freely. This page is where that is stated
    directly.</p>

    ${latest
      ? `<video class="vid" src="${latest.url}" controls preload="metadata" playsinline></video>
      <p><small>Confirmation version ${latest.version}, recorded ${htmlEscape(longDate(latest.date))}.</small></p>`
      : '<p><em>The confirmation recording has not yet been filed. The terms it states are below and are in force regardless — they are the terms of the signed agreement.</em></p>'}

    <h2>What is confirmed</h2>
    <div class="statement">
      <div><b>Origin</b><p>Micheal Ray Berry conceived this project, wrote the agreement that governs it, and built the website that publishes it. He then asked another adult to administer both, and signed the agreement placing them under that person's authority for the project's duration. He was not recruited, solicited, or persuaded.</p></div>
      <div><b>What he agreed to</b><p>To document himself daily — a weight, four photographs, and a four-angle inspection video — before ten PM Eastern, published under his own name. A failure to document is entered permanently on the public record and answered by corner time, recorded and published beside the entry that caused it. His weight is never a violation; only the failure to document is.</p></div>
      <div><b>What he gave up</b><p>He does not administer the record. He cannot edit an entry, soften a description, remove a recording, or take the site down, and he does not verify his own compliance. The record is permanent: completing a corrective requirement closes the obligation without removing the entry or the recording, and neither does resolution. If he abandons the project, that is recorded too.</p></div>
      <div><b>What he understood</b><p>That this is published under his legal name and is findable by anyone who searches it, including people who did not come looking for the project. That the photographs, video, and weights are permanent and indexed, and no future decision of his removes them. That the exposure is the mechanism rather than a side effect — every previous attempt ended privately, because quitting cost nothing.</p></div>
      <div><b>Consent and limits</b><p>Participation is voluntary. He is an adult, entered this freely, and may end it — by completing it, or by stopping and having that recorded. Nothing published is sexual; all published material is safe for work. No third party is invited to contact, pressure, or comment on him. A safety and privacy process applies throughout.</p></div>
    </div>

    <h2>Why the voice is synthetic</h2>
    <p>Every recording in this project is AI-voiced, and this one is no exception. A synthetic voice
    cannot demonstrate comprehension the way a person's own words can — that is a real cost, and
    worth naming. What it can do is state the terms precisely and identically every time, so what is
    confirmed is <em>these</em> terms rather than a paraphrase that drifts between recordings.</p>
    <p>The evidence of comprehension is elsewhere, and it is stronger: he wrote the agreement, he
    signed it, and he gave away the ability to change what it produces.</p>

    <h2>Versions</h2>
    <p>A new confirmation is recorded when the terms change materially. Earlier versions are kept —
    a superseded confirmation is part of the record of what was agreed, and when.</p>
    ${CONFIRMATIONS.length
      ? `<ul class="versions">${CONFIRMATIONS.slice().reverse().map((c) => `<li><a href="${c.url}"><span>Version ${c.version} — ${htmlEscape(longDate(c.date))}</span><span>View →</span></a></li>`).join('')}</ul>`
      : '<p><em>No confirmation has been filed yet.</em></p>'}

    <p><a href="/agreement">Read the signed agreement in full →</a></p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function violationState(raw) {
  const s = String(raw || '').trim();
  if (/^\s*(resolved|satisfied|closed)/i.test(s) && !/unresolved/i.test(s)) return 'resolved';
  if (/submitted|corrected|pending/i.test(s)) return 'corrected';
  return 'open';
}

/* Auto-declared entries read as an accusation; the record states what is absent
   instead. Matches the wording the violation log on the site uses. */
function violationText(raw) {
  const s = String(raw || '').trim().replace(/\s*\[auto-declared\]\s*/i, '');
  if (/incomplete/i.test(s)) return 'Incomplete record — ' + s.replace(/^Missed 10 PM ET deadline\s*—\s*/i, '');
  if (/no packet|not submitted|missing/i.test(s)) return 'No record — ' + s;
  return s;
}

function violationPage(v, prev, next) {
  const canonical = `${SITE_ORIGIN}/violations/${v.slug}/`;
  const title = `${v.id} — ${longDate(v.date)} — Micheal Ray Berry Public Accountability Project`;
  const description =
    `Violation ${v.id} of the Micheal Ray Berry Public Accountability Project, recorded ${longDate(v.date)}: ` +
    `${v.what}. Status: ${v.state}.`;

  const STATE_LABEL = { open: 'Open', corrected: 'Corrected — awaiting verification', resolved: 'Resolved' };
  const rows = [
    ['Project Day', 'Day ' + v.day],
    ['Date', longDate(v.date)],
    ['Requirement missed', v.what],
    ['Status', STATE_LABEL[v.state]],
    ['Correction submitted', v.submitted || '—'],
    ['Resolved', v.resolved || '—'],
    ['AP verification', v.verification || (v.state === 'resolved' ? 'Verified by the Accountability Partner' : v.state === 'corrected' ? 'Awaiting verification' : '—')],
  ];

  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      datePublished: v.date,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Violations', item: `${SITE_ORIGIN}/penalties` },
        { '@type': 'ListItem', position: 3, name: v.id, item: canonical },
      ],
    },
  ];
  if (/^https?:/.test(v.recording || '')) {
    graph.push({
      '@type': 'VideoObject',
      '@id': `${canonical}#corrective`,
      name: `Corrective session — ${v.id}`,
      description: `The corrective session recorded against entry ${v.id} of the Micheal Ray Berry Public Accountability Project, published beside the entry per §8 of the agreement.`,
      contentUrl: v.recording,
      uploadDate: v.submitted ? v.submitted.slice(0, 10) : v.date,
      thumbnailUrl: `${SITE_ORIGIN}/og-image.png`,
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .vstate{display:inline-block;font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;border:1px solid currentColor;padding:7px 10px}
    .vstate.open{color:var(--accent)}
    .vstate.corrected{color:#8A6A1E}
    .vstate.resolved{color:#3A6B3A}
    .vtable{border:1px solid var(--ink);margin:22px 0}
    .vtable div{display:grid;grid-template-columns:210px 1fr;border-bottom:1px solid var(--rule)}
    .vtable div:last-child{border-bottom:none}
    .vtable b{padding:14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)}
    .vtable p{padding:14px;margin:0;line-height:1.6}
    @media(max-width:560px){.vtable div{grid-template-columns:1fr}.vtable b{border-right:none;border-bottom:1px solid var(--rule)}}
    .corr{border-left:3px solid var(--rule);padding-left:14px;display:flex;flex-direction:column;gap:6px;margin:16px 0}
    .corr span{font-size:14px;line-height:1.6;color:#3A3935}
    .vrec{width:100%;max-width:540px;background:#141412;display:block;margin:16px 0}
    .vrec-yt{aspect-ratio:9/16;border:0}
  </style>
</head>
<body>
  <div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
  <header>
    <div class="eyebrow">Permanent violation entry</div>
    <h1>${v.id}</h1>
    <p>${htmlEscape(longDate(v.date))} · Day ${v.day}</p>
    <p><span class="vstate ${v.state}">${STATE_LABEL[v.state]}</span></p>
  </header>
  <main>
    <div class="vtable">
      ${rows.map(([k, val]) => `<div><b>${k}</b><p>${htmlEscape(String(val))}</p></div>`).join('')}
    </div>

    ${/^https?:/.test(v.recording || '') ? `<h2>Corrective recording</h2>
    <p>The corrective session recorded against this entry, published in full beside it (§8).
    Completing the requirement closes the obligation; it does not remove this entry or the
    recording.</p>
    ${videoEmbed(v.recording) ? `<iframe class="vrec vrec-yt" src="${videoEmbed(v.recording)}" title="Corrective session — ${v.id}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>` : `<video class="vrec" src="${v.recording}" controls preload="metadata" playsinline></video>`}` : ''}

    ${v.corrections.length ? `<h2>Correction history</h2>
    <p>Corrections to this entry are dated and appended. Nothing already recorded is rewritten or
    removed.</p>
    <div class="corr">${v.corrections.map((c) => `<span>${htmlEscape(c)}</span>`).join('')}</div>` : ''}

    <h2>What this entry means</h2>
    <p>This entry records a failure to document the day as required, by 10 PM Eastern. It is not a
    consequence for the weight: a gain, a plateau, or a bad month breaches nothing. Only the
    documentation can be failed.</p>
    <p>${v.state === 'resolved'
      ? 'The corrective requirement has been completed and verified by the Accountability Partner, which closes the obligation. It does not remove this entry — the entry is permanent.'
      : v.state === 'corrected'
        ? 'A corrective session has been submitted, which resolves the entry on the record. The Accountability Partner reviews the published posting and may overrule — reopening the entry — if it fails the standard.'
        : 'No corrective session has been submitted against this entry yet. It remains open, and the site states so on every page until it is answered.'}</p>
    <p>The standard the correction has to meet is set out on <a href="/corner-time/">the corrective
    session page</a>. The full terms are in <a href="/agreement">§8 of the signed agreement</a>.</p>

    <p><a href="/daily/${v.date}-day-${String(v.day).padStart(3, '0')}/">The record for Day ${v.day} →</a></p>

    <nav aria-label="Violation navigation" style="display:flex;justify-content:space-between;gap:16px;margin:36px 0 12px;font:600 14px 'IBM Plex Mono',ui-monospace,monospace">
      ${prev ? `<a rel="prev" href="/violations/${prev.slug}/">← ${prev.id}</a>` : '<span></span>'}
      <a href="/penalties">All entries</a>
      ${next ? `<a rel="next" href="/violations/${next.slug}/">${next.id} →</a>` : '<span></span>'}
    </nav>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

/* V-000 — the specimen entry. A permanent demonstration page showing exactly
   what a violation entry looks like and how its status flow works. It answers
   no violation: the log proper starts at V-001. */
function specimenPage(demoUrl) {
  const canonical = `${SITE_ORIGIN}/violations/v-000/`;
  const title = 'V-000 — Demonstration Entry — Micheal Ray Berry Public Accountability Project';
  const description =
    'A specimen violation entry: what a permanent entry on the Micheal Ray Berry ' +
    'Public Accountability Project record looks like, and how its status flow works. ' +
    'This entry answers no violation.';
  const embed = videoEmbed(demoUrl);
  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Violations', item: `${SITE_ORIGIN}/penalties` },
      { '@type': 'ListItem', position: 3, name: 'V-000 (demonstration)', item: canonical },
    ] },
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .vstate{display:inline-block;font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;border:1px solid currentColor;padding:7px 10px}
    .vstate.open{color:var(--accent)}
    .vstate.corrected{color:#8A6A1E}
    .vstate.resolved{color:#3A6B3A}
    .vtable{border:1px solid var(--ink);margin:22px 0}
    .vtable div{display:grid;grid-template-columns:210px 1fr;border-bottom:1px solid var(--rule)}
    .vtable div:last-child{border-bottom:none}
    .vtable b{padding:14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)}
    .vtable p{padding:14px;margin:0;line-height:1.6}
    @media(max-width:560px){.vtable div{grid-template-columns:1fr}.vtable b{border-right:none;border-bottom:1px solid var(--rule)}}
    .flow{display:flex;flex-direction:column;gap:14px;border:1px solid var(--ink);padding:20px;margin:22px 0}
    .flow-row{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
    .flow-row p{margin:0;line-height:1.6;flex:1;min-width:240px}
    .vrec{width:100%;max-width:540px;background:#141412;display:block;margin:16px 0}
    .vrec-yt{aspect-ratio:9/16;border:0}
  </style>
</head>
<body>
  <div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
  <header>
    <div class="eyebrow">Demonstration — not a violation</div>
    <h1>V-000</h1>
    <p>The specimen entry: what a permanent violation entry looks like, and how its status flow works.</p>
  </header>
  <main>
    <p class="lede"><strong>No requirement was missed here.</strong> V-000 exists so that anyone reading
    the record can see the exact format a real entry takes before one exists. The log proper starts at
    <a href="/penalties">V-001</a>, and every real entry is permanent.</p>

    <div class="vtable">
      <div><b>Date</b><p>${longDate(START_DATE)} · Day 1 — a real entry carries the date of the missed requirement.</p></div>
      <div><b>Requirement missed</b><p>None — a real entry names the failed item verbatim: the missed inspection video, photo set, weight entry, or tracker update.</p></div>
      <div><b>Status</b><p>Specimen — a real entry is always one of the three states walked through below.</p></div>
      <div><b>Submitted</b><p>— the timestamp at which the corrective session was filed.</p></div>
      <div><b>Resolved</b><p>— the date the Accountability Partner verified the correction.</p></div>
      <div><b>AP verification</b><p>— his written result: verified, incomplete, or requiring repetition.</p></div>
    </div>

    <h2>The three states of a real entry</h2>
    <div class="flow">
      <div class="flow-row"><span class="vstate open">Open</span><p>The 10 PM check found a requirement missing and entered it automatically — declared from the record, not by anyone's judgment. The site carries a factual notice on every page while the entry is open, and the corrective session is due within 72 hours.</p></div>
      <div class="flow-row"><span class="vstate corrected">Corrected</span><p>The corrective session — corner time, 10 / 20 / 30 minutes by level — has been recorded in one unbroken take and submitted. Submission resolves the entry; this state only appears while the filing is in flight.</p></div>
      <div class="flow-row"><span class="vstate resolved">Resolved</span><p>Submitting the recorded session resolves the entry — the published YouTube posting is the evidence. The Accountability Partner reviews it and may overrule, reopening the entry, if it fails the standard. The entry, and the published recording beside it, remain permanently.</p></div>
    </div>

    <h2>The corrective standard, demonstrated</h2>
    <p>What the corner-time position and standard look like. <strong>This is an explainer, not a
    corrective session</strong> — it answers no violation and is filed against no entry.</p>
    ${embed
      ? `<iframe class="vrec vrec-yt" src="${embed}" title="Corrective session standard — demonstration" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
      : `<video class="vrec" src="${demoUrl}" controls preload="metadata" playsinline></video>`}
    <p>The full standard is on <a href="/corner-time/">the corrective sessions page</a>; the terms are
    in <a href="/agreement">§8 of the signed agreement</a>. Every confirmed failure gets an entry in
    <a href="/penalties">the violation log</a> in exactly this format — permanently.</p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-bottom"><span>© 2026 Micheal Ray Berry · <a href="/">michealrayberry.com</a></span></div>
  </div></div>
</body>
</html>
`;
}

function positionsPage(entries) {
  const canonical = `${SITE_ORIGIN}/positions/`;
  const title = 'Inspection Standard — Micheal Ray Berry Public Accountability Project';
  const description =
    'The documentation standard for the Micheal Ray Berry Public Accountability Project: Wait, then ' +
    'four fixed views — front, left, rear, right — with the posture, framing, and visibility each requires.';

  // Reference frames come from the most recent complete day, so the page shows
  // the standard as it is currently met rather than an idealised illustration.
  const ref = entries.at(-1) || null;

  const VIEWS = [
    ['wait', 'Wait', 'Upright and squared to the camera, feet together, hands behind the back, head level, eyes forward.',
      'Every session opens and closes here. At the opening it is held while the day, date, recorded weight, and verification information are established on the record; after the four views are complete the participant returns to it while the session is closed. It files no progress photograph — it gives every recording a defined beginning and end, and a stationary identifiable frame before and after the sequence.'],
    ['front', 'Front', 'Squared to the camera, feet at the established inspection width, hands behind the head, head level, face fully visible.',
      'The primary front reference frame. Hands behind the head keep the torso unobstructed and prevent the arms being used to materially alter the silhouette.'],
    ['left', 'Left', 'A turn to the left from Front. Same stance, posture, camera distance, and hand position.',
      'The camera does not move. The side profile records changes in body depth and shape that cannot be evaluated as clearly from the front view alone.'],
    ['rear', 'Rear', 'Turned to face directly away. Established stance, hands behind the head, framing unchanged.',
      'The complete body remains visible from head to shoes.'],
    ['right', 'Right', 'A turn to the right, presenting the opposite profile with the posture and framing required for Left.',
      'Both profiles are required. Recording each side makes differences in stance or body shape visible rather than allowing one preferred profile to substitute for the other.'],
  ];

  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Inspection Standard', item: canonical },
      ],
    },
  ];

  const INVALIDATES = [
    'Any required part of the body outside the frame',
    'Face obscured during a required identification view',
    'Incorrect position, or hands not in the required position',
    'Arms obstructing the torso during an inspection view',
    'Materially different camera height or distance',
    'Camera movement between required views',
    'Altered or noncompliant attire',
    'Leaning, twisting, flexing, compressing, or another posture that materially changes the silhouette',
    'Failure to present one of the four required views',
    'A verification failure that prevents the recording being tied to the day\u2019s record',
  ];

  const SPEC = [
    ['Inspection posture', 'Upright, weight distributed evenly, feet at the established inspection width, hands behind the head. This keeps the torso visible, moves the arms away from the sides of the body, and reduces the ability to change the apparent silhouette through arm placement. The posture is held naturally and consistently: no deliberate flexing, compressing, twisting, or leaning for the photograph.'],
    ['Wait posture', 'Separate from the four photographic positions. Feet together, hands behind the back, body upright and squared to the camera, head level, eyes forward. Performed at both the opening and closing of every inspection recording. No progress photograph is filed from Wait.'],
    ['Head and identity', 'The head remains level. During the Front view and both Wait positions the face must be completely visible — identity must be apparent from the recorded image itself rather than from a filename, caption, or accompanying text. Hair, clothing, hands, or other objects may not materially obscure the face.'],
    ['Camera', 'A consistent height and distance, portrait orientation, the complete body visible from head to shoes. The camera remains stationary throughout: <strong>the participant turns, the camera does not.</strong> Zoom, height, framing, and distance stay substantially consistent from one daily record to the next.'],
    ['Attire', 'The designated project uniform, worn for every inspection: a plain black full-body unitard, consistent black shoes, and a plain black collar. Intentionally simple and standardized so clothing cannot materially alter the appearance of the body between records. See <a href="/uniform">the uniform standard</a>.'],
    ['Photographs', 'Four are produced from each compliant inspection — front, left, rear, and right. Wait is recorded on video but files no progress photograph. Each is taken from the required position rather than selected afterwards according to which image is most favourable.'],
    ['Verification', 'The verification code is issued immediately before the recording and appears as part of the recorded evidence. The required positions are checked while they are presented. The Accountability Partner reviews the submitted record for identity, attire, framing, required views, and completeness before accepting it as compliant.'],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .seq{border:1px solid var(--ink);background:var(--paper);padding:18px 20px;margin:22px 0;display:flex;flex-direction:column;gap:8px}
    .seq b{font:700 17px/1.3 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .seq p{margin:0;font-size:14px;line-height:1.6;color:#3A3935}
    .views{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:20px;margin:20px 0 10px}
    .view{border:1px solid var(--ink);display:flex;flex-direction:column;background:var(--paper)}
    .view img{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;border-bottom:1px solid var(--ink)}
    .view .ph{width:100%;aspect-ratio:9/16;background:repeating-linear-gradient(45deg,#f6f5f1,#f6f5f1 10px,#eeece6 10px,#eeece6 20px);border-bottom:1px solid var(--ink);display:flex;align-items:center;justify-content:center;font:600 10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#8A8983;text-align:center;padding:0 14px}
    .view .body{padding:14px 15px;display:flex;flex-direction:column;gap:7px}
    .view b{font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
    .view .req{font-size:14px;line-height:1.55;font-weight:600}
    .view p{margin:0;font-size:13.5px;line-height:1.6;color:#3A3935}
    .spec{border:1px solid var(--ink);margin:20px 0}
    .spec div{display:grid;grid-template-columns:170px 1fr;border-bottom:1px solid var(--rule)}
    .spec div:last-child{border-bottom:none}
    .spec b{padding:15px 14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--accent)}
    .spec p{padding:15px 14px;margin:0;line-height:1.6}
    @media(max-width:560px){.spec div{grid-template-columns:1fr}.spec b{border-right:none;border-bottom:1px solid var(--rule);padding-bottom:12px}}
    .invalid{margin:16px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:7px;font-size:15px;line-height:1.55}
  </style>
</head>
<body>
  <div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
  <header>
    <div class="eyebrow">The documentation standard</div>
    <h1>Inspection Standard</h1>
    <p>Wait, then four fixed views, recorded the same way every day.</p>
  </header>
  <main>
    <div class="viewsw"><a href="/positions/" aria-current="page">Inspection</a><a href="/uniform">Uniform</a></div>
    <p class="lede"><strong>The positions are fixed so that changes in posture, clothing, framing, or
    concealment cannot materially alter the visual record from one day to the next.</strong></p>

    <p>A photograph taken from a different angle, at a different distance, or with a different posture
    is not directly comparable to the one taken before it. This standard minimises those variables:
    every daily record uses the same sequence, the same attire, the same camera position, and the
    same four views. The purpose is to make the presentation as constant as possible, so that the
    body is what changes.</p>

    <div class="seq">
      <b>WAIT → FRONT → LEFT → REAR → RIGHT → WAIT</b>
      <p>The camera remains fixed. The participant changes position. Wait opens and closes the
      recording; the four inspection views produce the daily photographic record.</p>
    </div>

    <h2>The positions</h2>
    <div class="views">
      ${VIEWS.map(([angle, label, req, note]) => {
        const photo = ref && ref.photos && ref.photos[angle];
        const img = photo
          ? `<img src="${photo.variants?.[0]?.url || photo.sourceUrl}" alt="Micheal Ray Berry ${label.toLowerCase()} position, inspection standard — Day ${ref.record.day}" loading="lazy">`
          : `<div class="ph">${angle === 'wait' ? 'Wait is recorded on video only<br>no photograph is filed from it' : label + ' reference<br>frame pending'}</div>`;
        return `<figure class="view">${img}<div class="body"><b>${label}</b><span class="req">${req}</span><p>${note}</p></div></figure>`;
      }).join('')}
    </div>
    ${ref ? `<p><small>Reference frames from Day ${ref.record.day}, ${htmlEscape(longDate(ref.record.date))} — the most recent complete record. <a href="/daily/${ref.record.date}-day-${String(ref.record.day).padStart(3, '0')}/">View that day</a>.</small></p>` : ''}

    <h2>Specification</h2>
    <div class="spec">
      ${SPEC.map(([k, v]) => `<div><b>${k}</b><p>${v}</p></div>`).join('')}
    </div>

    <h2>What invalidates a view</h2>
    <p>A photograph or recorded view does not meet the standard when the comparison or the
    verification has been materially compromised. For example:</p>
    <ul class="invalid">${INVALIDATES.map((x) => `<li>${x}</li>`).join('')}</ul>
    <p><strong>A view that fails the standard is recorded again rather than filed.</strong> The
    objective is not to produce the most favourable photograph. It is to produce the required
    photograph.</p>

    <h2>Why it is specified</h2>
    <p>Longitudinal photography is useful only when the method that produced it stays reasonably
    constant. Progress photographs taken weeks or months apart typically differ in clothing, camera
    distance, pose, framing, and angle — so the difference between them is partly the body and partly
    the staging, with no way to tell how much of each.</p>
    <p>This record takes the opposite approach: daily, in the same uniform, from a consistent camera
    position, using the same sequence and the same four views. Any two of its days can be placed
    side by side and compared on substantially the same terms. That is why a frame which fails the
    specification is recorded again rather than kept simply because a photograph was taken.</p>

    <h2>Inspection is not correction</h2>
    <p>These positions produce the daily documentation record. They are separate from the posture
    required during a <a href="/corner-time/">corrective session</a>, which is governed by its own
    standard and applies only after a documented violation. Inspection positions document the day;
    corrective positions address a documented failure.</p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function cornerTimePage(entries, violations, demoUrl) {
  const canonical = `${SITE_ORIGIN}/corner-time/`;
  const title = 'Corrective Sessions — Micheal Ray Berry Public Accountability Project';
  const description =
    'The corrective session is the requirement that answers a documented failure in the ' +
    'Micheal Ray Berry Public Accountability Project: 10, 20, or 30 minutes by level, recorded ' +
    'in one unbroken take and published beside the entry that caused it.';

  const sessions = (violations || []).filter((v) => /^https?:/.test(v.recording || ''));
  const demo = demoUrl || 'https://pub-944fe11d344847f68307fb252477ba11.r2.dev/corner%20time/PXL_20251116_175931189~3%20(1).mp4';

  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      /* The demonstration is marked as such in the schema too, so a video
         result can never present an explainer as a served consequence. */
      '@type': 'VideoObject',
      '@id': `${canonical}#demonstration`,
      name: 'Corrective session — demonstration of the required position and standard',
      description:
        'A demonstration of the corrective session position and standard used in the Micheal Ray Berry ' +
        'Public Accountability Project. This is an explainer, not a corrective session: it answers ' +
        'no violation and is filed against no entry.',
      contentUrl: demo,
      embedUrl: canonical,
      encodingFormat: 'video/mp4',
      uploadDate: '2025-11-16',
      publisher: { '@id': `${SITE_ORIGIN}/#website` },
      isFamilyFriendly: true,
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Corrective Sessions', item: canonical },
      ],
    },
  ];

  const levels = [
    ['Level One', 'First confirmed Violation Event', '10 minutes'],
    ['Level Two', 'Second confirmed Violation Event', '20 minutes'],
    ['Level Three and after', 'Third and every later Violation Event', '30 minutes'],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .lede{font-size:17px;line-height:1.6;border-left:3px solid var(--accent);padding-left:16px;margin:0 0 18px}
    .levels{width:100%;border-collapse:collapse;margin:18px 0 8px;font-size:15px}
    .levels th{text-align:left;background:var(--ink);color:var(--paper);font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;padding:9px 12px}
    .levels td{padding:11px 12px;border-bottom:1px solid var(--rule)}
    .levels td:last-child{font-family:'IBM Plex Mono',ui-monospace,monospace;white-space:nowrap}
    .demo{max-width:300px;aspect-ratio:9/16;background:var(--ink);border:1px solid var(--ink);display:block}
    .standard{border:1px solid var(--ink);padding:0;margin:20px 0}
    .standard div{display:grid;grid-template-columns:86px 1fr;border-bottom:1px solid var(--rule)}
    .standard div:last-child{border-bottom:none}
    .standard b{padding:16px 14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--accent)}
    .standard p{padding:16px 14px;margin:0;line-height:1.6}
    .sessions{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
    .sessions a{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;border:1px solid var(--rule);padding:13px 15px;text-decoration:none}
    .sessions a:hover{border-color:var(--ink)}
    .sessions span:last-child{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
  <div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>
  <header>
    <div class="eyebrow">The corrective requirement</div>
    <h1>Corrective Sessions</h1>
    <p>What answers a documented failure, what the standard is, and every session on the record.</p>
  </header>
  <main>
    <p class="lede"><strong>A corrective session answers one thing: a failure to document the day
    as required, by ten PM Eastern.</strong> It is not a punishment for the weight. A gain, a plateau,
    or a bad month breaches nothing in this agreement and carries no consequence at all.</p>
    <p>Every confirmed Violation Event is answered this way, and the requirement is set by the
    Accountability Partner against the project's standards — not against anything outside them.</p>

    <p>The duration follows the accumulated count of confirmed violations, so a second failure costs
    more than a first and a third costs more than a second.</p>

    <table class="levels">
      <thead><tr><th>Level</th><th>Assigned when</th><th>Duration</th></tr></thead>
      <tbody>${levels.map(([l, w, d]) => `<tr><td>${l}</td><td>${w}</td><td>${d}</td></tr>`).join('')}</tbody>
    </table>

    <h2>The standard</h2>
    <div class="standard">
      <div><b>Position</b><p>Facing the designated corner or wall, standing upright, hands behind the head, feet shoulder-width apart, substantially still for the whole period. No phone, entertainment, reading, or unrelated activity.</p></div>
      <div><b>Uniform</b><p>The project uniform — black unitard, plain black shoes, and the collar — the same standard as a daily inspection.</p></div>
      <div><b>Timer</b><p>Begins only once the required position is established — not when the recording starts. Time spent getting into position does not count toward the assigned period.</p></div>
      <div><b>Recording</b><p>One continuous, unedited take, fully AI-voiced. The participant does not speak. A verification code issued by the record seconds before capture is burned into every frame, so the footage cannot be older than it claims.</p></div>
      <div><b>Invalidation</b><p>Leaving the position, materially changing posture, or ending early invalidates the attempt. The full period is completed again from zero — a shortened session counts for nothing.</p></div>
      <div><b>Deadline</b><p>The session must be completed, recorded, and filed within 72 hours of the violation notice. The Accountability Partner cannot extend or waive this except under a documented §9 exception; missing it is itself a new violation at the next level.</p></div>
      <div><b>Verification</b><p>Submitting the session resolves the entry — the public posting is the evidence. The Accountability Partner reviews it against the written standard — identity, attire, elapsed time, and an unbroken take — and may overrule only on that standard, with a stated reason.</p></div>
    </div>

    <h2>Demonstration</h2>
    <p>What the position and the standard look like. <strong>This is an explainer, not a corrective
    session</strong> — it answers no violation and is filed against no entry.</p>
    <video class="demo" src="${demo}" controls preload="metadata" playsinline></video>

    <h2>Why it is published</h2>
    <p>The recording is published beside the entry that caused it, and it stays there. Completing a
    corrective requirement closes the obligation; it does not remove the recording, and neither does
    resolution of the entry.</p>
    <p>The reasoning is the same as for the daily record itself. Every previous attempt at this ended
    quietly, because quitting cost nothing and nobody knew there had been a plan. A consequence
    nobody can see is one that would eventually be discounted too.</p>
    <p>All published material is safe for work and non-sexual: the participant is fully covered in
    the project uniform throughout. Verification photographs are held privately and are not
    published.</p>
    <p>The full terms are in <a href="/agreement">§8.2 and §8.6 of the signed agreement</a>.</p>

    <h2>Sessions on the record</h2>
    ${sessions.length
      ? `<ul class="sessions">${sessions.map((v) => `<li><a href="/violations/${v.slug}/"><span>${v.id} — ${htmlEscape(longDate(v.date))}</span><span>View session →</span></a></li>`).join('')}</ul>`
      : `<p>No corrective session has been recorded yet. Any session, once recorded, is listed here
        permanently and linked from the entry that required it. The
        <a href="/penalties">violation log</a> shows every confirmed failure and its status.</p>`}
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener" title="Every published version of this record, timestamped — the site cannot be quietly rewritten">Site History</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function violationSitemap(violations) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/violations/v-000/</loc>
    <lastmod>${START_DATE}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
${violations.map((v) => `  <url>
    <loc>${SITE_ORIGIN}/violations/${v.slug}/</loc>
    <lastmod>${v.resolved || v.submitted || v.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function dailySitemap(records) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${records.map((r) => `  <url><loc>${SITE_ORIGIN}/daily/${r.date}-day-${String(r.day).padStart(3, '0')}/</loc><lastmod>${r.date}</lastmod><changefreq>never</changefreq><priority>0.8</priority></url>`).join('\n')}
</urlset>
`;
}

function imageSitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.map(({ record, photos }) => `  <url>
    <loc>${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/</loc>
${Object.entries(photos).map(([angle, p]) => `    <image:image><image:loc>${xmlEscape(p.sourceUrl)}</image:loc><image:title>${xmlEscape(`Micheal Ray Berry Day ${record.day} ${imageLabel(angle)}`)}</image:title><image:caption>${xmlEscape(`Micheal Ray Berry ${imageLabel(angle)} accountability photograph on ${longDate(record.date)}, at ${record.weight.toFixed(1)} pounds.`)}</image:caption></image:image>`).join('\n')}
  </url>`).join('\n')}
</urlset>
`;
}

function videoSitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries.map(({ record, photos }) => {
  const embed = videoEmbed(record.video);
  return `  <url>
    <loc>${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/</loc>
    <video:video>
      <video:thumbnail_loc>${xmlEscape(photos.front.sourceUrl)}</video:thumbnail_loc>
      <video:title>${xmlEscape(`Micheal Ray Berry Day ${record.day} daily inspection video`)}</video:title>
      <video:description>${xmlEscape(`Four-angle daily inspection video for Day ${record.day} of the Micheal Ray Berry Public Accountability Project at ${record.weight.toFixed(1)} pounds.`)}</video:description>
      ${isSelfHosted(record.video) || !embed
        ? `<video:content_loc>${xmlEscape(record.video)}</video:content_loc>`
        : `<video:player_loc allow_embed="yes">${xmlEscape(embed)}</video:player_loc>`}
      <video:publication_date>${record.date}T22:00:00-04:00</video:publication_date>
    </video:video>
  </url>`;
}).join('\n')}
</urlset>
`;
}

function extraSitemap(urls, latestDate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(urls)].map((u) => `  <url><loc>${xmlEscape(u)}</loc><lastmod>${latestDate}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join('\n')}
</urlset>
`;
}

function sitemapIndex(latestDate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_ORIGIN}/sitemap-static.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-daily.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-violations.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-pages.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-images.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-videos.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
</sitemapindex>
`;
}

/* About and Agreement are authored once, inside index.html (the DC shell), and
   mirrored here as standalone, indexable static pages so crawlers and social
   cards get real content and per-page metadata. Same source, no drift: the DC
   template syntax is stripped and the inline-styled body wrapped in the site
   shell. The Agreement's dynamic amendment log (live on the SPA page) is
   dropped from the static copy. */
const SYN_CSS = `
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    a{color:var(--ink);text-underline-offset:3px}
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:400;font-size:11px;letter-spacing:.08em;color:var(--muted);padding:5px 9px}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    main{max-width:1160px;margin:auto;padding:0}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}.sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}.sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}.rec:hover{color:#FF6B61}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0}`;
const SYN_HEADER = `<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Collared · Under agreement · Savannah, Georgia</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary"><a href="/">Home</a><a href="/daily/">The Record</a><a href="/dashboard">Dashboard</a><a href="/penalties">Violations</a><a href="/milestones">Milestones</a><a class="ap" href="/partner">Local AP</a></span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/uniform">Uniform</a><a href="/agreement">Agreement</a><a href="/about">About</a><a href="/updates">Updates</a></span>
  </nav>
</div></div>`;
const SYN_FOOTER = `<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col"><span class="colhead">Official record</span><span class="links"><a href="https://michealrayberry.com">Website</a></span></div>
    </div>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Micheal Ray Berry: <a href="mailto:contact@michealrayberry.com">contact@michealrayberry.com</a></span></span>
      <span><a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
      <span><a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener">Site History</a></span>
    </div>
  </div></div>`;
function synExtract(full, startTag, endMarker) {
  const s = full.indexOf(startTag);
  const e = full.indexOf(endMarker, s);
  if (s === -1 || e === -1) throw new Error('synthetic-page markers not found: ' + startTag);
  return full.slice(s + startTag.length, e).replace(/\s*<\/div>\s*<\/sc-if>\s*$/, '');
}
function synClean(html) {
  return html
    .replace(/<sc-if value="\{\{ hasAmendments \}\}"[\s\S]*$/, '')
    .replace(/\s+onClick="\{\{[^}]*\}\}"/g, '')
    .replace(/\s+aria-current="\{\{[^}]*\}\}"/g, '')
    .replace(/\s+style-hover="[^"]*"/g, '')
    .replace(/\s+style-active="[^"]*"/g, '')
    .replace(/ data-photo-src=/g, ' src=')
    .replace(/\{\{[^}]*\}\}/g, '');
}
function synPage({ title, desc, canonical, body }) {
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description: desc, about: { '@id': `${SITE_ORIGIN}/#micheal-ray-berry` }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: title.split(' \u2014 ')[0], item: canonical } ] } ] });
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(desc)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry \u2014 Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Micheal Ray Berry \u2014 Public Accountability Project">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(desc)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png">
  <script type="application/ld+json">${schema}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${SYN_CSS}</style>
</head>
<body>
${SYN_HEADER}
<main>
${body}
</main>
${SYN_FOOTER}
</body>
</html>`;
}
async function buildSyntheticPages() {
  const full = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  return [
    ['about', synPage({
      title: 'About the Project \u2014 Micheal Ray Berry',
      desc: 'Why this public accountability project exists, how it is administered by an independent Accountability Partner, and the documentation standard behind the record.',
      canonical: `${SITE_ORIGIN}/about`,
      body: synClean(synExtract(full, '<div data-screen-label="About">', '<!-- ==================== AGREEMENT')),
    })],
    ['agreement', synPage({
      title: 'The Signed Accountability Agreement \u2014 Micheal Ray Berry',
      desc: 'The full public text of the signed Public Accountability Agreement: daily requirements, documentation standard, weigh-ins, violations, corrective sessions, and record permanence.',
      canonical: `${SITE_ORIGIN}/agreement`,
      body: synClean(synExtract(full, '<div data-screen-label="Agreement">', '<!-- ==================== PENALTIES')),
    })],
  ];
}

async function main() {
  const [csv, attestCsv, violationCsv, siteStateCsv, healthCsv] = await Promise.all([
    fetchText(SHEET_CSV, true),
    fetchText(ATTEST_CSV, true),
    fetchText(VIOLATION_CSV, true),
    fetchText(SITE_STATE_CSV, true),
    fetchText(HEALTH_CSV, true),
  ]);
  if (!csv) {
    // Sheet unreachable (not shared, or Google hiccuping). Publishing new
    // day pages is skipped; the existing site deploys untouched.
    console.warn('Record sheet unreadable — skipping page generation this build.');
    console.warn('Fix: Share > General access > Anyone with the link > Viewer.');
    return;
  }
  const violations = (violationCsv ? parseCSV(violationCsv).slice(1) : [])
    .map((r, i) => {
      const date = normalizeDate(r[0]);
      const num = String(i + 1).padStart(3, '0');
      return {
        n: i + 1,
        id: 'V-' + num,
        slug: 'v-' + num,
        date,
        day: dayNumber(date),
        what: violationText(r[1]),
        state: violationState(r[2]),
        submitted: String(r[3] || '').trim(),
        resolved: String(r[4] || '').trim(),
        verification: String(r[5] || '').trim(),
        corrections: String(r[6] || '').split(';').map((x) => x.trim()).filter(Boolean),
        recording: String(r[7] || '').trim(),
      };
    })
    .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.date) && v.what);

  // Site State key/value pairs — the demo recording URL lives here (ytfiled).
  const siteState = {};
  if (siteStateCsv) {
    for (const r of parseCSV(siteStateCsv).slice(1)) {
      if (r[0]) siteState[String(r[0]).trim()] = String(r[1] || '').trim();
    }
  }
  const demoUrl = /^https?:/.test(siteState.demo_video_url || '')
    ? siteState.demo_video_url
    : 'https://pub-944fe11d344847f68307fb252477ba11.r2.dev/corner%20time/PXL_20251116_175931189~3%20(1).mp4';

  /* Health tab: device-synced daily activity. gviz falls back to the FIRST
     sheet when the named tab is missing, so only parse when the header really
     is the Health tab's. */
  const healthMap = new Map();
  if (healthCsv) {
    const hrows = parseCSV(healthCsv);
    const hhead = (hrows[0] || []).map((v) => String(v).toLowerCase());
    if (hhead[1] === 'steps' && String(hhead[2] || '').startsWith('zone')) {
      for (const r of hrows.slice(1)) {
        const d = normalizeDate(r[0]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const a = { steps: parseFloat(r[1]) || 0, zone: parseFloat(r[2]) || 0, mi: parseFloat(r[5]) || 0, cal: parseFloat(r[6]) || 0 };
        if (a.steps || a.zone || a.mi || a.cal) healthMap.set(d, a);
      }
    }
  }

  const rows = parseCSV(csv);
  const records = rows.slice(1).map((r) => ({
    date: normalizeDate(r[0]),
    weight: Number.parseFloat(r[1]),
    note: String(r[2] || '').trim(),
    video: String(r[7] || '').trim(),
  })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.weight))
    .map((r) => ({ ...r, day: dayNumber(r.date) }))
    .filter((r) => r.day >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const attestMap = new Map();
  if (attestCsv) {
    const arows = parseCSV(attestCsv);
    const head = (arows[0] || []).map((v) => String(v).toLowerCase());
    if (head.includes('event') && head.includes('code')) {
      const eventCol = head.indexOf('event');
      const codeCol = head.indexOf('code');
      const statusCol = head.indexOf('status');
      const dateCol = head.findIndex((h) => h === 'date' || h.includes('project date'));
      for (const row of arows.slice(1)) {
        const date = normalizeDate(row[dateCol >= 0 ? dateCol : 1]);
        if (row[eventCol] === 'capture-attested' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          attestMap.set(date, [row[codeCol], statusCol >= 0 ? row[statusCol] : ''].filter(Boolean).join(' · '));
        }
      }
    }
  }

  const photoFiles = (await walk(path.join(ROOT, 'photos')))
    .filter((f) => /\.(?:jpe?g|png|webp)$/i.test(f) && !f.includes(`${path.sep}responsive${path.sep}`));
  const finalized = [];
  for (const record of records) {
    if (!record.video) continue;
    const photoPaths = {};
    for (const angle of ['front', 'left', 'rear', 'right']) {
      photoPaths[angle] = findPhoto(photoFiles, record.date, record.day, angle);
    }
    if (Object.values(photoPaths).some((p) => !p)) continue;
    finalized.push({ record, photoPaths });
  }

  /* Every Project Day from 1 to the latest documented one, in order — days
     with a complete packet and days without. The chain is built over this
     list, so prev/next is continuous and a crawler never sees Day 10 link
     straight to Day 13. */
  const todayIso = new Date().toISOString().slice(0, 10);
  const lastDay = Math.max(
    finalized.at(-1)?.record.day || 0,
    ...records.map((r) => r.day || 0),
    dayNumber(todayIso),
  );
  const byDay = new Map(finalized.map((f) => [f.record.day, f]));
  const rowByDay = new Map(records.map((r) => [r.day, r]));
  const sequence = [];
  for (let d = 1; d <= lastDay; d++) {
    const done = byDay.get(d);
    if (done) { sequence.push({ day: d, date: done.record.date, complete: true, entry: done }); continue; }
    const row = rowByDay.get(d);
    const date = row ? row.date : dateForDay(d);
    // Say precisely what is absent — a missing video reads differently from
    // a day with nothing filed at all.
    const have = [];
    const missing = [];
    (row && row.weight ? have : missing).push('the recorded weight');
    (row && row.video ? have : missing).push('the inspection video');
    const photoCount = ['front', 'left', 'rear', 'right']
      .filter((a) => findPhoto(photoFiles, row ? row.date : dateForDay(d), d, a)).length;
    (photoCount === 4 ? have : missing).push(photoCount ? photoCount + ' of the four accountability photographs' : 'the four accountability photographs');
    const reason = have.length
      ? 'The record for this Project Day is incomplete. Filed: ' + have.join(', ') + '. Not filed: ' + missing.join(', ') + '.'
      : 'None of the required daily documentation was filed for this Project Day.';
    sequence.push({ day: d, date, complete: false, kind: have.length ? 'incomplete' : 'none', reason });
  }

  const generated = [];
  const changedUrls = new Set();
  for (let i = 0; i < finalized.length; i++) {
    const { record, photoPaths } = finalized[i];
    const photos = {};
    for (const [angle, source] of Object.entries(photoPaths)) {
      photos[angle] = await generateResponsive(source, record.date, angle, record.day);
      photos[angle].changedUrls.forEach((u) => changedUrls.add(u));
    }
    const pos = sequence.findIndex((s) => s.day === record.day);
    const previous = pos > 0 ? sequence[pos - 1] : null;
    const next = pos >= 0 && pos < sequence.length - 1 ? sequence[pos + 1] : null;
    const pageDir = path.join(ROOT, 'daily', `${record.date}-day-${String(record.day).padStart(3, '0')}`);
    const pageFile = path.join(pageDir, 'index.html');
    const page = dailyPage({ record, photos, previous, next, attestation: attestMap.get(record.date) || '', health: healthMap.get(record.date) || null });
    if (await writeIfChanged(pageFile, page)) changedUrls.add(`${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`);

    const manifest = {
      schema: 'https://michealrayberry.com/schemas/daily-record-manifest-v1.json',
      person: { name: 'Micheal Ray Berry', id: PERSON_ID },
      project: {
        name: 'Micheal Ray Berry Public Accountability Project',
        start_date: START_DATE,
        start_weight_lb: START_WEIGHT,
        goal_weight_lb: GOAL_WEIGHT,
      },
      record: {
        date: record.date,
        day: record.day,
        weight_lb: record.weight,
        note: record.note,
        video_url: record.video,
        canonical_url: `${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`,
        attestation: attestMap.get(record.date) || null,
        activity: healthMap.get(record.date) || null,
      },
      photos: Object.fromEntries(Object.entries(photos).map(([angle, p]) => [angle, {
        url: p.sourceUrl,
        width: p.width,
        height: p.height,
        sha256: p.sourceSha256,
        responsive: p.variants.map((v) => ({
          url: v.url, width: v.width, height: v.height, bytes: v.bytes, sha256: v.sha256,
        })),
      }])),
    };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    const manifestFile = path.join(ROOT, 'manifests', `${record.date}.json`);
    if (await writeIfChanged(manifestFile, manifestText)) changedUrls.add(`${SITE_ORIGIN}/manifests/${record.date}.json`);
    const manifestHash = sha256(Buffer.from(manifestText));
    await writeIfChanged(path.join(ROOT, 'manifests', `${record.date}.sha256`), `${manifestHash}  ${record.date}.json\n`);
    generated.push({ record, photos });
  }

  for (let i = 0; i < sequence.length; i++) {
    const s = sequence[i];
    if (s.complete) continue;
    // An in-progress day gets no "no record" page — nothing has been missed yet.
    if (s.kind !== 'incomplete' && deadlinePending(s.date)) continue;
    const slug = `${s.date}-day-${String(s.day).padStart(3, '0')}`;
    const file = path.join(ROOT, 'daily', slug, 'index.html');
    const page = noRecordPage({
      date: s.date, day: s.day, reason: s.reason, kind: s.kind || 'none',
      previous: i > 0 ? sequence[i - 1] : null,
      next: i < sequence.length - 1 ? sequence[i + 1] : null,
    });
    if (await writeIfChanged(file, page)) changedUrls.add(`${SITE_ORIGIN}/daily/${slug}/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'daily', 'index.html'), dailyIndexPage(generated, new Map(sequence.filter((s) => !s.complete).map((s) => [s.date, s.kind || 'none']))))) {
    changedUrls.add(`${SITE_ORIGIN}/daily/`);
  }

  const extraUrls = [];
  for (const target of MILESTONES) {
    const file = path.join(ROOT, 'milestones', `${target}-lb`, 'index.html');
    if (await writeIfChanged(file, milestonePage(target, generated))) changedUrls.add(`${SITE_ORIGIN}/milestones/${target}-lb/`);
    extraUrls.push(`${SITE_ORIGIN}/milestones/${target}-lb/`);
  }
  const maxWeek = Math.ceil((generated.at(-1)?.record.day || 1) / 7);
  for (let w = 1; w <= maxWeek; w++) {
    const inWeek = generated.filter(({ record }) => Math.ceil(record.day / 7) === w);
    const file = path.join(ROOT, 'weeks', `week-${String(w).padStart(2, '0')}`, 'index.html');
    if (await writeIfChanged(file, weekPage(w, inWeek, generated, healthMap))) changedUrls.add(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
    extraUrls.push(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
  }
  if (await writeIfChanged(path.join(ROOT, 'weeks', 'index.html'), weeksIndexPage(generated))) changedUrls.add(`${SITE_ORIGIN}/weeks/`);

  for (let i = 0; i < violations.length; i++) {
    const v = violations[i];
    const page = violationPage(v, violations[i - 1] || null, violations[i + 1] || null);
    if (await writeIfChanged(path.join(ROOT, 'violations', v.slug, 'index.html'), page)) {
      changedUrls.add(`${SITE_ORIGIN}/violations/${v.slug}/`);
    }
  }
  if (violations.length) console.log('Violation entries published: ' + violations.length);

  if (await writeIfChanged(path.join(ROOT, 'violations', 'v-000', 'index.html'), specimenPage(demoUrl))) {
    changedUrls.add(`${SITE_ORIGIN}/violations/v-000/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'positions', 'index.html'), positionsPage(generated))) {
    changedUrls.add(`${SITE_ORIGIN}/positions/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'corner-time', 'index.html'), cornerTimePage(generated, violations, demoUrl))) {
    changedUrls.add(`${SITE_ORIGIN}/corner-time/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'consent', 'index.html'), consentPage())) {
    changedUrls.add(`${SITE_ORIGIN}/consent/`);
  }

  // Standalone, indexable About and Agreement pages, mirrored from index.html.
  for (const [slug, html] of await buildSyntheticPages()) {
    if (await writeIfChanged(path.join(ROOT, slug, 'index.html'), html)) changedUrls.add(`${SITE_ORIGIN}/${slug}`);
    extraUrls.push(`${SITE_ORIGIN}/${slug}`);
  }
  extraUrls.push(`${SITE_ORIGIN}/weeks/`);

  if (await writeIfChanged(path.join(ROOT, 'feed.xml'), rssFeed(generated))) {
    changedUrls.add(`${SITE_ORIGIN}/feed.xml`);
  }

  const latestDate = generated.at(-1)?.record.date || START_DATE;
  const sitemapFiles = [
    ['sitemap-static.xml', staticSitemap(latestDate)],
    ['sitemap-violations.xml', violationSitemap(violations)],
    ['sitemap-daily.xml', dailySitemap(sequence.map((s) => ({ date: s.date, day: s.day })))],
    ['sitemap-pages.xml', extraSitemap(extraUrls, latestDate)],
    ['sitemap-images.xml', imageSitemap(generated)],
    ['sitemap-videos.xml', videoSitemap(generated)],
    ['sitemap.xml', sitemapIndex(latestDate)],
  ];
  for (const [name, content] of sitemapFiles) {
    if (await writeIfChanged(path.join(ROOT, name), content)) changedUrls.add(`${SITE_ORIGIN}/${name}`);
  }

  await fs.writeFile(INDEXNOW_OUTPUT, JSON.stringify([...changedUrls].sort(), null, 2) + '\n');
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    await fs.appendFile(output, `page_count=${generated.length}\n`);
    await fs.appendFile(output, `latest_url=${generated.at(-1) ? `${SITE_ORIGIN}/daily/${generated.at(-1).record.date}-day-${String(generated.at(-1).record.day).padStart(3, '0')}/` : SITE_ORIGIN}\n`);
  }
  console.log(`Finalized records published: ${generated.length}`);
  console.log(`IndexNow candidate URLs: ${changedUrls.size}`);
}

// The publisher is additive: it only ever generates extra pages. A failure
// here must never block the deploy of the site itself.
main().catch((error) => {
  console.error('Publisher failed (site still deploys):', error);
});
