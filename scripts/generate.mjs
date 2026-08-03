/* Generation: every public artifact — daily pages, /daily/ index,
   daily/published.json, weekly pages, milestone pages, RSS, sitemaps, and
   the homepage daily-record data — is rendered from the normalized
   manifests and from nothing else. No network. Deterministic: all
   timestamps and "today" decisions come from data/sync-state.json's as_of,
   so running twice produces byte-identical output. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ROOT, SITE_ORIGIN, PERSON_ID, MILESTONES, ANGLES, START_DATE, START_WEIGHT,
  pad3, daySlug, canonicalDailyUrl, longDate, dayNumber, dateForDay,
  currentProjectDate, deadlinePending, htmlEscape, xmlEscape,
  writeIfChanged, loadSyncState, fail,
} from './lib/common.mjs';
import { loadManifests } from './lib/manifest.mjs';

const STATIC_PAGES = [
  ['', 'daily'], ['dashboard', 'daily'], ['milestones', 'weekly'], ['about', 'weekly'],
  ['agreement', 'weekly'], ['penalties', 'daily'], ['uniform', 'weekly'],
  ['updates', 'daily'], ['verify', 'monthly'], ['daily/', 'daily'],
];

function imageLabel(angle) {
  return ({ front: 'front view', left: 'left-side view', rear: 'rear view', right: 'right-side view' })[angle] || angle;
}

function isSelfHosted(url) {
  return /^https?:\/\/(video\.michealrayberry\.com|pub-[0-9a-f]+\.r2\.dev)\//i.test(String(url || ''));
}

function photosOf(m) {
  const out = {};
  for (const a of ANGLES) if (m.media.photos[a]) out[a] = m.media.photos[a];
  return out;
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">`;

const SITEBAR = `<div class="sitebar"><a href="/">Micheal Ray Berry</a><span><a href="/daily/">Daily</a><a href="/weeks/">Weeks</a><a href="/milestones">Milestones</a><a href="/penalties">Record</a><a href="/agreement">Agreement</a></span></div>`;

const FOOTER = `<footer>© 2026 Micheal Ray Berry · Public Accountability Project · <a href="/">michealrayberry.com</a></footer>`;

const BASE_CSS = `
    .sitebar{background:#141412;color:#fafaf7;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 24px;font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
    .sitebar a{color:#fafaf7;text-decoration:none}.sitebar a:hover{color:#ff6b61}
    .sitebar span{display:flex;gap:16px;flex-wrap:wrap}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main,footer{max-width:1120px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}
    h2{font-family:'IBM Plex Sans Condensed',sans-serif;text-transform:uppercase;letter-spacing:.03em;font-size:1.5rem;margin:32px 0 8px}
    .stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px 'IBM Plex Mono',ui-monospace,monospace}
    .intro{max-width:760px;font-size:1.15rem}.attest{border-left:4px solid var(--accent);padding:10px 14px;background:#f1f0ea}
    .gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:36px 0}.gallery figure{margin:0;border:1px solid var(--ink);background:#fff}
    .gallery img{display:block;width:100%;height:auto}.gallery figcaption{padding:10px 12px;font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
    .video{margin:24px 0;background:#000}.video video{display:block;width:100%;max-width:420px;height:auto;margin:auto}
    .missing-list{border:1px solid var(--ink);border-left:6px solid var(--accent);background:#f1f0ea;padding:18px 22px;max-width:760px;margin:24px 0}
    .missing-list ul{margin:8px 0 0;padding-left:20px}.missing-list li{margin:4px 0}
    .filed-list{border:1px solid var(--ink);border-left:6px solid #3c6e47;background:#eef2ec;padding:18px 22px;max-width:760px;margin:24px 0}
    .filed-list ul{margin:8px 0 0;padding-left:20px}.filed-list li{margin:4px 0}
    .status-flag{font:600 13px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
    nav.daynav{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--rule);padding-top:24px;margin-top:36px}nav.daynav a:nth-child(2){text-align:center}nav.daynav a:last-child{text-align:right}
    .also{font:12px/1.8 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:12px 0 0}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:720px){.gallery{grid-template-columns:1fr}nav.daynav{grid-template-columns:1fr;text-align:left!important}nav.daynav a:nth-child(2),nav.daynav a:last-child{text-align:left}}
`;

function navFor(m, manifests) {
  const prev = manifests.find((x) => x.day === m.day - 1) || null;
  const next = manifests.find((x) => x.day === m.day + 1) || null;
  const week = Math.ceil(m.day / 7);
  return `<nav class="daynav" aria-label="Daily record navigation">
      ${prev ? `<a rel="prev" href="/daily/${daySlug(prev.date, prev.day)}/">← Day ${prev.day}</a>` : '<span></span>'}
      <a href="/daily/">All days</a>
      ${next ? `<a rel="next" href="/daily/${daySlug(next.date, next.day)}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>
    <p class="also"><a href="/weeks/week-${pad3(week).slice(1)}/">Week ${week}</a> · <a href="/manifests/${m.date}.json">Manifest &amp; SHA-256 evidence hashes</a> · <a href="/dashboard">Weigh-in log</a> · <a href="/">michealrayberry.com</a></p>`;
}

function galleryFor(m) {
  const photos = photosOf(m);
  if (!Object.keys(photos).length) return '';
  const figures = Object.entries(photos).map(([angle, p]) => {
    const srcset = p.responsive.map((v) => `${v.url} ${v.width}w`).join(', ');
    const weightPart = Number.isFinite(m.weight_lb) ? `, at ${m.weight_lb.toFixed(1)} pounds` : '';
    const alt = `Micheal Ray Berry ${imageLabel(angle)} accountability photograph on ${longDate(m.date)}, Day ${m.day}${weightPart}`;
    return `<figure id="${angle}-photo">
      <picture>
        <source type="image/webp" srcset="${htmlEscape(srcset)}" sizes="(max-width: 720px) 100vw, 50vw">
        <img src="${htmlEscape(p.url)}" width="${p.width}" height="${p.height}" alt="${htmlEscape(alt)}" loading="${angle === 'front' ? 'eager' : 'lazy'}" decoding="async">
      </picture>
      <figcaption>Micheal Ray Berry — ${htmlEscape(imageLabel(angle))}, Day ${m.day}, ${htmlEscape(longDate(m.date))}.</figcaption>
    </figure>`;
  }).join('\n');
  return `<section aria-labelledby="photos-heading"><h2 id="photos-heading">Daily accountability photographs</h2><div class="gallery">${figures}</div></section>`;
}

function videoSection(m) {
  const v = m.media.video;
  if (!v || !v.verified) return '';
  const poster = m.media.photos.front ? ` poster="${htmlEscape(m.media.photos.front.url)}"` : '';
  return `<section aria-labelledby="video-heading"><h2 id="video-heading">Daily inspection video</h2>
    <div class="video"><video controls preload="none" playsinline${poster} width="720" height="1280" title="${htmlEscape(`Micheal Ray Berry Day ${m.day} inspection video`)}">
        <source src="${htmlEscape(v.url)}" type="video/mp4">
        <a href="${htmlEscape(v.url)}">Download the Day ${m.day} inspection video</a>
      </video></div></section>`;
}

function headBlock({ title, description, canonical, ogImage, graph, publishedTime }) {
  return `<meta charset="utf-8">
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
  ${ogImage ? `<meta property="og:image" content="${htmlEscape(ogImage)}">` : ''}
  ${publishedTime ? `<meta property="article:published_time" content="${publishedTime}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(description)}">
  ${ogImage ? `<meta name="twitter:image" content="${htmlEscape(ogImage)}">` : ''}
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  ${FONTS}
  <style>${BASE_CSS}</style>`;
}

function personNode(front) {
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: 'Micheal Ray Berry',
    alternateName: 'Ray Berry',
    url: SITE_ORIGIN + '/',
    ...(front ? { image: front } : {}),
    sameAs: ['https://x.com/michealrayberry', 'https://www.tiktok.com/@michealrayberry', 'https://www.instagram.com/michealrayberry', 'https://bsky.app/profile/michealrayberry.bsky.social', 'https://gravatar.com/michealrayberry', 'https://www.reddit.com/user/MichealRayBerry/', 'https://www.flickr.com/photos/michealrayberry/'],
  };
}

function breadcrumbs(canonical, m) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumbs`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Daily Record', item: `${SITE_ORIGIN}/daily/` },
      { '@type': 'ListItem', position: 3, name: `Day ${m.day} — ${longDate(m.date)}`, item: canonical },
    ],
  };
}

/* ── complete day page ────────────────────────────────────────────── */
function completeDayPage(m, manifests) {
  const canonical = m.canonical_url;
  const photos = photosOf(m);
  const front = photos.front.url;
  const title = `Micheal Ray Berry Day ${m.day} — ${m.weight_lb.toFixed(1)} lb | ${longDate(m.date)}`;
  const description = `Day ${m.day} of Micheal Ray Berry’s public weight-loss accountability record: ${m.weight_lb.toFixed(1)} pounds on ${longDate(m.date)}, with four-angle photographs and the daily inspection video.`;
  const graph = [
    {
      '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description,
      datePublished: m.date, dateModified: m.date,
      primaryImageOfPage: { '@id': `${canonical}#front-photo` },
      about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    personNode(front),
    ...Object.entries(photos).map(([angle, p]) => ({
      '@type': 'ImageObject',
      '@id': `${canonical}#${angle}-photo`,
      contentUrl: p.url,
      thumbnailUrl: p.responsive[0]?.url || p.url,
      name: `Micheal Ray Berry Day ${m.day} ${imageLabel(angle)} — ${m.date}`,
      caption: `Micheal Ray Berry, ${imageLabel(angle)}, Day ${m.day} of the Public Accountability Project on ${longDate(m.date)}.`,
      dateCreated: m.date, width: p.width, height: p.height,
      creator: { '@id': PERSON_ID },
      representativeOfPage: angle === 'front',
    })),
    {
      '@type': 'Article', '@id': `${canonical}#article`, headline: title, description,
      articleSection: 'Daily Record',
      datePublished: `${m.date}T22:00:00-04:00`, dateModified: `${m.date}T22:00:00-04:00`,
      author: { '@id': PERSON_ID }, publisher: { '@id': `${SITE_ORIGIN}/#website` },
      mainEntityOfPage: { '@id': canonical },
      image: Object.keys(photos).map((a) => ({ '@id': `${canonical}#${a}-photo` })),
      video: { '@id': `${canonical}#inspection-video` },
      about: { '@id': PERSON_ID }, isAccessibleForFree: true,
    },
    breadcrumbs(canonical, m),
    {
      '@type': 'VideoObject', '@id': `${canonical}#inspection-video`,
      name: `Micheal Ray Berry Day ${m.day} daily inspection video — ${m.date}`,
      description: `Four-angle daily inspection video for Day ${m.day} of the Micheal Ray Berry Public Accountability Project, recorded at ${m.weight_lb.toFixed(1)} pounds.`,
      thumbnailUrl: front, uploadDate: m.date, contentUrl: m.media.video.url,
      encodingFormat: 'video/mp4', creator: { '@id': PERSON_ID },
    },
  ];
  const attestLine = m.attestation
    ? `Capture attestation recorded: ${htmlEscape([m.attestation.code, m.attestation.status].filter(Boolean).join(' · '))}.`
    : 'The public photo and video record is preserved with this daily page and its GitHub manifest.';
  return `<!doctype html>
<html lang="en-US">
<head>
  ${headBlock({ title, description, canonical, ogImage: front, graph, publishedTime: `${m.date}T22:00:00-04:00` })}
</head>
<body>
${SITEBAR}
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Micheal Ray Berry — Day ${m.day}</h1>
  <div class="stats"><span>${htmlEscape(longDate(m.date))}</span><span>${m.weight_lb.toFixed(1)} LB</span><span>340 → 175 LB</span></div>
</header>
<main>
  <p class="intro">This page permanently documents Day ${m.day} of the Micheal Ray Berry Public Accountability Project. On ${htmlEscape(longDate(m.date))}, the official recorded weight was ${m.weight_lb.toFixed(1)} pounds. The four photographs below show the required front, left-side, rear, and right-side documentation views.</p>
  ${m.note ? `<p>${htmlEscape(m.note)}</p>` : ''}
  <p class="attest">${attestLine}</p>
  ${galleryFor(m)}
  ${videoSection(m)}
  ${navFor(m, manifests)}
</main>
${FOOTER}
</body>
</html>`;
}

/* ── partial day page ─────────────────────────────────────────────────
   Every verified item that was filed is displayed; every missing component
   is named separately. The page never claims media it cannot show, and it
   keeps the same canonical URL the day will have when completed. */
function partialDayPage(m, manifests) {
  const canonical = m.canonical_url;
  const photos = photosOf(m);
  const photoCount = Object.keys(photos).length;
  const hasWeight = Number.isFinite(m.weight_lb);
  const hasVideo = Boolean(m.media.video && m.media.video.verified);
  const filed = [];
  if (hasWeight) filed.push(`the recorded weight — <strong>${m.weight_lb.toFixed(1)} lb</strong>`);
  if (photoCount) filed.push(`${photoCount} of the four accountability photographs (${Object.keys(photos).map(imageLabel).join(', ')})`);
  if (hasVideo) filed.push('the daily inspection video');
  if (m.note) filed.push('a record note');
  const missing = [];
  if (!hasWeight) missing.push('the recorded weight');
  for (const a of ANGLES) if (!photos[a]) missing.push(`the ${imageLabel(a)} photograph`);
  if (!hasVideo) missing.push('the daily inspection video');
  const title = `Micheal Ray Berry Day ${m.day} — Incomplete Record | ${longDate(m.date)}`;
  const description = `Day ${m.day} of Micheal Ray Berry’s public accountability record, ${longDate(m.date)}: an incomplete filing.${hasWeight ? ` Recorded weight ${m.weight_lb.toFixed(1)} pounds.` : ''} Missing: ${missing.join(', ')}.`;
  const graph = [
    {
      '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description,
      datePublished: m.date, dateModified: m.date,
      about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    personNode(photos.front?.url || null),
    breadcrumbs(canonical, m),
  ];
  return `<!doctype html>
<html lang="en-US">
<head>
  ${headBlock({ title, description, canonical, ogImage: photos.front?.url || null, graph, publishedTime: `${m.date}T22:00:00-04:00` })}
</head>
<body>
${SITEBAR}
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Day ${m.day} — Incomplete Record</h1>
  <div class="stats"><span>${htmlEscape(longDate(m.date))}</span>${hasWeight ? `<span>${m.weight_lb.toFixed(1)} LB</span>` : ''}<span class="status-flag">Incomplete</span></div>
</header>
<main>
  <p class="intro">The Daily Compliance Packet for Day ${m.day} of the Micheal Ray Berry Public Accountability Project was not completed on ${htmlEscape(longDate(m.date))}. Everything that was filed is shown below; everything that was not filed is named below. This page is the permanent record for the day and keeps this URL if the record is later completed.</p>
  ${m.note ? `<p>${htmlEscape(m.note)}</p>` : ''}
  ${filed.length ? `<div class="filed-list"><strong>Filed and verified:</strong><ul>${filed.map((f) => `<li>${f}</li>`).join('')}</ul></div>` : ''}
  <div class="missing-list"><strong>Not filed:</strong><ul>${missing.map((x) => `<li>${htmlEscape(x)}</li>`).join('')}</ul></div>
  ${m.violation ? `<p class="attest"><strong>Violation logged:</strong> ${htmlEscape(m.violation.violation)} — <span class="status-flag">${htmlEscape(m.violation.status)}</span>. Consequences are administered privately under §8 of the signed agreement; resolution closes the obligation but does not erase this entry. <a href="/penalties">Violation log</a>.</p>` : ''}
  ${galleryFor(m)}
  ${videoSection(m)}
  ${navFor(m, manifests)}
</main>
${FOOTER}
</body>
</html>`;
}

/* ── missing / violation-only day page ────────────────────────────── */
function missingDayPage(m, manifests) {
  const canonical = m.canonical_url;
  const title = `Day ${m.day} — No Record — ${longDate(m.date)} — Micheal Ray Berry`;
  const description = `Day ${m.day} of the Micheal Ray Berry Public Accountability Project, ${longDate(m.date)}: no record was filed for this date.`;
  const graph = [
    {
      '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description,
      datePublished: m.date, dateModified: m.date,
      about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    breadcrumbs(canonical, m),
  ];
  return `<!doctype html>
<html lang="en-US">
<head>
  ${headBlock({ title, description, canonical, ogImage: null, graph, publishedTime: null })}
</head>
<body>
${SITEBAR}
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Day ${m.day} — No Record</h1>
  <div class="stats"><span>${htmlEscape(longDate(m.date))}</span><span class="status-flag">${m.violation ? htmlEscape(m.violation.status) : 'No record'}</span></div>
</header>
<main>
  <div class="missing-list">
    <p><strong>No record was filed for this date.</strong> ${htmlEscape(m.status_reason)}</p>
    ${m.violation ? `<p><strong>Violation logged:</strong> ${htmlEscape(m.violation.violation)} — ${htmlEscape(m.violation.status)}. <a href="/penalties">Violation log</a>.</p>` : ''}
    <p>The Daily Compliance Packet for a Project Day is the four-angle inspection video, four accountability photographs, and the day's weight, all delivered by 10 PM Eastern. A packet counts only when every element is filed on time. This page exists because the day exists: a gap is documented rather than omitted.</p>
  </div>
  ${navFor(m, manifests)}
</main>
${FOOTER}
</body>
</html>`;
}

/* ── /daily/ index ────────────────────────────────────────────────── */
function dailyIndexPage(manifests, pendingDates) {
  const canonical = `${SITE_ORIGIN}/daily/`;
  const complete = manifests.filter((m) => m.status === 'complete').length;
  const partial = manifests.filter((m) => m.status === 'partial').length;
  const gaps = manifests.filter((m) => m.status === 'missing' || m.status === 'violation').length;
  const title = 'Daily Record — Micheal Ray Berry Public Accountability Project';
  const description = `Every published day of the Micheal Ray Berry Public Accountability Project: ${complete} documented days with four-angle photographs, recorded weight, inspection video, and SHA-256 evidence manifests.`;
  const rows = [
    ...pendingDates.map((date) => ({ pending: true, date, day: dayNumber(date) })),
    ...[...manifests].reverse(),
  ];
  const cards = rows.map((m) => {
    if (m.pending) {
      return `<li class="card gap pending"><div class="thumb"><span>DUE TONIGHT</span></div>
        <div class="meta"><strong>Day ${m.day}</strong><span>${htmlEscape(longDate(m.date))}</span><span class="flag">Due by 10 PM ET</span></div></li>`;
    }
    const href = `/daily/${daySlug(m.date, m.day)}/`;
    if (m.status === 'complete') {
      const front = m.media.photos.front;
      const srcset = front.responsive.map((v) => `${v.url} ${v.width}w`).join(', ');
      return `<li class="card"><a href="${href}">
      <picture><source type="image/webp" srcset="${htmlEscape(srcset)}" sizes="(max-width:720px) 50vw, 25vw">
      <img src="${htmlEscape(front.url)}" width="${front.width}" height="${front.height}" alt="${htmlEscape(`Micheal Ray Berry front view, Day ${m.day}, ${longDate(m.date)}`)}" loading="lazy" decoding="async"></picture>
      <div class="meta"><strong>Day ${m.day}</strong><span>${htmlEscape(longDate(m.date))}</span><span class="wt">${m.weight_lb.toFixed(1)} lb</span></div>
    </a></li>`;
    }
    const flag = m.status === 'partial' ? 'Incomplete record' : 'No record';
    const weightLine = Number.isFinite(m.weight_lb) ? `<span class="wt">${m.weight_lb.toFixed(1)} lb</span>` : '';
    const inner = `<div class="thumb"><span>${flag.toUpperCase()}</span></div>
        <div class="meta"><strong>Day ${m.day}</strong><span>${htmlEscape(longDate(m.date))}</span>${weightLine}<span class="flag">${flag}</span></div>`;
    return `<li class="card gap"><a href="${href}">${inner}</a></li>`;
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
    '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': canonical, url: canonical,
    name: title, description, about: { '@id': PERSON_ID },
    hasPart: manifests.map((m) => ({
      '@type': 'WebPage',
      url: `${SITE_ORIGIN}/daily/${daySlug(m.date, m.day)}/`,
      name: `Day ${m.day} — ${longDate(m.date)}`,
    })),
  })}</script>
  ${FONTS}
  <style>${BASE_CSS}
    header,main,footer{max-width:1200px}
    ul.days{list-style:none;padding:0;margin:28px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
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
    .count{font:600 14px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em}
  </style>
</head>
<body>
${SITEBAR}
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Daily Record</h1>
</header>
<main>
  <p class="intro">Every published day of the Micheal Ray Berry Public Accountability Project, newest first. Documented days hold that day's four-angle photographs, the recorded weight, the inspection video, and a machine-readable manifest with SHA-256 evidence hashes. Days where the required documentation was not delivered are published too, marked <strong>Incomplete record</strong> or <strong>No record</strong>. The gaps are part of the record.</p>
  <p class="count"><strong>${complete}</strong> documented ${complete === 1 ? 'day' : 'days'}${partial ? ` · <strong>${partial}</strong> incomplete ${partial === 1 ? 'record' : 'records'}` : ''}${gaps ? ` · <strong>${gaps}</strong> ${gaps === 1 ? 'day' : 'days'} without a record` : ''}${pendingDates.length ? ` · <strong>${pendingDates.length}</strong> still due` : ''}</p>
  <p><a href="/">Return to michealrayberry.com</a> · <a href="/weeks/">Weekly record</a> · <a href="/milestones">Milestones</a> · <a href="/dashboard">Weigh-in log and progress grid</a></p>
  <ul class="days">${cards}</ul>
</main>
${FOOTER}
</body>
</html>`;
}

/* ── weekly pages ─────────────────────────────────────────────────── */
function weekPage(week, manifests) {
  const firstDay = (week - 1) * 7 + 1;
  const canonical = `${SITE_ORIGIN}/weeks/week-${String(week).padStart(2, '0')}/`;
  const inWeek = manifests.filter((m) => Math.ceil(m.day / 7) === week);
  const weighed = inWeek.filter((m) => Number.isFinite(m.weight_lb));
  const weights = weighed.map((m) => m.weight_lb);
  const net = weights.length > 1 ? weights[weights.length - 1] - weights[0] : 0;
  const span = inWeek.length ? `${longDate(inWeek[0].date)} – ${longDate(inWeek.at(-1).date)}` : `Days ${firstDay}–${firstDay + 6}`;
  const title = `Micheal Ray Berry Week ${week} — Days ${firstDay}–${firstDay + 6} | Public Accountability Project`;
  const description = weights.length
    ? `Week ${week} of the Micheal Ray Berry Public Accountability Project, ${span}: ${weights[0].toFixed(1)} to ${weights[weights.length - 1].toFixed(1)} pounds across ${weighed.length} recorded days.`
    : `Week ${week} of the Micheal Ray Berry Public Accountability Project. No recorded days in this week.`;
  const rows = inWeek.map((m) => `<tr>
    <td><a href="/daily/${daySlug(m.date, m.day)}/">Day ${m.day}</a></td>
    <td>${htmlEscape(longDate(m.date))}</td>
    <td>${Number.isFinite(m.weight_lb) ? `<strong>${m.weight_lb.toFixed(1)} lb</strong>` : '—'}</td>
    <td>${m.status === 'complete' ? 'Complete' : m.status === 'partial' ? '<span class="status-flag">Incomplete</span>' : '<span class="status-flag">No record</span>'}</td>
    <td>${htmlEscape(m.note || '')}</td>
  </tr>`).join('\n');
  const maxWeek = Math.ceil((manifests.at(-1)?.day || 1) / 7);
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
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Weeks', item: `${SITE_ORIGIN}/weeks/` },
      { '@type': 'ListItem', position: 3, name: `Week ${week}`, item: canonical },
    ] },
  ] })}</script>
  ${FONTS}
  <style>${BASE_CSS}
    table{width:100%;border-collapse:collapse;margin:20px 0;font:14px 'IBM Plex Mono',ui-monospace,monospace}
    th{text-align:left;background:var(--ink);color:var(--paper);padding:8px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    td{padding:8px 10px;border-bottom:1px solid var(--rule)}
    nav.crumbs{font:12px 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
  </style>
</head>
<body>
${SITEBAR}
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / <a href="/weeks/">Weeks</a> / Week ${week}</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Week ${week}</h1>
  <div class="stats"><span>DAYS ${firstDay}–${firstDay + 6}</span><span>${htmlEscape(span)}</span>${weights.length > 1 ? `<span>${net <= 0 ? '−' : '+'}${Math.abs(net).toFixed(1)} LB</span>` : ''}</div>
</header>
<main>
  <p class="intro">${htmlEscape(description)}</p>
  ${rows ? `<table><thead><tr><th>Day</th><th>Date</th><th>Weight</th><th>Status</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="missing-list">No recorded days in this week.</div>'}
  <p>${nav}</p>
  <p><a href="/daily/">Full daily record</a> · <a href="/dashboard">Weigh-in log</a></p>
</main>
${FOOTER}
</body>
</html>`;
}

function weeksIndexPage(manifests) {
  const maxWeek = Math.ceil((manifests.at(-1)?.day || 1) / 7);
  const canonical = `${SITE_ORIGIN}/weeks/`;
  const items = [];
  for (let w = 1; w <= maxWeek; w++) {
    const inWeek = manifests.filter((m) => Math.ceil(m.day / 7) === w);
    const weights = inWeek.filter((m) => Number.isFinite(m.weight_lb)).map((m) => m.weight_lb);
    items.push(`<tr><td><a href="/weeks/week-${String(w).padStart(2, '0')}/">Week ${w}</a></td>
      <td>Days ${(w - 1) * 7 + 1}–${w * 7}</td>
      <td>${inWeek.filter((m) => m.status === 'complete').length} documented</td>
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
  ${FONTS}
  <style>${BASE_CSS}
    table{width:100%;border-collapse:collapse;margin:20px 0;font:14px 'IBM Plex Mono',ui-monospace,monospace}
    th{text-align:left;background:var(--ink);color:var(--paper);padding:8px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    td{padding:8px 10px;border-bottom:1px solid var(--rule)}
    nav.crumbs{font:12px 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
  </style>
</head>
<body>
${SITEBAR}
<header>
  <nav class="crumbs"><a href="/">Micheal Ray Berry</a> / Weeks</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Weekly Record</h1>
</header>
<main>
  <p class="intro">Every project week, Day 1 onward. Each week page lists that week's days, recorded weights, record status, and net change.</p>
  <table><thead><tr><th>Week</th><th>Days</th><th>Documented</th><th>Weight</th></tr></thead><tbody>${items.reverse().join('\n')}</tbody></table>
  <p><a href="/daily/">Full daily record</a> · <a href="/milestones">Milestones</a></p>
</main>
${FOOTER}
</body>
</html>`;
}

/* ── milestone pages ──────────────────────────────────────────────── */
function milestonePage(target, manifests) {
  const completeDays = manifests.filter((m) => m.status === 'complete');
  const reached = completeDays.find((m) => m.weight_lb <= target) || null;
  const weighed = manifests.filter((m) => Number.isFinite(m.weight_lb));
  const latest = weighed.at(-1) || null;
  const start = weighed[0]?.weight_lb ?? START_WEIGHT;
  const canonical = `${SITE_ORIGIN}/milestones/${target}-lb/`;
  const title = reached
    ? `Micheal Ray Berry Reached ${target} lb — Day ${reached.day}, ${longDate(reached.date)}`
    : `Micheal Ray Berry — ${target} lb Milestone (Not Yet Reached)`;
  const toGo = latest ? (latest.weight_lb - target) : (START_WEIGHT - target);
  const description = reached
    ? `Micheal Ray Berry passed the ${target}-pound milestone of his public accountability project on ${longDate(reached.date)}, Day ${reached.day}, at ${reached.weight_lb.toFixed(1)} pounds. Verified with four-angle photographs and the daily inspection video.`
    : `The ${target}-pound milestone of the Micheal Ray Berry Public Accountability Project has not been reached. Current recorded weight: ${latest ? latest.weight_lb.toFixed(1) : START_WEIGHT} pounds — ${toGo.toFixed(1)} pounds to go.`;
  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Milestones', item: `${SITE_ORIGIN}/milestones` },
      { '@type': 'ListItem', position: 3, name: `${target} lb`, item: canonical },
    ] },
  ];
  if (reached) {
    graph.push({
      '@type': 'Achievement', name: `${target} pounds`,
      description: `Reached ${target} pounds on Day ${reached.day}.`,
      dateAchieved: reached.date, agent: { '@id': PERSON_ID },
    });
  }
  const body = reached
    ? `<p class="intro">Micheal Ray Berry reached the <strong>${target}-pound</strong> milestone on <strong>${htmlEscape(longDate(reached.date))}</strong>, Day ${reached.day} of the Public Accountability Project, at a recorded weight of ${reached.weight_lb.toFixed(1)} pounds — ${(start - reached.weight_lb).toFixed(1)} pounds down from the starting weight of ${start.toFixed(1)}.</p>
    <div class="gallery">${Object.entries(photosOf(reached)).map(([angle, ph]) => `<figure>
      <picture><source type="image/webp" srcset="${htmlEscape(ph.responsive.map((v) => `${v.url} ${v.width}w`).join(', '))}" sizes="(max-width:720px) 50vw, 25vw">
      <img src="${htmlEscape(ph.url)}" width="${ph.width}" height="${ph.height}" alt="${htmlEscape(`Micheal Ray Berry ${imageLabel(angle)} at the ${target} pound milestone, Day ${reached.day}`)}" loading="lazy" decoding="async"></picture>
      <figcaption>${htmlEscape(imageLabel(angle))} · Day ${reached.day}</figcaption></figure>`).join('')}</div>
    <p><a href="/daily/${daySlug(reached.date, reached.day)}/">Full record for Day ${reached.day} →</a></p>`
    : `<p class="intro">The <strong>${target}-pound</strong> milestone has not been reached.</p>
    <div class="missing-list"><strong>${toGo.toFixed(1)} pounds to go.</strong> Latest recorded weight: ${latest ? latest.weight_lb.toFixed(1) : START_WEIGHT} pounds${latest ? ` on ${htmlEscape(longDate(latest.date))}, Day ${latest.day}` : ''}. This page publishes the moment the milestone is recorded.</div>`;
  const others = MILESTONES.filter((mm) => mm !== target)
    .map((mm) => `<a href="/milestones/${mm}-lb/">${mm} lb</a>`).join(' · ');
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
  ${reached ? `<meta property="og:image" content="${htmlEscape(reached.media.photos.front.url)}">` : ''}
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  ${FONTS}
  <style>${BASE_CSS}
    nav.crumbs{font:12px 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
    .gallery{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
  </style>
</head>
<body>
${SITEBAR}
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
${FOOTER}
</body>
</html>`;
}

/* ── feeds and sitemaps ───────────────────────────────────────────── */
function rssFeed(manifests, asOfIso) {
  const items = manifests.slice(-50).reverse().map((m) => {
    const url = `${SITE_ORIGIN}/daily/${daySlug(m.date, m.day)}/`;
    const label = m.status === 'complete'
      ? `Day ${m.day} — ${m.weight_lb.toFixed(1)} lb — ${longDate(m.date)}`
      : m.status === 'partial'
        ? `Day ${m.day} — Incomplete record — ${longDate(m.date)}`
        : `Day ${m.day} — No record — ${longDate(m.date)}`;
    const description = m.status === 'complete'
      ? `Day ${m.day} of the Micheal Ray Berry Public Accountability Project. Recorded weight ${m.weight_lb.toFixed(1)} pounds on ${longDate(m.date)}, with four-angle documentation photographs and the daily inspection video.`
      : `Day ${m.day} of the Micheal Ray Berry Public Accountability Project (${longDate(m.date)}): ${m.status_reason}`;
    const front = m.media.photos.front;
    return `    <item>
      <title>${xmlEscape(label)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${m.date}T22:00:00-04:00`).toUTCString()}</pubDate>
      <description>${xmlEscape(description)}</description>
${front ? `      <enclosure url="${xmlEscape(front.url)}" type="${xmlEscape(front.content_type)}" length="${front.bytes}"/>\n` : ''}    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Micheal Ray Berry — Public Accountability Project</title>
    <link>${SITE_ORIGIN}/daily/</link>
    <atom:link href="${SITE_ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>The official daily public record: weight, four-angle photographs, and inspection video, published every day from 340 pounds to 175.</description>
    <language>en-US</language>
    <lastBuildDate>${new Date(asOfIso).toUTCString()}</lastBuildDate>
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

function dailySitemap(manifests) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_ORIGIN}/daily/</loc><lastmod>${manifests.at(-1)?.date || START_DATE}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>
${manifests.map((m) => `  <url><loc>${m.canonical_url}</loc><lastmod>${m.date}</lastmod><changefreq>${m.status === 'complete' ? 'never' : 'weekly'}</changefreq><priority>0.8</priority></url>`).join('\n')}
</urlset>
`;
}

function imageSitemap(manifests) {
  const withPhotos = manifests.filter((m) => Object.keys(photosOf(m)).length);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${withPhotos.map((m) => `  <url>
    <loc>${m.canonical_url}</loc>
${Object.entries(photosOf(m)).map(([angle, p]) => `    <image:image><image:loc>${xmlEscape(p.url)}</image:loc><image:title>${xmlEscape(`Micheal Ray Berry Day ${m.day} ${imageLabel(angle)}`)}</image:title><image:caption>${xmlEscape(`Micheal Ray Berry ${imageLabel(angle)} accountability photograph on ${longDate(m.date)}${Number.isFinite(m.weight_lb) ? `, at ${m.weight_lb.toFixed(1)} pounds` : ''}.`)}</image:caption></image:image>`).join('\n')}
  </url>`).join('\n')}
</urlset>
`;
}

function videoSitemap(manifests) {
  const withVideo = manifests.filter((m) => m.media.video?.verified && m.media.photos.front);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${withVideo.map((m) => `  <url>
    <loc>${m.canonical_url}</loc>
    <video:video>
      <video:thumbnail_loc>${xmlEscape(m.media.photos.front.url)}</video:thumbnail_loc>
      <video:title>${xmlEscape(`Micheal Ray Berry Day ${m.day} daily inspection video`)}</video:title>
      <video:description>${xmlEscape(`Four-angle daily inspection video for Day ${m.day} of the Micheal Ray Berry Public Accountability Project${Number.isFinite(m.weight_lb) ? ` at ${m.weight_lb.toFixed(1)} pounds` : ''}.`)}</video:description>
      <video:content_loc>${xmlEscape(m.media.video.url)}</video:content_loc>
      <video:publication_date>${m.date}T22:00:00-04:00</video:publication_date>
    </video:video>
  </url>`).join('\n')}
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

/* daily/published.json — the machine-readable record consumed by the
   homepage and any external checker. Derived from manifests only. */
export function publishedJson(manifests) {
  return JSON.stringify(manifests.map((m) => ({
    day: m.day,
    date: m.date,
    status: m.status,
    status_reason: m.status_reason,
    // Legacy key kept for older consumers of this file.
    type: m.status === 'complete' ? 'documented' : (m.violation ? 'violation' : 'incomplete'),
    weight_lb: m.weight_lb,
    note: m.note || '',
    photos: Object.keys(photosOf(m)).length,
    video: Boolean(m.media.video?.verified),
    violation_status: m.violation?.status ?? null,
    url: `/daily/${daySlug(m.date, m.day)}/`,
  })), null, 2) + '\n';
}

export async function generate() {
  const state = await loadSyncState();
  const asOf = new Date(state.as_of);
  const manifests = await loadManifests();
  if (!manifests.length) throw fail('No v2 manifests found — run scripts/ingest.mjs first.');
  manifests.sort((a, b) => a.day - b.day);

  const changedUrls = new Set();
  const write = async (file, content) => {
    if (await writeIfChanged(file, content)) {
      const rel = '/' + path.relative(ROOT, file).split(path.sep).map(encodeURIComponent).join('/');
      changedUrls.add(`${SITE_ORIGIN}${rel.replace(/\/index\.html$/, '/')}`);
      return true;
    }
    return false;
  };

  // Day pages.
  for (const m of manifests) {
    const html = m.status === 'complete' ? completeDayPage(m, manifests)
      : m.status === 'partial' ? partialDayPage(m, manifests)
        : missingDayPage(m, manifests);
    await write(path.join(ROOT, 'daily', daySlug(m.date, m.day), 'index.html'), html);
  }

  // A day still inside its Eastern filing window appears as "due tonight".
  const todayEt = currentProjectDate(asOf);
  const lastManifestDay = manifests.at(-1).day;
  const pendingDates = [];
  for (let d = lastManifestDay + 1; d <= dayNumber(todayEt); d++) {
    if (deadlinePending(dateForDay(d), asOf)) pendingDates.push(dateForDay(d));
  }

  await write(path.join(ROOT, 'daily', 'index.html'), dailyIndexPage(manifests, pendingDates));
  await write(path.join(ROOT, 'daily', 'published.json'), publishedJson(manifests));

  const extraUrls = [];
  for (const target of MILESTONES) {
    await write(path.join(ROOT, 'milestones', `${target}-lb`, 'index.html'), milestonePage(target, manifests));
    extraUrls.push(`${SITE_ORIGIN}/milestones/${target}-lb/`);
  }
  const maxWeek = Math.ceil(lastManifestDay / 7);
  for (let w = 1; w <= maxWeek; w++) {
    await write(path.join(ROOT, 'weeks', `week-${String(w).padStart(2, '0')}`, 'index.html'), weekPage(w, manifests));
    extraUrls.push(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
  }
  await write(path.join(ROOT, 'weeks', 'index.html'), weeksIndexPage(manifests));
  extraUrls.push(`${SITE_ORIGIN}/weeks/`);

  await write(path.join(ROOT, 'feed.xml'), rssFeed(manifests, state.as_of));

  const latestDate = manifests.at(-1).date;
  await write(path.join(ROOT, 'sitemap-static.xml'), staticSitemap(latestDate));
  await write(path.join(ROOT, 'sitemap-daily.xml'), dailySitemap(manifests));
  await write(path.join(ROOT, 'sitemap-pages.xml'), extraSitemap(extraUrls, latestDate));
  await write(path.join(ROOT, 'sitemap-images.xml'), imageSitemap(manifests));
  await write(path.join(ROOT, 'sitemap-videos.xml'), videoSitemap(manifests));
  await write(path.join(ROOT, 'sitemap.xml'), sitemapIndex(latestDate));

  await fs.writeFile(path.join(ROOT, '.indexnow-urls.json'),
    JSON.stringify([...changedUrls].filter((u) => u.startsWith(SITE_ORIGIN)).sort(), null, 2) + '\n');

  const statuses = manifests.map((m) => `${m.day}:${m.status}`).join(' ');
  console.log(`Generated site output for Days 1–${lastManifestDay} (${statuses}).`);
  return manifests;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  generate().catch((error) => {
    console.error(error.isPipelineError ? `Generation failed: ${error.message}` : error);
    process.exit(1);
  });
}
