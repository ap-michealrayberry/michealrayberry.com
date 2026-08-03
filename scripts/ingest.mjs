/* Ingestion: turns the committed sheet snapshot plus local/remote media into
   one normalized manifest per Project Day (manifests/<date>.json).

   Photo resolution order, per position:
     1. the valid local file already recorded in the day's manifest;
     2. a repository photo matching the exact day, date, and position;
     3. the spreadsheet photo URL, downloaded and verified (--online only).

   A Drive thumbnail URL is never used as a permanent public image. If a
   position's only source is a remote URL that cannot be ingested, ingestion
   STOPS with an error naming the exact URLs — the photos are never silently
   classified as absent.

   Evidence is immutable: if a previously published archival file's bytes no
   longer match the hash in its manifest, ingestion fails and demands review
   (data/approved-hash-changes.json) rather than silently re-hashing. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT, SITE_ORIGIN, DATA_DIR, MANIFEST_DIR, PHOTOS_DIR, ANGLES,
  MANIFEST_SCHEMA_VERSION, pad3, canonicalDailyUrl, currentProjectDate,
  deadlinePending, dayNumber, dateForDay, sha256, exists, readMaybe,
  readJsonMaybe, writeIfChanged, walk, relUrl, loadSyncState, fail,
} from './lib/common.mjs';
import { loadSnapshots } from './lib/sheet.mjs';
import { deriveStatus, describeMissing, manifestPath, saveManifest } from './lib/manifest.mjs';

const ONLINE = process.argv.includes('--online');

const IMAGE_MAGIC = [
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

function sniffImage(buffer) {
  if (!buffer || buffer.length < 16) return null;
  for (const m of IMAGE_MAGIC) if (m.test(buffer)) return m.type;
  return null;
}

function findRepoPhoto(photoFiles, date, day, angle) {
  const padded = pad3(day);
  const patterns = [
    new RegExp(`^micheal-ray-berry-day-${padded}-${angle}-${date}\\.(?:jpe?g|png|webp)$`, 'i'),
    new RegExp(`^micheal-ray-berry-daily-photo-${date}-${angle}\\.(?:jpe?g|png|webp)$`, 'i'),
  ];
  for (const re of patterns) {
    const hit = photoFiles.find((f) => re.test(path.basename(f)));
    if (hit) return hit;
  }
  return null;
}

function archivalPathFor(date, day, angle, contentType) {
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return path.join(PHOTOS_DIR, date.slice(0, 4), date.slice(5, 7), date.slice(8, 10),
    `micheal-ray-berry-day-${pad3(day)}-${angle}-${date}.${ext}`);
}

async function downloadRemotePhoto(url, dest) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'MRB-Record-Publisher/2.0 (+https://michealrayberry.com)' },
    redirect: 'follow',
  });
  if (!response.ok) throw fail(`download failed (${response.status} ${response.statusText}): ${url}`);
  const declaredType = (response.headers.get('content-type') || '').split(';')[0].trim();
  const buffer = Buffer.from(await response.arrayBuffer());
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    const head = buffer.slice(0, 200).toString('utf8');
    const looksHtml = /<!doctype html|<html|<head|accounts\.google\.com/i.test(head);
    throw fail(`response is not an image (declared ${declaredType || 'nothing'}${looksHtml ? '; body is an HTML page, likely a login or error page' : ''}): ${url}`);
  }
  if (declaredType && !declaredType.startsWith('image/')) {
    throw fail(`content-type ${declaredType} is not an image (bytes sniffed as ${sniffed}): ${url}`);
  }
  if (buffer.length < 10240) throw fail(`image implausibly small (${buffer.length} bytes), refusing: ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);
  return { buffer, contentType: sniffed };
}

async function verifyVideoOverHttp(url) {
  if (!/^https:\/\//.test(url)) throw fail(`video URL is not HTTPS: ${url}`);
  const response = await fetch(url, {
    headers: { range: 'bytes=0-1', 'user-agent': 'MRB-Record-Publisher/2.0' },
    redirect: 'follow',
  });
  if (!(response.status === 206 || response.status === 200)) {
    throw fail(`video request failed (${response.status} ${response.statusText}): ${url}`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('video/')) {
    throw fail(`video URL answered content-type "${contentType || 'none'}" (HTML/auth pages are rejected): ${url}`);
  }
  const selfHosted = /^https:\/\/(video\.michealrayberry\.com|pub-[0-9a-f]+\.r2\.dev)\//i.test(url);
  const ranges = response.status === 206 || /bytes/i.test(response.headers.get('accept-ranges') || '');
  if (selfHosted && !ranges) throw fail(`self-hosted MP4 does not support byte ranges: ${url}`);
  const total = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ??
    response.headers.get('content-length');
  if (total !== null && total !== undefined && Number(total) === 0) throw fail(`video is empty (0 bytes): ${url}`);
  return {
    at: new Date().toISOString(),
    method: 'http',
    http_status: response.status,
    content_type: contentType,
    accept_ranges: ranges,
    bytes: total ? Number(total) : null,
  };
}

async function buildResponsive(sourcePath, buffer, date, day, angle, meta) {
  const stem = `micheal-ray-berry-day-${pad3(day)}-${angle}-${date}`;
  const targetDir = path.join(ROOT, 'media', 'responsive', date.slice(0, 4), date.slice(5, 7), date.slice(8, 10));
  // sharp().rotate() bakes EXIF orientation into the variants, so the
  // display dimensions come from the rotated frame.
  const oriented = meta.orientation >= 5
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
  const maxPublicWidth = Math.min(oriented.width, 1600);
  const widths = [...new Set([480, 960, maxPublicWidth].filter((w) => w <= maxPublicWidth))].sort((a, b) => a - b);
  const variants = [];
  for (const width of widths) {
    const dest = path.join(targetDir, `${stem}-${width}.webp`);
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer();
    await writeIfChanged(dest, out);
    variants.push({
      url: `${SITE_ORIGIN}${relUrl(dest)}`,
      path: path.relative(ROOT, dest),
      width,
      height: Math.round(oriented.height * (width / oriented.width)),
      bytes: out.length,
      sha256: sha256(out),
    });
  }
  return { variants, oriented };
}

async function resolvePhoto({ existing, photoFiles, record, angle, approvedChanges, errors }) {
  const sourceUrl = record.photos[angle];
  const prior = existing?.media?.photos?.[angle] || null;

  // 1. The manifest's own local file, if still valid.
  let localPath = null;
  if (prior?.path && await exists(path.join(ROOT, prior.path))) localPath = path.join(ROOT, prior.path);
  // 2. A repository photo for the exact day, date, and position.
  if (!localPath) localPath = findRepoPhoto(photoFiles, record.date, record.day, angle);

  // 3. The spreadsheet URL — an explicit ingestion step, online only.
  if (!localPath && sourceUrl) {
    // A same-origin URL refers to a repo file; if the file is gone the
    // record is broken and downloading our own origin would mask it.
    if (sourceUrl.startsWith(SITE_ORIGIN)) {
      errors.push(`Day ${record.day} ${angle}: sheet references ${sourceUrl} but no matching repository photo exists.`);
      return null;
    }
    if (!ONLINE) {
      errors.push(`Day ${record.day} ${angle}: remote photo requires an online ingestion run: ${sourceUrl}`);
      return null;
    }
    const dest = archivalPathFor(record.date, record.day, angle, 'image/jpeg');
    try {
      const { contentType } = await downloadRemotePhoto(sourceUrl, dest);
      localPath = archivalPathFor(record.date, record.day, angle, contentType);
      if (localPath !== dest) { await fs.rename(dest, localPath); }
    } catch (e) {
      errors.push(`Day ${record.day} ${angle}: ${e.message}`);
      return null;
    }
  }
  if (!localPath) {
    if (sourceUrl) errors.push(`Day ${record.day} ${angle}: no local file and no ingestable source for ${sourceUrl}`);
    return null;
  }

  const buffer = await readMaybe(localPath);
  if (!buffer) throw fail(`unreadable photo file: ${localPath}`);
  const contentType = sniffImage(buffer);
  if (!contentType) throw fail(`file is not a decodable image: ${localPath}`);
  const hash = sha256(buffer);

  // Evidence immutability: bytes under a published path must match the hash
  // already on record, unless the change has been explicitly approved.
  if (prior?.sha256 && prior.path === path.relative(ROOT, localPath) && prior.sha256 !== hash) {
    const approved = approvedChanges.some((c) => c.path === prior.path && c.old === prior.sha256 && c.new === hash);
    if (!approved) {
      throw fail(`EVIDENCE HASH CHANGE for ${prior.path}: manifest records ${prior.sha256}, file is now ${hash}. ` +
        'Historical media is never rewritten silently. If this change is intentional, record it in data/approved-hash-changes.json and re-run.');
    }
  }

  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) throw fail(`cannot read image dimensions: ${localPath}`);
  const { variants, oriented } = await buildResponsive(localPath, buffer, record.date, record.day, angle, meta);
  return {
    position: angle,
    original_source_url: sourceUrl,
    url: `${SITE_ORIGIN}${relUrl(localPath)}`,
    path: path.relative(ROOT, localPath),
    content_type: contentType,
    bytes: buffer.length,
    sha256: hash,
    width: oriented.width,
    height: oriented.height,
    exif_orientation: meta.orientation ?? null,
    responsive: variants,
  };
}

function pickAttestation(attestations, date, photoHashes) {
  const list = attestations.get(date) || [];
  if (!list.length) return null;
  // Prefer the attestation whose logged hashes are exactly the archival
  // photo set; otherwise report the latest valid daily attestation.
  const match = list.find((a) => photoHashes.length === 4 && a.photo_sha256s.length === 4 &&
    a.photo_sha256s.every((h) => photoHashes.includes(h)));
  const chosen = match || list[list.length - 1];
  return {
    logged_at: chosen.logged_at,
    code: chosen.code,
    status: chosen.status,
    video_sha256: chosen.video_sha256,
    photo_sha256s: chosen.photo_sha256s,
    matches_archived_photos: Boolean(match),
    attempts_recorded: list.length,
  };
}

async function archiveLegacyManifests() {
  let entries = [];
  try { entries = await fs.readdir(MANIFEST_DIR); } catch { return; }
  for (const name of entries) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const m = await readJsonMaybe(path.join(MANIFEST_DIR, name));
    if (m && m.schema_version !== MANIFEST_SCHEMA_VERSION) {
      const raw = await fs.readFile(path.join(MANIFEST_DIR, name));
      await writeIfChanged(path.join(MANIFEST_DIR, 'archive', 'v1', name), raw);
    }
  }
}

export async function ingest() {
  const state = await loadSyncState();
  const asOf = new Date(state.as_of);
  const { weighIns, violations, attestations } = await loadSnapshots();
  const approvedChanges = (await readJsonMaybe(path.join(DATA_DIR, 'approved-hash-changes.json')))?.changes || [];
  const videoLedger = (await readJsonMaybe(path.join(DATA_DIR, 'video-verifications.json')))?.verifications || {};

  await archiveLegacyManifests();

  const photoFiles = (await walk(PHOTOS_DIR)).filter((f) => /\.(?:jpe?g|png|webp)$/i.test(f));

  /* Manifests cover every Project Day whose filing window has closed, plus
     any earlier day. Today (Eastern) is excluded while its 10 PM deadline is
     still ahead — nothing has been missed yet. */
  const todayEt = currentProjectDate(asOf);
  let lastClosedDay = dayNumber(todayEt) - (deadlinePending(todayEt, asOf) ? 1 : 0);
  const lastRecorded = weighIns.at(-1)?.day || 0;
  const maxDay = Math.max(lastClosedDay, lastRecorded, 1);

  const rowByDay = new Map(weighIns.map((r) => [r.day, r]));
  const hardErrors = [];
  const manifests = [];

  for (let day = 1; day <= maxDay; day++) {
    const date = dateForDay(day);
    const row = rowByDay.get(day) || null;
    if (row && row.date !== date) throw fail(`Day ${day}: sheet date ${row.date} does not match calendar date ${date}.`);
    const existing = await readJsonMaybe(manifestPath(date));
    const prior = existing && existing.schema_version === MANIFEST_SCHEMA_VERSION ? existing : null;

    const errors = [];
    const photos = {};
    for (const angle of ANGLES) {
      photos[angle] = await resolvePhoto({
        existing: prior, photoFiles,
        record: row || { date, day, photos: {} },
        angle, approvedChanges, errors,
      });
    }

    let video = null;
    if (row?.video) {
      if (!/^https:\/\//.test(row.video)) {
        errors.push(`Day ${day}: video URL is not HTTPS: ${row.video}`);
      } else {
        let verified = null;
        if (ONLINE) {
          try { verified = await verifyVideoOverHttp(row.video); }
          catch (e) { errors.push(`Day ${day}: ${e.message}`); }
        }
        if (!verified && prior?.media?.video?.url === row.video && prior.media.video.verified) {
          verified = prior.media.video.verified;
        }
        if (!verified && videoLedger[row.video]) {
          const seed = videoLedger[row.video];
          verified = { at: seed.at, method: seed.method, content_type: seed.content_type, accept_ranges: seed.accept_ranges };
        }
        if (!verified) errors.push(`Day ${day}: inspection video is not yet verified (no HTTP check, prior verification, or ledger entry): ${row.video}`);
        video = {
          original_source_url: row.video,
          url: row.video,
          content_type: verified?.content_type || null,
          verified: verified || null,
        };
      }
    }

    const violation = violations.get(date) || null;
    const m = {
      schema_version: MANIFEST_SCHEMA_VERSION,
      date,
      day,
      weight_lb: row && Number.isFinite(row.weight_lb) ? row.weight_lb : null,
      note: row?.note || '',
      status: 'missing',
      status_reason: '',
      canonical_url: canonicalDailyUrl(date, day),
      published_at: prior?.published_at || state.as_of,
      last_verified_at: state.as_of,
      source: {
        sheet_id: state.sheet_id,
        sheet_row: row?.row ?? null,
        source_fetched_at: state.fetched_at,
      },
      media: { photos, video },
      attestation: pickAttestation(attestations, date,
        ANGLES.map((a) => photos[a]?.sha256).filter(Boolean)),
      violation: violation ? { ...violation, logged_for: date } : null,
      ingest_errors: errors,
      history: prior?.history ? [...prior.history] : [],
    };

    m.status = deriveStatus(m);
    if (m.status === 'missing' && violation) m.status = 'violation';
    const { have, missing } = describeMissing(m);
    m.status_reason = m.status === 'complete'
      ? 'All required components verified: recorded weight, four accountability photographs, and the inspection video.'
      : m.status === 'missing'
        ? 'None of the required daily documentation was filed for this Project Day.'
        : `Filed: ${have.join(', ') || 'nothing'}. Not filed: ${missing.join(', ')}.`;

    const last = m.history.at(-1);
    if (!last) {
      m.history.push({ at: state.as_of, status: m.status, reason: 'Initial normalized manifest (v2 migration from the legacy publisher).' });
    } else if (last.status !== m.status) {
      m.history.push({ at: state.as_of, status: m.status, reason: m.status_reason });
    }

    // A position whose only source is a remote URL that could not be
    // ingested stops the run — never silently absent.
    const remoteFailures = errors.filter((e) => /remote photo requires|download failed|not an image|content-type|implausibly small/.test(e));
    if (remoteFailures.length) hardErrors.push(...remoteFailures);
    for (const e of errors.filter((x) => !remoteFailures.includes(x))) console.warn(`WARN ${e}`);

    manifests.push(m);
  }

  for (const m of manifests) await saveManifest(m);

  if (hardErrors.length) {
    console.error('\nINGESTION BLOCKED — remote media could not be ingested:');
    for (const e of hardErrors) console.error(`  - ${e}`);
    console.error('\nManifests record these days as partial with ingest_errors; fix the sources (or run with --online in the sync workflow) and re-run.');
    throw fail(`${hardErrors.length} media source(s) failed ingestion.`);
  }

  console.log(`Ingested ${manifests.length} daily manifests (Days 1–${maxDay}).`);
  for (const m of manifests) console.log(`  Day ${pad3(m.day)}  ${m.date}  ${m.status}${m.status === 'partial' ? ` — ${m.status_reason}` : ''}`);
  return manifests;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  ingest().catch((error) => {
    console.error(error.isPipelineError ? `Ingestion failed: ${error.message}` : error);
    process.exit(1);
  });
}
