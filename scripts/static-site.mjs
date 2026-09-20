/* Static renderer for the public shell — home, dashboard,
   milestones, uniform, updates, about, agreement.

   The single source is site.template.html (the former SPA). Every {{ hole }},
   <sc-for>, and <sc-if> is resolved HERE, at build time, from the record
   sheet, so the delivered HTML contains the facts and no template braces.
   JavaScript on these pages only enhances the supervision console and shared
   navigation state. Nothing the record states depends on a script running. */

import fs from 'node:fs/promises';
import path from 'node:path';

const VIEWS = [
  { page: 'home', slug: '', label: 'Home', title: 'Micheal Ray Berry — public accountability, 340 to 200',
    desc: 'A voluntary public accountability record. Declared start: 340 lb on {{ startDateLong }}. Goal: 200 lb held for 28 consecutive days.' },
  { page: 'dashboard', slug: 'dashboard', label: 'Dashboard', title: 'Dashboard — weigh-in log, weight chart, daily photographs — Micheal Ray Berry',
    desc: 'The weigh-in log, weight chart, threshold ladder, and published daily documentation photographs of the Micheal Ray Berry Public Accountability Project.' },
  { page: 'milestones', slug: 'milestones', label: 'Milestones', title: 'Weight Thresholds — 320 to 200 | Micheal Ray Berry',
    desc: 'Six published weight thresholds between the declared 340-pound baseline and 200 pounds, each recorded or not from dated weigh-ins.' },
  { page: 'uniform', slug: 'uniform', label: 'Uniform', title: 'Project Uniform — Micheal Ray Berry Public Accountability Project',
    desc: 'The agreement defines black for routine documentation and pink for recorded corrective sessions; the agreement page reports current applicability.' },
  { page: 'updates', slug: 'updates', label: 'Updates', title: 'Updates — Micheal Ray Berry Public Accountability Project',
    desc: 'Official entries by the Accountability Partner and dated notes on the record, newest first.' },
  { page: 'about', slug: 'about', label: 'About', title: 'About the Project \u2014 Micheal Ray Berry',
    desc: 'Why this public accountability project exists, how it is administered by an independent Accountability Partner, and the documentation standard behind the record.' },
  { page: 'agreement', slug: 'agreement', label: 'Agreement', title: 'Accountability Agreement Status \u2014 Micheal Ray Berry',
    desc: 'The current status and public summary of the agreement: daily requirements, documentation standards, violations, corrective sessions, and limits.' },
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
    .replace(/\s+(onClick|ref|style-hover|style-active|style-focus)="[^"]*"/g, '')
    .replace(/\s+data-photo-src=/g, ' src=')
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
  const { rows, violations, updates, siteState, attestMap, photoFiles, findPhoto, relUrl, publicVideoUrl, videoEmbed, longDate, htmlEscape, normalizeDate, SITE_ORIGIN, START_DATE, todayIso } = ctx;
  const esc = (s) => htmlEscape(String(s == null ? '' : s));
  const startWeight = 340, goalWeight = 200;
  const dayOf = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_DATE + 'T12:00:00Z')) / 864e5) + 1;
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const canonicalOrigin = new URL(SITE_ORIGIN).origin;
  const publicLink = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('//') || raw.includes('\\')) return '';
    try {
      const parsed = new URL(raw, canonicalOrigin);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return '';
      if (raw.startsWith('/')) return parsed.origin === canonicalOrigin ? parsed.pathname + parsed.search + parsed.hash : '';
      return /^https:\/\//.test(raw) ? parsed.href : '';
    } catch {
      return '';
    }
  };
  const fmtDate = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));
  const isRealDate = (value) => {
    const date = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + 'T12:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const agreementEffectiveDate = String((siteState || {}).agreement_effective_date || '').trim();
  const agreementExecuted = String((siteState || {}).agreement_execution_active || '').trim().toLowerCase() === 'true'
    && isRealDate(agreementEffectiveDate) && agreementEffectiveDate <= todayIso;
  const rawDay = dayOf(todayIso);
  const dayNumber = Math.max(0, rawDay);
  const all = (rows || []).slice(1).map((r) => ({
    date: normalizeDate(r[0]), weight: Number.parseFloat(r[1]), note: String(r[2] || '').trim(),
    photo: String(r[3] || '').trim(), left: String(r[4] || '').trim(), rear: String(r[5] || '').trim(), right: String(r[6] || '').trim(), video: publicVideoUrl(r[7]),
  })).filter((e) => isRealDate(e.date) && e.date >= START_DATE && e.date <= todayIso);
  const byDate = {}; all.forEach((e) => { byDate[e.date] = e; });
  const data = all.filter((e) => !Number.isNaN(e.weight)).sort((a, b) => a.date.localeCompare(b.date));
  const last = data.at(-1) || null;
  const current = last ? last.weight : startWeight;
  const progress = Math.max(0, startWeight - current), remaining = Math.max(0, current - goalWeight);
  const fromDeclared = current - startWeight;
  const fromDeclaredLabel = fromDeclared === 0 ? '±0.0' : (fromDeclared > 0 ? '+' : '−') + fmt(Math.abs(fromDeclared));
  const pct = Math.min(100, Math.max(0, (progress / (startWeight - goalWeight)) * 100));

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

  // Attestation is supporting evidence, not a Daily Compliance Packet item.
  // Do not carry legacy attestation-only log rows forward as violations.
  const isLegacyAttestationOnly = (v) => /attestation/i.test(String(v?.what || ''));
  const publicViolations = (violations || []).filter((v) => (
    agreementExecuted && isRealDate(v.date) && v.date >= agreementEffectiveDate && !isLegacyAttestationOnly(v)
  ));

  // violations
  // Corrected entries remain unresolved until the AP explicitly verifies them.
  // Elapsed time must never close a public accountability entry automatically.
  const openList = publicViolations.filter((v) => v.state !== 'resolved');
  const STATE_STYLE = { open: '#B3261E', corrected: '#8A6A1E', resolved: '#3A6B3A' };
  const penaltyRows = publicViolations.map((v) => ({
    num: String(v.n).padStart(3, '0'), href: '/violations/' + v.slug + '/', date: v.date, violation: esc(v.what),
    status: v.state, statusColor: STATE_STYLE[v.state], submitted: esc(v.submitted || '—'),
    resolved: esc(v.resolved || '—'),
    verification: esc(v.verification || (v.state === 'resolved' ? 'Verified by the AP' : v.state === 'corrected' ? 'Awaiting AP verification' : '—')),
    corrections: (v.corrections || []).map(esc), hasCorrections: (v.corrections || []).length > 0,
  }));
  const violDates = publicViolations.map((v) => v.date).sort();
  const lastViol = violDates.at(-1) || null;
  const daysBetween = (later, earlier) => Math.round((
    Date.parse(later + 'T12:00:00Z') - Date.parse(earlier + 'T12:00:00Z')
  ) / 864e5);
  const cleanDays = !agreementExecuted ? 0 : (lastViol
    ? Math.max(0, daysBetween(todayIso, lastViol))
    : Math.max(0, daysBetween(todayIso, agreementEffectiveDate) + 1));

  const attestedDays = Object.keys(attestMap || {}).filter((d) => attestMap[d] === 'VALID-CONSUMED').length;

  let nextFound = false;
  const milestoneRows = MILESTONES.map((t) => {
    const hit = data.find((r) => r.weight <= t);
    let isNext = false; if (!hit && !nextFound) { isNext = true; nextFound = true; }
    return { targetLabel: t + ' LB', href: '/milestones/' + t + '-lb/', badge: hit ? 'THRESHOLD RECORDED' : (isNext ? 'NEXT' : 'AHEAD'),
      badgeBg: hit ? '#141412' : (isNext ? '#B3261E' : '#F1F0EA'), badgeFg: hit ? '#FAFAF7' : (isNext ? '#FFFFFF' : '#6B6A64'),
      detail: hit ? 'Weight recorded ' + fmtDate(hit.date) + ' · Day ' + dayOf(hit.date) : (last ? fmt(Math.max(0, current - t)) + ' lb away at last recorded weight' : 'No measured weight recorded yet') };
  });
  const lowest = data.length ? Math.min(...data.map((e) => e.weight)) : startWeight;
  const milestoneCells = MILESTONES.map((m) => ({ label: String(m), tag: data.length && lowest <= m ? 'Threshold recorded' : (m === 200 ? 'Goal' : 'Ahead'), bg: data.length && lowest <= m ? '#141412' : '#FAFAF7', color: data.length && lowest <= m ? '#FAFAF7' : (m === 200 ? '#B3261E' : '#141412') }));

  // updates
  const ups = (updates && updates.length ? updates : [{ date: longDate(START_DATE), type: 'official', title: 'Entry 001 — Project Commencement', body: 'The project begins under the published protocol and public record. The protocol declares a start of 340 lb. Nothing before this date is on the record. The Agreement page reports the current execution status.', link: '/daily/' }])
    .slice().sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  // amendments: Updates rows typed 'amendment' render on the agreement page (§12.1 log), newest first
  const amendments = ups.filter((u) => String(u.type || '').toLowerCase() === 'amendment').reverse()
    .map((u) => ({ date: esc(u.date), title: esc(u.title || 'Amendment'), summary: esc(u.body || '') }));
  let n = 0;
  const updateRows = ups.map((u) => { const isPersonal = u.type === 'personal'; if (!isPersonal) n++; return { u, isPersonal, num: n }; }).reverse().map(({ u, isPersonal, num }) => {
    const link = publicLink(u.link);
    const isAmendment = String(u.type || '').toLowerCase() === 'amendment';
    return {
      date: esc(u.date), isPersonal,
      title: esc(isPersonal ? (u.title || 'Personal note') : (String(u.title || '').toLowerCase().indexOf('entry') === 0 ? u.title : 'Entry ' + String(num).padStart(3, '0') + ' — ' + (isAmendment ? 'Amendment: ' : '') + u.title)),
      body: esc(u.body), author: isPersonal ? 'by Micheal Ray Berry' : 'by the AP',
      hasLink: Boolean(link), link: esc(link), linkLabel: 'Link',
      borderColor: isPersonal ? '#D8D6CF' : '#141412', bg: isPersonal ? '#F1F0EA' : '#FAFAF7', titleColor: isPersonal ? '#3A3935' : '#141412',
    };
  });

  // Photo URLs are emitted only for derivatives that exist in the repository.
  // A Sheet/Drive URL is never copied into public HTML as a fallback.
  const photoUrl = (w, angle) => {
    const file = findPhoto(photoFiles, w.date, dayOf(w.date), angle);
    const url = file ? String(relUrl(file) || '') : '';
    return /^\/photos\/(?!\/)/.test(url) ? url : '';
  };
  const frontUrl = (w) => photoUrl(w, 'front');
  const hasPublishedPhotos = (w) => ['front', 'left', 'rear', 'right'].every((angle) => photoUrl(w, angle));
  const hasCompletePublicPacket = (w) => !Number.isNaN(w.weight) && Boolean(w.video) && hasPublishedPhotos(w);
  const cells = all.filter(hasCompletePublicPacket).map((w) => ({
    isMissed: false, isPhoto: true, missedLabel: '', date: w.date, weight: w.weight.toFixed(1) + ' LB', photo: esc(frontUrl(w)),
    href: '/daily/' + w.date + '-day-' + String(dayOf(w.date)).padStart(3, '0') + '/', borderColor: '#141412',
  })).filter((w) => w.photo);
  for (let d = new Date(START_DATE + 'T12:00:00Z'); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso >= todayIso) break;
    const row = byDate[iso];
    if (row && hasCompletePublicPacket(row)) continue;
    const partial = !!(row && (!Number.isNaN(row.weight) || ['front', 'left', 'rear', 'right'].some((angle) => photoUrl(row, angle)) || row.video));
    cells.push({ isMissed: true, isPhoto: false, date: iso, photo: '', weight: partial && !Number.isNaN(row.weight) ? row.weight.toFixed(1) + ' LB' : '', missedLabel: partial ? 'INCOMPLETE' : 'NO RECORD' });
  }
  const photoRows = cells.sort((a, b) => (a.date < b.date ? -1 : 1)).reverse();

  // videos
  const latestWithVideo = all.filter((r) => r.video).at(-1) || null;
  const latestVideoUrl = latestWithVideo ? latestWithVideo.video : '';
  const latestEmbed = videoEmbed(latestVideoUrl);
  const introUrl = publicVideoUrl((siteState || {}).intro_video_url);
  const introEmbed = videoEmbed(introUrl);

  const todayRow = byDate[todayIso];
  const packetDone = !!(todayRow && !Number.isNaN(todayRow.weight) && hasPublishedPhotos(todayRow) && todayRow.video);
  const openCount = openList.length;
  const corner = cornerSummary(violations, agreementExecuted);
  const ms = MILESTONES.filter((m) => m < current);
  return {
    dayNumber, dayCounterLabel: rawDay < 1 ? '—' : String(dayNumber),
    startDateLong: esc(longDate(START_DATE)),
    startLabel: fmt(startWeight), goalLabel: fmt(goalWeight),
    currentLabel: last ? fmt(current) : '—', currentDateLabel: last ? esc(longDate(last.date)) : 'no measurement yet', lostLabel: last ? fromDeclaredLabel : '—', remainingLabel: last ? fmt(remaining) : '—',
    pctLabel: last ? pct.toFixed(1) + '%' : '—', pctWidth: last ? Math.max(0.5, pct) + '%' : '0%',
    cleanDays: agreementExecuted ? String(cleanDays) : '—',
    cleanDaysHeading: agreementExecuted ? 'Days without violation' : 'Requirements inactive',
    nextMilestone: ms.length ? String(ms[0]) : '200',
    toMilestoneLabel: !last ? 'No measured weight recorded yet' : ms.length ? (current - ms[0] > 0 ? (current - ms[0]).toFixed(1) + ' lbs to go' : '') : (current <= 200 ? 'final threshold recorded' : ''),
    wrClosed, wrCurrent,
    hasAttested: attestedDays > 0, attestedLabel: attestedDays + (attestedDays === 1 ? ' day attested ✓' : ' days attested ✓'),
    logRows, milestoneCells, milestoneRows, penaltyRows, hasPenalties: penaltyRows.length > 0, noPenalties: penaltyRows.length === 0,
    updateRows, photoRows, hasPhotos: photoRows.length > 0, hasExpanded: false, expandedAngles: [], hasExpandedAttested: false,
    hasAmendments: amendments.length > 0, amendments, amendmentsThrough: amendments.length ? amendments[0].date : '',
    showVideos: true,
    introVideoEmbed: introEmbed, introVideoUrl: introUrl && !introEmbed ? esc(introUrl) : '', noIntroVideo: !introUrl,
    latestVideoEmbed: latestEmbed, latestVideoUrl: latestVideoUrl && !latestEmbed ? esc(latestVideoUrl) : '', noLatestVideo: !latestVideoUrl,
    latestVideoLabel: latestWithVideo ? 'Day ' + dayOf(latestWithVideo.date) + ' · ' + latestWithVideo.date : 'Daily inspection archive',
    agreementExecuted, agreementInactive: !agreementExecuted,
    agreementEffectiveDateLong: agreementExecuted ? esc(longDate(agreementEffectiveDate)) : '',
    agreementStatusSentence: agreementExecuted
      ? 'The agreement is recorded as active effective ' + esc(longDate(agreementEffectiveDate)) + '.'
      : 'The agreement is pending counter-signature; its requirements are not yet active.',
    agreementScopeLabel: agreementExecuted ? 'Agreement scope' : 'Pending agreement scope',
    agreementRulesNoun: agreementExecuted ? 'The executed agreement' : 'The draft',
    agreementFullHeading: agreementExecuted ? 'Agreement — active' : 'Agreement — pending counter-signature',
    agreementConsentScopeLabel: agreementExecuted ? 'Recorded consent scope' : 'Proposed consent scope',
    footerTermsLabel: agreementExecuted ? 'published terms' : 'published pending terms',
    inViolation: agreementExecuted && openCount > 0,
    owedMinutes: String(corner.owed),
    servedMinutes: String(corner.served),
    openCountNum: String(openCount),
    dueAtIso: corner.soonestDueIso,
    dueAtLabel: corner.soonestDueLabel,
    dueRelative: corner.soonestDueRelative,
    overdueSuffix: corner.overdueSuffix,
    dueWord: corner.dueWord,
    allOverdue: corner.allOverdue,
    heroPhoto: agreementExecuted && openCount > 0 ? '/photos/official/micheal-ray-berry-correction-uniform.png' : '/photos/official/micheal-ray-berry-official-front-v2.jpg',
    heroPhotoAlt: agreementExecuted && openCount > 0 ? 'Micheal Ray Berry in the designated pink correction uniform. A documented requirement was missed and a corrective obligation is open.' : 'Micheal Ray Berry, official photograph — black unitard, steel or titanium collar, hands behind head. Declared start 340.',
    openCountHeading: agreementExecuted ? 'Unresolved violations' : 'Operative violations',
    openCountLabel: agreementExecuted ? String(openCount) : '—',
    agreementStatus: agreementExecuted
      ? 'agreement executed · ' + openCount + ' unresolved'
      : 'agreement pending counter-signature · requirements not yet active',
    projectStatusLabel: agreementExecuted ? 'Under agreement' : 'Public accountability record',
    deadlineHeading: agreementExecuted ? 'Deadline' : 'Proposed deadline',
    deadlineValue: agreementExecuted ? '10:00 PM ET daily' : '10:00 PM ET if activated',
    complianceLabel: !agreementExecuted ? 'Agreement pending — requirements not yet active'
      : openCount > 0 ? (openCount === 1 ? 'One unresolved violation' : openCount + ' unresolved violations')
        : (rawDay < 1 ? 'Record not yet started' : packetDone ? 'Today’s required media and weight filed' : 'Today’s packet due'),
    todayPacketLabel: !agreementExecuted ? 'Filed daily · counts toward the record once the agreement is active'
      : rawDay < 1 ? '' : (packetDone ? 'Required media and weight filed · ' : 'Due · ') + todayIso,
    _chart: chart,
  };
}

async function renderLlmsStartDate(ctx, startDateLong) {
  const file = path.join(ctx.ROOT, 'llms.txt');
  const source = await fs.readFile(file, 'utf8');
  const marker = /(<!-- START_DATE_LONG:BEGIN -->)[\s\S]*?(<!-- START_DATE_LONG:END -->)/g;
  const matches = [...source.matchAll(marker)];
  if (matches.length !== 2) {
    throw new Error(`llms.txt must contain exactly two START_DATE_LONG marker pairs; found ${matches.length}.`);
  }
  const rendered = source.replace(marker, `$1${startDateLong}$2`);
  if (rendered !== source) await fs.writeFile(file, rendered);
}

/* ── assembly ─────────────────────────────────────────────────────── */
/* Corner time owed / served and the soonest corrective deadline, from the
   Violation Log only. Level follows confirmed-count order (10/20/30, capped);
   the 72 h clock runs from the entry's declaration (eventVerifiedAt when
   present, else the violation date at 22:00 ET). Served = resolved entries. */
function cornerSummary(violations, active) {
  const minutesFor = (i) => [10, 20, 30][Math.min(2, i)];
  const confirmed = (violations || []).filter((v) => v.state === 'open' || v.state === 'resolved')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let owed = 0, served = 0, soonest = null, openN = 0, overdueN = 0;
  const now = Date.now();
  confirmed.forEach((v, i) => {
    const mins = minutesFor(i);
    if (v.state === 'resolved') { served += mins; return; }
    owed += mins; openN += 1;
    const base = v.eventVerifiedAt ? new Date(v.eventVerifiedAt) : new Date(`${v.date}T22:00:00-04:00`);
    const due = new Date(base.getTime() + 72 * 3600e3);
    if (Number.isNaN(due.getTime())) return;
    if (due.getTime() < now) overdueN += 1;
    if (!soonest || due < soonest) soonest = due;
  });
  const fmt = (d) => d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const rel = (d) => { const ms = d - Date.now(); const a = Math.abs(ms); const h = Math.floor(a / 3600e3), m = Math.floor((a % 3600e3) / 60e3); const txt = h >= 24 ? `${h} h` : h > 0 ? `${h} h ${m} m` : `${m} m`; return ms < 0 ? `overdue by ${txt}` : `${txt} remaining`; };
  return {
    owed: active ? owed : 0, served,
    soonestDueIso: active && soonest ? soonest.toISOString() : '',
    soonestDueLabel: active && soonest ? fmt(soonest) : '',
    soonestDueRelative: active && soonest ? rel(soonest) : '',
    overdueSuffix: !active || !openN ? '' : overdueN === openN ? ' · ALL OVERDUE' : overdueN > 0 ? ` · ${overdueN} OVERDUE` : '',
    dueWord: overdueN > 0 ? 'earliest due' : 'due',
    allOverdue: !!(active && openN && overdueN === openN),
    overdue: !!(active && soonest && soonest < new Date()),
  };
}

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
  await renderLlmsStartDate(ctx, vals.startDateLong);
  const out = [];
  for (const v of VIEWS) {
    const scope = Object.assign({}, vals, {
      isHome: v.page === 'home', isDashboard: v.page === 'dashboard', isMilestones: v.page === 'milestones',
      isUniform: v.page === 'uniform', isUpdates: v.page === 'updates', isAbout: v.page === 'about', isAgreement: v.page === 'agreement',
      isRecordSection: ['milestones', 'updates'].includes(v.page),
      isProtocolSection: ['uniform', 'agreement'].includes(v.page),
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
    const canonical = v.slug ? ctx.SITE_ORIGIN + '/' + v.slug + '/' : ctx.SITE_ORIGIN + '/';
    const description = fill(v.desc, vals);
    const pageHead = head
      .replace(/<title>[^<]*<\/title>/, `<title>${ctx.htmlEscape(v.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${ctx.htmlEscape(description)}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.title)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${ctx.htmlEscape(description)}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${ctx.htmlEscape(v.title)}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${ctx.htmlEscape(description)}$2`);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>${pageHead}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS}
${helmetStyle}
<script src="/unsw.js"></script>
${v.slug === 'live' ? '<script src="/live.js" defer></script>' : ''}
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
