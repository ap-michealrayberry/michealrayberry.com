import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Netlify sets no workspace var; the build runs from the repo root.
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
const SHEET_CSV = process.env.WEIGHINS_CSV ||
  'https://docs.google.com/spreadsheets/d/1BKNAGZEchYs2P5ZoWql6Ct_4GTyAKJxUqEsXVsJyeDM/gviz/tq?tqx=out:csv&sheet=Weigh-ins';
const ATTEST_CSV = process.env.ATTESTATION_CSV ||
  'https://docs.google.com/spreadsheets/d/1BKNAGZEchYs2P5ZoWql6Ct_4GTyAKJxUqEsXVsJyeDM/gviz/tq?tqx=out:csv&sheet=Attestation';
const START_DATE = '2026-07-20';
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

/* Self-hosted video (Cloudflare R2, served from video.michealrayberry.com)
   is the preferred form: the video rich result then belongs to this domain
   rather than to a third-party player. YouTube and Drive links still render
   as embeds so older rows keep working. */
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

function dailyPage({ record, photos, previous, next, attestation }) {
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
      // Only accounts the project actually uses. Declaring a channel that
      // does not carry the record tells Google the canonical source is
      // somewhere it is not.
      sameAs: ['https://x.com/michealrayberry'],
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
      ...(isSelfHosted(video) ? { encodingFormat: 'video/mp4' } : {}),
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
  <style>
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main,footer{max-width:1120px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}.stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px ui-monospace,monospace}
    .intro{max-width:760px;font-size:1.15rem}.attest{border-left:4px solid var(--accent);padding:10px 14px;background:#f1f0ea}
    .gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:36px 0}.gallery figure{margin:0;border:1px solid var(--ink);background:#fff}
    .gallery img{display:block;width:100%;height:auto}.gallery figcaption{padding:10px 12px;font:12px/1.5 ui-monospace,monospace;text-transform:uppercase}
    .video{margin:24px 0;background:#000}.video video{display:block;width:100%;max-width:420px;height:auto;margin:auto}
    .video:has(iframe){position:relative;padding-top:56.25%}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    nav{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--rule);padding-top:24px;margin-top:36px}nav a:nth-child(2){text-align:center}nav a:last-child{text-align:right}
    .also{font:12px/1.8 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:12px 0 0}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:720px){.gallery{grid-template-columns:1fr}nav{grid-template-columns:1fr;text-align:left!important}nav a:nth-child(2),nav a:last-child{text-align:left}}
  </style>
</head>
<body>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Micheal Ray Berry — Day ${day}</h1>
  <div class="stats"><span>${htmlEscape(longDate(date))}</span><span>${weight.toFixed(1)} LB</span><span>340 → 175 LB</span></div>
</header>
<main>
  <p class="intro">This page permanently documents Day ${day} of the Micheal Ray Berry Public Accountability Project. On ${htmlEscape(longDate(date))}, the official recorded weight was ${weight.toFixed(1)} pounds. The four photographs below show the required front, left-side, rear, and right-side documentation views.</p>
  ${note ? `<p>${htmlEscape(note)}</p>` : ''}
  <p class="attest">${attestation ? `Capture attestation recorded: ${htmlEscape(attestation)}.` : 'The public photo and video record is preserved with this daily page and its GitHub manifest.'}</p>
  <section aria-labelledby="photos-heading"><h2 id="photos-heading">Daily accountability photographs</h2><div class="gallery">${figures}</div></section>
  <section aria-labelledby="video-heading"><h2 id="video-heading">Daily inspection video</h2>${videoHtml}</section>
  <p><a href="/manifests/${date}.json">View the machine-readable manifest and SHA-256 evidence hashes</a></p>
  ${nav}
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
</body>
</html>`;
}

/* The /daily/ index. Built from the same list that produced the day pages,
   so "documented" always means "a page exists" — the index can never claim a
   day is missing while its page sits published. Days between the start and
   the latest record with no page are shown as gaps, which is the point. */
const PAGE_CSS = `
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main,footer{max-width:1120px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    h2{font-size:1.5rem;margin:32px 0 8px}
    .intro{max-width:760px;font-size:1.1rem}
    .stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px ui-monospace,monospace;margin:.5rem 0}
    table{width:100%;border-collapse:collapse;margin:20px 0;font:14px ui-monospace,monospace}
    th{text-align:left;background:var(--ink);color:var(--paper);padding:8px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    td{padding:8px 10px;border-bottom:1px solid var(--rule)}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:24px 0}
    .gallery figure{margin:0;border:1px solid var(--ink);background:#fff}.gallery img{display:block;width:100%;height:auto}
    .gallery figcaption{padding:8px 10px;font:11px/1.5 ui-monospace,monospace;text-transform:uppercase}
    .pending{border-left:4px solid var(--accent);padding:12px 16px;background:#f1f0ea}
    nav.crumbs{font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
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
  <style>${PAGE_CSS}</style>
</head>
<body>
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
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
</body>
</html>`;
}

/* ── Weekly summary pages ─────────────────────────────────────────────
   Project weeks run Day 1–7, 8–14, and so on. Each page carries that
   week's weights, the net change, and every documented day, giving the
   archive a second navigable axis and a lot more indexable surface. */
function weekPage(week, weekEntries, allEntries) {
  const firstDay = (week - 1) * 7 + 1;
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
  <style>${PAGE_CSS}</style>
</head>
<body>
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / <a href="/weeks/">Weeks</a> / Week ${week}</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Week ${week}</h1>
  <div class="stats"><span>DAYS ${firstDay}–${firstDay + 6}</span><span>${htmlEscape(span)}</span>${weights.length > 1 ? `<span>${net <= 0 ? '−' : '+'}${Math.abs(net).toFixed(1)} LB</span>` : ''}</div>
</header>
<main>
  <p class="intro">${htmlEscape(description)}</p>
  ${rows ? `<table><thead><tr><th>Day</th><th>Date</th><th>Weight</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="pending">No documented days in this week.</div>'}
  <p>${nav}</p>
  <p><a href="/daily/">Full daily record</a> · <a href="/dashboard">Weigh-in log</a></p>
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
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
  <style>${PAGE_CSS}</style>
</head>
<body>
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / Weeks</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Weekly Record</h1>
</header>
<main>
  <p class="intro">Every project week, Day 1 onward. Each week page lists that week's documented days, recorded weights, and net change.</p>
  <table><thead><tr><th>Week</th><th>Days</th><th>Documented</th><th>Weight</th></tr></thead><tbody>${items.reverse().join('\n')}</tbody></table>
  <p><a href="/daily/">Full daily record</a> · <a href="/milestones">Milestones</a></p>
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
</body>
</html>`;
}

function dailyIndexPage(entries) {
  const byDate = new Map(entries.map((e) => [e.record.date, e]));
  const latest = entries.at(-1)?.record.date || START_DATE;
  const days = [];
  for (let d = new Date(`${START_DATE}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, day: dayNumber(iso), entry: byDate.get(iso) || null });
    if (iso >= latest) break;
  }
  days.reverse();
  const documented = days.filter((d) => d.entry).length;
  const gaps = days.length - documented;
  const canonical = `${SITE_ORIGIN}/daily/`;
  const title = 'Daily Record — Micheal Ray Berry Public Accountability Project';
  const description = `Every published day of the Micheal Ray Berry Public Accountability Project: ${documented} documented days with four-angle photographs, recorded weight, inspection video, and SHA-256 evidence manifests.`;
  const cards = days.map(({ date, day, entry }) => {
    const href = `/daily/${date}-day-${String(day).padStart(3, '0')}/`;
    if (!entry) {
      return `<li class="card gap"><div class="thumb"><span>NO RECORD</span></div>
        <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="flag">No record</span></div></li>`;
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
  <style>
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main,footer{max-width:1200px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    .intro{max-width:760px}.count{font:600 14px ui-monospace,monospace;letter-spacing:.08em}
    ul{list-style:none;padding:0;margin:28px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
    .card{border:1px solid var(--ink);background:#fff}.card a{display:block;color:inherit;text-decoration:none}
    .card img{display:block;width:100%;height:auto}
    .card .meta{display:flex;flex-direction:column;gap:2px;padding:10px 12px;font:12px/1.5 ui-monospace,monospace;text-transform:uppercase}
    .card .wt{font-weight:700}.card.gap{border-color:var(--accent)}
    .card .thumb{aspect-ratio:9/16;background:repeating-linear-gradient(45deg,#f1f0ea,#f1f0ea 10px,#e8e6df 10px,#e8e6df 20px);display:flex;align-items:center;justify-content:center}
    .card .thumb span{font:700 13px ui-monospace,monospace;letter-spacing:.2em;color:var(--accent)}
    .card .flag{color:var(--accent);font-weight:700}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
  </style>
</head>
<body>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Daily Record</h1>
</header>
<main>
  <p class="intro">Every published day of the Micheal Ray Berry Public Accountability Project, newest first. Documented days hold that day's four-angle photographs, the recorded weight, the inspection video, and a machine-readable manifest with SHA-256 evidence hashes. Days where the required documentation was not delivered are published too, marked <strong>No record</strong>. The gaps are part of the record.</p>
  <p class="count"><strong>${documented}</strong> documented days · <strong>${gaps}</strong> days without a record</p>
  <p><a href="/">Return to michealrayberry.com</a> · <a href="/weeks/">Weekly record</a> · <a href="/milestones">Milestones</a> · <a href="/dashboard">Weigh-in log and progress grid</a></p>
  <ul>${cards}</ul>
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
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
function noRecordPage({ date, day, previous, next, reason }) {
  const canonical = `${SITE_ORIGIN}/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const title = `Day ${day} — No record — ${longDate(date)} — Micheal Ray Berry`;
  const description = `Day ${day} of the Micheal Ray Berry Public Accountability Project, ${longDate(date)}: no complete record was filed for this date.`;
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
  <style>
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main,footer{max-width:1120px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}
    .card{border:1px solid var(--ink);background:#f1f0ea;border-left:6px solid var(--accent);padding:22px 24px;margin:32px 0;max-width:760px}
    .card p{margin:0 0 12px}.card p:last-child{margin:0}
    nav{display:flex;justify-content:space-between;gap:16px;margin:36px 0 12px;font:600 14px ui-monospace,monospace}
    nav a{color:var(--ink)}footer{border-top:1px solid var(--rule);color:var(--muted);font-size:14px}
    a{color:var(--ink)}a:hover{color:var(--accent)}
  </style>
</head>
<body>
  <header>
    <div class="eyebrow"><a href="/">Micheal Ray Berry</a> · Public Accountability Project</div>
    <h1>Day ${day} — No record</h1>
    <p>${htmlEscape(longDate(date))}</p>
  </header>
  <main>
    <div class="card">
      <p><strong>No complete record was filed for this date.</strong> ${htmlEscape(reason)}</p>
      <p>The Daily Compliance Packet for a Project Day is the four-angle inspection video, four accountability photographs, and the day's weight, due by 10 PM Eastern. This page exists because the day exists: a gap in the record is documented rather than omitted.</p>
    </div>
    <nav aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/daily/">All days</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>
    <p><a href="/weeks/week-${String(week).padStart(2, '0')}/">Week ${week}</a> · <a href="/penalties">Violation log</a> · <a href="/">michealrayberry.com</a></p>
  </main>
  <footer>The official public record of Micheal Ray Berry's Public Accountability Project.</footer>
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
  <sitemap><loc>${SITE_ORIGIN}/sitemap-pages.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-images.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-videos.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
</sitemapindex>
`;
}

async function main() {
  const [csv, attestCsv] = await Promise.all([
    fetchText(SHEET_CSV, true),
    fetchText(ATTEST_CSV, true),
  ]);
  if (!csv) {
    // Sheet unreachable (not shared, or Google hiccuping). Publishing new
    // day pages is skipped; the existing site deploys untouched.
    console.warn('Record sheet unreadable — skipping page generation this build.');
    console.warn('Fix: Share > General access > Anyone with the link > Viewer.');
    return;
  }
  const rows = parseCSV(csv);
  const records = rows.slice(1).map((r) => ({
    date: normalizeDate(r[0]),
    weight: Number.parseFloat(r[1]),
    note: String(r[2] || '').trim(),
    video: String(r[7] || '').trim(),
  })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.weight))
    .map((r) => ({ ...r, day: dayNumber(r.date) }))
    .filter((r) => r.day >= 1)
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
  const lastDay = finalized.at(-1)?.record.day || 0;
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
    const reason = !row
      ? 'No weigh-in, photographs, or inspection video were filed for this Project Day.'
      : (!row.video
        ? 'A weight was recorded, but the required inspection video was not filed.'
        : 'The inspection video was filed, but the four required accountability photographs were not.');
    sequence.push({ day: d, date, complete: false, reason });
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
    const page = dailyPage({ record, photos, previous, next, attestation: attestMap.get(record.date) || '' });
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
    const slug = `${s.date}-day-${String(s.day).padStart(3, '0')}`;
    const file = path.join(ROOT, 'daily', slug, 'index.html');
    const page = noRecordPage({
      date: s.date, day: s.day, reason: s.reason,
      previous: i > 0 ? sequence[i - 1] : null,
      next: i < sequence.length - 1 ? sequence[i + 1] : null,
    });
    if (await writeIfChanged(file, page)) changedUrls.add(`${SITE_ORIGIN}/daily/${slug}/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'daily', 'index.html'), dailyIndexPage(generated))) {
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
    if (await writeIfChanged(file, weekPage(w, inWeek, generated))) changedUrls.add(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
    extraUrls.push(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
  }
  if (await writeIfChanged(path.join(ROOT, 'weeks', 'index.html'), weeksIndexPage(generated))) changedUrls.add(`${SITE_ORIGIN}/weeks/`);
  extraUrls.push(`${SITE_ORIGIN}/weeks/`);

  if (await writeIfChanged(path.join(ROOT, 'feed.xml'), rssFeed(generated))) {
    changedUrls.add(`${SITE_ORIGIN}/feed.xml`);
  }

  const latestDate = generated.at(-1)?.record.date || START_DATE;
  const sitemapFiles = [
    ['sitemap-static.xml', staticSitemap(latestDate)],
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
