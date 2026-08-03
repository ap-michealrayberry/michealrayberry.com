/* Spreadsheet parsing: columns are resolved by header name, never by
   position. Missing or duplicated required headers are hard failures, as are
   duplicate rows for the same Project Day — there is no silent resolution
   rule, so a duplicate means someone has to look at the sheet. */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  DATA_DIR, parseCSV, normalizeDate, assertIsoDate, dayNumber, fail,
} from './common.mjs';

export const REQUIRED_HEADERS = [
  'date', 'weight_lb', 'note',
  'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video',
];

export function indexHeaders(headerRow, required, context) {
  const names = headerRow.map((h) => String(h).trim().toLowerCase());
  const index = {};
  for (const name of required) {
    const hits = names.reduce((acc, h, i) => (h === name ? [...acc, i] : acc), []);
    if (hits.length === 0) throw fail(`${context}: required header "${name}" is absent. Headers seen: ${names.join(', ')}`);
    if (hits.length > 1) throw fail(`${context}: required header "${name}" appears ${hits.length} times (columns ${hits.join(', ')}).`);
    index[name] = hits[0];
  }
  return index;
}

export function parseWeighIns(csvText, context = 'weigh-ins') {
  const rows = parseCSV(csvText);
  if (rows.length === 0) throw fail(`${context}: sheet is empty.`);
  const col = indexHeaders(rows[0], REQUIRED_HEADERS, context);
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (name) => String(row[col[name]] ?? '').trim();
    const rawDate = get('date');
    if (!rawDate) continue;
    const date = normalizeDate(rawDate);
    assertIsoDate(date, `${context} row ${i + 1}`);
    const weightRaw = get('weight_lb');
    const record = {
      date,
      day: dayNumber(date),
      weight_lb: weightRaw === '' ? null : Number.parseFloat(weightRaw),
      note: get('note'),
      photos: {
        front: get('photo_front') || null,
        left: get('photo_left') || null,
        rear: get('photo_rear') || null,
        right: get('photo_right') || null,
      },
      video: get('video') || null,
      row: i + 1,
    };
    if (record.weight_lb !== null && !Number.isFinite(record.weight_lb)) {
      throw fail(`${context} row ${i + 1} (${date}): weight_lb ${JSON.stringify(weightRaw)} is not a number.`);
    }
    // A fully empty future row (only a date) is scaffolding, not a record.
    const hasContent = record.weight_lb !== null || record.note || record.video ||
      Object.values(record.photos).some(Boolean);
    if (!hasContent) continue;
    if (record.day < 1) continue;
    records.push(record);
  }
  const seen = new Map();
  for (const r of records) {
    if (seen.has(r.day)) {
      const prev = seen.get(r.day);
      throw fail(`${context}: duplicate rows for Project Day ${r.day} (${prev.date} row ${prev.row} and ${r.date} row ${r.row}). Remove the duplicate in the sheet; the publisher refuses to guess.`);
    }
    seen.set(r.day, r);
  }
  return records.sort((a, b) => a.day - b.day);
}

export function parseViolations(csvText, context = 'violations') {
  if (!csvText || !csvText.trim()) return new Map();
  const rows = parseCSV(csvText);
  const col = indexHeaders(rows[0], ['date', 'violation', 'status'], context);
  const map = new Map();
  for (const row of rows.slice(1)) {
    const date = normalizeDate(String(row[col.date] ?? '').trim());
    const violation = String(row[col.violation] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !violation) continue;
    map.set(date, { violation, status: String(row[col.status] ?? '').trim() || 'Unresolved' });
  }
  return map;
}

export function parseAttestations(csvText, context = 'attestations') {
  if (!csvText || !csvText.trim()) return new Map();
  const rows = parseCSV(csvText);
  const col = indexHeaders(rows[0], ['date', 'event', 'code', 'kind', 'status'], context);
  const names = rows[0].map((h) => String(h).trim().toLowerCase());
  const opt = (name) => (names.includes(name) ? names.indexOf(name) : -1);
  const videoCol = opt('video_sha256');
  const photosCol = opt('photo_sha256s');
  const loggedCol = opt('logged_at_server');
  const map = new Map();
  for (const row of rows.slice(1)) {
    const get = (i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
    const date = normalizeDate(get(col.date));
    if (get(col.event) !== 'capture-attested') continue;
    if (!get(col.kind).startsWith('daily')) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const entry = {
      logged_at: get(loggedCol) || null,
      code: get(col.code),
      status: get(col.status),
      video_sha256: get(videoCol) || null,
      photo_sha256s: get(photosCol) ? get(photosCol).split(/\s+/) : [],
    };
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(entry);
  }
  return map;
}

export async function loadSnapshots() {
  const weighIns = parseWeighIns(await fs.readFile(path.join(DATA_DIR, 'weigh-ins.csv'), 'utf8'), 'data/weigh-ins.csv');
  let violations = new Map();
  let attestations = new Map();
  try {
    violations = parseViolations(await fs.readFile(path.join(DATA_DIR, 'violations.csv'), 'utf8'), 'data/violations.csv');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try {
    attestations = parseAttestations(await fs.readFile(path.join(DATA_DIR, 'attestations.csv'), 'utf8'), 'data/attestations.csv');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { weighIns, violations, attestations };
}
