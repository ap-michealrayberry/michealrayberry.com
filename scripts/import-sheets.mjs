#!/usr/bin/env node
/* One-off import of the Google Sheets record into D1 (migration step 1).

   Reads each tab as CSV — from --dir <folder> (files named like Weigh-ins.csv or
   Violation_Log.csv) or from the feed URL in the matching env var — and writes
   an SQL file of INSERTs plus one chained `events` row per table:

     node scripts/import-sheets.mjs --out import.sql [--dir sheets/]
     npx wrangler d1 execute mrb-record --local  --file import.sql   # check first
     npx wrangler d1 execute mrb-record --remote --file import.sql

   Run against an empty database only: the first statement inserts the genesis
   event, so a second run fails before writing anything else.

   Rows dated before Day 1 are imported as private history. The rules module
   never applies them (contract §1: nothing applies before activation). The
   legacy agreement-gate keys are not carried over; the AP records the Edition 2
   execution dates (§1, §13) before enforcement can start. */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { canonicalJson, eventHash, GENESIS } from '../src/events.ts';
import { etDate, etWallTime, isIsoDate } from '../src/rules.ts';

const TABS = {
  'Weigh-ins': { env: 'WEIGHINS_CSV', required: true, columns: ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video', 'video_sec'] },
  'Violation Log': { env: 'VIOLATION_CSV', required: true, columns: ['date', 'violation', 'status', 'submitted', 'resolved', 'ap_verification', 'corrections', 'recording', 'event_verification'] },
  'Attestation': { env: 'ATTESTATION_CSV', required: true, columns: ['logged_at_server', 'date', 'day', 'event', 'code', 'kind', 'video_sha256', 'photo_sha256s', 'weight', 'status', 'chunk_chain', 'chunk_count', 'server_seal', 'sealed_at'] },
  'Site State': { env: 'SITE_STATE_CSV', required: true, columns: ['key', 'value'] },
  'Confirmations': { env: 'CONFIRMATIONS_CSV', required: true, columns: ['logged_at', 'date', 'version', 'day', 'url', 'attestation_seal'] },
  'Supervision': { env: 'SUPERVISION_CSV', required: true, columns: ['date', 'required', 'status', 'start', 'end', 'stream_url', 'note'] },
  'Updates': { env: 'UPDATES_CSV', required: true, columns: ['date', 'type', 'title', 'body', 'link'] },
  // Private tabs: never published as feeds; export them from Sheets into --dir.
  'Corrective Log': { env: 'CORRECTIVE_CSV', columns: ['date', 'assignment', 'due', 'status', 'completed'] },
  'Health': { env: 'HEALTH_CSV', columns: ['date', 'steps', 'zone_minutes', 'active_minutes', 'synced_at', 'distance_mi', 'calories', 'weight_lb'] },
  'Weekly Log': { env: 'WEEKLY_CSV', columns: ['logged_at', 'date', 'week', 'documented', 'required', 'weight_lb', 'open_entries', 'url'] },
  'Observer': { env: 'OBSERVER_CSV', columns: ['received_at', 'type', 'record_ref', 'message', 'name', 'email', 'source_url', 'review', 'ap_note'] },
  'Contests': { env: 'CONTESTS_CSV', columns: ['received_at', 'violation_id', 'violation_date', 'reason', 'evidence_url', 'status'] },
  'Portal Filings': { env: 'PORTAL_FILINGS_CSV', columns: ['received_at', 'kind', 'violation_id', 'assignment_id', 'url', 'status'] },
  'Subscribers': { env: 'SUBSCRIBERS_CSV', columns: ['email', 'status', 'token', 'created', 'confirmed'] },
};

/* Site State keys that do not carry over. start_date is fixed by the contract
   (Day 1 = 2026-10-03, rules.ts); the test-phase keys are retired; the legacy
   gate keys recorded verifications made before Edition 2 existed. */
const DROPPED_STATE_KEYS = new Set([
  'start_date', 'test_start_date', 'test_mode',
  'mrb_signature_verified_at', 'ap_signature_verified_at',
  'agreement_confirmation_date', 'agreement_confirmation_verified_at', 'agreement_confirmation_fingerprint',
]);

// ---------------------------------------------------------------- parsing

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const header = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const text = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
const num = (v) => { const s = text(v); if (s === null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = num(v); return n === null ? null : Math.round(n); };

export function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (isIsoDate(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const parsed = new Date(s); // e.g. "Tue Sep 22 2026 00:00:00 GMT-0400 (Eastern Daylight Time)"
  return s && !Number.isNaN(parsed.getTime()) ? etDate(parsed) : s;
}

/** Sheets timestamps are Eastern wall time ("9/26/2026 23:16:16" or "2026-09-05 21:44"). */
export function etTimestamp(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s).toISOString();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    || s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return isIsoDate(normalizeDate(s)) ? normalizeDate(s) : s;
  const date = m[0].includes('/') ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : `${m[1]}-${m[2]}-${m[3]}`;
  const at = etWallTime(date, Number(m[4]), Number(m[5]));
  return new Date(at.getTime() + Number(m[6] || 0) * 1000).toISOString();
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// --------------------------------------------------- violation identities

/* Ported from publish.mjs so every /violations/v-<12hex>/ URL stays the same. */
export function verifiedViolation(marker, eventDate, eventText, today) {
  const match = String(marker || '').trim().match(/^APV1\|(\d{4}-\d{2}-\d{2})\|([a-f0-9]{64})$/);
  const what = String(eventText || '').trim();
  if (!match || !isIsoDate(eventDate) || !isIsoDate(match[1]) || !what) return null;
  if (match[1] < eventDate || match[1] > today) return null;
  return match[2] === sha256(`violation-v1\n${eventDate}\n${what}`) ? { verifiedAt: match[1], digest: match[2] } : null;
}

export function verifiedResolution(marker, resolutionDate, eventMarker, eventDate, verifiedAt, today) {
  const match = String(marker || '').trim().match(/^APR1\|(\d{4}-\d{2}-\d{2})\|([a-f0-9]{64})$/);
  const date = normalizeDate(resolutionDate);
  const source = String(eventMarker || '').trim();
  if (!match || !isIsoDate(date) || match[1] !== date || date < eventDate || date < verifiedAt || date > today) return null;
  return match[2] === sha256(`violation-resolution-v1\n${source}\n${date}`) ? date : null;
}

export function publicViolationId(digest) {
  return `V-${sha256(`public-violation-id-v1\n${digest}`).slice(0, 12).toUpperCase()}`;
}

function violationState(raw) {
  const s = String(raw || '').trim();
  if (/^\s*(resolved|satisfied|closed)/i.test(s) && !/unresolved/i.test(s)) return 'resolved';
  if (/^(submitted|corrected|pending)(?:\b|\s*[·\-–])/i.test(s)) return 'corrected';
  if (/^(rejected|dismissed)\b/i.test(s)) return 'rejected';
  return 'open';
}

// ------------------------------------------------------------- SQL output

const sqlValue = (v) => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL')
  : `'${String(v).replace(/'/g, "''")}'`);

function insert(table, row) {
  const cols = Object.keys(row);
  const values = cols.map((c) => (row[c] && typeof row[c] === 'object' && 'sql' in row[c] ? row[c].sql : sqlValue(row[c])));
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.join(', ')});`;
}

// ---------------------------------------------------------------- mapping

export function mapTables(tabs, today) {
  const out = {};
  const notes = [];
  const rows = (name) => tabs[name]?.rows ?? [];

  out.days = rows('Weigh-ins').map((r) => ({
    date: normalizeDate(r.date), weight_lb: num(r.weight_lb), note: text(r.note),
    photo_front: text(r.photo_front), photo_left: text(r.photo_left), photo_rear: text(r.photo_rear), photo_right: text(r.photo_right),
    video: text(r.video), video_sec: int(r.video_sec), stream_uid: text(r.stream_uid), r2_key: text(r.r2_key),
  })).filter((r) => isIsoDate(r.date));

  out.health = rows('Health').map((r) => ({
    date: normalizeDate(r.date), steps: int(r.steps), zone_minutes: int(r.zone_minutes), active_minutes: int(r.active_minutes),
    distance_mi: num(r.distance_mi), calories: int(r.calories), weight_lb: num(r.weight_lb), synced_at: etTimestamp(r.synced_at),
  })).filter((r) => isIsoDate(r.date));

  out.attestations = rows('Attestation').map((r) => ({
    logged_at: etTimestamp(r.logged_at_server), date: normalizeDate(r.date), day: int(r.day), event: text(r.event),
    code: text(r.code), kind: text(r.kind), video_sha256: text(r.video_sha256), photo_sha256s: text(r.photo_sha256s),
    weight: num(r.weight), status: text(r.status), chunk_chain: text(r.chunk_chain), chunk_count: int(r.chunk_count),
    server_seal: text(r.server_seal), sealed_at: etTimestamp(r.sealed_at),
  })).filter((r) => r.logged_at && isIsoDate(r.date));

  const publicIds = new Set();
  out.violations = rows('Violation Log').map((r) => {
    const date = normalizeDate(r.date);
    const what = String(r.violation || '').trim();
    const verified = verifiedViolation(r.event_verification, date, what, today);
    const row = {
      date, violation: what, status: 'flagged', status_note: text(r.status), verified_at: null,
      submitted_at: etTimestamp(r.submitted), resolved_at: null, ap_verification: text(r.ap_verification),
      corrections: String(r.corrections || '').trim(), recording: text(r.recording),
      event_marker: text(r.event_verification), public_id: null,
    };
    const state = violationState(r.status);
    if (!verified) {
      // Never AP-verified: an automated flag, not a Violation Event (§8).
      row.status = state === 'rejected' ? 'rejected' : 'flagged';
      return row;
    }
    row.verified_at = verified.verifiedAt;
    row.public_id = publicViolationId(verified.digest);
    if (publicIds.has(row.public_id)) throw new Error(`Violation Log: duplicate public id ${row.public_id} (${date})`);
    publicIds.add(row.public_id);
    const resolvedOn = verifiedResolution(r.ap_verification, r.resolved, r.event_verification, date, verified.verifiedAt, today);
    row.status = resolvedOn ? 'resolved' : state === 'corrected' && row.recording ? 'submitted' : 'open';
    row.resolved_at = resolvedOn;
    return row;
  }).filter((r) => isIsoDate(r.date) && r.violation);

  out.correctives = [];
  for (const r of rows('Corrective Log')) {
    const marker = String(r.status || '').match(/APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}/)?.[0];
    const minutes = int(String(r.assignment || '').match(/(10|20|30)\s*min/i)?.[1]);
    const id = text(r.assignment_id);
    if (!marker || !minutes || !id) { notes.push(`Corrective Log: skipped a row dated ${r.date} (no marker, minutes or assignment_id)`); continue; }
    out.correctives.push({
      violation_id: { sql: `(SELECT id FROM violations WHERE event_marker = ${sqlValue(marker)})` },
      assignment_id: id, assigned_at: normalizeDate(r.date), due_at: normalizeDate(r.due),
      level: minutes / 10, minutes, status: text(r.status), completed_at: text(r.completed) && normalizeDate(r.completed),
    });
  }

  out.supervision = rows('Supervision').map((r) => ({
    date: normalizeDate(r.date), required: /^(true|yes|1|required)$/i.test(String(r.required || '').trim()) ? 1 : 0,
    status: text(r.status) ?? 'SCHEDULED', start_at: etTimestamp(r.start), end_at: etTimestamp(r.end),
    stream_url: text(r.stream_url), note: text(r.note),
  })).filter((r) => isIsoDate(r.date));

  out.weekly = rows('Weekly Log').map((r) => ({
    logged_at: etTimestamp(r.logged_at), date: normalizeDate(r.date), week: int(r.week), documented: int(r.documented),
    required: int(r.required), weight_lb: num(r.weight_lb), open_entries: int(r.open_entries), url: text(r.url),
  })).filter((r) => r.logged_at && r.week !== null);

  out.confirmations = rows('Confirmations').map((r) => ({
    logged_at: etTimestamp(r.logged_at), date: normalizeDate(r.date), edition: int(r.version), day: int(r.day),
    url: text(r.url), attestation_seal: text(r.attestation_seal),
  })).filter((r) => r.logged_at && isIsoDate(r.date) && r.edition !== null);

  out.updates = rows('Updates').map((r) => {
    const type = (text(r.type) ?? 'official').toLowerCase();
    if (!['official', 'personal', 'amendment'].includes(type)) throw new Error(`Updates: unknown type "${r.type}"`);
    return { date: normalizeDate(r.date), type, title: text(r.title), body: text(r.body), link: text(r.link) };
  }).filter((r) => isIsoDate(r.date));

  out.site_state = [];
  for (const r of rows('Site State')) {
    const key = String(r.key || '').trim();
    if (!key) continue;
    if (DROPPED_STATE_KEYS.has(key)) { notes.push(`Site State: dropped ${key}`); continue; }
    let value = key === 'agreement_edition' ? String(r.value ?? '') : String(r.value ?? '').trim();
    if (/_date$/.test(key) && value) value = normalizeDate(value);
    out.site_state.push({ key, value });
  }

  out.correction_requests = rows('Contests').map((r) => ({
    received_at: etTimestamp(r.received_at),
    violation_id: { sql: `(SELECT id FROM violations WHERE public_id = ${sqlValue(String(r.violation_id || '').trim().toUpperCase())})` },
    reason: text(r.reason), evidence_url: text(r.evidence_url), status: text(r.status) ?? 'received',
  })).filter((r) => r.received_at && r.reason);

  out.portal_filings = rows('Portal Filings').map((r) => ({
    received_at: etTimestamp(r.received_at), kind: text(r.kind),
    violation_id: text(r.violation_id) ? { sql: `(SELECT id FROM violations WHERE public_id = ${sqlValue(r.violation_id.trim().toUpperCase())})` } : null,
    assignment_id: text(r.assignment_id), url: text(r.url), status: text(r.status) ?? 'received',
  })).filter((r) => r.received_at && r.kind);

  out.observer_reports = rows('Observer').map((r) => ({
    received_at: etTimestamp(r.received_at), type: text(r.type), record_ref: text(r.record_ref), message: text(r.message),
    name: text(r.name), email: text(r.email), source_url: text(r.source_url), review: text(r.review) ?? 'received', ap_note: text(r.ap_note),
  })).filter((r) => r.received_at);

  out.subscribers = rows('Subscribers').map((r) => ({
    email: text(r.email)?.toLowerCase(), status: (text(r.status) ?? '').toUpperCase(), token: text(r.token),
    created_at: etTimestamp(r.created), confirmed_at: etTimestamp(r.confirmed),
  })).filter((r) => r.email && r.token && ['PENDING', 'ACTIVE', 'UNSUBSCRIBED'].includes(r.status));

  return { tables: out, notes };
}

// -------------------------------------------------------------- main

async function loadTab(name, spec, dir) {
  let csv = null;
  if (dir) {
    for (const file of [`${name}.csv`, `${name.replace(/ /g, '_')}.csv`]) {
      if (existsSync(join(dir, file))) { csv = await readFile(join(dir, file), 'utf8'); break; }
    }
  }
  if (csv === null && process.env[spec.env]) {
    const res = await fetch(process.env[spec.env]);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    csv = await res.text();
  }
  if (csv === null) {
    if (spec.required) throw new Error(`${name}: no CSV (set ${spec.env} or put the file in --dir)`);
    return { missing: true };
  }
  const parsed = parseCsv(csv);
  const head = (parsed[0] || []).map(header);
  const matches = spec.columns.every((c, i) => head[i] === c);
  if (!matches) {
    // A gviz URL for a tab that does not exist returns the first tab instead.
    if (!spec.required) return { missing: true, reason: `header is ${head.slice(0, 4).join(',')}…` };
    throw new Error(`${name}: expected columns ${spec.columns.join(', ')}; got ${head.join(', ')}`);
  }
  const rows = parsed.slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  return { rows, sha256: sha256(csv) };
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, dir: { type: 'string' } } });
  if (!values.out) throw new Error('usage: node scripts/import-sheets.mjs --out import.sql [--dir sheets/]');
  const today = etDate(new Date());

  const tabs = {};
  for (const [name, spec] of Object.entries(TABS)) {
    tabs[name] = await loadTab(name, spec, values.dir);
    if (tabs[name].missing) console.warn(`${name}: not found, imported as empty${tabs[name].reason ? ` (${tabs[name].reason})` : ''}`);
  }
  const { tables, notes } = mapTables(tabs, today);
  for (const n of notes) console.warn(n);

  const sources = Object.fromEntries(Object.entries(tabs).filter(([, t]) => !t.missing).map(([n, t]) => [n, t.sha256]));
  const lines = [];
  let prev = GENESIS;
  const at = new Date().toISOString();
  const event = async (action, subject, payload) => {
    const row = { at, actor: 'system', action, subject, payload };
    const hash = await eventHash(prev, row);
    lines.push(insert('events', { at, actor: 'system', action, subject, payload: canonicalJson(payload), prev_hash: prev, hash }));
    prev = hash;
  };

  // Genesis first: on a non-empty database this fails before anything else is written.
  await event('import.start', null, { from: 'google-sheets', today, sources });
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) lines.push(insert(table, row));
    await event('import.table', table, { rows: rows.length });
    console.log(`${table}: ${rows.length}`);
  }
  await event('import.done', null, { tables: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])) });

  await writeFile(values.out, `${lines.join('\n')}\n`);
  console.log(`wrote ${lines.length} statements to ${values.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
