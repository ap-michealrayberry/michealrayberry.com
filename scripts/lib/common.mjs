/* Shared primitives for the daily-record publishing pipeline.
   Everything time-related runs in America/New_York: a Project Day is an
   Eastern calendar day, and the 10 PM ET deadline decides whether "today"
   is still open. UTC is never used alone to pick a Project Day. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || new URL('../..', import.meta.url).pathname);
export const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
export const TZ = 'America/New_York';
export const START_DATE = '2026-07-20';
export const START_WEIGHT = 340;
export const GOAL_WEIGHT = 175;
export const PERSON_ID = `${SITE_ORIGIN}/#micheal-ray-berry`;
export const MILESTONES = [300, 275, 250, 225, 200, 175];
export const ANGLES = ['front', 'left', 'rear', 'right'];
export const MANIFEST_SCHEMA_VERSION = 2;
export const MANIFEST_SCHEMA_URL = `${SITE_ORIGIN}/schemas/daily-record-manifest-v2.json`;
export const DEADLINE_HOUR_ET = 22;

export const DATA_DIR = path.join(ROOT, 'data');
export const MANIFEST_DIR = path.join(ROOT, 'manifests');
export const PHOTOS_DIR = path.join(ROOT, 'photos');
export const RESPONSIVE_DIR = path.join(ROOT, 'media', 'responsive');

export function fail(message) {
  const err = new Error(message);
  err.isPipelineError = true;
  return err;
}

/* ── time ─────────────────────────────────────────────────────────── */

const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

// The instant `asOf` expressed as Eastern wall-clock parts.
export function easternParts(asOf) {
  const parts = {};
  for (const p of ET_FMT.formatToParts(asOf)) parts[p.type] = p.value;
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '00' : parts.hour),
    minute: Number(parts.minute),
  };
}

export function assertIsoDate(s, context) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fail(`${context}: not an ISO date: ${JSON.stringify(s)}`);
  return s;
}

/* Day numbers are pure calendar arithmetic between ISO dates; time zones
   only decide which calendar date "now" is (easternParts above). */
export function dayNumber(isoDate) {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${START_DATE}T00:00:00Z`)) / 86400000) + 1;
}

export function dateForDay(day) {
  const d = new Date(Date.parse(`${START_DATE}T00:00:00Z`) + (day - 1) * 86400000);
  return d.toISOString().slice(0, 10);
}

// The current Project Day for an instant: the Eastern calendar date.
export function currentProjectDate(asOf) {
  return easternParts(asOf).iso;
}

// True while a project date's 10 PM ET filing deadline is still ahead of asOf.
export function deadlinePending(isoDate, asOf) {
  const now = easternParts(asOf);
  if (isoDate > now.iso) return true;
  if (isoDate < now.iso) return false;
  return now.hour < DEADLINE_HOUR_ET;
}

export function longDate(isoDate) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function pad3(n) { return String(n).padStart(3, '0'); }

export function daySlug(date, day) { return `${date}-day-${pad3(day)}`; }

export function canonicalDailyUrl(date, day) { return `${SITE_ORIGIN}/daily/${daySlug(date, day)}/`; }

/* ── text ─────────────────────────────────────────────────────────── */

export function xmlEscape(value = '') {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

export function htmlEscape(value = '') {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

export function parseCSV(text) {
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

export function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s;
}

/* ── fs / hashing ─────────────────────────────────────────────────── */

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function readMaybe(file) {
  try { return await fs.readFile(file); } catch { return null; }
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function readJsonMaybe(file) {
  try { return await readJson(file); } catch { return null; }
}

export async function writeIfChanged(file, data) {
  const next = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const current = await readMaybe(file);
  if (current && current.equals(next)) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  return true;
}

export async function walk(dir) {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

export function relUrl(file) {
  return '/' + path.relative(ROOT, file).split(path.sep).map(encodeURIComponent).join('/');
}

/* ── sync state ───────────────────────────────────────────────────── */

export async function loadSyncState() {
  const state = await readJsonMaybe(path.join(DATA_DIR, 'sync-state.json'));
  if (!state || !state.as_of) {
    throw fail('data/sync-state.json is missing or has no as_of timestamp; run scripts/sync-sheet.mjs first.');
  }
  return state;
}
