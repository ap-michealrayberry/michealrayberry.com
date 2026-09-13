/* Static renderer for the public shell — home, dashboard, penalties,
   milestones, uniform, updates, about, agreement.

   The single source is site.template.html (the former SPA). Every {{ hole }},
   <sc-for>, and <sc-if> is resolved HERE, at build time, from the record
   sheet, so the delivered HTML contains the facts and no template braces.
   JavaScript on these pages only enhances: /record.js refreshes the counters
   from the live sheet, /live.js runs the supervision console. Nothing the
   record states depends on a script running. */

import fs from 'node:fs/promises';
import path from 'node:path';

const VIEWS = [
  { page: 'home', slug: '', label: 'Home', title: 'Micheal Ray Berry — under public accountability, 340 to 200',
    desc: 'A voluntary public accountability record. Declared start 340 lb, toward 200, documented daily under his real name. Archive: /daily/. Violations: /penalties.' },
  { page: 'dashboard', slug: 'dashboard', label: 'Dashboard', title: 'Dashboard — weigh-in log, weight chart, daily photographs — Micheal Ray Berry',
    desc: 'The weigh-in log, the weight chart, the milestone ladder, and every daily documentation photograph of the Micheal Ray Berry Public Accountability Project.' },
  { page: 'penalties', slug: 'penalties', label: 'Penalties', title: 'Violation Log — Micheal Ray Berry Public Accountability Project',
    desc: 'The permanent public record of every Violation Event: date, requirement missed, status, submission and resolution timestamps, and the Accountability Partner\u2019s verification.' },
  { page: 'milestones', slug: 'milestones', label: 'Milestones', title: 'Milestone Ladder — 320 to 200 | Micheal Ray Berry',
    desc: 'The six official milestones between 340 and 200 pounds, each reached or not, computed live from the weigh-in record.' },
  { page: 'uniform', slug: 'uniform', label: 'Uniform', title: 'Project Uniform — Micheal Ray Berry Public Accountability Project',
    desc: 'The required uniform for all official content: a plain black unitard and a plain collar, worn identically in every recording so the record stays comparable day to day.' },
  { page: 'updates', slug: 'updates', label: 'Updates', title: 'Updates — Micheal Ray Berry Public Accountability Project',
    desc: 'Official entries by the Accountability Partner and dated notes on the record, newest first.' },
  { page: 'about', slug: 'about', label: 'About', title: 'About the Project \u2014 Micheal Ray Berry',
    desc: 'Why this public accountability project exists, how it is administered by an independent Accountability Partner, and the documentation standard behind the record.' },
  { page: 'agreement', slug: 'agreement', label: 'Agreement', title: 'The Signed Accountability Agreement \u2014 Micheal Ray Berry',
    desc: 'The public summary of the signed Public Accountability Agreement: daily requirements, documentation standard, weigh-ins, violations, corrective sessions, and record permanence.' },
];

const MILESTONES = [320, 300, 275, 250, 225, 200];
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">';

/* ── template engine ─────────────────────────────────────────────── */
function lookup(scope, expr) {
  const p = String(expr).trim();
  if (p === 'true') return true;
  if (p === 'false') return false;
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}
function blockEnd(tpl, tag, start) {
  const open = '<' + tag, close = '</' + tag + '>';
  let depth = 0, i = start;
  for (;;) {
    const no = tpl.indexOf(open, i), nc = tpl.indexOf(close, i);
    if (nc === -1) throw new Error('unclosed ' + tag + ' at ' + start);
    if (no !== -1 && no < nc) { depth++; i = no + open.length; }
    else { depth--; i = nc + close.length; if (depth === 0) return i; }
  }
}
function fill(html, scope) {
  return html
    .replace(/\s+(onClick|ref|style-hover|style-active|style-focus|data-photo-src)="[^"]*"/g, '')
    .replace(/\s+aria-current="\{\{\s*([^}]+?)\s*\}\}"/g, (m, p) => (lookup(scope, p) === 'page' ? ' aria-current="page"' : ''))
    .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, p) => {
      const v = lookup(scope, p);
      if (v == null || v === false || typeof v === 'function' || typeof v === 'object') return '';
      return String(v);
    });
}
function expand(tpl, scope) {
  let out = '', i = 0;
  for (;;) {
    const f = tpl.indexOf('<sc-for', i), c = tpl.indexOf('<sc-if', i);
    let next = -1, tag = '';
    if (f !== -1 && (c === -1 || f < c)) { next = f; tag = 'sc-for'; } else if (c !== -1) { next = c; tag = 'sc-if'; }
    if (next === -1) { out += fill(tpl.slice(i), scope); return out; }
    out += fill(tpl.slice(i, next), scope);
    const end = blockEnd(tpl, tag, next);
    const block = tpl.slice(next, end);
    const openEnd = block.indexOf('>');
    const openTag = block.slice(0, openEnd + 1);
    const inner = block.slice(openEnd + 1, block.length - (tag.length + 3));
    if (tag === 'sc-if') {
      const m = openTag.match(/value="\{\{\s*([^}]+?)\s*\}\}"/);
      if (m && lookup(scope, m[1])) out += expand(inner, scope);
    } else {
      const lm = openTag.match(/list="\{\{\s*([^}]+?)\s*\}\}"/);
      const am = openTag.match(/\sas="(\w+)"/);
      const list = lm ? lookup(scope, lm[1]) : [];
      const as = am ? am[1] : 'item';
      (Array.isArray(list) ? list : []).forEach((it, k) => { out += expand(inner, Object.assign({}, scope, { [as]: it, $index: k })); });
    }
    i = end;
  }
}

/* ── values (mirrors the former renderVals, computed from the sheet) ── */
function computeValues(ctx) {
  const { rows, violations, updates, siteState, attestMap, photoFiles, findPhoto, relUrl, videoEmbed, longDate, htmlEscape, normalizeDate, START_DATE, todayIso, SITE_ORIGIN } = ctx;
  const esc = (s) => htmlEscape(String(s == null ? '' : s));
  const startWeight = 340, goalWeight = 200;
  const dayOf = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_DATE + 'T12:00:00Z')) / 864e5) + 1;
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const fmtDate = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));
  const normalizeDrive = (u) => { const m = String(u || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|thumbnail\?id=|uc\?id=)([\w-]+)/); return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200' : String(u || ''); };

  const rawDay = dayOf(todayIso);
  const dayNumber = Math.max(0, rawDay);
  const all = (rows || []).slice(1).map((r) => ({
    date: normalizeDate(r[0]), weight: Number.parseFloat(r[1]), note: String(r[2] || '').trim(),
    photo: String(r[3] || '').trim(), left: String(r[4] || '').trim(), rear: String(r[5] || '').trim(), right: String(r[6] || '').trim(), video: String(r[7] || '').trim(),
  })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date >= START_DATE);
  const byDate = {}; all.forEach((e) => { byDate[e.date] = e; });
  const data = all.filter((e) => !Number.isNaN(e.weight)).sort((a, b) => a.date.localeCompare(b.date));
  const last = data.at(-1) || null;
  const current = last ? last.weight : startWeight;
  const lost = Math.max(0, startWeight - current), remaining = Math.max(0, current - goalWeight);
  const pct = Math.min(100, Math.max(0, (lost / (startWeight - goalWeight)) * 100));

  // weekly strip
  const daysSince = Math.max(0, dayNumber - 1);
  const closedWeek = Math.floor(daysSince / 7);
  let wrClosed = 'Week 1 closes with Day 7.';
  if (closedWeek >= 1) {
    const ws = new Date(START_DATE + 'T12:00:00Z'); ws.setUTCDate(ws.getUTCDate() + (closedWeek - 1) * 7);
    const we = new Date(ws); we.setUTCDate(we.getUTCDate() + 6);
    const iso = (d) => d.toISOString().slice(0, 10);
    const inWeek = data.filter((r) => r.date >= iso(ws) && r.date <= iso(we));
    const before = data.filter((r) => r.date < iso(ws));
    const base = before.length ? before.at(-1).weight : (inWeek.length ? inWeek[0].weight : NaN);
    const endW = inWeek.length ? inWeek.at(-1).weight : NaN;
    wrClosed = Number.isNaN(endW) ? 'Week ' + closedWeek + ' closed — no recorded entries.'
      : 'Week ' + closedWeek + ' closed: ' + base.toFixed(1) + ' → ' + endW.toFixed(1) + ' (' + (endW - base <= 0 ? '−' : '+') + Math.abs(endW - base).toFixed(1) + ' lb)';
  }
  const wrCurrent = closedWeek >= 1 ? 'Week ' + (closedWeek + 1) + ' in progress — day ' + ((daysSince % 7) + 1) + ' of 7.' : '';

  // chart
  const X0 = 60, X1 = 990, Y0 = 20, Y1 = 300, W_TOP = 340, W_BOT = 170;
  const maxDay = Math.max(dayNumber, 28);
  const xOf = (d) => X0 + ((d - 1) / Math.max(1, maxDay - 1)) * (X1 - X0);
  const yOf = (w) => Y0 + ((W_TOP - w) / (W_TOP - W_BOT)) * (Y1 - Y0);
  const chartDots = data.map((e) => ({ x: xOf(dayOf(e.date)).toFixed(1), y: yOf(e.weight).toFixed(1) }));
  const chart = { goalY: yOf(goalWeight).toFixed(1), goalLabelY: (yOf(goalWeight) - 10).toFixed(1), points: chartDots.map((d) => d.x + ',' + d.y).join(' '), dots: chartDots };

  const logRows = data.slice().reverse().map((e, i, arr) => {
    const prev = arr[i + 1];
    const delta = prev ? e.weight - prev.weight : 0;
    let change = '—', changeColor = '#6B6A64';
    if (prev) { if (delta < 0) { change = fmt(delta) + ' lbs'; changeColor = '#141412'; } else if (delta > 0) { change = '+' + fmt(delta) + ' lbs'; changeColor = '#B3261E'; } else change = '±0.0 lbs'; }
    return { day: dayOf(e.date) < 1 ? 'PRE' : String(dayOf(e.date)).padStart(2, '0'), date: fmtDate(e.date), weight: fmt(e.weight) + ' lbs', change, changeColor, note: esc(e.note) };
  });

  // violations
  const subEnds = (v) => { const m = String(v.submitted || '').match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/); if (!m) return null; const at = Date.parse(m[1] + 'T' + (m[2] ? String(m[2]).padStart(2, '0') + ':' + m[3] : '12:00') + ':00-04:00'); return Number.isNaN(at) ? null : at + 864e5; };
  const openList = (violations || []).filter((v) => v.state !== 'resolved' && !(v.state === 'corrected' && subEnds(v) && Date.now() >= subEnds(v)));
  const STATE_STYLE = { open: '#B3261E', corrected: '#8A6A1E', resolved: '#3A6B3A' };
  const penaltyRows = (violations || []).map((v) => ({
    num: String(v.n).padStart(3, '0'), href: '/violations/' + v.slug + '/', date: v.date, violation: esc(v.what),
    status: v.state, statusColor: STATE_STYLE[v.state], submitted: esc(v.submitted || '—'),
    resolved: esc(v.resolved || '—'),
    verification: esc(v.verification || (v.state === 'resolved' ? 'Verified by the AP' : v.state === 'corrected' ? 'Awaiting AP verification' : '—')),
    corrections: (v.corrections || []).map(esc), hasCorrections: (v.corrections || []).length > 0,
  }));
  const violDates = (violations || []).map((v) => v.date).sort();
  const lastViol = violDates.at(-1) || null;
  const cleanDays = rawDay < 1 ? 0 : (lastViol ? Math.max(0, dayOf(todayIso) - dayOf(lastViol)) : dayNumber);

  const attestedDays = Object.keys(attestMap || {}).filter((d) => /VALID/.test(String(attestMap[d] || ''))).length;

  let nextFound = false;
  const milestoneRows = MILESTONES.map((t) => {
    const hit = data.find((r) => r.weight <= t);
    let isNext = false; if (!hit && !nextFound) { isNext = true; nextFound = true; }
    return { targetLabel: t + ' LB', href: '/milestones/' + t + '-lb/', badge: hit ? 'REACHED' : (isNext ? 'NEXT' : 'AHEAD'),
      badgeBg: hit ? '#141412' : (isNext ? '#B3261E' : '#F1F0EA'), badgeFg: hit ? '#FAFAF7' : (isNext ? '#FFFFFF' : '#6B6A64'),
      detail: hit ? 'Reached ' + fmtDate(hit.date) + ' · Day ' + dayOf(hit.date) : fmt(Math.max(0, current - t)) + ' lb away at last recorded weight' };
  });
  const lowest = data.length ? Math.min(...data.map((e) => e.weight)) : startWeight;
  const milestoneCells = MILESTONES.map((m) => ({ label: String(m), tag: lowest <= m ? 'Reached' : (m === 200 ? 'Goal' : 'Ahead'), bg: lowest <= m ? '#141412' : '#FAFAF7', color: lowest <= m ? '#FAFAF7' : (m === 200 ? '#B3261E' : '#141412') }));

  // updates
  const ups = (updates && updates.length ? updates : [{ date: 'August 31, 2026', type: 'official', title: 'Entry 001 — Project Commencement', body: 'The project begins under Edition 2 of the agreement. The agreement declares a start of 340 lb. Nothing before this date is on the record.', link: '/daily/' }])
    .slice().sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  let n = 0;
  const updateRows = ups.map((u) => { const isPersonal = u.type === 'personal'; if (!isPersonal) n++; return { u, isPersonal, num: n }; }).reverse().map(({ u, isPersonal, num }) => ({
    date: esc(u.date), isPersonal,
    title: esc(isPersonal ? (u.title || 'Personal note') : (String(u.title || '').toLowerCase().indexOf('entry') === 0 ? u.title : 'Entry ' + String(num).padStart(3, '0') + ' — ' + u.title)),
    body: esc(u.body), author: isPersonal ? 'by Micheal Ray Berry' : 'by the AP',
    hasLink: /^https?:\/\//i.test(String(u.link || '')), link: /^https?:\/\//i.test(String(u.link || '')) ? esc(u.link) : '', linkLabel: 'Link',
    borderColor: isPersonal ? '#D8D6CF' : '#141412', bg: isPersonal ? '#F1F0EA' : '#FAFAF7', titleColor: isPersonal ? '#3A3935' : '#141412',
  }));

  // photo grid — the repo copy when the publisher has it, else the sheet URL
  const frontUrl = (w) => { const f = findPhoto(photoFiles, w.date, dayOf(w.date), 'front'); return f ? SITE_ORIGIN + relUrl(f) : normalizeDrive(w.photo); };
  const cells = all.filter((w) => w.photo && !Number.isNaN(w.weight)).map((w) => ({
    isMissed: false, isPhoto: true, missedLabel: '', date: w.date, weight: w.weight.toFixed(1) + ' LB', photo: esc(frontUrl(w)),
    href: '/daily/' + w.date + '-day-' + String(dayOf(w.date)).padStart(3, '0') + '/', borderColor: '#141412',
  }));
  for (let d = new Date(START_DATE + 'T12:00:00Z'); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso >= todayIso) break;
    const row = byDate[iso];
    if (row && row.photo && !Number.isNaN(row.weight)) continue;
    const partial = !!(row && (!Number.isNaN(row.weight) || row.left || row.rear || row.right || row.video));
    cells.push({ isMissed: true, isPhoto: false, date: iso, photo: '', weight: partial && !Number.isNaN(row.weight) ? row.weight.toFixed(1) + ' LB' : '', missedLabel: partial ? 'INCOMPLETE' : 'NO RECORD' });
  }
  const photoRows = cells.sort((a, b) => (a.date < b.date ? -1 : 1)).reverse();

  // videos
  const latestWithVideo = all.filter((r) => r.video).at(-1) || null;
  const latestVideoUrl = latestWithVideo ? latestWithVideo.video : '';
  const latestEmbed = videoEmbed(latestVideoUrl);
  const introUrl = String((siteState || {}).intro_video_url || '').trim();
  const introEmbed = videoEmbed(introUrl);

  const todayRow = byDate[todayIso];
  const packetDone = !!(todayRow && !Number.isNaN(todayRow.weight) && todayRow.photo);
  const openCount = openList.length;
  const ms = MILESTONES.filter((m) => m < current);

  return {
    dayNumber, dayCounterLabel: rawDay < 1 ? '—' : String(dayNumber),
    startLabel: fmt(startWeight), goalLabel: fmt(goalWeight),
    currentLabel: last ? fmt(current) : '—', lostLabel: fmt(lost), remainingLabel: fmt(remaining),
    pctLabel: pct.toFixed(1) + '%', pctWidth: Math.max(0.5, pct) + '%',
    cleanDays: String(cleanDays),
    nextMilestone: ms.length ? String(ms[0]) : '200',
    toMilestoneLabel: ms.length ? (current - ms[0] > 0 ? (current - ms[0]).toFixed(1) + ' lbs to go' : '') : (current <= 200 ? 'final milestone reached' : ''),
    wrClosed, wrCurrent,
    hasAttested: attestedDays > 0, attestedLabel: attestedDays + (attestedDays === 1 ? ' day attested ✓' : ' days attested ✓'),
    logRows, milestoneCells, milestoneRows, penaltyRows, hasPenalties: penaltyRows.length > 0, noPenalties: penaltyRows.length === 0,
    updateRows, photoRows, hasPhotos: photoRows.length > 0, hasExpanded: false, expandedAngles: [], hasExpandedAttested: false,
    hasAmendments: false, amendments: [],
    showVideos: true,
    introVideoEmbed: introEmbed, introVideoUrl: introUrl && !introEmbed ? esc(introUrl) : '', noIntroVideo: !introUrl,
    latestVideoEmbed: latestEmbed, latestVideoUrl: latestVideoUrl && !latestEmbed ? esc(latestVideoUrl) : '', noLatestVideo: !latestVideoUrl,
    latestVideoLabel: latestWithVideo ? 'Day ' + dayOf(latestWithVideo.date) + ' · ' + latestWithVideo.date : 'Daily inspection archive',
    inViolation: openCount > 0, openCountLabel: String(openCount), agreementStatus: 'under agreement · ' + openCount + ' open',
    complianceLabel: openCount > 0 ? (openCount === 1 ? 'Non-compliant — one unresolved violation' : 'Non-compliant — ' + openCount + ' unresolved violations')
      : (rawDay < 1 ? 'Under agreement' : packetDone ? 'Compliant — today’s packet filed' : 'Compliant — today’s packet due'),
    todayPacketLabel: rawDay < 1 ? '' : (packetDone ? 'Filed · ' : 'Not yet filed · ') + todayIso,
    _chart: chart,
  };
}

/* ── assembly ─────────────────────────────────────────────────────── */
export async function buildStaticSite(ctx) {
  const src = await fs.readFile(path.join(ctx.ROOT, 'site.template.html'), 'utf8');
  const headStart = src.indexOf('<head>') + 6, headEnd = src.indexOf('</head>');
  let head = src.slice(headStart, headEnd).replace(/\s*<script src="\.\/support\.js"><\/script>/, '').replace(/\s*<link rel="manifest"[^>]*>/, '');
  const hs = src.indexOf('<helmet'), he = src.indexOf('</helmet>') + 9;
  const helmet = src.slice(hs, he);
  const helmetStyle = (helmet.match(/<style[\s\S]*?<\/style>/) || [''])[0];
  const bodyStart = src.indexOf('</noscript>') + 11;
  const bodyEnd = src.lastIndexOf('</x-dc>');
  const bodyTpl = src.slice(bodyStart, bodyEnd);

  const vals = computeValues(ctx);
  const out = [];
  for (const v of VIEWS) {
    const scope = Object.assign({}, vals, {
      isHome: v.page === 'home', isDashboard: v.page === 'dashboard', isPenalties: v.page === 'penalties', isMilestones: v.page === 'milestones',
      isUniform: v.page === 'uniform', isUpdates: v.page === 'updates', isAbout: v.page === 'about', isAgreement: v.page === 'agreement',
    });
    for (const p of VIEWS) scope['is' + p.page[0].toUpperCase() + p.page.slice(1) + 'Nav'] = v.page === p.page ? 'page' : undefined;
    let body = expand(bodyTpl, scope);
    if (v.page === 'dashboard') {
      const c = vals._chart;
      body = body
        .replace(/(<line data-goal-line x1="60" y1=")[^"]*(" x2="990" y2=")[^"]*(")/, `$1${c.goalY}$2${c.goalY}$3`)
        .replace(/(<text data-goal-label x="66" y=")[^"]*(")/, `$1${c.goalLabelY}$2`)
        .replace(/<polyline data-series points=""/, `<polyline data-series points="${c.points}"`)
        .replace(/<g data-dots><\/g>/, '<g data-dots>' + c.dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="4" fill="#141412"></circle>`).join('') + '</g>');
    }
    const canonical = ctx.SITE_ORIGIN + '/' + v.slug;
    const pageHead = head
      .replace(/<title>[^<]*<\/title>/, `<title>${ctx.htmlEscape(v.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.desc)}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.title)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.desc)}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.title)}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.desc)}$2`);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>${pageHead}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS}
${helmetStyle}
<script src="/unsw.js"></script>
<script src="/live.js" defer></script>
<script src="/record.js" defer></script>
<script src="/livenav.js" defer></script>
</head>
<body>
${body.trim()}
</body>
</html>
`;
    out.push([v.slug, html, v.label]);
  }
  return out;
}
