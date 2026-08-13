import { promises as fs } from 'node:fs';
import path from 'node:path';

const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
const START_DATE = '2026-08-13';
const START_WEIGHT = 340;
const GOAL_WEIGHT = 175;
const MILESTONES = [300, 275, 250, 225, 200, 175];
const PERSON_ID = `${SITE_ORIGIN}/#micheal-ray-berry`;

function htmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;')
    .replace(/'/g, '&#39;');
}

function longDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

function dayNumber(date) {
  const start = Date.parse(`${START_DATE}T12:00:00Z`);
  const current = Date.parse(`${date}T12:00:00Z`);
  return Math.round((current - start) / 86400000) + 1;
}

const PAGE_CSS = `
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
    .sitenav a[aria-current]{color:var(--accent)}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}
    header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    .crumbs{font:12px 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;color:var(--muted)}
    .crumbs a{color:inherit}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    h2{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:1.5rem;margin:32px 0 8px}
    .intro{max-width:760px;font-size:1.1rem}
    .stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px 'IBM Plex Mono',ui-monospace,monospace;margin:.5rem 0}
    .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;border:1px solid var(--ink);margin:24px 0}
    .statgrid div{padding:22px 18px;border-right:1px solid var(--rule);display:flex;flex-direction:column;gap:6px}
    .statgrid div:last-child{border-right:0}
    .statgrid span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
    .statgrid b{font:600 28px/1 'IBM Plex Mono',ui-monospace,monospace}
    .bar{height:22px;border:1px solid var(--ink);background:var(--paper);margin:8px 0 24px}
    .bar i{display:block;height:100%;background:var(--ink)}
    table{width:100%;border-collapse:collapse;margin:20px 0;font:14px 'IBM Plex Mono',ui-monospace,monospace}
    th{text-align:left;background:var(--ink);color:var(--paper);padding:8px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    td{padding:10px;border-bottom:1px solid var(--rule);vertical-align:top}
    .ladder{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;border:1px solid var(--ink);margin:24px 0}
    .ladder a{display:flex;flex-direction:column;gap:6px;padding:22px 14px;text-decoration:none;color:inherit;border-right:1px solid var(--rule)}
    .ladder a:last-child{border-right:0}
    .ladder a:hover{background:#f1f0ea}
    .ladder b{font:700 28px/1 'IBM Plex Mono',ui-monospace,monospace}
    .ladder em{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;font-style:normal;color:var(--muted)}
    .ladder a.hit{background:var(--ink);color:var(--paper)}
    .ladder a.hit em{color:#b9b8b2}
    .pending{border-left:4px solid var(--accent);padding:12px 16px;background:#f1f0ea}
    .empty{padding:36px 16px;text-align:center;border:1px solid var(--rule);font:600 14px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
    .viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot .rec{display:inline-flex;align-items:center;gap:7px}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace}
    .sitefoot .links a{color:#B9B8B2;text-decoration:none}
    @media (max-width:700px){
      .sitehead,.sitefoot,header,main{padding-left:16px;padding-right:16px}
      table{display:block;overflow-x:auto}
    }
`;

function navMark(current) {
  const items = [
    ['/', 'Home', 'home'],
    ['/daily/', 'The Record', 'daily'],
    ['/dashboard', 'Dashboard', 'dashboard'],
    ['/penalties', 'Violations', 'penalties'],
    ['/milestones', 'Milestones', 'milestones'],
    ['/partner', 'Local AP', 'partner'],
  ];
  return items.map(([href, label, key]) =>
    `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}

function shell({ title, desc, canonical, current, eyebrow, h1, crumbs, body }) {
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description: desc,
        about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: h1, item: canonical },
      ] },
    ],
  });
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(desc)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry — Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <link rel="icon" type="image/png" href="${SITE_ORIGIN}/favicon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Micheal Ray Berry — Public Accountability Project">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(desc)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.jpg">
  <script type="application/ld+json">${schema}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Public Accountability Project</span></a>
  <nav class="sitenav">
    <span class="nav-primary">${navMark(current)}</span>
    <span class="nav-secondary"><a href="/positions/">Inspection Standard</a><a href="/agreement">Agreement</a><a href="/about">About</a></span>
  </nav>
</div></div>
<header>
  <nav class="crumbs">${crumbs}</nav>
  <div class="eyebrow">${htmlEscape(eyebrow)}</div>
  <h1>${htmlEscape(h1)}</h1>
</header>
<main>
${body}
</main>
<div class="sitefoot"><div class="sitefoot-in">
  <div class="sitefoot-top">
    <div><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
    <div><span class="colhead">Official record</span><span class="links"><a href="${SITE_ORIGIN}">Website</a></span></div>
  </div>
  <div class="sitefoot-bottom">
    <span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span>
    <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a>
    <a href="https://github.com/ap-michealrayberry/michealrayberry.com" target="_blank" rel="noopener">Site History</a>
  </div>
</div></div>
</body>
</html>`;
}

function chartSvg(records) {
  const pts = records.length
    ? records
    : [{ day: 1, weight: START_WEIGHT }];
  const minW = 170;
  const maxW = 340;
  const w = 1000;
  const h = 280;
  const l = 56;
  const r = 980;
  const t = 20;
  const b = 250;
  const n = Math.max(pts.length - 1, 1);
  const xy = pts.map((p, i) => {
    const x = l + ((r - l) * i) / n;
    const y = t + ((maxW - p.weight) / (maxW - minW)) * (b - t);
    return [x, y];
  });
  const goalY = t + ((maxW - GOAL_WEIGHT) / (maxW - minW)) * (b - t);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dots = xy.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#141412"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Weight record from 340 pounds toward 175">
    <line x1="${l}" y1="${t}" x2="${l}" y2="${b}" stroke="#141412"/>
    <line x1="${l}" y1="${b}" x2="${r}" y2="${b}" stroke="#141412"/>
    <line x1="${l}" y1="${goalY.toFixed(1)}" x2="${r}" y2="${goalY.toFixed(1)}" stroke="#B3261E" stroke-dasharray="6 5"/>
    <text x="${l + 8}" y="${goalY - 6}" fill="#B3261E" font-family="IBM Plex Mono,monospace" font-size="13">GOAL 175</text>
    <text x="8" y="${t + 8}" fill="#6B6A64" font-family="IBM Plex Mono,monospace" font-size="12">340</text>
    <text x="8" y="${b + 4}" fill="#6B6A64" font-family="IBM Plex Mono,monospace" font-size="12">170</text>
    <polyline points="${line}" fill="none" stroke="#141412" stroke-width="2.5"/>
    ${dots}
  </svg>`;
}

export function dashboardPage(records = []) {
  const latest = records.at(-1) || null;
  const current = latest ? latest.weight : START_WEIGHT;
  const lost = START_WEIGHT - current;
  const remaining = Math.max(0, current - GOAL_WEIGHT);
  const span = START_WEIGHT - GOAL_WEIGHT;
  const pct = Math.max(0, Math.min(100, (lost / span) * 100));
  const today = new Date().toISOString().slice(0, 10);
  const day = latest ? latest.day : Math.max(1, dayNumber(today < START_DATE ? START_DATE : today));
  const rows = records.length
    ? records.map((r, i) => {
      const prev = i ? records[i - 1].weight : START_WEIGHT;
      const delta = r.weight - prev;
      const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
      const color = delta < 0 ? '#1B6E3C' : delta > 0 ? '#B3261E' : '#6B6A64';
      const href = `/daily/${r.date}-day-${String(r.day).padStart(3, '0')}/`;
      return `<tr>
        <td><a href="${href}">${r.day}</a></td>
        <td>${htmlEscape(longDate(r.date))}</td>
        <td><strong>${r.weight.toFixed(1)} lb</strong></td>
        <td style="color:${color}">${delta === 0 ? '0.0' : sign + Math.abs(delta).toFixed(1)}</td>
        <td>${htmlEscape(r.note || '')}</td>
      </tr>`;
    }).reverse().join('\n')
    : `<tr><td colspan="5"><div class="empty">Day ${day} is open — no weigh-in has been filed yet</div></td></tr>`;

  const body = `
  <div class="viewsw"><a href="/daily/">Days</a><a href="/weeks/">Weeks</a><a href="/dashboard" aria-current="page">Dashboard</a></div>
  <p class="intro">Every official weigh-in from Day 1. Pre-start calibration readings are not part of this log. Up, down, or flat — it gets posted. Completion requires 28 consecutive days at or below 175 pounds.</p>
  <div class="statgrid">
    <div><span>Project day</span><b>${day}</b></div>
    <div><span>Start</span><b>${START_WEIGHT}</b></div>
    <div><span>Last recorded</span><b>${latest ? latest.weight.toFixed(1) : '—'}</b></div>
    <div><span>Lost so far</span><b>${latest ? lost.toFixed(1) : '0.0'}</b></div>
    <div><span>To goal</span><b>${remaining.toFixed(1)}</b></div>
  </div>
  <p class="stats"><span>340 lbs</span><span>${pct.toFixed(0)}% of 165 lbs eliminated</span><span>175 lbs</span></p>
  <div class="bar" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></div>
  ${chartSvg(records)}
  <h2>Weigh-in log</h2>
  <table><thead><tr><th>Day</th><th>Date</th><th>Weight</th><th>Change</th><th>Note</th></tr></thead><tbody>
  ${rows}
  </tbody></table>
  <p><a href="/daily/">Daily record</a> · <a href="/milestones">Milestones</a> · <a href="/weeks/">Weekly summaries</a></p>`;

  return shell({
    title: 'Dashboard — Weigh-in log — Micheal Ray Berry',
    desc: `Official weigh-in log for the Micheal Ray Berry Public Accountability Project: ${records.length} recorded ${records.length === 1 ? 'day' : 'days'} from 340 pounds toward 175.`,
    canonical: `${SITE_ORIGIN}/dashboard`,
    current: 'dashboard',
    eyebrow: 'Tracked data — updated with every weigh-in',
    h1: 'Dashboard',
    crumbs: '<a href="/">Micheal Ray Berry</a> / Dashboard',
    body,
  });
}

export function penaltiesIndexPage(violations = []) {
  const rows = violations.length
    ? violations.map((v) => `<tr>
        <td><a href="/violations/${htmlEscape(v.slug)}/">${htmlEscape(v.id)}</a></td>
        <td>${htmlEscape(v.date)}</td>
        <td>${htmlEscape(v.what)}</td>
        <td>${htmlEscape(v.state)}</td>
        <td>${htmlEscape(v.submitted || '—')}</td>
        <td>${htmlEscape(v.resolved || '—')}</td>
        <td>${htmlEscape(v.verification || '—')}</td>
      </tr>`).join('\n')
    : `<tr><td colspan="7"><div class="empty">No violations recorded — the record is clean</div></td></tr>`;

  const body = `
  <p class="intro">A violation is a documentation failure — missed, late, incomplete, or refused. Weight fluctuation is never a violation. Entries stay published; completing the corrective session closes the obligation, it does not erase the row.</p>
  <p class="stats"><span>${violations.length} on record</span><span><a href="/corner-time/">Corrective standard</a></span><span><a href="/violations/v-000/">Specimen entry</a></span></p>
  <h2>Violation log</h2>
  <table><thead><tr><th>No.</th><th>Date</th><th>Requirement missed</th><th>Status</th><th>Submitted</th><th>Resolved</th><th>AP verification</th></tr></thead><tbody>
  ${rows}
  <tr>
    <td><a href="/violations/v-000/">V-000</a></td>
    <td>2026-08-13</td>
    <td>Demonstration — what a violation entry looks like. Answers no violation.</td>
    <td>specimen</td>
    <td>—</td>
    <td>—</td>
    <td>Not a violation</td>
  </tr>
  </tbody></table>
  <p><a href="/agreement">The signed agreement</a> · <a href="/daily/">Daily record</a></p>`;

  return shell({
    title: 'Violation Log — Micheal Ray Berry Public Accountability Project',
    desc: 'Permanent public violation log for the Micheal Ray Berry Public Accountability Project. Documentation failures only — weight fluctuation is never a violation.',
    canonical: `${SITE_ORIGIN}/penalties`,
    current: 'penalties',
    eyebrow: 'Permanent archival record',
    h1: 'Violation Log',
    crumbs: '<a href="/">Micheal Ray Berry</a> / Violations',
    body,
  });
}

export function milestonesIndexPage(entries = []) {
  const latest = entries.at(-1)?.record || null;
  const current = latest ? latest.weight : START_WEIGHT;
  const cells = MILESTONES.map((m) => {
    const hit = entries.find(({ record }) => record.weight <= m);
    const toGo = Math.max(0, current - m);
    return `<a class="${hit ? 'hit' : ''}" href="/milestones/${m}-lb/">
      <b>${m}</b>
      <em>${hit ? `Day ${hit.record.day}` : `${toGo.toFixed(0)} lb to go`}</em>
    </a>`;
  }).join('');

  const body = `
  <p class="intro">Six official checkpoints. Each requires an on-camera weigh-in and a milestone video. Reaching one resets the future violation count; it does not erase what is already on the record.</p>
  <div class="ladder">${cells}</div>
  <p class="pending">${latest
    ? `Latest recorded weight: ${latest.weight.toFixed(1)} lb on ${htmlEscape(longDate(latest.date))}, Day ${latest.day}.`
    : 'No official weigh-in has been filed yet. The ladder starts at 340 pounds on 13 August 2026.'}</p>
  <p><a href="/dashboard">Weigh-in log</a> · <a href="/daily/">Daily record</a></p>`;

  return shell({
    title: 'Milestones — 300 to 175 lb — Micheal Ray Berry',
    desc: 'Official milestone ladder for the Micheal Ray Berry Public Accountability Project: 300, 275, 250, 225, 200, and 175 pounds.',
    canonical: `${SITE_ORIGIN}/milestones`,
    current: 'milestones',
    eyebrow: '§6 — Official milestones',
    h1: 'The Milestone Ladder',
    crumbs: '<a href="/">Micheal Ray Berry</a> / Milestones',
    body,
  });
}

export function updatesPage() {
  const body = `
  <p class="intro">Official entries are posted by the Accountability Partner. Personal notes are posted by Micheal Ray Berry. Nothing is silently altered or deleted — a correction is appended with a date.</p>
  <div class="empty">No updates have been posted yet</div>
  <p><a href="/daily/">Daily record</a> · <a href="/agreement">Agreement</a></p>`;
  return shell({
    title: 'Updates — Micheal Ray Berry Public Accountability Project',
    desc: 'Chronological official updates and personal notes from the Micheal Ray Berry Public Accountability Project.',
    canonical: `${SITE_ORIGIN}/updates`,
    current: 'home',
    eyebrow: 'Chronological — newest first',
    h1: 'Updates',
    crumbs: '<a href="/">Micheal Ray Berry</a> / Updates',
    body,
  });
}

export function uniformPage() {
  const body = `
  <p class="intro">All official project content must show Micheal Ray Berry under the same conditions each time — clearly identified, visually inspected, and publicly documented.</p>
  <div class="viewsw"><a href="/positions/">Inspection</a><a href="/uniform" aria-current="page">Uniform</a></div>
  <h2>Requirement 1 — Black full-body unitard</h2>
  <p>Creates a consistent visual baseline. Prevents ordinary clothing from hiding or changing the appearance of the body over time. Its purpose is not fashion. Its purpose is documentation.</p>
  <h2>Requirement 2 — Plain black shoes</h2>
  <p>Required for all official full-body documentation. They complete the project uniform and ensure each inspection presents the same full-body visual standard from head to toe.</p>
  <h2>Required pose and angles</h2>
  <p>Standing upright, hands behind head, body visible, face visible, no concealment of body shape. Every inspection documents four angles: front, left side, right side, and rear. A normal Daily Inspection runs roughly a minute. The same attire, pose, angle, and no-concealment standards apply to the four required daily photos.</p>
  <p class="pending">No anonymous content. No casual documentation. No hidden identity. No inconsistent visual record.</p>
  <p><a href="/positions/">Inspection standard</a> · <a href="/agreement">Agreement</a></p>`;
  return shell({
    title: 'Project Uniform — Micheal Ray Berry Public Accountability Project',
    desc: 'Required project uniform for the Micheal Ray Berry Public Accountability Project: black full-body unitard, plain black shoes, four-angle documentation.',
    canonical: `${SITE_ORIGIN}/uniform`,
    current: 'home',
    eyebrow: 'Required standard — all official content',
    h1: 'Project Uniform',
    crumbs: '<a href="/">Micheal Ray Berry</a> / Uniform',
    body,
  });
}


export function partnerPage() {
  const body = `
  <p class="intro">This project is administered by a remote Accountability Partner. It now needs a second Partner who can be present in person, locally, to carry the parts of the role that cannot be done over a screen.</p>
  <p>This is a real enforcement role, not a symbolic one. It carries genuine authority: within the written rules, the Partner's judgment on the record is final, and it is not negotiable in the moment. Any appointment is formalized by a signed amendment to the agreement.</p>
  <h2>What you would do</h2>
  <p>You would enforce the signed agreement in person, with real authority over how it is carried out. That includes directing and supervising corrective corner time — 10, 20, or 30 minutes by level, in the project uniform, recorded in a single unbroken take. The role is conducted strictly under the agreement: safe-for-work under §10.4, with your identity kept private under §12.2.</p>
  <ul>
    <li>Verify weigh-ins in person.</li>
    <li>Supervise corrective corner-time sessions.</li>
    <li>Confirm or reject violations against the written rules.</li>
    <li>Help administer the website and the official record.</li>
    <li>Hold the signed agreement and the record keys.</li>
    <li>Set additional daily structure and requirements in support of the goal, enforced on the same terms (§3.1).</li>
    <li>Conduct the weekly review.</li>
    <li>Appear on camera as needed, with your face and identity kept private (§12.2).</li>
  </ul>
  <h2>You can hold the line</h2>
  <p>There is one requirement, and it is the whole role: you must be able to enforce the agreement exactly as written — including, and especially, when Micheal asks you not to.</p>
  <p class="pending">The project only works if the person running it does not soften it in the moment. If that is not you, this is not the role for you.</p>
  <h2>To apply</h2>
  <p>Write to the Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></p>
  <p><a href="/agreement">Read the signed agreement</a> · <a href="/about">About the project</a></p>`;
  return shell({
    title: 'Local Accountability Partner Wanted — Micheal Ray Berry',
    desc: 'The Public Accountability Project is seeking a local, in-person Accountability Partner to verify weigh-ins, supervise corrective corner time, and confirm violations against the written rules.',
    canonical: `${SITE_ORIGIN}/partner`,
    current: 'partner',
    eyebrow: '§12.2 — Accountability Partner',
    h1: 'Local Accountability Partner Wanted',
    crumbs: '<a href="/">Micheal Ray Berry</a> / Local AP',
    body,
  });
}

export async function writeArchivePages(root, { records = [], violations = [], entries = [] } = {}) {
  const pages = [
    ['dashboard', dashboardPage(records)],
    ['penalties', penaltiesIndexPage(violations)],
    ['milestones', milestonesIndexPage(entries)],
    ['uniform', uniformPage()],
    ['updates', updatesPage()],
    ['partner', partnerPage()],
  ];
  const changed = [];
  for (const [slug, html] of pages) {
    const file = path.join(root, slug, 'index.html');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const prev = await fs.readFile(file, 'utf8').catch(() => null);
    if (prev === html) continue;
    await fs.writeFile(file, html);
    changed.push(`${SITE_ORIGIN}/${slug}`);
  }
  return changed;
}
