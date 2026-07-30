import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
const SHEET_CSV = process.env.WEIGHINS_CSV ||
  'https://docs.google.com/spreadsheets/d/1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM/gviz/tq?tqx=out:csv&gid=1146060827';
const ATTEST_CSV = process.env.ATTESTATION_CSV ||
  'https://docs.google.com/spreadsheets/d/1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM/gviz/tq?tqx=out:csv&sheet=Attestation';
// Violation Log (AP-administered). §8 permits publishing ONLY date, nature of the
// documentation failure, and resolved/unresolved. Never consequence details.
const PENALTIES_CSV = process.env.PENALTIES_CSV ||
  'https://docs.google.com/spreadsheets/d/1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM/gviz/tq?tqx=out:csv&gid=1365599185';
const START_DATE = '2026-07-20';
const START_WEIGHT = 340;
const GOAL_WEIGHT = 175;
const PERSON_ID = `${SITE_ORIGIN}/#micheal-ray-berry`;
const INDEXNOW_OUTPUT = path.join(ROOT, '.indexnow-urls.json');
const STATIC_PAGES = [
  ['', 'daily'],
  ['dashboard', 'daily'],
  ['milestones', 'weekly'],
  ['about', 'weekly'],
  ['agreement', 'weekly'],
  ['penalties', 'daily'],
  ['uniform', 'weekly'],
  ['updates', 'daily'],
  ['record', 'weekly'],
  ['verify', 'monthly'],
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

function videoEmbed(url) {
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

function dailyPage({ record, photos, previous, next, attestation, violation }) {
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
      sameAs: [
        'https://youtube.com/@michealrayberry',
        'https://x.com/michealrayberry',
        'https://www.instagram.com/michealrayberry',
        'https://www.tiktok.com/@michealrayberry',
      ],
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
      '@type': 'VideoObject',
      '@id': `${canonical}#inspection-video`,
      name: `Micheal Ray Berry Day ${day} daily inspection video — ${date}`,
      description: `Four-angle daily inspection video for Day ${day} of the Micheal Ray Berry Public Accountability Project, recorded at ${weight.toFixed(1)} pounds.`,
      thumbnailUrl: front,
      uploadDate: date,
      contentUrl: video,
      ...(embed ? { embedUrl: embed } : {}),
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
  const videoHtml = embed
    ? `<div class="video"><iframe src="${htmlEscape(embed)}" title="${htmlEscape(`Micheal Ray Berry Day ${day} inspection video`)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
    : `<p class="video-link"><a href="${htmlEscape(video)}" rel="noopener">Watch the Day ${day} inspection video</a></p>`;
  const nav = `<nav aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/dashboard">Full daily record</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>`;
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
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
    .violation{border:1px solid var(--accent);border-left-width:4px;padding:12px 16px;background:#fff;max-width:760px}
    .gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:36px 0}.gallery figure{margin:0;border:1px solid var(--ink);background:#fff}
    .gallery img{display:block;width:100%;height:auto}.gallery figcaption{padding:10px 12px;font:12px/1.5 ui-monospace,monospace;text-transform:uppercase}
    .video{position:relative;padding-top:56.25%;background:#000;margin:24px 0}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    nav{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--rule);padding-top:24px;margin-top:36px}nav a:nth-child(2){text-align:center}nav a:last-child{text-align:right}
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
  ${violation ? `<p class="violation"><strong>Violation on record for this date — ${htmlEscape(violation.resolved ? 'Resolved' : 'Unresolved')}.</strong> ${htmlEscape(violation.violation)} Consequences are administered privately under §8 and are never published. <a href="/penalties">Violation Log</a></p>` : ''}
  <section aria-labelledby="photos-heading"><h2 id="photos-heading">Daily accountability photographs</h2><div class="gallery">${figures}</div></section>
  <section aria-labelledby="video-heading"><h2 id="video-heading">Daily inspection video</h2>${videoHtml}</section>
  <p><a href="/manifests/${date}.json">View the machine-readable manifest and SHA-256 evidence hashes</a></p>
  ${nav}
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
</body>
</html>`;
}

// A missed day is part of the record. §8 permits exactly three public facts:
// the date, the nature of the documentation failure, and resolved/unresolved.
// Consequence details are confidential and must never appear here.
function violationPage({ record, violation, previous, next }) {
  const { date, day } = record;
  const canonical = `${SITE_ORIGIN}/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const status = violation.resolved ? 'Resolved' : 'Unresolved';
  const title = `Micheal Ray Berry Day ${day} — documentation failure | ${longDate(date)}`;
  const description = `Day ${day} of Micheal Ray Berry's public accountability record: the required daily documentation was not delivered on ${longDate(date)}. ${violation.violation} Status: ${status.toLowerCase()}.`;
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
      '@type': 'Person',
      '@id': PERSON_ID,
      name: 'Micheal Ray Berry',
      alternateName: 'Ray Berry',
      url: SITE_ORIGIN + '/',
    },
  ];
  const nav = `<nav aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/daily/">Full daily record</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>`;
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Micheal Ray Berry — Public Accountability Project">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="article:published_time" content="${date}T22:00:00-04:00">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(description)}">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <style>
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main,footer{max-width:1120px;margin:auto;padding:24px}header{border-bottom:2px solid var(--accent)}
    .eyebrow{font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}
    .stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px ui-monospace,monospace}
    .intro{max-width:760px;font-size:1.15rem}
    .failure{border-left:4px solid var(--accent);padding:14px 18px;background:#f1f0ea;max-width:760px}
    .failure dt{font:600 12px/1.6 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
    .failure dd{margin:0 0 14px;font-size:1.05rem}.failure dd:last-child{margin-bottom:0}
    .status{font:600 13px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:${violation.resolved ? '#1b6e3c' : 'var(--accent)'}}
    nav{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--rule);padding-top:24px;margin-top:36px}
    nav a:nth-child(2){text-align:center}nav a:last-child{text-align:right}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:720px){nav{grid-template-columns:1fr}nav a:nth-child(2),nav a:last-child{text-align:left}}
  </style>
</head>
<body>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Day ${day} — no record</h1>
  <div class="stats"><span>${htmlEscape(longDate(date))}</span><span class="status">${status}</span></div>
</header>
<main>
  <p class="intro">The required daily documentation for Day ${day} of the Micheal Ray Berry Public Accountability Project was not delivered on ${htmlEscape(longDate(date))}. This page exists so the gap is part of the permanent record rather than an absence in it.</p>
  <dl class="failure">
    <dt>Date</dt><dd>${htmlEscape(longDate(date))}</dd>
    <dt>Nature of the documentation failure</dt><dd>${htmlEscape(violation.violation)}</dd>
    <dt>Status</dt><dd class="status">${status}</dd>
  </dl>
  <p>Consequences are administered privately by the Accountability Partner under §8 of the signed agreement and are never published. Resolution closes the obligation; it does not erase this entry.</p>
  <p><a href="/penalties">View the full Violation Log</a></p>
  ${nav}
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>
</body>
</html>`;
}

function archivePage(entries) {
  const canonical = `${SITE_ORIGIN}/daily/`;
  const title = `Daily Record Archive — Micheal Ray Berry Public Accountability Project`;
  const description = `Every published day of the Micheal Ray Berry Public Accountability Project: ${entries.length} permanent daily records, each with four-angle photographs, the recorded weight, and the daily inspection video.`;
  const newest = entries.at(-1);
  // og:image must come from the newest DOCUMENTED day — violation entries carry
  // no photos, and entries.at(-1) may well be one.
  const newestWithPhoto = entries.filter((e) => e.photos).at(-1) || null;
  const items = entries.slice().reverse();
  const cards = items.map((item) => {
    const { record } = item;
    const href = `/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`;
    if (item.type === 'violation') {
      const status = item.violation.resolved ? 'Resolved' : 'Unresolved';
      return `<li class="missed">
      <a href="${href}">
        <span class="nodoc">No record</span>
        <span class="meta"><strong>Day ${record.day}</strong><span>${htmlEscape(longDate(record.date))}</span><span class="s">${status}</span></span>
      </a>
    </li>`;
    }
    const { photos } = item;
    const thumb = photos.front.variants[0] || null;
    const alt = `Micheal Ray Berry front view on ${longDate(record.date)}, Day ${record.day}, at ${record.weight.toFixed(1)} pounds`;
    return `<li>
      <a href="${href}">
        <img src="${htmlEscape(thumb ? thumb.url : photos.front.sourceUrl)}" width="${thumb ? thumb.width : photos.front.width}" height="${thumb ? thumb.height : photos.front.height}" alt="${htmlEscape(alt)}" loading="lazy" decoding="async">
        <span class="meta"><strong>Day ${record.day}</strong><span>${htmlEscape(longDate(record.date))}</span><span class="w">${record.weight.toFixed(1)} lb</span></span>
      </a>
    </li>`;
  }).join('\n');
  const documented = items.filter((i) => i.type !== 'violation').length;
  const missed = items.length - documented;
  const graph = [
    {
      '@type': 'CollectionPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
      ...(newest ? { dateModified: newest.record.date } : {}),
    },
    {
      '@type': 'ItemList',
      '@id': `${canonical}#record-list`,
      name: 'Permanent daily records',
      numberOfItems: items.length,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      itemListElement: items.map(({ record }, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `Day ${record.day} — ${longDate(record.date)}`,
        url: `${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`,
      })),
    },
  ];
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Micheal Ray Berry — Public Accountability Project">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  ${newestWithPhoto ? `<meta property="og:image" content="${htmlEscape(newestWithPhoto.photos.front.sourceUrl)}">` : ''}
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <style>
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header,main,footer{max-width:1160px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-size:clamp(1.9rem,5vw,3.4rem);line-height:1.05;margin:.35rem 0}
    .intro{max-width:760px;font-size:1.1rem}
    ul{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;padding:0;margin:32px 0}
    li a{display:block;border:1px solid var(--ink);background:#fff;color:inherit;text-decoration:none}
    li img{display:block;width:100%;height:auto}
    .meta{display:flex;flex-direction:column;gap:2px;padding:10px 12px;font:12px/1.5 ui-monospace,monospace;text-transform:uppercase;border-top:1px solid var(--rule)}
    .meta strong{font-size:15px}.meta .w{color:var(--accent);font-weight:600}
    li a:hover{outline:2px solid var(--accent)}
    li.missed a{border-color:var(--accent);background:#f1f0ea}
    .nodoc{display:flex;align-items:center;justify-content:center;aspect-ratio:9/16;color:var(--accent);
      font:600 13px ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;
      background:repeating-linear-gradient(45deg,#f1f0ea,#f1f0ea 10px,#e8e6df 10px,#e8e6df 20px)}
    .meta .s{color:var(--accent);font-weight:600}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
  </style>
</head>
<body>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Daily record archive</h1>
</header>
<main>
  <p class="intro">Every published day of the Micheal Ray Berry Public Accountability Project, newest first. Documented days hold that day's four-angle photographs, the recorded weight, the inspection video, and a machine-readable manifest with SHA-256 evidence hashes. Days where the required documentation was not delivered are published too, marked <strong>No record</strong>. The gaps are part of the record.</p>
  <p><strong>${documented}</strong> documented ${documented === 1 ? 'day' : 'days'} · <strong>${missed}</strong> ${missed === 1 ? 'day' : 'days'} without a record</p>
  <p><a href="/">Return to michealrayberry.com</a> · <a href="/dashboard">Weigh-in log and progress grid</a></p>
  <ul>
${cards}
  </ul>
</main>
<footer>© 2026 Micheal Ray Berry · Public Accountability Project · ${items.length} published ${items.length === 1 ? 'day' : 'days'} · <a href="/">michealrayberry.com</a></footer>
</body>
</html>`;
}

function staticSitemap(latestDate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${STATIC_PAGES.map(([slug, freq]) => `  <url><loc>${SITE_ORIGIN}/${slug}</loc><lastmod>${latestDate}</lastmod><changefreq>${freq}</changefreq><priority>${slug ? '0.7' : '1.0'}</priority></url>`).join('\n')}
</urlset>
`;
}

function dailySitemap(records) {
  const latest = records.at(-1)?.date || START_DATE;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_ORIGIN}/daily/</loc><lastmod>${latest}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>
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
      ${embed ? `<video:player_loc allow_embed="yes">${xmlEscape(embed)}</video:player_loc>` : `<video:content_loc>${xmlEscape(record.video)}</video:content_loc>`}
      <video:publication_date>${record.date}T22:00:00-04:00</video:publication_date>
    </video:video>
  </url>`;
}).join('\n')}
</urlset>
`;
}

function sitemapIndex(latestDate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_ORIGIN}/sitemap-static.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-daily.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-images.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-videos.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
</sitemapindex>
`;
}

async function main() {
  const [csv, attestCsv, penaltyCsv] = await Promise.all([
    fetchText(SHEET_CSV),
    fetchText(ATTEST_CSV, true),
    fetchText(PENALTIES_CSV, true),
  ]);
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

  // Violation Log — the AP's determination is authoritative. Never infer a
  // failure from missing photos: a §9 medical exception is an excused day, not
  // a violation, and only the AP knows which is which.
  const violations = new Map();
  if (penaltyCsv) {
    for (const row of parseCSV(penaltyCsv).slice(1)) {
      const c = row.map((x) => String(x || '').trim());
      // Public format (§8): date · violation · status. Legacy level-format rows
      // carry 'Level N' in column B and the status in column G.
      const entry = /^level/i.test(c[1])
        ? { date: normalizeDate(c[0]), violation: c[2], status: c[6] || 'Unresolved' }
        : { date: normalizeDate(c[0]), violation: c[1], status: c[2] || c[3] || 'Unresolved' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !entry.violation) continue;
      // ANCHORED: 'Unresolved' contains the substring 'resolved'.
      entry.resolved = /^\s*(satisfied|resolved)/i.test(entry.status);
      violations.set(entry.date, entry);
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

  // One continuous timeline: documented days and violation days share the same
  // URL scheme and prev/next chain, so the record has no navigational gaps.
  const finalizedDates = new Set(finalized.map((f) => f.record.date));
  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const violationDays = [...violations.values()]
    .filter((v) => !finalizedDates.has(v.date) && dayNumber(v.date) >= 1)
    .map((v) => {
      const r = recordByDate.get(v.date);
      return {
        type: 'violation',
        violation: v,
        record: { date: v.date, day: dayNumber(v.date), weight: r ? r.weight : null, note: r ? r.note : '' },
      };
    });
  const timeline = [
    ...finalized.map((f) => ({ type: 'day', ...f })),
    ...violationDays,
  ].sort((a, b) => a.record.date.localeCompare(b.record.date));

  const generated = [];
  const publishedViolations = [];
  const changedUrls = new Set();
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    const previous = timeline[i - 1]?.record || null;
    const next = timeline[i + 1]?.record || null;

    if (entry.type === 'violation') {
      const { record, violation } = entry;
      const dir = `${record.date}-day-${String(record.day).padStart(3, '0')}`;
      const page = violationPage({ record, violation, previous, next });
      if (await writeIfChanged(path.join(ROOT, 'daily', dir, 'index.html'), page)) {
        changedUrls.add(`${SITE_ORIGIN}/daily/${dir}/`);
      }
      publishedViolations.push(entry);
      continue;
    }

    const { record, photoPaths } = entry;
    const photos = {};
    for (const [angle, source] of Object.entries(photoPaths)) {
      photos[angle] = await generateResponsive(source, record.date, angle, record.day);
      photos[angle].changedUrls.forEach((u) => changedUrls.add(u));
    }
    const pageDir = path.join(ROOT, 'daily', `${record.date}-day-${String(record.day).padStart(3, '0')}`);
    const pageFile = path.join(pageDir, 'index.html');
    const page = dailyPage({
      record, photos, previous, next,
      attestation: attestMap.get(record.date) || '',
      violation: violations.get(record.date) || null,
    });
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
        // §8: nature and status only. Consequence details are confidential.
        violation: violations.has(record.date) ? {
          nature: violations.get(record.date).violation,
          status: violations.get(record.date).resolved ? 'Resolved' : 'Unresolved',
        } : null,
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

  // Archive hub at /daily/ — a crawlable static index linking every published day,
  // plus the machine-readable list the dashboard reads to link its log rows.
  // Both page types share the archive, the chain and the sitemap. Only
  // documented days carry photos, so image/video sitemaps stay day-only.
  const publishedAll = timeline.filter((e) =>
    e.type === 'violation' || generated.some((g) => g.record.date === e.record.date));
  if (publishedAll.length) {
    const hub = archivePage(publishedAll.map((e) => e.type === 'violation'
      ? { type: 'violation', record: e.record, violation: e.violation }
      : { type: 'day', record: e.record, photos: generated.find((g) => g.record.date === e.record.date).photos }));
    if (await writeIfChanged(path.join(ROOT, 'daily', 'index.html'), hub)) {
      changedUrls.add(`${SITE_ORIGIN}/daily/`);
    }
    const published = publishedAll.map((e) => ({
      day: e.record.day,
      date: e.record.date,
      type: e.type === 'violation' ? 'violation' : 'documented',
      weight_lb: Number.isFinite(e.record.weight) ? e.record.weight : null,
      status: e.type === 'violation' ? (e.violation.resolved ? 'Resolved' : 'Unresolved') : null,
      url: `/daily/${e.record.date}-day-${String(e.record.day).padStart(3, '0')}/`,
    }));
    await writeIfChanged(path.join(ROOT, 'daily', 'published.json'), JSON.stringify(published, null, 2) + '\n');
  }

  const latestDate = publishedAll.at(-1)?.record.date || START_DATE;
  const sitemapFiles = [
    ['sitemap-static.xml', staticSitemap(latestDate)],
    ['sitemap-daily.xml', dailySitemap(publishedAll.map((e) => e.record))],
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
    const newest = publishedAll.at(-1);
    await fs.appendFile(output, `page_count=${publishedAll.length}\n`);
    await fs.appendFile(output, `latest_url=${newest ? `${SITE_ORIGIN}/daily/${newest.record.date}-day-${String(newest.record.day).padStart(3, '0')}/` : SITE_ORIGIN}\n`);
  }
  console.log(`Documented days published: ${generated.length}`);
  console.log(`Violation days published: ${publishedViolations.length}`);
  console.log(`IndexNow candidate URLs: ${changedUrls.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
