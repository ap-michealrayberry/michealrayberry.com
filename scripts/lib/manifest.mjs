/* The normalized daily manifest is the single authority every public
   artifact is generated from. One manifest per Project Day, committed to
   the repository at manifests/<date>.json. */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  MANIFEST_DIR, MANIFEST_SCHEMA_VERSION, MANIFEST_SCHEMA_URL, SITE_ORIGIN,
  START_DATE, START_WEIGHT, GOAL_WEIGHT, PERSON_ID, ANGLES,
  dayNumber, canonicalDailyUrl, sha256, readJsonMaybe, writeIfChanged, fail,
} from './common.mjs';

export const STATUSES = ['complete', 'partial', 'missing', 'violation'];

export function manifestPath(date) {
  return path.join(MANIFEST_DIR, `${date}.json`);
}

export async function loadManifests() {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(MANIFEST_DIR); } catch { return out; }
  for (const name of entries.sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const m = await readJsonMaybe(path.join(MANIFEST_DIR, name));
    if (m && m.schema_version === MANIFEST_SCHEMA_VERSION) out.push(m);
  }
  return out;
}

/* Derive status from what is actually verified. `complete` is earned, never
   asserted: four verified photos, a verified video, and a recorded weight. */
export function deriveStatus(m) {
  const photosOk = ANGLES.every((a) => m.media.photos[a] && m.media.photos[a].sha256);
  const videoOk = Boolean(m.media.video && m.media.video.url && m.media.video.verified);
  const weightOk = Number.isFinite(m.weight_lb);
  const filedAnything = weightOk || Boolean(m.note) ||
    ANGLES.some((a) => m.media.photos[a]) || Boolean(m.media.video);
  if (photosOk && videoOk && weightOk) return 'complete';
  if (filedAnything) return 'partial';
  return 'missing';
}

export function describeMissing(m) {
  const have = [];
  const missing = [];
  (Number.isFinite(m.weight_lb) ? have : missing).push('the recorded weight');
  const photoCount = ANGLES.filter((a) => m.media.photos[a] && m.media.photos[a].sha256).length;
  if (photoCount === 4) have.push('all four accountability photographs');
  else if (photoCount > 0) { have.push(`${photoCount} of the four accountability photographs`); missing.push(`${4 - photoCount} of the four accountability photographs`); }
  else missing.push('the four accountability photographs');
  (m.media.video && m.media.video.verified ? have : missing).push('the inspection video');
  return { have, missing, photoCount };
}

export function validateManifestShape(m, context) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(`${context}: ${msg}`); };
  need(m.schema_version === MANIFEST_SCHEMA_VERSION, `schema_version must be ${MANIFEST_SCHEMA_VERSION}`);
  need(/^\d{4}-\d{2}-\d{2}$/.test(m.date || ''), 'date must be ISO');
  need(Number.isInteger(m.day) && m.day >= 1, 'day must be a positive integer');
  if (m.date && Number.isInteger(m.day)) need(dayNumber(m.date) === m.day, `day ${m.day} does not match date ${m.date} (expected ${dayNumber(m.date)})`);
  need(STATUSES.includes(m.status), `status "${m.status}" is not one of ${STATUSES.join('/')}`);
  need(typeof m.status_reason === 'string' && m.status_reason.length > 0, 'status_reason is required');
  need(m.weight_lb === null || Number.isFinite(m.weight_lb), 'weight_lb must be number or null');
  need(m.canonical_url === canonicalDailyUrl(m.date, m.day), `canonical_url mismatch: ${m.canonical_url}`);
  need(typeof m.published_at === 'string' && m.published_at.length > 0, 'published_at is required');
  need(typeof m.last_verified_at === 'string' && m.last_verified_at.length > 0, 'last_verified_at is required');
  need(m.media && m.media.photos && typeof m.media.photos === 'object', 'media.photos is required');
  need(Array.isArray(m.history) && m.history.length > 0, 'history must record status changes');
  if (m.media && m.media.photos) {
    for (const angle of ANGLES) {
      const p = m.media.photos[angle];
      if (p === null || p === undefined) continue;
      need(typeof p.path === 'string' && p.path.length > 0, `photo ${angle}: local path required`);
      need(typeof p.url === 'string' && p.url.startsWith(SITE_ORIGIN), `photo ${angle}: permanent url must be same-origin`);
      need(!/drive\.google\.com/.test(p.url || ''), `photo ${angle}: permanent url must not be a Google Drive URL`);
      need(/^[0-9a-f]{64}$/.test(p.sha256 || ''), `photo ${angle}: sha256 required`);
      need(Number.isInteger(p.width) && Number.isInteger(p.height), `photo ${angle}: dimensions required`);
      need(typeof p.content_type === 'string' && p.content_type.startsWith('image/'), `photo ${angle}: image content type required`);
      need(Array.isArray(p.responsive) && p.responsive.length > 0, `photo ${angle}: responsive variants required`);
    }
  }
  if (m.media && m.media.video) {
    const v = m.media.video;
    need(/^https:\/\//.test(v.url || ''), 'video url must be HTTPS');
    need(!/drive\.google\.com/.test(v.url || ''), 'video url must not be a Google Drive URL');
    if (v.verified) {
      need(typeof v.verified.at === 'string', 'video verification timestamp required');
      need(typeof v.verified.method === 'string', 'video verification method required');
      need((v.verified.content_type || '').startsWith('video/'), 'video verification must record a video content type');
    }
  }
  if (m.status === 'complete') {
    const derived = deriveStatus(m);
    need(derived === 'complete', `status is complete but verified media only supports "${derived}"`);
  }
  return problems;
}

export function manifestJson(m) {
  // Stable key order so regeneration is byte-deterministic.
  const ordered = {
    schema_version: m.schema_version,
    schema: MANIFEST_SCHEMA_URL,
    project: {
      name: 'Micheal Ray Berry Public Accountability Project',
      person: { name: 'Micheal Ray Berry', id: PERSON_ID },
      start_date: START_DATE,
      start_weight_lb: START_WEIGHT,
      goal_weight_lb: GOAL_WEIGHT,
      timezone: 'America/New_York',
    },
    date: m.date,
    day: m.day,
    weight_lb: m.weight_lb,
    note: m.note,
    status: m.status,
    status_reason: m.status_reason,
    canonical_url: m.canonical_url,
    published_at: m.published_at,
    last_verified_at: m.last_verified_at,
    source: m.source,
    media: {
      photos: Object.fromEntries(['front', 'left', 'rear', 'right'].map((a) => [a, m.media.photos[a] ?? null])),
      video: m.media.video ?? null,
    },
    attestation: m.attestation ?? null,
    violation: m.violation ?? null,
    ingest_errors: m.ingest_errors && m.ingest_errors.length ? m.ingest_errors : undefined,
    history: m.history,
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

export async function saveManifest(m) {
  const file = manifestPath(m.date);
  const text = manifestJson(m);
  const changed = await writeIfChanged(file, text);
  await writeIfChanged(path.join(MANIFEST_DIR, `${m.date}.sha256`), `${sha256(Buffer.from(text))}  ${m.date}.json\n`);
  return changed;
}
