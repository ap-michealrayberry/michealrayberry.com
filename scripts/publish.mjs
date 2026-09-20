import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaticSite } from './static-site.mjs';
import crypto from 'node:crypto';
import sharp from 'sharp';

async function requiredRealpath(label, candidate) {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    throw new Error(`Refusing to publish: ${label} cannot be resolved (${error.message}).`);
  }
}

/* The publisher deletes regenerated output, so its root identity comes from
   this module rather than from caller-controlled environment state. Both the
   working directory and GitHub's workspace declaration (when present) must
   resolve to that same canonical directory. */
const ROOT = await requiredRealpath(
  'publisher module root',
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const CWD_ROOT = await requiredRealpath('current working directory', process.cwd());
if (CWD_ROOT !== ROOT) {
  throw new Error(`Refusing to publish outside the canonical project root: ${CWD_ROOT}`);
}
if (process.env.GITHUB_WORKSPACE) {
  const WORKSPACE_ROOT = await requiredRealpath('GITHUB_WORKSPACE', process.env.GITHUB_WORKSPACE);
  if (WORKSPACE_ROOT !== ROOT) {
    throw new Error(`Refusing mismatched GITHUB_WORKSPACE: ${WORKSPACE_ROOT}`);
  }
}
let packageManifest;
try {
  const manifestPath = path.join(ROOT, 'package.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error('package.json must be a regular, non-symlink file');
  }
  packageManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
} catch (error) {
  throw new Error(`Refusing to publish outside the project root: ${error.message}`);
}
if (packageManifest.name !== 'mrb-seo-publisher') {
  throw new Error(`Refusing unexpected project root: ${ROOT}`);
}
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
const SHEET_CSV = String(process.env.WEIGHINS_CSV || '').trim();
const VIOLATION_CSV = String(process.env.VIOLATION_CSV || '').trim();
const ATTEST_CSV = String(process.env.ATTESTATION_CSV || '').trim();
const CONFIRMATIONS_CSV = String(process.env.CONFIRMATIONS_CSV || '').trim();
const SUPERVISION_CSV = String(process.env.SUPERVISION_CSV || '').trim();
const UPDATES_CSV = String(process.env.UPDATES_CSV || '').trim();
const SITE_STATE_CSV = String(process.env.SITE_STATE_CSV || '').trim();
const ATTESTATION_SEAL_SECRET = String(process.env.ATTESTATION_SEAL_SECRET || '');
const ATTESTATION_SEAL_DOMAIN = 'MRB_ATTESTATION_SEAL_V2';
const SOURCE_DATE_EPOCH = String(process.env.SOURCE_DATE_EPOCH || '').trim();
const BUILD_INSTANT = SOURCE_DATE_EPOCH
  ? new Date(/^\d+$/.test(SOURCE_DATE_EPOCH) ? Number(SOURCE_DATE_EPOCH) * 1000 : NaN)
  : new Date();
if (Number.isNaN(BUILD_INSTANT.getTime())) throw new Error('SOURCE_DATE_EPOCH must be Unix seconds.');
const buildNow = () => new Date(BUILD_INSTANT.getTime());
/* Day 1 of the CURRENT attempt. Overridden at build time by the Site State
   key `start_date` — a restart is a single sheet edit, no code change. When
   `prior_attempt_note` is set it renders on /daily so an earlier attempt is
   closed on the record, not erased (its photos stay in the repo history). */
let START_DATE = '2026-08-31';
let PRIOR_NOTE = '';
const START_WEIGHT = 340;
const GOAL_WEIGHT = 200;
const PERSON_ID = `${SITE_ORIGIN}/#micheal-ray-berry`;
const INDEXNOW_OUTPUT = path.join(ROOT, '.indexnow-urls.json');
const MILESTONES = [320, 300, 275, 250, 225, 200];

const STATIC_PAGES = [
  ['', 'daily'],
  ['daily/', 'daily'],
  ['dashboard/', 'daily'],
  ['milestones/', 'weekly'],
  ['about/', 'weekly'],
  ['agreement/', 'weekly'],
  ['violations/', 'daily'],
  ['corrections/', 'weekly'],
  ['positions/', 'monthly'],
  ['consent/', 'monthly'],
  ['uniform/', 'weekly'],
  ['updates/', 'daily'],
  ['share/', 'weekly'],
  ['live/', 'daily'],
  ['weeks/', 'daily'],
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

/* Rows dated before Day 1 belong to the pre-record system test — label them
   as such rather than rendering a negative day number. */
function dayLabelOf(v) {
  return v.day >= 1 ? `Day ${v.day}` : 'Before Day 1';
}

// JSON-LD must never be able to close its own <script> tag.
function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function todayEtIso(now = buildNow()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

function parseCSV(text, label = 'CSV') {
  const rows = [];
  let row = [];
  let field = '';
  let state = 'start';
  let line = 1;
  let rowHasStructure = false;

  const fail = (message) => {
    throw new Error(`${label} CSV syntax error at line ${line}: ${message}`);
  };
  const finishField = () => {
    row.push(field);
    field = '';
    state = 'start';
  };
  const finishRow = () => {
    finishField();
    if (rowHasStructure || row.some((value) => String(value).trim() !== '')) rows.push(row);
    row = [];
    rowHasStructure = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'after-quote';
      } else if (c === '\r' && text[i + 1] === '\n') {
        field += '\r\n';
        i++;
        line++;
      } else {
        field += c;
        if (c === '\n' || c === '\r') line++;
      }
      continue;
    }

    if (state === 'after-quote') {
      if (c === ',') finishField();
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        finishRow();
        line++;
      } else fail('unexpected character after a closing quote');
      continue;
    }

    if (c === '"') {
      if (state !== 'start') fail('quote character inside an unquoted field');
      state = 'quoted';
      rowHasStructure = true;
    } else if (c === ',') {
      rowHasStructure = true;
      finishField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      finishRow();
      line++;
    } else {
      field += c;
      if (!/\s/.test(c)) rowHasStructure = true;
      state = 'unquoted';
    }
  }
  if (state === 'quoted') fail('unclosed quoted field');
  finishRow();
  return rows;
}

function normalizedHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function validateTable(rows, expected, label, { optional = [] } = {}) {
  const actual = (rows[0] || []).map(normalizedHeader);
  const okRequired = actual.length >= expected.length && expected.every((name, index) => {
    const choices = Array.isArray(name) ? name : [name];
    return choices.map(normalizedHeader).includes(actual[index]);
  });
  const extra = actual.slice(expected.length);
  const okOptional = extra.length <= optional.length && extra.every((h, i) => h === normalizedHeader(optional[i]));
  if (!okRequired || !okOptional) throw new Error(`${label} schema mismatch; expected ${expected.map((v) => Array.isArray(v) ? v.join('|') : v).join(', ')}${optional.length ? ` [+ optional: ${optional.join(', ')}]` : ''}`);
  const width = actual.length;
  for (let index = 1; index < rows.length; index++) {
    if (rows[index].length !== width) {
      throw new Error(`${label} row ${index + 1} has ${rows[index].length} columns; expected exactly ${width}.`);
    }
  }
  return rows;
}

/* Public CSV exports are generated from reviewed columns, never from an
   entire operational sheet. Prefix formula-leading values so opening an
   export in spreadsheet software cannot execute a submitted formula. */
function csvCell(value) {
  let text = String(value == null ? '' : value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvDocument(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
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

function attestationSealPayload(fields) {
  return JSON.stringify([
    ATTESTATION_SEAL_DOMAIN,
    fields.loggedAt,
    fields.date,
    String(fields.day),
    fields.event,
    fields.code,
    fields.kind,
    fields.videoHash,
    fields.photoHashes,
    fields.weight,
    fields.status,
    fields.chunkChain,
    String(fields.chunkCount),
    fields.sealedAt,
  ]);
}

function attestationSealMatches(fields, suppliedSeal) {
  if (!/^[a-f0-9]{64}$/.test(String(suppliedSeal || ''))) return false;
  const expected = crypto
    .createHmac('sha256', ATTESTATION_SEAL_SECRET)
    .update(attestationSealPayload(fields), 'utf8')
    .digest();
  const supplied = Buffer.from(suppliedSeal, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function rememberAcceptedAttestation(seen, date, kind, serverSeal) {
  const identity = JSON.stringify([date, kind, serverSeal]);
  if (seen.has(identity)) {
    throw new Error(`Attestation contains a duplicate accepted ${kind} record for ${date} with the same server seal.`);
  }
  seen.add(identity);
}

function agreementConfirmationFingerprint(version, date, canonicalUrl, attestationSeal, videoHash) {
  const edition = String(version);
  const confirmationUrl = confirmationVideoUrl(canonicalUrl);
  const seal = String(attestationSeal || '').trim();
  const hash = String(videoHash || '').trim().toLowerCase();
  if (!/^\d+$/.test(edition) || !isRealIsoDate(date) || !confirmationUrl
    || !/^[a-f0-9]{64}$/.test(seal) || !/^[a-f0-9]{64}$/.test(hash)) return '';
  return sha256(Buffer.from(
    `agreement-confirmation-v1\n${edition}\n${date}\n${confirmationUrl}\n${seal}\n${hash}`,
    'utf8',
  ));
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

/* These directories are build artifacts, never hand-authored source. Clear
   them only after required feeds have parsed successfully so a revoked or
   removed record cannot survive as a stale page, manifest, card, or image in
   the next deploy. The deploy itself remains atomic in prepare-dist.mjs. */
async function resetGeneratedOutput() {
  const generatedRoots = [
    'cards', 'daily', 'manifests', 'milestones',
    'media/responsive', 'violations', 'weeks',
  ];
  const validateTarget = async (relativePath) => {
    const target = path.resolve(ROOT, relativePath);
    const relativeTarget = path.relative(ROOT, target);
    if (!relativeTarget || relativeTarget === '..'
      || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      throw new Error(`Refusing unsafe generated-output path: ${target}`);
    }
    let current = ROOT;
    for (const segment of relativeTarget.split(path.sep)) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing symlink in generated-output path: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Refusing non-directory generated-output path: ${current}`);
      }
    }
    return target;
  };

  /* Preflight the complete allowlist before deleting any one root. Recheck
     each target immediately before removal as a defense against replacement
     between the preflight and the destructive operation. */
  const targets = [];
  for (const relativePath of generatedRoots) {
    targets.push(await validateTarget(relativePath));
  }
  for (let index = 0; index < generatedRoots.length; index++) {
    const target = await validateTarget(generatedRoots[index]);
    if (target !== targets[index]) throw new Error('Generated-output path changed during validation.');
    await fs.rm(target, { recursive: true, force: true });
    /* Keep the deploy topology valid even on a fresh Day 1 with no finalized
       records. prepare-dist treats these reviewed roots as required, while an
       empty directory correctly publishes no stale artifacts. */
    await fs.mkdir(target, { recursive: true });
    const createdStat = await fs.lstat(target);
    if (createdStat.isSymbolicLink() || !createdStat.isDirectory()) {
      throw new Error(`Generated-output root was not created safely: ${target}`);
    }
  }
}

async function walk(dir) {
  const out = [];
  if (!(await exists(dir))) return out;
  const items = await fs.readdir(dir, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
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

function isRealIsoDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function agreementAppliesOn(date, active, effectiveDate) {
  return Boolean(active && isRealIsoDate(effectiveDate) && isRealIsoDate(date) && date >= effectiveDate);
}

function agreementExecutionGate(siteState, confirmations, startDate, todayDate) {
  const stateDate = (value) => {
    const date = String(value || '').trim();
    return isRealIsoDate(date) ? date : '';
  };
  const mrbSignatureDate = stateDate(siteState.mrb_signature_verified_at);
  const apSignatureDate = stateDate(siteState.ap_signature_verified_at);
  const reviewedConfirmationDate = stateDate(siteState.agreement_confirmation_date);
  const confirmationReviewDate = stateDate(siteState.agreement_confirmation_verified_at);
  const reviewedConfirmationFingerprint = String(
    siteState.agreement_confirmation_fingerprint || '',
  ).trim().toLowerCase();
  const rawEdition = String(siteState.agreement_edition || '');

  const inactive = {
    active: false,
    effectiveDate: '',
    activationTupleComplete: false,
    reviewedConfirmationFingerprint,
  };
  /* agreement_edition is the commit flag. A deliberately cleared flag is the
     only inactive state; once Edition 2 is asserted, every bound field must be
     present and valid or the release fails closed. This prevents a malformed
     active tuple from overwriting the last known-good active deploy. */
  if (rawEdition === '') return inactive;
  if (rawEdition !== '2') {
    throw new Error('Agreement activation has an unsupported or non-canonical edition commit flag.');
  }
  if (!mrbSignatureDate || !apSignatureDate || !reviewedConfirmationDate
    || !confirmationReviewDate || !/^[a-f0-9]{64}$/.test(reviewedConfirmationFingerprint)) {
    throw new Error('Edition 2 agreement activation tuple is incomplete or malformed.');
  }

  const confirmationRecord = confirmations.find((entry) => entry.version === 2) || null;
  const recomputedFingerprint = confirmationRecord
    ? agreementConfirmationFingerprint(
      confirmationRecord.version,
      confirmationRecord.date,
      confirmationRecord.url,
      confirmationRecord.attestationSeal,
      confirmationRecord.videoHash,
    )
    : '';
  const exactEvidenceValid = Boolean(confirmationRecord
    && confirmationRecord.attestationVerified === true
    && confirmationRecord.date === reviewedConfirmationDate
    && recomputedFingerprint
    && recomputedFingerprint === confirmationRecord.fingerprint
    && reviewedConfirmationFingerprint === confirmationRecord.fingerprint);
  if (!exactEvidenceValid) {
    throw new Error('Complete agreement activation tuple does not match one exact HMAC-verified confirmation and fingerprint.');
  }
  if (!isRealIsoDate(startDate) || !isRealIsoDate(todayDate)) {
    throw new Error('Complete agreement activation tuple has an invalid project or build date.');
  }
  const effectiveDate = [
    startDate,
    mrbSignatureDate,
    apSignatureDate,
    confirmationRecord.date,
    confirmationReviewDate,
  ].sort().at(-1);
  if (effectiveDate > todayDate) {
    throw new Error('Complete agreement activation tuple contains a future-dated prerequisite.');
  }
  return {
    active: true,
    effectiveDate,
    activationTupleComplete: true,
    reviewedConfirmationFingerprint,
  };
}

/* Reject operational storage, alternate YouTube surfaces, and arbitrary
   hosts before any URL reaches HTML, JSON-LD, CSV, or a sitemap. */
/* Cloudflare Stream is the primary player; YouTube is the public mirror.
   STREAM_CUSTOMER_CODE = the "customer-xxxx" subdomain (Stream → Settings).
   stream_uid on a row embeds Stream; the YouTube URL becomes "Also on
   YouTube". R2 holds the untouched original (r2_key) — recorded in the
   manifest beside its SHA-256, never used as a player. */
const STREAM_CUSTOMER_CODE = String(process.env.STREAM_CUSTOMER_CODE || '').trim();
function streamUid(value = '') { const v = String(value || '').trim(); return /^[a-f0-9]{32}$/i.test(v) ? v.toLowerCase() : ''; }
function streamBase(uid) { return STREAM_CUSTOMER_CODE && uid ? `https://${STREAM_CUSTOMER_CODE}.cloudflarestream.com/${uid}` : ''; }
function streamThumb(uid) { const b = streamBase(uid); return b ? `${b}/thumbnails/thumbnail.jpg?time=2s&height=1280` : ''; }
function streamEmbedUrl(uid) { const b = streamBase(uid); return b ? `${b}/iframe?preload=metadata&poster=${encodeURIComponent(streamThumb(uid))}` : ''; }
function streamHls(uid) { const b = streamBase(uid); return b ? `${b}/manifest/video.m3u8` : ''; }
function streamTranscriptUrl(uid) { const b = streamBase(uid); return b ? `${b}/captions/en` : ''; }
function streamPlayer(uid, title, eager = false) {
  const src = streamEmbedUrl(uid); if (!src) return '';
  return `<div class="video" style="position:relative;width:100%;max-width:540px;aspect-ratio:9/16;background:#000;margin:0 auto"><iframe src="${htmlEscape(src)}" title="${htmlEscape(title)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="${eager ? 'eager' : 'lazy'}" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`;
}
function mirrorLink(video, label) { const safe = publicVideoUrl(video); return safe && !isSelfHosted(safe) ? `<p class="video-link" style="font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">Also on YouTube: <a href="${htmlEscape(safe)}" rel="noopener">${htmlEscape(label)}</a></p>` : ''; }

function publicVideoUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const rootRelativeMedia = /^\/media\/(?!\/)/i.test(raw);
  if (!rootRelativeMedia && !/^https:\/\//i.test(raw)) return '';
  let url;
  try { url = new URL(raw, 'https://michealrayberry.com'); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return '';
  if (url.origin === 'https://michealrayberry.com'
    && /^\/media\/[A-Za-z0-9._/-]+\.(?:mp4|webm)$/i.test(url.pathname) && !url.search) {
    return rootRelativeMedia ? url.pathname : `${url.origin}${url.pathname}`;
  }
  // YouTube: normalise every public form (watch, youtu.be, shorts, embed,
  // live, mobile host, share-sheet ?si= tracking) to a canonical link. The
  // 11-character ID is the only thing that matters; extra params are dropped.
  if (/^(?:www\.|m\.)?youtube\.com$/i.test(url.hostname)) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') || '';
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : '';
    }
    const path = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})\/?$/);
    return path ? `https://youtu.be/${path[1]}` : '';
  }
  if (/^youtu\.be$/i.test(url.hostname)) {
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
    return match ? `https://youtu.be/${match[1]}` : '';
  }
  return '';
}

/* Confirmation evidence follows the exact Apps Script input contract. Keep
   this deliberately narrower than publicVideoUrl(), which also serves normal
   public media and tolerates harmless presentation variants. */
function confirmationVideoUrl(value = '') {
  const raw = String(value || '').trim();
  const watch = raw.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/);
  if (watch) return `https://www.youtube.com/watch?v=${watch[1]}`;
  const shortLink = raw.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})$/);
  return shortLink ? `https://youtu.be/${shortLink[1]}` : '';
}

function youtubeId(url = '') {
  const safe = publicVideoUrl(url);
  if (!safe) return '';
  try {
    const parsed = new URL(safe, SITE_ORIGIN);
    if (/^youtu\.be$/i.test(parsed.hostname)) return parsed.pathname.slice(1);
    if (/^(?:www\.)?youtube\.com$/i.test(parsed.hostname) && parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
  } catch {}
  return '';
}

/* YouTube (@michealrayberry) is the official external player. Self-hosted
   video is limited to the site's own /media/ path. */
function isSelfHosted(url) {
  const safe = publicVideoUrl(url);
  return /^\/media\//i.test(safe) || /^https:\/\/michealrayberry\.com\/media\//i.test(safe);
}

function videoEmbed(url) {
  const safe = publicVideoUrl(url);
  if (!safe || isSelfHosted(safe)) return '';
  const yid = youtubeId(safe);
  if (yid) return `https://www.youtube-nocookie.com/embed/${yid}`;
  return '';
}

function videoSchemaSource(url) {
  const safe = publicVideoUrl(url);
  if (!safe) return {};
  const embed = videoEmbed(safe);
  return {
    ...(isSelfHosted(safe) ? { contentUrl: safe } : { url: safe }),
    ...(embed ? { embedUrl: embed } : {}),
  };
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
    const response = await fetch(url, {
      headers: { 'user-agent': 'MRB-SEO-Publisher/1.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    if (optional) {
      console.warn(`Optional record feed fetch failed: ${error.message}`);
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
  const exact = files.filter((f) => expected.test(path.basename(f)));
  if (exact.length > 1) throw new Error(`Ambiguous exact photo candidates for ${date} ${angle}.`);
  if (exact.length === 1) return exact[0];
  const fallback = files.filter((f) => broader.test(path.basename(f)));
  if (fallback.length > 1) throw new Error(`Ambiguous fallback photo candidates for ${date} ${angle}.`);
  return fallback[0] || null;
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

/* The public CSV must never inherit a Drive/camera URL from the operational
   sheet. Only a derivative generated by this publisher beneath the site's
   own responsive-media path is eligible for the sanitized export. */
function publicPhotoDerivative(photo) {
  const candidate = photo?.variants?.at(-1)?.url || '';
  try {
    const url = new URL(candidate);
    const origin = new URL(SITE_ORIGIN);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.origin !== origin.origin || !/^\/media\/responsive\/[A-Za-z0-9._/-]+\.webp$/i.test(url.pathname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

/* ═════ DAILY REPORT CARD ═════
   A card reports public file presence. Adverse compliance language is allowed
   only on/after a fail-closed agreement effective date. Current file presence
   is not proof that every component was filed before its deadline. */
let CARD_CTX = null; // set by main(): { rows, violations, supervision, agreementActive, agreementEffectiveDate }
function cardStatus(c) {
  if (!c.obligationActive) return c.complete ? 'FILES PRESENT' : c.anyFiled ? 'PARTIAL RECORD' : 'NO RECORD';
  if (c.violation) return c.violation.state === 'open' ? 'VIOLATION' : c.violation.state === 'resolved' ? 'VIOLATION · RESOLVED' : 'VIOLATION · CORRECTED';
  if (c.pending && (!c.complete || !c.supervisionComplete)) return 'DUE';
  if (c.complete && c.supervisionComplete && c.deadlineVerdict === 'on-time') return 'DOCUMENTED';
  if (c.complete) return 'FILES PRESENT';
  return c.anyFiled ? 'PARTIAL RECORD' : 'NO RECORD';
}
function reportCard(c, { compact = false, link = '' } = {}) {
  const status = cardStatus(c);
  const cls = /^VIOLATION\b/.test(status) ? 'bad' : status === 'DOCUMENTED' ? 'ok' : c.obligationActive ? 'warn' : 'neutral';
  const wt = Number.isFinite(c.weight) ? c.weight.toFixed(1) + ' lb' : (c.pending ? 'Awaiting scale record' : 'No weight record');
  const dd = c.weight - c.prevWeight;
  const delta = Number.isFinite(c.weight) && Number.isFinite(c.prevWeight)
    ? (dd === 0 ? '\u00B10.0' : (dd > 0 ? '+' : '\u2212') + Math.abs(dd).toFixed(1)) + ' from prior day' : '';
  const fromStart = START_WEIGHT - c.weight;
  const total = Number.isFinite(c.weight) ? (fromStart === 0 ? '\u00B10.0' : (fromStart > 0 ? '\u2212' : '+') + Math.abs(fromStart).toFixed(1)) + ' from declared start' : '';
  const insp = c.video
    ? 'File present' + (c.attestationAt ? ' \u00B7 attestation received ' + c.attestationAt + ' ET' : '') + (c.videoSec ? ' \u00B7 recording ' + Math.round(c.videoSec / 60) + ' min' : '')
    : (c.pending ? 'Not present yet \u00B7 due 10:00 PM ET' : 'No video record');
  const photos = c.photoCount + ' of 4 files present';
  const sup = !c.obligationActive ? 'No active requirement' : c.supervision === null ? 'Not scheduled' : c.supervision ? c.supervision.toUpperCase() : (c.pending ? 'Scheduled 6:00\u201310:00 PM ET' : 'No outcome recorded');
  const vioToday = c.violation
    ? (c.violation.id + ' \u00B7 ' + ({ open: 'Open \u2014 correction required', corrected: 'Corrected \u2014 awaiting verification', resolved: 'Resolved' })[c.violation.state])
    : (c.obligationActive && c.pending ? 'No adverse ruling' : 'None');
  const outstanding = c.openCount ? c.openCount + ' unresolved entr' + (c.openCount === 1 ? 'y' : 'ies') + ' on the record' : 'None';
  const rows = [['Weigh-in', [wt, delta, total].filter(Boolean).join(' \u00B7 ')], ['Inspection', insp], ['Photographs', photos], ['Supervision', sup], ['Violations today', vioToday], ['Outstanding', outstanding]];
  const isBad = (v) => /VIOLATION|MISSED|Open/.test(v);
  const photo = c.photo
    ? `<a class="rc-photo" href="${link || '#photos-heading'}"><img src="${htmlEscape(c.photo.url)}" alt="Micheal Ray Berry, front view, Day ${c.day}" loading="lazy" decoding="async"></a>`
    : `<div class="rc-photo rc-none"><span>${c.pending ? 'AWAITING RECORD' : 'NO PHOTOGRAPH RECORD'}</span></div>`;
  const timingNote = c.deadlineVerdict === 'on-time'
    ? 'An immutable on-time verdict is recorded.'
    : c.complete
      ? 'Files are present; current file presence does not establish when every component was filed.'
      : c.pending
        ? 'The active filing window closes at 10:00 PM Eastern.'
        : '';
  return `<section class="rc ${cls}${compact ? ' compact' : ''}" aria-label="Report card, Day ${c.day}">
    ${photo}
    <div class="rc-body">
      <div class="rc-head">${link ? `<a href="${link}">DAY ${c.day}</a>` : 'DAY ' + c.day}<span>${htmlEscape(longDate(c.date))}</span></div>
      <div class="rc-status"><span class="lamp"></span>${status}</div>
      <dl>${rows.map(([k, v]) => `<div${isBad(v) ? ' class="bad"' : ''}><dt>${k}</dt><dd>${htmlEscape(v)}</dd></div>`).join('')}</dl>
      ${timingNote ? `<p class="rc-next">${timingNote}</p>` : ''}
    </div>
  </section>`;
}
const RC_CSS = `
.rc{display:grid;grid-template-columns:150px 1fr;border:1px solid var(--ink);background:#fff;margin:24px 0}
.rc.compact{grid-template-columns:96px 1fr;margin:0}
.rc-photo{display:block;background:var(--ink);aspect-ratio:9/16;overflow:hidden}
.rc-photo img{width:100%;height:100%;object-fit:cover;display:block}
.rc-none{display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;font:600 10px/1.5 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;color:#6B6A64;background:repeating-linear-gradient(45deg,#f6f5f1,#f6f5f1 10px,#eeece6 10px,#eeece6 20px)}
.rc-body{padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-width:0}
.rc-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font:700 13px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em}
.rc-head a{text-decoration:none;color:inherit}.rc-head span{font-weight:400;color:var(--muted);letter-spacing:.04em}
.rc-status{font:700 22px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:2px solid var(--ink)}
.rc.compact .rc-status{font-size:15px;padding:4px 0}
.rc .lamp{width:11px;height:11px;border-radius:50%;background:#3A6B3A;flex-shrink:0}
.rc.warn .lamp{background:#8A6A1E}.rc.neutral .lamp{background:#6B6A64}.rc.bad .lamp{background:var(--accent)}.rc.bad .rc-status{color:var(--accent)}
.rc dl{margin:0;display:grid;grid-template-columns:120px 1fr;gap:5px 14px;font-size:14px;line-height:1.45}
.rc dl div{display:contents}.rc dt{font:600 11px/1.6 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.rc dd{margin:0}.rc dl div.bad dd{color:var(--accent);font-weight:600}
.rc.compact dl{grid-template-columns:100px 1fr;font-size:13px;gap:3px 12px}
.rc-next{margin:0;font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)}
@media(max-width:560px){.rc{grid-template-columns:1fr}.rc-photo{aspect-ratio:4/3}.rc-photo img{object-position:50% 20%}.rc-body{padding:14px 16px;gap:8px}.rc-status{font-size:19px}.rc dl{grid-template-columns:1fr;gap:2px 0}.rc dt{margin-top:6px}}
`;
function cardCtx(day, opts = {}) {
  const X = CARD_CTX || { rows: [], violations: [], supervision: [], agreementActive: false, agreementEffectiveDate: '' };
  const date = opts.date || dateForDay(day);
  const row = X.rows.find((r) => r.date === date) || null;
  const prev = X.rows.filter((r) => r.day < day && Number.isFinite(r.weight)).sort((a, b) => b.day - a.day)[0] || null;
  const obligationActive = agreementAppliesOn(date, X.agreementActive, X.agreementEffectiveDate);
  const v = obligationActive ? X.violations.find((x) => x.date === date) || null : null;
  const s = X.supervision.find((x) => x.date === date) || null;
  const supRequired = obligationActive && !!(s && s.required === true);
  const pending = obligationActive && deadlinePending(date);
  const photoCount = opts.photoCount ?? 0;
  const complete = !!(opts.complete || (row && row.video && photoCount === 4));
  const supervision = supRequired ? publicSupervisionStatus(s?.status) : null;
  const supervisionComplete = !supRequired || /^(COMPLETED|EXCEPTION)\b/i.test(supervision || '');
  const deadlineVerdict = row && /^(on-time|late)$/i.test(String(row.deadlineVerdict || ''))
    ? String(row.deadlineVerdict).toLowerCase() : '';
  return {
    day, date, obligationActive,
    weight: row ? row.weight : NaN, prevWeight: prev ? prev.weight : NaN,
    video: !!(row && row.video), videoSec: row ? row.videoSec : 0, attestationAt: row && row.attestationAt ? row.attestationAt : '',
    photoCount, complete, pending, deadlineVerdict,
    anyFiled: !!(row && (Number.isFinite(row.weight) || row.video)) || photoCount > 0,
    supervision, supervisionComplete,
    violation: v, openCount: X.violations.filter((x) => x.state !== 'resolved').length,
    photo: opts.photo || null,
  };
}

/* ═════ CARD IMAGE (1080×1350 PNG) ═════
   The unit that travels. Composed as SVG from the same ctx as the HTML card,
   rasterised by sharp (already a build dependency). Photo is embedded as a
   base64 JPEG so the PNG is self-contained. Fonts: librsvg has no web fonts,
   so a generic monospace stack — the layout is sized for it. */
const svgEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function cardImage(c) {
  const W = 1080, H = 1350, PAD = 56;
  const status = cardStatus(c);
  const bad = /^VIOLATION\b/.test(status), warn = !bad && status !== 'DOCUMENTED';
  const lamp = bad ? '#B3261E' : !c.obligationActive ? '#6B6A64' : warn ? '#8A6A1E' : '#3A6B3A';
  // photo column: 9:16 at 380 wide
  const PW = 380, PH = Math.round(PW * 16 / 9);
  let photoEl = '';
  if (c.photo && c.photo.path) {
    try {
      const buf = await sharp(c.photo.path, { failOn: 'none' }).rotate().resize({ width: PW, height: PH, fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
      photoEl = `<image href="data:image/jpeg;base64,${buf.toString('base64')}" x="${PAD}" y="${PAD + 130}" width="${PW}" height="${PH}" preserveAspectRatio="xMidYMid slice"/>`;
    } catch (e) { photoEl = ''; }
  }
  if (!photoEl) {
    photoEl = `<rect x="${PAD}" y="${PAD + 130}" width="${PW}" height="${PH}" fill="#EEECE6"/>
      <text x="${PAD + PW / 2}" y="${PAD + 130 + PH / 2}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="20" font-weight="700" letter-spacing="3" fill="#6B6A64">${c.pending ? 'AWAITING RECORD' : 'NO PHOTOGRAPH RECORD'}</text>`;
  }
  const wt = Number.isFinite(c.weight) ? c.weight.toFixed(1) + ' lb' : (c.pending ? 'Awaiting record' : 'No weight record');
  const dd = c.weight - c.prevWeight;
  const delta = Number.isFinite(c.weight) && Number.isFinite(c.prevWeight) ? (dd === 0 ? '±0.0' : (dd > 0 ? '+' : '−') + Math.abs(dd).toFixed(1)) + ' day' : '';
  const fromStart = START_WEIGHT - c.weight;
  const total = Number.isFinite(c.weight) ? (fromStart === 0 ? '±0.0' : (fromStart > 0 ? '−' : '+') + Math.abs(fromStart).toFixed(1)) + ' from declared start' : '';
  const filedLine = c.video ? 'File present' : (c.pending ? 'Not present yet' : 'No video record');
  const filedSub = c.deadlineVerdict === 'on-time'
    ? 'On-time verdict recorded'
    : c.video
      ? 'Timing unverified' + (c.videoSec ? ' \u00B7 recording ' + Math.round(c.videoSec / 60) + ' min' : '')
      : c.pending ? 'Due 10:00 PM ET' : '';
  const photoLine = c.photoCount + ' of 4 files present';
  const supervisionLine = !c.obligationActive ? 'No active requirement' : c.supervision === null ? 'Not scheduled' : c.supervision ? c.supervision.toUpperCase() : (c.pending ? 'Scheduled 6:00\u201310:00 PM ET' : 'No outcome recorded');
  const vioToday = c.violation
    ? c.violation.id + ' \u00B7 ' + ({ open: 'Open', corrected: 'Corrected \u2014 awaiting verification', resolved: 'Resolved' })[c.violation.state]
    : (c.obligationActive && c.pending ? 'No adverse ruling' : 'None');
  const outstanding = c.openCount ? c.openCount + ' unresolved entr' + (c.openCount === 1 ? 'y' : 'ies') : 'None';
  const rows = [
    ['WEIGH-IN', wt, [delta, total].filter(Boolean).join(' \u00B7 ')],
    ['DAILY INSPECTION', filedLine, filedSub],
    ['PHOTOGRAPHS', photoLine, ''],
    ['SUPERVISION', supervisionLine, ''],
    ['VIOLATIONS TODAY', vioToday, c.violation && c.violation.state === 'open' ? 'Correction required' : ''],
    ['OUTSTANDING CORRECTIONS', outstanding, ''],
  ];
  const isBad = (v) => /VIOLATION|MISSED|Open/.test(v);
  const pageUrl = `${SITE_ORIGIN}/daily/${c.date}-day-${String(c.day).padStart(3, '0')}/`;
  const qr = qrSvgPath(pageUrl);
  const X = PAD + PW + 44, RW = W - X - PAD;
  const rowTop = PAD + 130 + 84 + 46;             // below the status rule
  const rowBottom = H - PAD - 150 - 24;           // above the footer band (taller: QR)
  const step = Math.floor((rowBottom - rowTop) / rows.length); // ≈150 for 6 rows
  let y = rowTop;
  const rowSvg = rows.map(([k, v, sub]) => {
    const red = isBad(v) || isBad(sub);
    const out = `<text x="${X}" y="${y}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="17" font-weight="700" letter-spacing="3" fill="#6B6A64">${svgEsc(k)}</text>
      <text x="${X}" y="${y + 44}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="34" font-weight="${red ? 700 : 400}" fill="${red ? '#B3261E' : '#141412'}">${svgEsc(v)}</text>
      ${sub ? `<text x="${X}" y="${y + 76}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="19" fill="${red ? '#B3261E' : '#6B6A64'}">${svgEsc(sub)}</text>` : ''}
      <line x1="${X}" y1="${y + step - 26}" x2="${W - PAD}" y2="${y + step - 26}" stroke="#D8D6CF" stroke-width="2"/>`;
    y += step;
    return out;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#FAFAF7"/>
    <rect x="${PAD}" y="${PAD}" width="${W - PAD * 2}" height="${H - PAD * 2}" fill="#FFFFFF" stroke="#141412" stroke-width="3"/>
    <text x="${PAD + 30}" y="${PAD + 58}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="22" font-weight="700" letter-spacing="4" fill="#B3261E">MICHEAL RAY BERRY · PUBLIC ACCOUNTABILITY PROJECT</text>
    <text x="${PAD + 30}" y="${PAD + 100}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="26" font-weight="700" letter-spacing="4" fill="#141412">DAY ${c.day}</text>
    <text x="${W - PAD - 30}" y="${PAD + 100}" text-anchor="end" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="22" fill="#6B6A64">${svgEsc(longDate(c.date))}</text>
    <line x1="${PAD}" y1="${PAD + 130}" x2="${W - PAD}" y2="${PAD + 130}" stroke="#141412" stroke-width="3"/>
    ${photoEl}
    <circle cx="${X + 16}" cy="${PAD + 130 + 52}" r="14" fill="${lamp}"/>
    <text x="${X + 46}" y="${PAD + 130 + 64}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${status.length > 12 ? 34 : 44}" font-weight="700" letter-spacing="4" fill="${bad ? '#B3261E' : '#141412'}">${svgEsc(status)}</text>
    <line x1="${X}" y1="${PAD + 130 + 84}" x2="${W - PAD}" y2="${PAD + 130 + 84}" stroke="#141412" stroke-width="3"/>
    ${rowSvg}
    <rect x="${PAD}" y="${H - PAD - 150}" width="${W - PAD * 2}" height="150" fill="#141412"/>
    <text x="${PAD + 30}" y="${H - PAD - 96}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="24" font-weight="700" letter-spacing="3" fill="#FAFAF7">MICHEAL RAY BERRY</text>
    <text x="${PAD + 30}" y="${H - PAD - 60}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="19" letter-spacing="2" fill="#FAFAF7">michealrayberry.com/daily/${c.date}-day-${String(c.day).padStart(3, '0')}/</text>
    <text x="${PAD + 30}" y="${H - PAD - 28}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="17" letter-spacing="2" fill="#8A8983">${c.complete ? 'FILES PRESENT' : c.anyFiled ? 'PARTIAL FILE RECORD' : 'NO PUBLIC FILE RECORD'} · 340 → 200 LB · PUBLIC ACCOUNTABILITY PROJECT</text>
    <g transform="translate(${W - PAD - 30 - 118} ${H - PAD - 134})"><rect width="118" height="118" fill="#FAFAF7"/><g transform="translate(6 6) scale(${106 / qr.size})"><path d="${qr.path}" fill="#141412"/></g></g>
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
/* Minimal QR encoder — byte mode, error-correction L, fixed mask 0. Enough
   for one short URL; returns { size, path } for an SVG <path>. */
function qrSvgPath(text) {
  const bytes = Buffer.from(text, 'utf8');
  const CAP = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];          // byte capacity, EC L, v1–v10
  const ECW = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];                 // EC codewords per block
  const BLK = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];                           // blocks
  const TOT = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];          // total codewords
  let v = CAP.findIndex((c) => c >= bytes.length); if (v < 0) throw new Error('QR: text too long');
  const size = 17 + 4 * (v + 1);
  const dataCw = TOT[v] - ECW[v] * BLK[v];
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(0b0100, 4); put(bytes.length, v + 1 >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0xEC; data.length < dataCw; p ^= 0xEC ^ 0x11) data.push(p);
  // GF(256) tables
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  const gen = (n) => { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; };
  const rs = (msg, n) => { const g = gen(n); const res = msg.concat(new Array(n).fill(0)); for (let i = 0; i < msg.length; i++) { const c = res[i]; if (c) for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c); } return res.slice(msg.length); };
  // blocks (short blocks first; group sizes for these versions at EC L are uniform or differ by one)
  const nb = BLK[v], base = Math.floor(dataCw / nb), extra = dataCw % nb;
  const blocks = [], ecs = []; let off = 0;
  for (let b = 0; b < nb; b++) { const len = base + (b >= nb - extra ? 1 : 0); const blk = data.slice(off, off + len); off += len; blocks.push(blk); ecs.push(rs(blk, ECW[v])); }
  const inter = [];
  for (let i = 0; i < base + 1; i++) for (const blk of blocks) if (i < blk.length) inter.push(blk[i]);
  for (let i = 0; i < ECW[v]; i++) for (const e of ecs) inter.push(e[i]);
  // matrix
  const M = Array.from({ length: size }, () => new Array(size).fill(null));
  const setF = (r, c, val) => { if (r >= 0 && r < size && c >= 0 && c < size) M[r][c] = val ? 1 : 0; };
  const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const on = (i >= 0 && i <= 6 && j >= 0 && j <= 6) && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)); setF(r + i, c + j, on); } };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  setF(size - 8, 8, 1);
  if (v + 1 >= 2) { const pos = [6, size - 7]; if (v + 1 >= 7) pos.splice(1, 0, Math.round((size - 13) / 2 / 2) * 2 + 6); for (const r of pos) for (const c of pos) { if (M[r][c] !== null && !(r === pos[1] && c === pos[1] && pos.length === 3) && (r === 6 || c === 6) && pos.length === 2) continue; if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) setF(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); } }
  // reserve format areas
  for (let i = 0; i < 9; i++) { if (M[8][i] === null) M[8][i] = 0; if (M[i][8] === null) M[i][8] = 0; }
  for (let i = size - 8; i < size; i++) { if (M[8][i] === null) M[8][i] = 0; if (M[i][8] === null) M[i][8] = 0; }
  if (v + 1 >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { M[i][size - 11 + j] = 0; M[size - 11 + j][i] = 0; }
  const reserved = M.map((row) => row.map((x) => x !== null));
  // place data, mask 0: (r+c)%2===0
  let bi = 0; const dbits = inter.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (b >> k) & 1));
  for (let c = size - 1; c > 0; c -= 2) { if (c === 6) c--; for (let k = 0; k < size; k++) { const r = ((c + 1) / 2) % 2 === 0 ? k : size - 1 - k; for (const cc of [c, c - 1]) { if (reserved[r][cc]) continue; let bit = bi < dbits.length ? dbits[bi++] : 0; if ((r + cc) % 2 === 0) bit ^= 1; M[r][cc] = bit; } } }
  // format info: EC L (01), mask 0 → data 01000, BCH → 0x77C4 ^ mask 0x5412 = known table value
  const fmt = 0b111011111000100; // EC L, mask 0 (pre-masked)
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    if (i < 6) M[i][8] = bit; else if (i < 8) M[i + 1][8] = bit; else M[size - 15 + i][8] = bit;
    if (i < 8) M[8][size - 1 - i] = bit; else if (i < 9) M[8][15 - i - 1 + 1] = bit; else M[8][15 - i - 1] = bit;
  }
  M[size - 8][8] = 1;
  if (v + 1 >= 7) { const VER = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 }[v + 1]; for (let i = 0; i < 18; i++) { const bit = (VER >> i) & 1; M[Math.floor(i / 3)][size - 11 + (i % 3)] = bit; M[size - 11 + (i % 3)][Math.floor(i / 3)] = bit; } }
  let d = '';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (M[r][c]) d += `M${c} ${r}h1v1h-1z`;
  return { size, path: d };
}
/* Writes /cards/YYYY-MM-DD.png; returns its URL. */
async function writeCard(c) {
  const dest = path.join(ROOT, 'cards', `${c.date}.png`);
  const buf = await cardImage(c);
  await writeIfChanged(dest, buf);
  return `${SITE_ORIGIN}/cards/${c.date}.png`;
}
/* Plain mono actions under a card. No counters, no icons, no "share". */
function cardActions(c, pageUrl) {
  const img = `${SITE_ORIGIN}/cards/${c.date}.png`;
  const text = encodeURIComponent(`Micheal Ray Berry — Day ${c.day}: ${cardStatus(c)}. ${pageUrl}`);
  return `<p class="rc-actions" style="margin:6px 0 0;font:600 12px/1.8 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;display:flex;gap:6px 18px;flex-wrap:wrap">
    <a href="${pageUrl}" data-copy="${pageUrl}">Copy link</a>
    <a href="${img}" download="micheal-ray-berry-day-${String(c.day).padStart(3, '0')}-report-card.png">Card image</a>
    <a href="https://x.com/intent/post?text=${text}" rel="noopener">Post to X</a>
    <a href="https://www.reddit.com/submit?url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(`Micheal Ray Berry — Day ${c.day}: ${cardStatus(c)}`)}" rel="noopener">Reddit</a>
  </p>`;
}

/* Watch page: the inspection video as the page's main content, so Google
   indexes it as a video result ("video isn't on a watch page" otherwise).
   One per complete day at /daily/<date>-day-NNN/video/. The day page keeps
   its own embed; this page is the one the video sitemap points at. */
function watchPage({ record, photos, previous, next }) {
  const { date, day, weight, video } = record;
  const dayPath = `/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const canonical = `${SITE_ORIGIN}${dayPath}video/`;
  const embed = videoEmbed(video);
  if (!embed && !isSelfHosted(video)) return null;
  const front = photos.front.sourceUrl;
  const title = `Day ${day} Daily Inspection — ${longDate(date)} — Micheal Ray Berry`;
  const description = `Micheal Ray Berry's Day ${day} daily inspection video, ${longDate(date)}: four positions in the project uniform, recorded weight ${weight.toFixed(1)} lb. Public Accountability Project.`;
  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, datePublished: date, dateModified: date, about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, primaryImageOfPage: front,
      mainEntity: { '@id': `${canonical}#video` } },
    { '@type': 'VideoObject', '@id': `${canonical}#video`, name: `Micheal Ray Berry — Day ${day} daily inspection, ${longDate(date)}`, description, uploadDate: date, thumbnailUrl: record.streamUid && streamThumb(record.streamUid) ? [streamThumb(record.streamUid), front] : [front], contentUrl: record.streamUid && streamHls(record.streamUid) ? streamHls(record.streamUid) : (isSelfHosted(video) ? video : undefined), embedUrl: record.streamUid && streamEmbedUrl(record.streamUid) ? streamEmbedUrl(record.streamUid) : (embed || undefined), ...(record.transcript ? { transcript: record.transcript } : {}), ...(video && !isSelfHosted(video) && record.streamUid ? { sameAs: video } : {}), ...(record.videoSec > 0 ? { duration: isoDuration(record.videoSec) } : {}), creator: { '@id': PERSON_ID }, isFamilyFriendly: true },
    { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Daily Record', item: `${SITE_ORIGIN}/daily/` },
      { '@type': 'ListItem', position: 3, name: `Day ${day}`, item: `${SITE_ORIGIN}${dayPath}` },
      { '@type': 'ListItem', position: 4, name: 'Inspection video', item: canonical } ] },
  ];
  const su = record.streamUid && streamEmbedUrl(record.streamUid) ? record.streamUid : '';
  const transcriptBlock = su && record.transcript ? `<section style="max-width:540px;margin:24px auto 0"><h2 style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px">Transcript</h2><p style="font-size:15px;line-height:1.6;margin:0">${htmlEscape(record.transcript)}</p></section>` : '';
  const player = su ? streamPlayer(su, title, true) + mirrorLink(video, `Day ${day} inspection`) : isSelfHosted(video)
    ? `<video controls preload="metadata" playsinline poster="${htmlEscape(front)}" width="720" height="1280" title="${htmlEscape(title)}" style="width:100%;max-width:540px;aspect-ratio:9/16;background:#000;display:block;margin:0 auto"><source src="${htmlEscape(video)}" type="${/\.webm(\?|$)/i.test(video) ? 'video/webm' : 'video/mp4'}"></video>`
    : `<div style="position:relative;width:100%;max-width:540px;aspect-ratio:9/16;background:#000;margin:0 auto"><iframe src="${htmlEscape(embed)}" title="${htmlEscape(title)}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="eager" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`;
  const strip = Object.entries(photos).map(([angle, ph]) => `<a href="${dayPath}#${angle}-photo"><img src="${htmlEscape(ph.variants?.[0]?.url || ph.sourceUrl)}" width="${ph.width}" height="${ph.height}" alt="${htmlEscape(`Micheal Ray Berry, Day ${day} daily inspection, ${imageLabel(angle)}, ${longDate(date)}`)}" loading="lazy" decoding="async" style="width:100%;height:auto;display:block;border:1px solid var(--rule)"></a>`).join('');
  const body = `
    <p class="crumb"><a href="/">Record</a> · <a href="/daily/">The Record</a> · <a href="${dayPath}">Day ${day}</a> · Video</p>
    <h1 style="font-size:clamp(2rem,5vw,3.4rem)">Day ${day} — Daily Inspection</h1>
    <p class="lede"><strong>${htmlEscape(longDate(date))} · recorded weight ${weight.toFixed(1)} lb · project uniform.</strong> One continuous take: Wait, Inspection, Left, Rear, Right. The burned-in stamp carries the day, weight, verification code and date.</p>
    ${player}${transcriptBlock}
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;max-width:760px;margin:24px auto 0">${strip}</div>
    <p style="text-align:center;margin-top:18px"><a href="${dayPath}">Full record for Day ${day} →</a>${previous ? ` · <a href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/video/">← Day ${previous.day}</a>` : ''}${next ? ` · <a href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/video/">Day ${next.day} →</a>` : ''}</p>`;
  return synPage({ title, desc: description, canonical, body })
    .replace('</head>', `<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>\n</head>`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${htmlEscape(front)}"><meta property="og:type" content="video.other">${embed ? `<meta property="og:video" content="${htmlEscape(embed)}"><meta property="og:video:type" content="text/html"><meta property="og:video:width" content="720"><meta property="og:video:height" content="1280">` : ''}`);
}

function dailyPage({ record, photos, previous, next, attestation }) {
  const { date, weight, note, video, day } = record;
  const canonical = `${SITE_ORIGIN}/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const title = `Micheal Ray Berry Day ${day} — ${weight.toFixed(1)} lb | ${longDate(date)}`;
  const description = `Day ${day} of Micheal Ray Berry’s public accountability record: ${weight.toFixed(1)} pounds on ${longDate(date)}, with four-angle photographs and the daily inspection video.`;
  const front = photos.front.sourceUrl;
  const embed = videoEmbed(video);
  const card = cardCtx(day, { date, complete: true, photoCount: 4, photo: { url: photos.front.variants?.[0]?.url || photos.front.sourceUrl } });
  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      primaryImageOfPage: { '@id': `${canonical}#front-photo` },
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: 'Micheal Ray Berry',
      url: SITE_ORIGIN + '/',
      image: front,
      // Must match the sameAs on the home page exactly: one entity, one set of
      // profiles. A day page claiming a narrower set makes the Person node
      // ambiguous instead of corroborating it.
      sameAs: ['https://www.youtube.com/@michealrayberry', 'https://fetlife.com/MichealRayBerry'],
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
      '@type': 'Article',
      '@id': `${canonical}#article`,
      headline: title,
      description,
      articleSection: 'Daily Record',
      author: { '@id': PERSON_ID },
      publisher: { '@id': PERSON_ID },
      mainEntityOfPage: { '@id': canonical },
      image: Object.keys(photos).map((a) => ({ '@id': `${canonical}#${a}-photo` })),
      video: { '@id': `${canonical}#inspection-video` },
      about: { '@id': PERSON_ID },
      isAccessibleForFree: true,
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Daily Record', item: `${SITE_ORIGIN}/daily/` },
        { '@type': 'ListItem', position: 3, name: `Day ${day} — ${longDate(date)}`, item: canonical },
      ],
    },
    {
      '@type': 'VideoObject',
      '@id': `${canonical}#inspection-video`,
      name: `Micheal Ray Berry Day ${day} daily inspection video — ${date}`,
      description: `Four-angle daily inspection video for Day ${day} of the Micheal Ray Berry Public Accountability Project, recorded at ${weight.toFixed(1)} pounds.`,
      thumbnailUrl: front,
      ...(isSelfHosted(video) ? { contentUrl: video } : { url: video }),
      ...(record.videoSec > 0 ? { duration: isoDuration(record.videoSec) } : {}),
      ...(embed ? { embedUrl: embed } : {}),
      ...(isSelfHosted(video)
        ? { encodingFormat: /\.webm(\?|$)/i.test(video) ? 'video/webm' : 'video/mp4' }
        : {}),
      creator: { '@id': PERSON_ID },
    },
  ];
  const figures = Object.entries(photos).map(([angle, p]) => {
    const srcset = p.variants.map((v) => `${v.url} ${v.width}w`).join(', ');
    const alt = `Micheal Ray Berry, Day ${day} daily inspection, ${imageLabel(angle)}, ${longDate(date)}, ${weight.toFixed(1)} lb, project uniform`;
    return `<figure id="${angle}-photo">
      <picture>
        <source type="image/webp" srcset="${htmlEscape(srcset)}" sizes="(max-width: 720px) 100vw, 50vw">
        <img src="${htmlEscape(p.sourceUrl)}" width="${p.width}" height="${p.height}" alt="${htmlEscape(alt)}" loading="${angle === 'front' ? 'eager' : 'lazy'}" decoding="async">
      </picture>
      <figcaption>Micheal Ray Berry — ${htmlEscape(imageLabel(angle))}, Day ${day}, ${htmlEscape(longDate(date))}.</figcaption>
    </figure>`;
  }).join('\n');
  const videoHtml = isSelfHosted(video)
    ? `<div class="video"><video controls preload="none" playsinline poster="${htmlEscape(front)}" width="720" height="1280" title="${htmlEscape(`Micheal Ray Berry Day ${day} inspection video`)}">
        <source src="${htmlEscape(video)}" type="${/\.webm(?:\?|$)/i.test(video) ? 'video/webm' : 'video/mp4'}">
        <a href="${htmlEscape(video)}">Download the Day ${day} inspection video</a>
      </video></div>`
    : record.streamUid && streamEmbedUrl(record.streamUid)
      ? streamPlayer(record.streamUid, `Micheal Ray Berry Day ${day} inspection video`) + mirrorLink(video, `Day ${day} inspection`)
    : (embed
      ? `<div class="video"><iframe src="${htmlEscape(embed)}" title="${htmlEscape(`Micheal Ray Berry Day ${day} inspection video`)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : `<p class="video-link"><a href="${htmlEscape(video)}" rel="noopener">Watch the Day ${day} inspection video</a></p>`);
  const week = Math.ceil(day / 7);
  const nav = `<nav class="record-nav" aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/daily/">All days</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>
    <p style="font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">Something wrong with this entry? <a href="/report/?ref=${date}">Report a record issue</a>.</p>
    <p class="also"><a href="/weeks/week-${String(week).padStart(2, '0')}/">Week ${week}</a> · <a href="/milestones/${MILESTONES.filter((m) => m < weight).sort((a, b) => b - a)[0] || 200}-lb/">Next milestone</a> · <a href="/dashboard/">Weigh-in log</a> · <a href="/">michealrayberry.com</a></p>`;
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
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
  <meta property="og:image" content="${SITE_ORIGIN}/cards/${date}.png">
  <meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">
  <meta name="twitter:card" content="summary_large_image">
  ${embed ? `<meta property="og:video" content="${htmlEscape(embed)}">
  <meta property="og:video:type" content="text/html">
  <meta property="og:video:width" content="1080">
  <meta property="og:video:height" content="1920">` : ''}
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(description)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/cards/${date}.png">
  <meta name="twitter:image:alt" content="Day ${day} public record report card">
  <meta property="og:image:alt" content="Day ${day} public record report card">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>
    .skip-link{position:fixed;left:16px;top:12px;z-index:10000;transform:translateY(-160%);background:#fafaf7;color:#141412;border:2px solid #141412;padding:10px 14px;font:600 14px "IBM Plex Mono",ui-monospace,monospace}
    .skip-link:focus{transform:translateY(0)}
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:500;font-size:11.5px;letter-spacing:.08em;color:#3A3935;padding:5px 9px}
    .sitenav .share{border:1px solid var(--ink);padding:7px 12px;margin-left:6px;font-size:12px;letter-spacing:.08em}.sitenav .share:hover{background:var(--ink);color:var(--paper);text-decoration:none}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    [data-live-nav]{display:inline-flex;align-items:center;gap:7px}[data-live-nav].is-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;animation:livepulse 1.6s ease-in-out infinite}
    [data-live-nav].is-live{color:var(--accent)}@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
    @media(max-width:760px){.sitehead{padding:0 16px}.sitehead-in{align-items:flex-start}.sitenav{width:100%;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav-primary,.nav-secondary{flex-wrap:nowrap;justify-content:flex-start;width:max-content;min-width:100%}.sitenav a{min-height:44px;display:inline-flex;align-items:center}.nav-secondary a{min-height:40px}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#FF6B61}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}.stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px 'IBM Plex Mono',ui-monospace,monospace}
    .intro{max-width:760px;font-size:1.15rem}.attest{border-left:4px solid var(--accent);padding:10px 14px;background:#f1f0ea}
    .gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:36px 0}.gallery figure{margin:0;border:1px solid var(--ink);background:#fff}
    .gallery img{display:block;width:100%;height:auto}.gallery figcaption{padding:10px 12px;font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
    ${RC_CSS}
    .video{margin:24px 0;background:#000}.video video{display:block;width:100%;max-width:420px;height:auto;margin:auto}
    .video:has(iframe){position:relative;padding-top:56.25%}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    .record-nav{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--rule);padding-top:24px;margin-top:36px}.record-nav a:nth-child(2){text-align:center}.record-nav a:last-child{text-align:right}
    .also{font:12px/1.8 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:12px 0 0}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:720px){.gallery{grid-template-columns:1fr}.record-nav{grid-template-columns:1fr;text-align:left!important}.record-nav a:nth-child(2),.record-nav a:last-child{text-align:left}}
    @media(max-width:760px){.sitefoot{padding-left:16px;padding-right:16px}.sitefoot-bottom .pair{min-width:0}.sitefoot-bottom .pair span{white-space:normal}.sitefoot-bottom .pair a{overflow-wrap:anywhere}.sitefoot-bottom>span:last-child{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-width:0}}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Micheal Ray Berry — Day ${day}</h1>
  <div class="stats"><span>${htmlEscape(longDate(date))}</span><span>${weight.toFixed(1)} LB</span><span>340 → 200 LB</span></div>
</header>
<main id="main-content">
  ${reportCard(card)}
  ${cardActions(card, canonical)}
  <p class="intro">This page records Day ${day} of the Micheal Ray Berry Public Accountability Project. On ${htmlEscape(longDate(date))}, the public tracker recorded ${weight.toFixed(1)} pounds. Four photographs and an inspection video are present. Their current presence does not, by itself, establish when every file was submitted${card.obligationActive ? ' or whether the active deadline was met' : '; no filing requirement was active for this date'}.</p>
  ${note ? `<p>${htmlEscape(note)}</p>` : ''}
  <p class="attest">${attestation ? `A structurally valid capture-attestation row is recorded: ${htmlEscape(attestation)}. It supports a byte-match comparison but does not independently prove capture time, authorship, or filing timeliness.` : 'The public files are listed with this daily page and its manifest; no accepted capture-attestation row is published for this date.'}</p>
  <section aria-labelledby="photos-heading"><h2 id="photos-heading">Daily accountability photographs</h2><div class="gallery">${figures}</div></section>
  <section aria-labelledby="video-heading"><h2 id="video-heading">Daily inspection video</h2>${videoHtml}
    <p class="watch-link" style="margin:8px 0 0;font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase"><a href="video/">Watch page for this inspection →</a></p></section>
  <p><a href="/manifests/${date}.json">View the machine-readable manifest and SHA-256 evidence hashes</a></p>
  ${nav}
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* The /daily/ index. Built from the same list that produced the day pages,
   so a file-presence label always corresponds to a generated entry. Days between the start and
   the latest record with no page are shown as gaps, which is the point. */
const PAGE_CSS = `
    .skip-link{position:fixed;left:16px;top:12px;z-index:10000;transform:translateY(-160%);background:#fafaf7;color:#141412;border:2px solid #141412;padding:10px 14px;font:600 14px "IBM Plex Mono",ui-monospace,monospace}
    .skip-link:focus{transform:translateY(0)}
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:500;font-size:11.5px;letter-spacing:.08em;color:#3A3935;padding:5px 9px}
    .sitenav .share{border:1px solid var(--ink);padding:7px 12px;margin-left:6px;font-size:12px;letter-spacing:.08em}.sitenav .share:hover{background:var(--ink);color:var(--paper);text-decoration:none}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    [data-live-nav]{display:inline-flex;align-items:center;gap:7px}[data-live-nav].is-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;animation:livepulse 1.6s ease-in-out infinite}
    [data-live-nav].is-live{color:var(--accent)}@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
    @media(max-width:760px){.sitehead{padding:0 16px}.sitehead-in{align-items:flex-start}.sitenav{width:100%;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav-primary,.nav-secondary{flex-wrap:nowrap;justify-content:flex-start;width:max-content;min-width:100%}.sitenav a{min-height:44px;display:inline-flex;align-items:center}.nav-secondary a{min-height:40px}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#FF6B61}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    h2{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:22px;margin:36px 0 12px;font-size:1.5rem;margin:32px 0 8px}
    .intro{max-width:760px;font-size:1.1rem}
    .stats{display:flex;gap:24px;flex-wrap:wrap;font:600 14px 'IBM Plex Mono',ui-monospace,monospace;margin:.5rem 0}
    table{width:100%;border-collapse:collapse;margin:20px 0;font:14px 'IBM Plex Mono',ui-monospace,monospace}
    caption{text-align:left;margin:0 0 8px;font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
    th{text-align:left;background:var(--ink);color:var(--paper);padding:8px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    td{padding:8px 10px;border-bottom:1px solid var(--rule)}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:24px 0}
    .gallery figure{margin:0;border:1px solid var(--ink);background:#fff}.gallery img{display:block;width:100%;height:auto}
    .gallery figcaption{padding:8px 10px;font:11px/1.5 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
    .pending{border-left:4px solid var(--accent);padding:12px 16px;background:#f1f0ea}
    ${RC_CSS}
    nav.crumbs{font:12px 'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:760px){.sitefoot{padding-left:16px;padding-right:16px}.sitefoot-bottom .pair{min-width:0}.sitefoot-bottom .pair span{white-space:normal}.sitefoot-bottom .pair a{overflow-wrap:anywhere}.sitefoot-bottom>span:last-child{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-width:0}}
`;

function crumbs(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.url })),
  };
}

/* ── Milestone pages ──────────────────────────────────────────────────
   One page per published weight threshold (320/300/275/250/225/200).
   A scale entry records that a threshold was crossed; it is not presented
   as an independently verified achievement. */
function milestonePage(target, entries) {
  const reached = entries.find(({ record }) => record.weight <= target) || null;
  const latest = entries.at(-1)?.record || null;
  const start = START_WEIGHT;
  const canonical = `${SITE_ORIGIN}/milestones/${target}-lb/`;
  const title = reached
    ? `Micheal Ray Berry — ${target} lb Threshold Recorded on Day ${reached.record.day}`
    : `Micheal Ray Berry — ${target} lb Threshold (Not Yet Recorded)`;
  const toGo = latest ? Math.max(0, latest.weight - target) : null;
  const description = reached
    ? `A weight at or below the ${target}-pound threshold was recorded for Micheal Ray Berry on ${longDate(reached.record.date)}, Day ${reached.record.day}: ${reached.record.weight.toFixed(1)} pounds.`
    : latest
      ? `The ${target}-pound threshold has not been recorded. Latest recorded weight: ${latest.weight.toFixed(1)} pounds — ${toGo.toFixed(1)} pounds above the threshold.`
      : `The ${target}-pound threshold has not been recorded. No measured weight is currently published.`;
  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    crumbs([
      { name: 'Micheal Ray Berry', url: `${SITE_ORIGIN}/` },
      { name: 'Milestones', url: `${SITE_ORIGIN}/milestones` },
      { name: `${target} lb`, url: canonical },
    ]),
  ];
  const day1 = entries[0] || null;
  const pair = reached && day1 && day1.photos?.front && reached.photos?.front && day1.record.date !== reached.record.date ? `
    <div class="pair" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-width:720px;margin:20px 0 28px">
      <figure style="margin:0"><img src="${htmlEscape(day1.photos.front.sourceUrl)}" width="${day1.photos.front.width}" height="${day1.photos.front.height}" alt="${htmlEscape(`Micheal Ray Berry, Day ${day1.record.day} front, ${day1.record.weight.toFixed(1)} pounds — the starting record`)}" loading="lazy" decoding="async" style="width:100%;height:auto;display:block"><figcaption>Day ${day1.record.day} · ${htmlEscape(longDate(day1.record.date))} · ${day1.record.weight.toFixed(1)} lb</figcaption></figure>
      <figure style="margin:0"><img src="${htmlEscape(reached.photos.front.sourceUrl)}" width="${reached.photos.front.width}" height="${reached.photos.front.height}" alt="${htmlEscape(`Micheal Ray Berry, Day ${reached.record.day} front, ${reached.record.weight.toFixed(1)} pounds — first record at or below ${target}`)}" loading="lazy" decoding="async" style="width:100%;height:auto;display:block"><figcaption>Day ${reached.record.day} · ${htmlEscape(longDate(reached.record.date))} · ${reached.record.weight.toFixed(1)} lb</figcaption></figure>
    </div>` : '';
  const body = reached
    ? `${pair}<p class="intro">A weight at or below the <strong>${target}-pound threshold</strong> was recorded on <strong>${htmlEscape(longDate(reached.record.date))}</strong>, Day ${reached.record.day} of the Public Accountability Project: ${reached.record.weight.toFixed(1)} pounds — ${(start - reached.record.weight).toFixed(1)} pounds below the declared starting weight of ${start.toFixed(1)}.</p>
    <div class="gallery">${Object.entries(reached.photos).map(([angle, ph]) => `<figure>
      <picture><source type="image/webp" srcset="${htmlEscape(ph.variants.map((v) => `${v.url} ${v.width}w`).join(', '))}" sizes="(max-width:720px) 50vw, 25vw">
      <img src="${htmlEscape(ph.sourceUrl)}" width="${ph.width}" height="${ph.height}" alt="${htmlEscape(`Micheal Ray Berry ${imageLabel(angle)} accountability photograph on ${longDate(reached.record.date)}, Day ${reached.record.day}, recorded weight ${reached.record.weight.toFixed(1)} pounds—the first public record at or below the ${target}-pound threshold`)}" loading="lazy" decoding="async"></picture>
      <figcaption>${htmlEscape(imageLabel(angle))} · Day ${reached.record.day}</figcaption></figure>`).join('')}</div>
    <p><a href="/daily/${reached.record.date}-day-${String(reached.record.day).padStart(3, '0')}/">Full record for Day ${reached.record.day} →</a></p>`
    : `<p class="intro">The <strong>${target}-pound threshold</strong> has not been recorded.</p>
    <div class="pending">${latest ? `<strong>${toGo.toFixed(1)} pounds above the threshold.</strong> Latest recorded weight: ${latest.weight.toFixed(1)} pounds on ${htmlEscape(longDate(latest.date))}, Day ${latest.day}.` : '<strong>No measured weight is currently published.</strong> The 340-pound starting figure is declared, not a measured baseline.'} This page updates when a qualifying weight is recorded.</div>`;
  const others = MILESTONES.filter((m) => m !== target)
    .map((m) => `<a href="/milestones/${m}-lb/">${m} lb</a>`).join(' · ');
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
  ${reached ? `<meta property="og:image" content="${htmlEscape(reached.photos.front.sourceUrl)}"><meta property="og:image:alt" content="Micheal Ray Berry on the day the ${target}-pound threshold was recorded">` : ''}
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
<header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Micheal Ray Berry</a> / <a href="/milestones/">Milestones</a> / ${target} lb</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>${target} Pound Milestone</h1>
  <div class="stats"><span>340 → 200 LB</span><span>${reached ? 'THRESHOLD RECORDED' : 'NOT YET RECORDED'}</span></div>
</header>
<main id="main-content">
  ${body}
  <h2>Other milestones</h2>
  <p>${others}</p>
  <p><a href="/daily/">Full daily record</a> · <a href="/dashboard/">Weigh-in log</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* ── Weekly summary pages ─────────────────────────────────────────────
   Project weeks run Day 1–7, 8–14, and so on. Each page carries that
   week's weights, the net change, and every day with the listed files present, giving the
   archive a second navigable axis and a lot more indexable surface. */
function weekPage(week, weekEntries, allEntries, lastWeek) {
  const firstDay = (week - 1) * 7 + 1;
  const canonical = `${SITE_ORIGIN}/weeks/week-${String(week).padStart(2, '0')}/`;
  const weights = weekEntries.map((e) => e.record.weight);
  const net = weights.length > 1 ? weights[weights.length - 1] - weights[0] : 0;
  const dates = weekEntries.map((e) => e.record.date);
  const span = dates.length ? `${longDate(dates[0])} – ${longDate(dates[dates.length - 1])}` : `Days ${firstDay}–${firstDay + 6}`;
  const title = `Micheal Ray Berry Week ${week} — Days ${firstDay}–${firstDay + 6} | Public Accountability Project`;
  const description = weights.length
    ? `Week ${week} of the Micheal Ray Berry Public Accountability Project, ${span}: ${weights[0].toFixed(1)} to ${weights[weights.length - 1].toFixed(1)} pounds across ${weekEntries.length} days with the listed files present. File presence does not establish filing timeliness.`
    : `Week ${week} of the Micheal Ray Berry Public Accountability Project. No days currently have all listed files present in this week.`;
  const rows = weekEntries.map(({ record }) => `<tr>
    <td><a href="/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/">Day ${record.day}</a></td>
    <td>${htmlEscape(longDate(record.date))}</td>
    <td><strong>${record.weight.toFixed(1)} lb</strong></td>
    <td>${htmlEscape(record.note || '')}</td>
  </tr>`).join('\n');
  const maxWeek = lastWeek || Math.ceil((allEntries.at(-1)?.record.day || 1) / 7);
  const todayDay = dayNumber(todayEtIso());
  const weekCards = [];
  for (let d = firstDay; d <= firstDay + 6 && d <= todayDay; d++) {
    const e = weekEntries.find((x) => x.record.day === d);
    const date = e ? e.record.date : dateForDay(d);
    weekCards.push(reportCard(cardCtx(d, { date, complete: !!e, photoCount: e ? 4 : 0, photo: e ? { url: e.photos.front.variants?.[0]?.url || e.photos.front.sourceUrl } : null }), { compact: true, link: `/daily/${date}-day-${String(d).padStart(3, '0')}/` }));
  }
  const filesPresent = weekEntries.length;
  const wkFirst = weights[0], wkLast = weights.at(-1);
  const recapDays = Math.min(7, Math.max(0, todayDay - firstDay + 1));
  const recap = [
    `Week ${week} of the Micheal Ray Berry Public Accountability Project covers Days ${firstDay}–${firstDay + 6}${dates.length ? ` (${span})` : ''}.`,
    weights.length >= 2 ? `The recorded weight moved from ${wkFirst.toFixed(1)} to ${wkLast.toFixed(1)} pounds, a ${net < 0 ? 'loss' : net > 0 ? 'gain' : 'change'} of ${Math.abs(net).toFixed(1)} pounds, and stood ${Math.abs(START_WEIGHT - wkLast).toFixed(1)} pounds ${wkLast <= START_WEIGHT ? 'below' : 'above'} the declared ${START_WEIGHT}-pound start.` : weights.length === 1 ? `One weight was recorded, ${wkFirst.toFixed(1)} pounds.` : 'No complete daily record was published this week.',
    recapDays > 0 ? `${filesPresent} of ${recapDays} days so far have all required files present${recapDays - filesPresent > 0 ? `; ${recapDays - filesPresent} ${recapDays - filesPresent === 1 ? 'day does' : 'days do'} not` : ''}. File presence does not by itself establish that a filing was on time; compliance outcomes come from the violation log.` : '',
  ].filter(Boolean).join(' ');
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
  ${weekEntries[0] ? `<meta property="og:image" content="${htmlEscape(weekEntries[0].photos.front.sourceUrl)}"><meta property="og:image:alt" content="Micheal Ray Berry documentation photograph from week ${week}">` : ''}
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID } },
    crumbs([
      { name: 'Micheal Ray Berry', url: `${SITE_ORIGIN}/` },
      { name: 'Weeks', url: `${SITE_ORIGIN}/weeks/` },
      { name: `Week ${week}`, url: canonical },
    ]),
  ] })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}${RC_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
<header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Micheal Ray Berry</a> / <a href="/weeks/">Weeks</a> / Week ${week}</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Week ${week}</h1>
  <p class="intro" style="max-width:720px">${htmlEscape(recap)}</p>
  <div class="stats"><span>DAYS ${firstDay}–${firstDay + 6}</span><span>${htmlEscape(span)}</span>${weights.length > 1 ? `<span>${net <= 0 ? '−' : '+'}${Math.abs(net).toFixed(1)} LB</span>` : ''}</div>
</header>
<main id="main-content">
  <p class="intro">${htmlEscape(description)}</p>
  ${weekCards.length ? `<h2 style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin:8px 0 12px">Report cards \u00B7 ${filesPresent} of ${weekCards.length} days have all listed files present · timing unverified</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin:0 0 32px">${weekCards.join('')}</div>` : ''}
  ${rows ? `<table><caption>Recorded entries for week ${week}</caption><thead><tr><th scope="col">Day</th><th scope="col">Date</th><th scope="col">Weight</th><th scope="col">Note</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="pending">No days currently have all listed files present in this week.</div>'}
  <p>${nav}</p>
  <p><a href="/daily/">Full daily record</a> · <a href="/dashboard/">Weigh-in log</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

function weeksIndexPage(entries, lastDay) {
  const maxWeek = Math.ceil((lastDay || entries.at(-1)?.record.day || 1) / 7);
  const canonical = `${SITE_ORIGIN}/weeks/`;
  const items = [];
  for (let w = 1; w <= maxWeek; w++) {
    const inWeek = entries.filter(({ record }) => Math.ceil(record.day / 7) === w);
    const weights = inWeek.map((e) => e.record.weight);
    items.push(`<tr><td><a href="/weeks/week-${String(w).padStart(2, '0')}/">Week ${w}</a></td>
      <td>Days ${(w - 1) * 7 + 1}–${w * 7}</td>
      <td>${inWeek.length} with files present</td>
      <td>${weights.length ? `${weights[0].toFixed(1)} → ${weights[weights.length - 1].toFixed(1)} lb` : '—'}</td></tr>`);
  }
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Weekly Record — Micheal Ray Berry Public Accountability Project</title>
  <meta name="description" content="Week-by-week summary of the Micheal Ray Berry Public Accountability Project: current file presence and net recorded weight change for every project week; filing timeliness is not inferred.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${canonical}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
<header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Micheal Ray Berry</a> / Weeks</nav>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Weekly Record</h1>
</header>
<main id="main-content">
  <div class="viewsw"><a href="/daily/">Days</a><a href="/weeks/" aria-current="page">Weeks</a><a href="/dashboard/">Dashboard</a></div>
  <p class="intro">Every project week, Day 1 onward. Each week page lists days with the currently published files, recorded weights, and net change. Current file presence does not establish filing timeliness.</p>
  <table><caption>Weekly file-presence summary</caption><thead><tr><th scope="col">Week</th><th scope="col">Days</th><th scope="col">Files present</th><th scope="col">Weight</th></tr></thead><tbody>${items.reverse().join('\n')}</tbody></table>
  <p><a href="/daily/">Full daily record</a> · <a href="/milestones/">Milestones</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* True while today's 10 PM Eastern deadline is still ahead. Derived from the
   date rather than a fixed offset so it holds across the DST change. */
function deadlinePending(iso) {
  const now = buildNow();
  const todayIso = todayEtIso(now);
  if (iso > todayIso) return true;
  if (iso < todayIso) return false;
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
  }).format(now));
  return hour < 22;
}

/* Day labels separate file presence from an AP ruling and a deadline verdict. */
function dayGrade(date, hasEntry, vioByDate, obligationActive, deadlineVerdict = '') {
  if (!obligationActive) return hasEntry
    ? '<span class="flag" style="color:#6B6A64">Files present · no active requirement</span>'
    : '<span class="flag" style="color:#6B6A64">No active requirement</span>';
  const v = vioByDate.get(date);
  if (v === 'open') return '<span class="flag" style="color:#B3261E;font-weight:700">Failed — correction required</span>';
  if (v === 'corrected') return '<span class="flag" style="color:#8A6A1E">Failed — corrected, awaiting verification</span>';
  if (v === 'resolved') return '<span class="flag" style="color:#6B6A64">Failed — corrected</span>';
  if (hasEntry && deadlineVerdict === 'on-time') return '<span class="flag" style="color:#3A6B3A">Documented on time</span>';
  if (hasEntry) return '<span class="flag" style="color:#6B6A64">Files present · timing unverified</span>';
  return '';
}

function dailyIndexPage(entries, dayStates = new Map(), vioByDate = new Map(), agreementActive = false, effectiveDate = '') {
  const byDate = new Map(entries.map((e) => [e.record.date, e]));
  /* Run to today, not to the last finalized day. Stopping at the last
     complete record makes an unfiled day vanish from the index instead of
     showing as a gap — which is the one thing this page exists to prevent. */
  const today = todayEtIso();
  const lastEntry = entries.at(-1)?.record.date || START_DATE;
  const latest = today > lastEntry ? today : lastEntry;
  const days = [];
  for (let d = new Date(`${START_DATE}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const state = dayStates.get(iso) || {};
    days.push({
      date: iso,
      day: dayNumber(iso),
      entry: byDate.get(iso) || null,
      state,
      obligationActive: agreementAppliesOn(iso, agreementActive, effectiveDate),
    });
    if (iso >= latest) break;
  }
  days.reverse();
  const filesPresent = days.filter((d) => d.entry).length;
  const partial = days.filter((d) => !d.entry && d.state.kind === 'partial').length;
  const pending = days.filter((d) => !d.entry && d.obligationActive && d.state.kind === 'pending').length;
  const gaps = days.length - filesPresent - partial - pending;
  const canonical = `${SITE_ORIGIN}/daily/`;
  const title = 'Daily Record — Micheal Ray Berry Public Accountability Project';
  const description = `Every published day of the Micheal Ray Berry Public Accountability Project: ${filesPresent} days currently have a recorded weight, four-angle photographs, inspection video, and SHA-256 evidence manifest. Current file presence does not establish filing timeliness.`;
  const cards = days.map(({ date, day, entry, state, obligationActive }) => {
    const href = `/daily/${date}-day-${String(day).padStart(3, '0')}/`;
    if (!entry) {
      const hasPartialRecord = state.kind === 'partial';
      // Only an active, post-effective filing window can be described as due.
      if (!hasPartialRecord && obligationActive && state.kind === 'pending') {
        return `<li class="card gap pending"><a href="${href}"><div class="thumb"><span>DUE TONIGHT</span></div>
        <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="flag">Due by 10 PM ET</span></div></a></li>`;
      }
      const flag = hasPartialRecord ? 'Partial record' : 'No record';
      const inner = `<div class="thumb"><span>${flag.toUpperCase()}</span></div>
        <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="flag">${flag}</span>${dayGrade(date, false, vioByDate, obligationActive)}</div>`;
      // Every gap day links to its page, which states what was and was not filed.
      return `<li class="card gap${obligationActive ? '' : ' pending'}"><a href="${href}">${inner}</a></li>`;
    }
    const front = entry.photos.front;
    const srcset = front.variants.map((v) => `${v.url} ${v.width}w`).join(', ');
    return `<li class="card"><a href="${href}">
      <picture><source type="image/webp" srcset="${htmlEscape(srcset)}" sizes="(max-width:720px) 50vw, 25vw">
      <img src="${htmlEscape(front.sourceUrl)}" width="${front.width}" height="${front.height}" alt="${htmlEscape(`Micheal Ray Berry, Day ${day} daily inspection, front view, ${longDate(date)}`)}" loading="lazy" decoding="async"></picture>
      <div class="meta"><strong>Day ${day}</strong><span>${htmlEscape(longDate(date))}</span><span class="wt">${entry.record.weight.toFixed(1)} lb</span>${dayGrade(date, true, vioByDate, obligationActive, entry.record.deadlineVerdict || '')}</div>
    </a></li>`;
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
  <script type="application/ld+json">${jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonical,
    url: canonical,
    name: title,
    description,
    about: { '@id': PERSON_ID },
    hasPart: days.filter((d) => d.entry).map((d) => ({
      '@type': 'WebPage',
      url: `${SITE_ORIGIN}/daily/${d.date}-day-${String(d.day).padStart(3, '0')}/`,
      name: `Day ${d.day} — ${longDate(d.date)}`,
    })),
  })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>
    .skip-link{position:fixed;left:16px;top:12px;z-index:10000;transform:translateY(-160%);background:#fafaf7;color:#141412;border:2px solid #141412;padding:10px 14px;font:600 14px "IBM Plex Mono",ui-monospace,monospace}
    .skip-link:focus{transform:translateY(0)}
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:500;font-size:11.5px;letter-spacing:.08em;color:#3A3935;padding:5px 9px}
    .sitenav .share{border:1px solid var(--ink);padding:7px 12px;margin-left:6px;font-size:12px;letter-spacing:.08em}.sitenav .share:hover{background:var(--ink);color:var(--paper);text-decoration:none}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    [data-live-nav]{display:inline-flex;align-items:center;gap:7px}[data-live-nav].is-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;animation:livepulse 1.6s ease-in-out infinite}
    [data-live-nav].is-live{color:var(--accent)}@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
    @media(max-width:760px){.sitehead{padding:0 16px}.sitehead-in{align-items:flex-start}.sitenav{width:100%;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav-primary,.nav-secondary{flex-wrap:nowrap;justify-content:flex-start;width:max-content;min-width:100%}.sitenav a{min-height:44px;display:inline-flex;align-items:center}.nav-secondary a{min-height:40px}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#FF6B61}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main,footer{max-width:1200px;margin:auto;padding:24px}header{border-bottom:2px solid var(--ink)}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,5vw,3.5rem);line-height:1;margin:.35rem 0}
    .intro{max-width:760px}.count{font:600 14px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em}
    ul{list-style:none;padding:0;margin:28px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
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
    footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--rule)}a{color:var(--ink);text-underline-offset:3px}
    @media(max-width:760px){.sitefoot{padding-left:16px;padding-right:16px}.sitefoot-bottom .pair{min-width:0}.sitefoot-bottom .pair span{white-space:normal}.sitefoot-bottom .pair a{overflow-wrap:anywhere}.sitefoot-bottom>span:last-child{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-width:0}}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
<header>
  <div class="eyebrow">Official public record · MichealRayBerry.com</div>
  <h1>Daily Record</h1>
</header>
<main id="main-content">
  <div class="viewsw"><a href="/daily/" aria-current="page">Days</a><a href="/weeks/">Weeks</a><a href="/dashboard/">Dashboard</a></div>
  <p class="intro">Every published project date appears here, newest first. A day labeled <strong>Files present</strong> has the currently published weight, photographs, video, and manifest, but current presence alone does not prove when each component was filed. <strong>Partial record</strong> and <strong>No record</strong> describe only current public file presence. While the agreement is pending counter-signature, days without records are not yet published as violations; the violation log staying empty does not mean every day was documented. ${agreementActive && effectiveDate ? `Only dates on or after ${htmlEscape(longDate(effectiveDate))} can carry an active due or violation state.` : 'Agreement execution is not verified, so no date carries an active filing obligation or violation state.'}</p>
  <p class="count"><strong>${filesPresent}</strong> ${filesPresent === 1 ? 'day with files present' : 'days with files present'}${partial ? ` · <strong>${partial}</strong> partial ${partial === 1 ? 'record' : 'records'}` : ''}${gaps ? ` · <strong>${gaps}</strong> ${gaps === 1 ? 'day' : 'days'} without a record` : ''}${pending ? ` · <strong>${pending}</strong> active filing ${pending === 1 ? 'window' : 'windows'} open` : ''}</p>
  <p><a href="/">Return to michealrayberry.com</a> · <a href="/weeks/">Weekly record</a> · <a href="/milestones/">Milestones</a> · <a href="/dashboard/">Weigh-in log and progress grid</a></p>
  <h2 style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin:28px 0 0">Today\u2019s report card</h2>
  ${(() => { const t = days[0]; const e = t.entry; const cc = cardCtx(t.day, { date: t.date, complete: !!e, photoCount: e ? 4 : (t.state.photoCount || 0), photo: e ? { url: e.photos.front.variants?.[0]?.url || e.photos.front.sourceUrl } : null }); const u = `${SITE_ORIGIN}/daily/${t.date}-day-${String(t.day).padStart(3, '0')}/`; return reportCard(cc, { link: u }) + cardActions(cc, u); })()}
  ${PRIOR_NOTE ? `<div style="border-left:4px solid var(--accent);background:#f1f0ea;padding:12px 16px;margin:20px 0;max-width:760px"><strong>Earlier attempt.</strong> ${htmlEscape(PRIOR_NOTE)}</div>` : ''}
  <ul>${cards}</ul>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* RSS feed of the daily record. Feed readers, aggregators, and crawlers all
   poll it, so a new day is discovered without waiting for a sitemap re-crawl. */
function rssFeed(entries) {
  const items = entries.slice(-50).reverse().map(({ record, photos }) => {
    const url = `${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`;
    return `    <item>
      <title>${xmlEscape(`Day ${record.day} — ${record.weight.toFixed(1)} lb — ${longDate(record.date)}`)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${record.date}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${xmlEscape(`Day ${record.day} of the Micheal Ray Berry Public Accountability Project. Recorded weight ${record.weight.toFixed(1)} pounds on ${longDate(record.date)}, with four-angle documentation photographs and the daily inspection video.`)}</description>
      <enclosure url="${xmlEscape(photos.front.sourceUrl)}" type="image/jpeg" length="0"/>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Micheal Ray Berry — Public Accountability Project</title>
    <link>${SITE_ORIGIN}/daily/</link>
    <atom:link href="${SITE_ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>The public record of dated weight, four-angle photographs, and inspection video when those files are available. The agreement page reports whether any filing requirement is active.</description>
    <language>en-US</language>
    <lastBuildDate>${buildNow().toUTCString()}</lastBuildDate>
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

/* A Project Day with no complete record still gets a page. Two reasons: the
   prev/next chain stays unbroken (a crawler following Day 10 → Day 13 sees a
   sequence with a hole and no explanation), and the absence is itself part of
   the record — stated neutrally, exactly as the agreement requires. These
   pages carry no photographs, no video, and no consequence detail. */
function noRecordPage({ date, day, previous, next, reason, kind = 'none', photoCount = 0, obligationActive = false }) {
  const label = obligationActive && kind === 'pending' ? 'Due today' : kind === 'partial' ? 'Partial record' : 'No record';
  const canonical = `${SITE_ORIGIN}/daily/${date}-day-${String(day).padStart(3, '0')}/`;
  const title = `Day ${day} — ${label} — ${longDate(date)} — Micheal Ray Berry`;
  const description = `Day ${day} of the Micheal Ray Berry Public Accountability Project, ${longDate(date)}: ${obligationActive && kind === 'pending' ? 'an active filing window remains open until 10:00 PM Eastern' : kind === 'partial' ? 'some public files are currently present, with filing timeliness unverified' : 'no public file record is currently present'}.`;
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
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Daily Record', item: `${SITE_ORIGIN}/daily/` },
        { '@type': 'ListItem', position: 3, name: `Day ${day} — ${longDate(date)}`, item: canonical },
      ],
    },
  ];
  const week = Math.ceil(day / 7);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_ORIGIN}/cards/${date}.png"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350"><meta property="og:image:alt" content="Day ${day} public record status card">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SITE_ORIGIN}/cards/${date}.png"><meta name="twitter:image:alt" content="Day ${day} public record status card">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>
    .skip-link{position:fixed;left:16px;top:12px;z-index:10000;transform:translateY(-160%);background:#fafaf7;color:#141412;border:2px solid #141412;padding:10px 14px;font:600 14px "IBM Plex Mono",ui-monospace,monospace}
    .skip-link:focus{transform:translateY(0)}
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:500;font-size:11.5px;letter-spacing:.08em;color:#3A3935;padding:5px 9px}
    .sitenav .share{border:1px solid var(--ink);padding:7px 12px;margin-left:6px;font-size:12px;letter-spacing:.08em}.sitenav .share:hover{background:var(--ink);color:var(--paper);text-decoration:none}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    .sitenav a[aria-current]{color:var(--accent)}
    [data-live-nav]{display:inline-flex;align-items:center;gap:7px}[data-live-nav].is-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;animation:livepulse 1.6s ease-in-out infinite}
    [data-live-nav].is-live{color:var(--accent)}@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}
    .sitenav .ap{color:var(--accent);border:1px solid var(--accent);padding:7px 10px}.sitenav .ap:hover{background:var(--accent);color:#fff;text-decoration:none}
    .sitefoot-bottom .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}
    .sitefoot-bottom .rec:hover{color:#FF6B61}
    .sitenav .rec{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:5px 9px 5px 8px}
    .sitenav .rec .rec-lamp{width:6px;height:6px}
    .sitenav .rec:hover{border-color:var(--accent);text-decoration:none}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;animation:recPulse 2s ease-out infinite}
    @keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.55)}70%{box-shadow:0 0 0 7px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
    @media (prefers-reduced-motion:reduce){.rec-lamp{animation:none}}
    @media(max-width:760px){.sitehead{padding:0 16px}.sitehead-in{align-items:flex-start}.sitenav{width:100%;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav-primary,.nav-secondary{flex-wrap:nowrap;justify-content:flex-start;width:max-content;min-width:100%}.sitenav a{min-height:44px;display:inline-flex;align-items:center}.nav-secondary a{min-height:40px}}
.viewsw{display:inline-flex;border:1px solid var(--ink);margin:0 0 22px;font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .viewsw a{padding:11px 16px;text-decoration:none;color:var(--ink)}
    .viewsw a+a{border-left:1px solid var(--ink)}
    .viewsw a[aria-current]{background:var(--ink);color:var(--paper)}
    .viewsw a:not([aria-current]):hover{color:var(--accent)}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px;margin-top:56px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}
    .sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}
    .sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#FF6B61}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .sitefoot a{color:#B9B8B2;text-decoration:none}.sitefoot a:hover{color:#FF6B61}
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    header,main{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:2px solid var(--ink)}header a{color:inherit}
    .eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
    h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2rem,6vw,4.5rem);line-height:1;margin:.35rem 0}
    .card{border:1px solid var(--ink);background:#f1f0ea;border-left:6px solid var(--accent);padding:22px 24px;margin:32px 0;max-width:760px}
    .card p{margin:0 0 12px}.card p:last-child{margin:0}
    .record-nav{display:flex;justify-content:space-between;gap:16px;margin:36px 0 12px;font:600 14px 'IBM Plex Mono',ui-monospace,monospace}
    .record-nav a{color:var(--ink)}footer{border-top:1px solid var(--rule);color:var(--muted);font-size:14px}
    a{color:var(--ink)}a:hover{color:var(--accent)}
    ${RC_CSS}
    @media(max-width:760px){.sitefoot{padding-left:16px;padding-right:16px}.sitefoot-bottom .pair{min-width:0}.sitefoot-bottom .pair span{white-space:normal}.sitefoot-bottom .pair a{overflow-wrap:anywhere}.sitefoot-bottom>span:last-child{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-width:0}}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
  <header>
    <div class="eyebrow"><a href="/">Micheal Ray Berry</a> · Public Accountability Project</div>
    <h1>Day ${day} — ${label}</h1>
    <p>${htmlEscape(longDate(date))}</p>
  </header>
  <main id="main-content">
    ${reportCard(cardCtx(day, { date, photoCount }))}
    ${cardActions(cardCtx(day, { date, photoCount }), canonical)}
    <div class="card">
      <p><strong>${obligationActive && kind === 'pending' ? 'Today’s active filing window is still open.' : kind === 'partial' ? 'Some public files are currently present for this date.' : 'No public file record is currently present for this date.'}</strong> ${htmlEscape(reason)}</p>
      <p>${obligationActive && kind === 'pending'
        ? 'The Daily Compliance Packet is due by 10:00 PM Eastern. Until that deadline passes, this page records an open obligation—not a failure.'
        : obligationActive
          ? 'This page reports only current public file presence. Without an immutable deadline verdict, it does not claim when the files were submitted or whether the deadline was met.'
          : 'No filing requirement was active for this date. The page reports current public file presence only and does not assign a compliance outcome.'}</p>
    </div>
    <nav class="record-nav" aria-label="Daily record navigation">
      ${previous ? `<a rel="prev" href="/daily/${previous.date}-day-${String(previous.day).padStart(3, '0')}/">← Day ${previous.day}</a>` : '<span></span>'}
      <a href="/daily/">All days</a>
      ${next ? `<a rel="next" href="/daily/${next.date}-day-${String(next.day).padStart(3, '0')}/">Day ${next.day} →</a>` : '<span></span>'}
    </nav>
    <p><a href="/weeks/week-${String(week).padStart(2, '0')}/">Week ${week}</a> · <a href="/violations/">Violation log</a> · <a href="/">michealrayberry.com</a></p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
  </body>
</html>
`;
}

// Inverse of dayNumber(): the calendar date a Project Day falls on, used when
// a gap day has no row in the sheet to read a date from.
function dateForDay(day) {
  const start = new Date(`${START_DATE}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() + (day - 1));
  return start.toISOString().slice(0, 10);
}

function consentPage(confirmations = [], agreementActive = false, effectiveDate = '', reviewedFingerprint = '') {
  const canonical = `${SITE_ORIGIN}/consent/`;
  const title = 'Consent and Confirmation — Micheal Ray Berry Public Accountability Project';
  const description =
    'The filing status and intended scope of the recorded consent confirmation for the Micheal Ray Berry Public Accountability Project.';
  const latest = agreementActive
    ? confirmations.find((entry) => entry.fingerprint === reviewedFingerprint) || null
    : confirmations[confirmations.length - 1] || null;
  const latestEmbed = latest ? videoEmbed(latest.url) : '';
  const statementQualifier = latest ? 'filed' : 'intended';
  const consentScopeLabel = agreementActive ? 'Recorded scope' : 'Proposed scope';
  const statusNotice = agreementActive
    ? `The reviewed record reports the agreement active effective ${htmlEscape(longDate(effectiveDate))}. This page reports the filed confirmation record; it does not independently prove identity, comprehension, voluntariness, or bilateral execution.`
    : 'The agreement is pending counter-signature. No requirements are represented as active.';

  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description,
      about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    ...(latest ? [{
      '@type': 'VideoObject',
      '@id': `${canonical}#confirmation-${latest.version}`,
      name: `Project confirmation statement — version ${latest.version}`,
      description,
      ...(isSelfHosted(latest.url) ? { contentUrl: latest.url } : { url: latest.url }),
      ...(latestEmbed ? { embedUrl: latestEmbed } : {}),
      publisher: { '@id': PERSON_ID },
      isFamilyFriendly: true,
    }] : []),
    { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Consent and Confirmation', item: canonical },
    ] },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .statement{border:1px solid var(--ink);padding:0;margin:20px 0}
    .statement div{display:grid;grid-template-columns:150px 1fr;border-bottom:1px solid var(--rule)}
    .statement div:last-child{border-bottom:none}
    .statement b{padding:16px 14px;border-right:1px solid var(--rule);font:600 11px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
    .statement p{padding:16px 14px;margin:0;line-height:1.65}
    .vid{max-width:420px;background:var(--ink);border:1px solid var(--ink);display:block;width:100%}
    .video-frame{position:relative;aspect-ratio:16/9;max-width:760px;background:#000}
    .video-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    .versions{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:9px}
    .versions a{display:flex;justify-content:space-between;gap:14px;border:1px solid var(--rule);padding:12px 15px;text-decoration:none}
    .versions a:hover{border-color:var(--ink)}
    @media(max-width:620px){.statement div{grid-template-columns:1fr}.statement b{border-right:none;border-bottom:1px solid var(--rule)}}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
  <header>
    <div class="eyebrow">Consent</div>
    <h1>Confirmation</h1>
    <p>What the public confirmation record contains, what the recorded statement says, and what it does not establish.</p>
  </header>
  <main id="main-content">
    <p><strong>${statusNotice}</strong></p>
    <p>This page reports whether a consent confirmation has been filed. A published draft or project
    page does not, by itself, prove that both parties executed an agreement or that a participant
    confirmed its terms.</p>

    ${latest
      ? `${latestEmbed
        ? `<div class="video-frame"><iframe src="${htmlEscape(latestEmbed)}" title="Consent confirmation" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
        : isSelfHosted(latest.url)
          ? `<video class="vid" src="${htmlEscape(latest.url)}" controls preload="metadata" playsinline></video>`
          : `<p><a href="${htmlEscape(latest.url)}" rel="noopener">View the filed confirmation recording</a></p>`}
      <p><small>Confirmation version ${latest.version}, recorded ${htmlEscape(longDate(latest.date))}.</small></p>`
      : '<p><strong>No consent confirmation has been filed.</strong> The material below describes the intended confirmation; it does not prove execution or consent.</p>'}

    <h2>${latest ? 'What the filed recording states' : 'What a future confirmation would cover'}</h2>
    <div class="statement">
      <div><b>Origin</b><p>The ${statementQualifier} statement says that Micheal Ray Berry conceived the project, drafted its terms, and asked for independent administration.</p></div>
      <div><b>${consentScopeLabel}</b><p>The ${statementQualifier} statement covers a daily weight, four photographs, and a four-angle inspection video before 10:00 PM Eastern, plus the published correction process. Weight itself is never a violation.</p></div>
      <div><b>Administration</b><p>The ${statementQualifier} statement separates participant filing from Accountability Partner review. Privacy and safety corrections or takedowns remain available and must be recorded transparently.</p></div>
      <div><b>Public notice</b><p>The ${statementQualifier} statement acknowledges that public pages may be searchable. It does not authorize workplace contact, confrontation, harassment, stalking, or disclosure of private information.</p></div>
      <div><b>Consent and limits</b><p>The ${statementQualifier} statement describes participation as voluntary and bounded by the published safety rules. A filing and its technical acceptance do not independently prove identity, comprehension, voluntariness, or bilateral execution.</p></div>
    </div>

    <h2>Why the voice is synthetic</h2>
    <p>Every recording in this project is AI-voiced, and a future or filed confirmation is no exception. A synthetic voice
    cannot demonstrate comprehension the way a person's own words can — that is a real cost, and
    worth naming. It can state the same wording consistently, so a filed recording documents which
    terms were presented rather than proving that the participant understood or accepted them.</p>
    <p>A synthetic voice cannot establish comprehension by itself. Even when a public confirmation
    record and verified agreement status are present, this page reports those records; it does not
    independently establish identity, comprehension, voluntariness, or bilateral execution.</p>

    <h2>Versions</h2>
    <p>A new confirmation is recorded when the terms change materially. Earlier versions are kept —
    a superseded record identifies the wording presented and its recorded date; it does not independently prove agreement.</p>
    ${confirmations.length
      ? `<ul class="versions">${confirmations.slice().reverse().map((c) => `<li><a href="${htmlEscape(c.url)}" rel="noopener"><span>Version ${c.version} — ${htmlEscape(longDate(c.date))}</span><span>View →</span></a></li>`).join('')}</ul>`
      : '<p><em>No confirmation has been filed yet.</em></p>'}

    <p><a href="/agreement/">Read the agreement status and public summary →</a></p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function violationState(raw) {
  const s = String(raw || '').trim();
  if (/^\s*(resolved|satisfied|closed)/i.test(s) && !/unresolved/i.test(s)) return 'resolved';
  if (/^(submitted|corrected|pending)(?:\b|\s*[·\-–])/i.test(s)) return 'corrected';
  if (/^(unresolved|open|declared|active)(?:\b|\s*[·\-–])/i.test(s)) return 'open';
  return null;
}

function publicSupervisionStatus(raw) {
  const value = String(raw || '').trim();
  if (/^COMPLETED\b/i.test(value)) return 'COMPLETED';
  if (/^MISSED\b/i.test(value)) return 'MISSED';
  if (/^EXCEPTION\b/i.test(value)) return 'EXCEPTION';
  if (/^(LIVE|IN PROGRESS)\b/i.test(value)) return 'IN PROGRESS';
  return '';
}

/* A violation is public only after the AP has reviewed the exact event date
   and wording. The marker is stored in the protected event_verification
   column; binding it to those fields makes copied or stale approvals fail
   closed. This is an integrity marker, not a substitute for access control on
   the private workbook and sanitized feed. */
function verifiedViolation(marker, eventDate, eventText, today = todayEtIso()) {
  const match = String(marker || '').trim().match(/^APV1\|(\d{4}-\d{2}-\d{2})\|([a-f0-9]{64})$/);
  const text = String(eventText || '').trim();
  if (!match || !isRealIsoDate(eventDate) || !isRealIsoDate(match[1]) || !text) return null;
  if (match[1] < eventDate || match[1] > today) return null;
  const expected = sha256(Buffer.from(`violation-v1\n${eventDate}\n${text}`, 'utf8'));
  return match[2] === expected ? { verifiedAt: match[1], digest: match[2] } : null;
}

function verifiedViolationDate(marker, eventDate, eventText, today = todayEtIso()) {
  return verifiedViolation(marker, eventDate, eventText, today)?.verifiedAt || '';
}

/* Resolution is a separate AP decision. The APR1 marker binds the exact APV1
   event marker and resolution date, so changing a status cell cannot by itself
   close or hide a verified public entry.

   Digest payload (UTF-8, exact newlines):
     violation-resolution-v1\n<APV1 marker>\n<YYYY-MM-DD resolution date> */
function verifiedViolationResolution(marker, resolutionDate, eventMarker, eventDate, eventVerifiedAt, today = todayEtIso()) {
  const match = String(marker || '').trim().match(/^APR1\|(\d{4}-\d{2}-\d{2})\|([a-f0-9]{64})$/);
  const date = normalizeDate(resolutionDate);
  const source = String(eventMarker || '').trim();
  if (!match || !isRealIsoDate(date) || match[1] !== date
    || !/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(source)
    || date < eventDate || date < eventVerifiedAt || date > today) return null;
  const expected = sha256(Buffer.from(`violation-resolution-v1\n${source}\n${date}`, 'utf8'));
  return match[2] === expected ? { date, marker: String(marker).trim() } : null;
}

/* Public identifiers must not reveal protected-sheet row positions. Derive a
   compact, domain-separated hexadecimal token from the already verified APV1
   digest. The explicit uniqueness check below makes any rare truncation
   collision fail the build instead of aliasing or overwriting an entry. */
function publicViolationIdentity(digest) {
  if (!/^[a-f0-9]{64}$/.test(String(digest || ''))) return null;
  const derived = sha256(Buffer.from(`public-violation-id-v1\n${digest}`, 'utf8'));
  const token = derived.slice(0, 12).toUpperCase();
  return { id: `V-${token}`, slug: `v-${token.toLowerCase()}`, token };
}

function assertUniqueViolationIdentities(entries) {
  const ids = new Set();
  const slugs = new Set();
  for (const entry of entries) {
    if (!entry.id || !entry.slug || entry.slug !== entry.id.toLowerCase()) {
      throw new Error('Verified violation is missing a valid opaque public identity.');
    }
    if (ids.has(entry.id) || slugs.has(entry.slug)) {
      throw new Error(`Opaque public violation identity collision: ${entry.id}`);
    }
    ids.add(entry.id);
    slugs.add(entry.slug);
  }
}

/* Auto-declared entries read as an accusation; the record states what is absent
   instead. Matches the wording the violation log on the site uses. */
function violationText(raw) {
  const s = String(raw || '').trim().replace(/\s*\[auto-declared\]\s*/i, '');
  if (/incomplete/i.test(s)) return 'Incomplete record — ' + s.replace(/^Missed 10 PM ET deadline\s*—\s*/i, '');
  if (/no packet|not submitted|missing/i.test(s)) return 'No record — ' + s;
  return s;
}

function violationPage(v, prev, next) {
  const canonical = `${SITE_ORIGIN}/violations/${v.slug}/`;
  const title = `${v.id} — ${longDate(v.date)} — Micheal Ray Berry Public Accountability Project`;
  const description =
    `Violation ${v.id} of the Micheal Ray Berry Public Accountability Project, recorded ${longDate(v.date)}: ` +
    `${v.what}. Status: ${v.state}.`;

  const STATE_LABEL = { open: 'Open', corrected: 'Corrected — awaiting verification', resolved: 'Resolved' };
  const rows = [
    ['Project Day', dayLabelOf(v)],
    ['Date', longDate(v.date)],
    ['Requirement missed', v.what],
    ['Status', STATE_LABEL[v.state]],
    ['Event verified by AP', v.eventVerifiedAt ? longDate(v.eventVerifiedAt) : '—'],
    ['Correction submitted', v.submitted || '—'],
    ['Resolved', v.resolved || '—'],
    ['Correction review', v.verification || (v.state === 'corrected' ? 'Awaiting review' : '—')],
  ];

  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Violations', item: `${SITE_ORIGIN}/violations/` },
        { '@type': 'ListItem', position: 3, name: v.id, item: canonical },
      ],
    },
  ];
  if (v.recording) {
    graph.push({
      '@type': 'VideoObject',
      '@id': `${canonical}#corrective`,
      name: `Corrective session — ${v.id}`,
      description: `The corrective session recorded against entry ${v.id} of the Micheal Ray Berry Public Accountability Project, published beside the entry under §8 of the agreement.`,
      ...videoSchemaSource(v.recording),
      thumbnailUrl: `${SITE_ORIGIN}/og-image.png`,
      publisher: { '@id': PERSON_ID },
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .vstate{display:inline-block;font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;border:1px solid currentColor;padding:7px 10px}
    .vstate.open{color:var(--accent)}
    .vstate.corrected{color:#8A6A1E}
    .vstate.resolved{color:#3A6B3A}
    .vtable{border:1px solid var(--ink);margin:22px 0}
    .vtable div{display:grid;grid-template-columns:210px 1fr;border-bottom:1px solid var(--rule)}
    .vtable div:last-child{border-bottom:none}
    .vtable b{padding:14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)}
    .vtable p{padding:14px;margin:0;line-height:1.6}
    @media(max-width:560px){.vtable div{grid-template-columns:1fr}.vtable b{border-right:none;border-bottom:1px solid var(--rule)}}
    .corr{border-left:3px solid var(--rule);padding-left:14px;display:flex;flex-direction:column;gap:6px;margin:16px 0}
    .corr span{font-size:14px;line-height:1.6;color:#3A3935}
    .vrec{width:100%;max-width:540px;background:#141412;display:block;margin:16px 0}
    .vrec-yt{aspect-ratio:9/16;border:0}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
  <header>
    <div class="eyebrow">Durable public violation entry</div>
    <h1>${v.id}</h1>
    <p>${htmlEscape(longDate(v.date))} · ${dayLabelOf(v)}</p>
    <p><span class="vstate ${v.state}">${STATE_LABEL[v.state]}</span>${v.state === 'open' ? (() => { const base = v.eventVerifiedAt ? new Date(v.eventVerifiedAt) : new Date(`${v.date}T22:00:00-04:00`); const due = new Date(base.getTime() + 72 * 3600e3); if (Number.isNaN(due.getTime())) return ''; const lbl = due.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); const ms = due - Date.now(), a = Math.abs(ms), h = Math.floor(a / 3600e3), mm = Math.floor((a % 3600e3) / 60e3); const txt = h >= 24 ? `${h} h` : h > 0 ? `${h} h ${mm} m` : `${mm} m`; return `<p style="margin:16px 0 0;font:600 14px/1.5 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;color:#B3261E;border:2px solid #B3261E;padding:12px 16px;display:inline-block">CORRECTIVE SESSION DUE · <span data-due-iso="${due.toISOString()}">${ms < 0 ? 'overdue by ' + txt : txt + ' remaining'}</span> · by ${htmlEscape(lbl)} · pink correction uniform required</p><figure style="margin:18px 0;max-width:300px"><img src="/photos/official/micheal-ray-berry-correction-uniform.png" alt="Micheal Ray Berry in the designated pink correction uniform — the attire required for the corrective session owed against this entry." loading="lazy" decoding="async" style="width:100%;height:auto;display:block;border:3px solid #B3261E"><figcaption style="font:11px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted);margin-top:6px">Required for the corrective session: the pink correction uniform. The black uniform documents the standard; the pink uniform documents a failure to meet it.</figcaption></figure>`; })() : ''}</p>
  </header>
  <main id="main-content">
    <div class="vtable">
      ${rows.map(([k, val]) => `<div><b>${k}</b><p>${htmlEscape(String(val))}</p></div>`).join('')}
    </div>

    ${v.recordingStreamUid && streamEmbedUrl(v.recordingStreamUid) ? `<h2>Corrective recording</h2><p>The corrective session recorded against this entry, published in full beside it (§8).</p>${streamPlayer(v.recordingStreamUid, `Corrective session — ${v.id}`)}${mirrorLink(v.recording, 'corrective session')}` : ''}
    ${v.recording && !v.recordingStreamUid ? `<h2>Corrective recording</h2>
    <p>The corrective session recorded against this entry, published in full beside it (§8).
    Completing the requirement closes the obligation. The record normally remains documented,
    unless redaction or removal is required for privacy, safety, consent, or applicable law.</p>
    ${videoEmbed(v.recording) ? `<iframe class="vrec vrec-yt" src="${htmlEscape(videoEmbed(v.recording))}" title="Corrective session — ${htmlEscape(v.id)}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>` : `<video class="vrec" src="${htmlEscape(v.recording)}" controls preload="metadata" playsinline></video>`}` : ''}

    ${v.corrections.length ? `<h2>Correction history</h2>
    <p>Corrections to this entry are dated and appended rather than silently rewriting the history.
    Any required redaction or removal is documented transparently when appropriate.</p>
    <div class="corr">${v.corrections.map((c) => `<span>${htmlEscape(c)}</span>`).join('')}</div>` : ''}

    <h2>What this entry means</h2>
    <p>This entry records a failure to document the day as required, by 10 PM Eastern. It is not a
    consequence for the weight: a gain, a plateau, or a bad month breaches nothing. Only the
    documentation can be failed.</p>
    <p>${v.state === 'resolved'
      ? 'The corrective requirement has been completed and verified by the Accountability Partner, which closes the obligation. The entry remains in the durable public record unless redaction or removal is required.'
      : v.state === 'corrected'
        ? 'A corrective session has been submitted. The entry remains unresolved while it awaits Accountability Partner verification.'
        : 'No corrective session has been submitted against this entry yet. It remains open in the public violation log until it is answered.'}</p>
    <p>The standard the correction has to meet is set out on <a href="/corrections/">the corrective
    session page</a>. §8 is summarized on <a href="/agreement/">the agreement page</a>, together with its current execution status.</p>

    ${v.day >= 1 ? `<p><a href="/daily/${v.date}-day-${String(v.day).padStart(3, '0')}/">The record for Day ${v.day} →</a></p>`
      : '<p>This entry predates Day 1.</p>'}

    <nav aria-label="Violation navigation" style="display:flex;justify-content:space-between;gap:16px;margin:36px 0 12px;font:600 14px 'IBM Plex Mono',ui-monospace,monospace">
      ${prev ? `<a rel="prev" href="/violations/${prev.slug}/">← ${prev.id}</a>` : '<span></span>'}
      <a href="/violations/">All entries</a>
      ${next ? `<a rel="next" href="/violations/${next.slug}/">${next.id} →</a>` : '<span></span>'}
    </nav>
    <p style="font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">Something wrong with this entry? <a href="/report/?ref=${encodeURIComponent(v.id)}">Report a record issue</a>.</p>
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function isoDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (s || (!h && !m) ? s + 'S' : '');
}

function positionsPage(entries, siteState = {}) {
  const canonical = `${SITE_ORIGIN}/positions/`;
  const title = 'Documentation Standard — Micheal Ray Berry Public Accountability Project';
  const description =
    'The documentation standard for the Micheal Ray Berry Public Accountability Project: Wait, then ' +
    'four fixed views — front, left, rear, right — with the posture, framing, and visibility each requires.';

  // Reference frames come from the most recent complete day, so the page shows
  // the standard as it is currently met rather than an idealised illustration.
  const ref = entries.at(-1) || null;

  const VIEWS = [
    ['wait', 'Wait', 'Upright and squared to the camera, feet together, hands behind the back, head level, eyes forward. Video only — no photograph is filed from it.',
      'Every session opens and closes here. At the opening it is held while the day, date, recorded weight, and verification information are established on the record; after the four views are complete the participant returns to it while the session is closed. It files no progress photograph — it gives every recording a defined beginning and end, and a stationary identifiable frame before and after the sequence.'],
    ['front', 'Front', 'Squared to the camera, feet at the established inspection width, hands behind the head, head level, face fully visible.',
      'The primary front reference frame. Hands behind the head keep the torso unobstructed and prevent the arms being used to materially alter the silhouette.'],
    ['left', 'Left', 'A turn to the left from Front. Same stance, posture, camera distance, and hand position.',
      'The camera does not move. The side profile records changes in body depth and shape that cannot be evaluated as clearly from the front view alone.'],
    ['rear', 'Rear', 'Turned to face directly away. Established stance, hands behind the head, framing unchanged.',
      'The complete body remains visible from head to feet.'],
    ['right', 'Right', 'A turn to the right, presenting the opposite profile with the posture and framing required for Left.',
      'Both profiles are required. Recording each side makes differences in stance or body shape visible rather than allowing one preferred profile to substitute for the other.'],
  ];

  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Documentation Standard', item: canonical },
      ],
    },
  ];

  const INVALIDATES = [
    'Any required part of the body outside the frame',
    'Face obscured during a required identification view',
    'Incorrect position, or hands not in the required position',
    'Arms obstructing the torso during an inspection view',
    'Materially different camera height or distance',
    'Camera movement between required views',
    'Altered or noncompliant attire',
    'Leaning, twisting, flexing, compressing, or another posture that materially changes the silhouette',
    'Failure to present one of the four required views',
    'A verification failure that prevents the recording being tied to the day\u2019s record',
  ];

  const SPEC = [
    ['Inspection posture', 'Upright, weight distributed evenly, feet at the established inspection width, hands behind the head. This keeps the torso visible, moves the arms away from the sides of the body, and reduces the ability to change the apparent silhouette through arm placement. The posture is held naturally and consistently: no deliberate flexing, compressing, twisting, or leaning for the photograph.'],
    ['Wait posture', 'Separate from the four photographic positions. Feet together, hands behind the back, body upright and squared to the camera, head level, eyes forward. Performed at both the opening and closing of every inspection recording. No progress photograph is filed from Wait.'],
    ['Head and identity', 'The head remains level. During the Front view and both Wait positions the face must be completely visible — identity must be apparent from the recorded image itself rather than from a filename, caption, or accompanying text. Hair, clothing, hands, or other objects may not materially obscure the face.'],
    ['Camera', 'A consistent height and distance, portrait orientation, the complete body visible from head to feet. The camera remains stationary throughout: <strong>the participant turns, the camera does not.</strong> Zoom, height, framing, and distance stay substantially consistent from one daily record to the next.'],
    ['Attire', 'The designated project uniform, worn for every inspection: a plain black full-body unitard and a plain steel or titanium collar, worn continuously. Intentionally simple and standardized so clothing cannot materially alter the appearance of the body between records. See <a href="/uniform/">the uniform standard</a>.'],
    ['Photographs', 'Four are produced from each compliant inspection — front, left, rear, and right. Wait is recorded on video but files no progress photograph. Each is taken from the required position rather than selected afterwards according to which image is most favourable.'],
    ['Verification', 'The verification code is issued immediately before the recording and appears as part of the recorded evidence. The required positions are checked while they are presented. The Accountability Partner reviews the submitted record for identity, attire, framing, required views, and completeness before accepting it as compliant.'],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .seq{border:1px solid var(--ink);background:var(--paper);padding:18px 20px;margin:22px 0;display:flex;flex-direction:column;gap:8px}
    .seq b{font:700 17px/1.3 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .seq p{margin:0;font-size:14px;line-height:1.6;color:#3A3935}
    .views{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:20px;margin:20px 0 10px}
    .view{border:1px solid var(--ink);display:flex;flex-direction:column;background:var(--paper)}
    .view img{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;border-bottom:1px solid var(--ink)}
    .view .ph{width:100%;aspect-ratio:9/16;background:repeating-linear-gradient(45deg,#f6f5f1,#f6f5f1 10px,#eeece6 10px,#eeece6 20px);border-bottom:1px solid var(--ink);display:flex;align-items:center;justify-content:center;font:600 10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#6B6A64;text-align:center;padding:0 14px}
    .view .body{padding:14px 15px;display:flex;flex-direction:column;gap:7px}
    .view b{font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
    .view .req{font-size:14px;line-height:1.55;font-weight:600}
    .view p{margin:0;font-size:13.5px;line-height:1.6;color:#3A3935}
    .spec{border:1px solid var(--ink);margin:20px 0}
    .spec div{display:grid;grid-template-columns:170px 1fr;border-bottom:1px solid var(--rule)}
    .spec div:last-child{border-bottom:none}
    .spec b{padding:15px 14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--accent)}
    .spec p{padding:15px 14px;margin:0;line-height:1.6}
    @media(max-width:560px){.spec div{grid-template-columns:1fr}.spec b{border-right:none;border-bottom:1px solid var(--rule);padding-bottom:12px}}
    .invalid{margin:16px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:7px;font-size:15px;line-height:1.55}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
  <header>
    <div class="eyebrow">The documentation standard</div>
    <h1>Documentation Standard</h1>
    <p>Wait, then four fixed views, recorded the same way every day.</p>
  </header>
  <main id="main-content">
    <div class="viewsw"><a href="/positions/" aria-current="page">Inspection</a><a href="/uniform/">Uniform</a><a href="/corrections/">Corrections</a></div>
    <p class="lede"><strong>The positions are fixed so that changes in posture, clothing, framing, or
    concealment cannot materially alter the visual record from one day to the next.</strong></p>

    <p>A photograph taken from a different angle, at a different distance, or with a different posture
    is not directly comparable to the one taken before it. This standard minimises those variables:
    every daily record uses the same sequence, the same attire, the same camera position, and the
    same four views. The purpose is to make the presentation as constant as possible, so that the
    body is what changes.</p>

    <div class="seq">
      <b>WAIT → FRONT → LEFT → REAR → RIGHT → WAIT</b>
      <p>The camera remains fixed. The participant changes position. Wait opens and closes the
      recording; the four inspection views produce the daily photographic record.</p>
    </div>

    <h2>The positions</h2>
    <div class="views">
      ${VIEWS.map(([angle, label, req, note]) => {
        const photo = ref && ref.photos && ref.photos[angle];
        const img = photo
          ? `<img src="${photo.variants?.[0]?.url || photo.sourceUrl}" alt="Micheal Ray Berry ${label.toLowerCase()} position, inspection standard — Day ${ref.record.day}" loading="lazy">`
          : `<div class="ph">${angle === 'wait' ? 'Wait is recorded on video only<br>no photograph is filed from it' : label + ' reference<br>frame pending'}</div>`;
        return `<figure class="view">${img}<div class="body"><b>${label}</b><span class="req">${req}</span><p>${note}</p></div></figure>`;
      }).join('')}
    </div>
    ${ref ? `<p><small>Reference frames from Day ${ref.record.day}, ${htmlEscape(longDate(ref.record.date))} — the most recent complete record. <a href="/daily/${ref.record.date}-day-${String(ref.record.day).padStart(3, '0')}/">View that day</a>.</small></p>` : ''}

    <h2>Specification</h2>
    <div class="spec">
      ${SPEC.map(([k, v]) => `<div><b>${k}</b><p>${v}</p></div>`).join('')}
    </div>

    <h2>What invalidates a view</h2>
    <p>A photograph or recorded view does not meet the standard when the comparison or the
    verification has been materially compromised. For example:</p>
    <ul class="invalid">${INVALIDATES.map((x) => `<li>${x}</li>`).join('')}</ul>
    <p><strong>A view that fails the standard is recorded again rather than filed.</strong> The
    objective is not to produce the most favourable photograph. It is to produce the required
    photograph.</p>

    <h2>Why it is specified</h2>
    <p>Longitudinal photography is useful only when the method that produced it stays reasonably
    constant. Progress photographs taken weeks or months apart typically differ in clothing, camera
    distance, pose, framing, and angle — so the difference between them is partly the body and partly
    the staging, with no way to tell how much of each.</p>
    <p>This record takes the opposite approach: daily, in the same uniform, from a consistent camera
    position, using the same sequence and the same four views. Any two of its days can be placed
    side by side and compared on substantially the same terms. That is why a frame which fails the
    specification is recorded again rather than kept simply because a photograph was taken.</p>

    <h2>Inspection is not correction</h2>
    <p>These positions produce the daily documentation record. They are separate from the posture
    required during a <a href="/corrections/">corrective session</a>, which is governed by its own
    standard and applies only after a documented violation. Inspection positions document the day;
    corrective positions address a documented failure.</p>

    <h2>Command vocabulary</h2>
    <p>Every session uses the same four commands, spoken by the synthetic voice and answered without
    words: <strong>Present</strong> — assume the named position; <strong>Hold</strong> — maintain it
    to the standard until the next command; <strong>Correct your posture</strong> — fix the stated
    defect without leaving the position; <strong>Release</strong> — the session is over. The
    vocabulary never varies, so the response is trained, not interpreted.</p>

  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function violationsIndexPage(violations) {
  const canonical = `${SITE_ORIGIN}/violations/`;
  const title = 'Violation Log — Micheal Ray Berry Public Accountability Project';
  const description =
    'Durable public log of governed documentation failures in the Micheal Ray Berry Public Accountability Project, subject to privacy, safety, consent, and lawful redaction or removal.';
  const open = violations.filter((v) => v.state !== 'resolved').length;
  const rows = violations.map((v) => `<tr>
    <td><a href="/violations/${v.slug}/">${htmlEscape(v.id)}</a></td>
    <td>${htmlEscape(longDate(v.date))}</td>
    <td>${dayLabelOf(v)}</td>
    <td>${htmlEscape(v.what)}</td>
    <td>${htmlEscape(v.state)}</td>
  </tr>`).join('\n');
  const graph = [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, about: { '@id': PERSON_ID }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Violations', item: canonical },
    ] },
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
<header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Micheal Ray Berry</a> / Violations</nav>
  <div class="eyebrow">Durable archival record</div>
  <h1>Violation Log</h1>
</header>
<main id="main-content">
  <p class="intro">${violations.length} ${violations.length === 1 ? 'entry' : 'entries'} on the public log. ${open} unresolved. Each entry has a stable public page.</p>
  ${PRIOR_NOTE ? `<div style="border-left:4px solid var(--accent);background:#f1f0ea;padding:12px 16px;margin:0 0 16px;max-width:760px"><strong>Earlier attempt.</strong> ${htmlEscape(PRIOR_NOTE)}</div>` : ''}
  ${violations.length ? `<table><caption>Published violation entries</caption><thead><tr><th scope="col">ID</th><th scope="col">Date</th><th scope="col">Day</th><th scope="col">Requirement</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No violation entries have been published.</p>'}
  <p><a href="/daily/">Daily record</a> · <a href="/corrections/">Corrective sessions</a> · <a href="/report/">Report a record issue</a></p>
</main>
<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col"><span class="colhead">Official record</span><span class="links"><a href="https://michealrayberry.com">Website</a></span></div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>`;
}

/* /observer/ — controlled submission channel. Plain form → Pages Function
   (functions/observer.js) → Turnstile → Apps Script Observer tab; the AP is
   notified. Nothing
   submitted is published automatically. (Cloudflare Pages variant with
   Turnstile + Apps Script relay is parked — see README.) */
/* /tf060/ — the earlier agreement, owned. Static, linked from About only.
   Numbers here must match the record (Day 1 Aug 31 2026, 340 → 200). */
function tf060Page() {
  const canonical = `${SITE_ORIGIN}/tf060/`;
  const title = 'TF060: A Documented Failure | Micheal Ray Berry';
  const description = 'Micheal Ray Berry acknowledges the failed TF060 agreement and explains how it informed the structure and standards of his current public accountability project.';
  const img = `${SITE_ORIGIN}/photos/official/micheal-ray-berry-tf060-continues.png`;
  const body = `
    <p class="crumb"><a href="/">Record</a> · <a href="/about/">About</a> · TF060</p>
    <h1>TF060: A Documented Failure — and What Comes Next</h1>
    <figure style="margin:24px 0 32px;max-width:520px">
      <img src="/photos/official/micheal-ray-berry-tf060-continues.png" alt="Micheal Ray Berry standing in the black project uniform, holding a sign that reads “TF060 failed. Micheal Ray Berry continues.”" width="1303" height="2048" style="width:100%;height:auto;display:block;border:1px solid var(--ink)" loading="eager" decoding="async">
      <figcaption style="font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted);margin-top:8px">TF060 failed. Micheal Ray Berry continues.</figcaption>
    </figure>
    <p class="lede"><strong>On October 5, 2025, I signed a personal accountability agreement under the identifier TF060. I did not complete it.</strong></p>
    <p>I also did not respond appropriately when I was contacted afterward. The agreement included authorization for the failure and portions of the record to be published. Publication followed.</p>
    <p>This page does not dispute that outcome, minimize it, or attempt to erase it. It records the failure plainly and explains why it matters to the accountability project I operate today.</p>
    <h2>What TF060 established</h2>
    <p>TF060 demonstrated a simple problem: writing detailed rules is not the same as following them.</p>
    <p>I created a commitment, signed it, and then failed to carry it through. When accountability required a response, silence became another failure. Removing old pages or moving on to a new project would not change that record.</p>
    <p>The lesson is not that public commitments automatically create discipline. They do not. A public commitment only becomes meaningful when it is supported by measurable requirements, reliable documentation, outside review, and consistent follow-through.</p>
    <p>TF060 had the promise. It did not have the sustained execution.</p>
    <h2>Why this page exists</h2>
    <p>The current Micheal Ray Berry Public Accountability Project is not a clean slate. It is a continuation built with the knowledge that motivation, private intentions, and elaborate plans are not enough.</p>
    <p>The photograph at the top of this page states the position accurately: <strong>TF060 failed. Micheal Ray Berry continues.</strong></p>
    <p>“Continues” does not mean “succeeded.” It means I am still responsible for what I agreed to do, still accountable for the record I created, and still required to prove progress through actions rather than declarations.</p>
    <h2>What changed</h2>
    <p>The current project began on <strong>August 31, 2026</strong>, at a declared starting weight of <strong>340 pounds</strong>. The goal is <strong>200 pounds</strong>. Completion requires 28 consecutive days at or below 200.</p>
    <p>The project uses defined requirements rather than relying on memory or self-reporting alone:</p>
    <ul>
      <li>A daily deadline of 10:00 PM Eastern</li>
      <li>A scale-synced weigh-in</li>
      <li>A four-angle Daily Inspection video</li>
      <li>Four daily photographs in the project uniform</li>
      <li>An updated public tracker</li>
      <li>A weekly review read to camera from the record</li>
      <li>Documented violations when requirements are missed</li>
      <li>Predefined corrective sessions that escalate by level: 10, 20, and 30 minutes</li>
    </ul>
    <p>These controls do not guarantee success. They make performance — or the absence of it — visible.</p>
    <h2>The standard now</h2>
    <p>The current project is judged by the published record.</p>
    <p>A written plan is not progress. A new page is not progress. A photograph is not progress. A promise to restart is not progress.</p>
    <p>Progress requires complete, timely documentation and sustained movement toward the stated goal. A missed requirement must be recorded as missed. A late filing does not become timely because it was eventually uploaded. An explanation does not replace required evidence.</p>
    <p>The standard is intentionally uncomplicated: <strong>complete the requirement, document it by the deadline, and maintain an accurate public record.</strong></p>
    <h2>What continuation means</h2>
    <p>TF060 remains part of my history because I failed it. The current project will not rewrite that fact.</p>
    <p>What the current project can establish is whether I learned from it.</p>
    <p>If I complete the present requirements, TF060 will remain a documented failure followed by a documented recovery. If I abandon the project, weaken the rules when they become uncomfortable, or stop reporting, TF060 will instead be evidence of a pattern.</p>
    <p>That distinction will not be decided by the language on this page. It will be decided by the record that follows it.</p>
    <p>Anyone who saw TF060 fail is welcome to watch whether this one does.</p>
    <h2>Public record and boundaries</h2>
    <p>This project is intentionally public. Public project materials may be viewed, linked, or shared when they are presented accurately and in context.</p>
    <p>Public accountability does not authorize harassment, threats, impersonation, disclosure of private information, contact with my employer or coworkers, or interference with my employment. This page concerns a personal accountability project and does not represent any employer or professional organization.</p>
    <p>Corrections to factual errors may be submitted through <a href="/report/">Report a Record Issue</a>. Disagreement with the project is not a reason to alter, mislabel, or misrepresent its records.</p>
    <h2>Follow the current record</h2>
    <p><a href="/daily/">View the daily record</a> · <a href="/">Return to the project homepage</a></p>
    <p style="font:600 13px/1.6 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;margin-top:32px">TF060 failed. The current record is still being written.</p>
    <p style="font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">— Micheal Ray Berry</p>`;
  return synPage({ title, desc: description, canonical, body })
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${img}"><meta property="og:image:alt" content="Micheal Ray Berry holding a sign: TF060 failed. Micheal Ray Berry continues."><meta property="og:title" content="TF060 Failed. Micheal Ray Berry Continues.">`);
}

/* /share/ — "Share the Record". Third person; the record speaks. Facts come
   from the shareData object computed in main(); nothing here is hard-coded
   about the current state. No sign-photograph section until the photograph
   exists on the record. */
function sharePage(d) {
  const canonical = `${SITE_ORIGIN}/share/`;
  const title = 'Share the Record | Micheal Ray Berry';
  const description = "Micheal Ray Berry asked to be held publicly accountable: 340 to 200 pounds, documented daily under his real name. Source material, current facts, and the conditions for accurate sharing.";
  const card = d.latest;
  const gap = d.today != null && card ? Math.max(0, d.today - card.day) : null;
  const delta = d.weight ? (Number(d.weight) - 340) : null;
  const deltaTxt = delta == null ? '' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)} lb`;
  const desc = `Micheal Ray Berry asked to be held publicly accountable for reducing his weight from a declared 340 lb to 200 lb. The public record began August 31, 2026, and does not end until he maintains 200 lb for 28 consecutive days. He chose real-name, searchable, shareable documentation because more visibility creates more accountability. The archive holds dated weigh-ins, standardized inspection videos, photographs, report cards, and a public tracker, so progress, missing documentation, and unfavorable outcomes cannot be quietly rewritten.${d.weight ? ` Latest published weight: ${d.weight} lb, recorded ${d.weightDate}${deltaTxt ? ` (${deltaTxt} from the declared start)` : ''}.` : ''} Follow the source record at https://michealrayberry.com/daily/.`;
  const body = `
    <p class="crumb"><a href="/">Record</a> · Share</p>
    <h1>Share the Record</h1>
    <p class="lede"><strong>Micheal Ray Berry asked for this accountability.</strong></p>
    <p>He chose to place his real name, weight, daily documentation, missed requirements, and results on a public record. He began at a declared <strong>340 lb</strong>. The completion standard is <strong>200 lb maintained for 28 consecutive days</strong> — not one favorable weigh-in, not one good week. Until that standard is met, the record remains open.</p>
    <p>Private promises can be revised, excused, or quietly abandoned. A dated public record is harder to argue with. If Micheal follows through, the evidence will show it. If he stops documenting the work, the gaps will show that too. <strong>The record does not accept excuses. It records evidence.</strong></p>
    <p>Public visibility is part of the consequence he chose. It does not authorize harassment, threats, employer or workplace contact, disclosure of private information, or interference with his personal or professional relationships.</p>
    <p class="share-actions" style="display:flex;flex-wrap:wrap;gap:10px 22px;font:600 13px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase">
      <button type="button" data-copy="https://michealrayberry.com/" style="all:unset;cursor:pointer;color:var(--accent);text-decoration:underline;text-underline-offset:4px">Copy project link</button>
      ${card ? `<a href="${card.png}" download>Download latest report card</a>` : ''}
      <a href="/daily/">View daily archive</a>
    </p>

    <h2>The current record</h2>
    <p style="font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">The latest published facts — not promises, estimates, or assumptions.</p>
    <div class="standard">
      <div><b>Current project day</b><p>Day ${d.today ?? '—'}</p></div>
      <div><b>Latest day with files present</b><p>${card ? `Day ${card.day} · ${card.dateLong}` : 'None published'}</p></div>
      ${gap != null ? `<div><b>Public file gap</b><p>${gap} project ${gap === 1 ? 'day' : 'days'}</p></div>` : ''}
      <div><b>Latest published weight</b><p>${d.weight ? `${d.weight} lb · recorded ${d.weightDate}` : 'Not recorded'}</p></div>
      ${deltaTxt ? `<div><b>Change from declared start</b><p>${deltaTxt}</p></div>` : ''}
      <div><b>Published open violations</b><p>${d.open} · as of ${d.asOf}</p></div>
      <div><b>Agreement status</b><p>${d.agreementActive ? 'Active' : 'Pending counter-signature'}</p></div>
      <div><b>Completion standard</b><p>200 lb maintained for 28 consecutive days</p></div>
    </div>
    ${delta != null && delta >= 0 ? `<p>The latest published weight is ${Math.abs(delta).toFixed(1)} lb ${delta > 0 ? 'above' : 'at'} the declared starting weight. The record will not describe that as progress.</p>` : ''}
    ${gap ? `<p>The public file record is ${gap} project ${gap === 1 ? 'day' : 'days'} behind the current day. Those figures are shown separately on purpose: an older entry is not presented as current because it is the latest available.</p>` : ''}
    <p>A published weight is the most recent documented measurement, not automatically today's weight. "Files present" means files are publicly available for that day; it does not establish when they were submitted or whether every requirement was met. Official compliance outcomes appear only in the <a href="/violations/">violation log</a>.</p>
    ${card ? `<p style="margin:26px 0 8px"><a href="${card.page}"><img src="${card.png}" alt="Report card, Day ${card.day}, ${card.dateLong}" style="max-width:360px;width:100%;display:block;border:1px solid var(--ink)" loading="lazy"></a><small>Day ${card.day} · ${card.dateLong} · <a href="${card.page}">the supporting entry</a></small></p>` : ''}

    <h2>More visibility means more accountability</h2>
    <p>The more people who can see the dated record, follow the numbers, and notice missing entries, the harder it becomes to minimize a failure, rely on private excuses, or disappear into another quiet restart. That is why Micheal asked for this project to be public, searchable, shareable, published under his real name, and preserved in order. He knows the visibility may be uncomfortable. That discomfort is not a side effect; it is the pressure he chose.</p>
    <p>He did not ask the public to pretend he was succeeding. He asked the public to see what the record shows. If the numbers improve, the record will show it. If they move the wrong way, the record will show that. If the documentation stops, the empty space stays visible. <strong>He asked to be seen. This is the record he asked people to see.</strong></p>

    <h2>What the project documents</h2>
    <p>A voluntary, structured weight-loss record published under Micheal's real name. The current record began <strong>August 31, 2026</strong> at a declared <strong>340 lb</strong>; completion requires <strong>200 lb held for 28 consecutive days</strong>. The agreement describes a Daily Compliance Packet — a recorded weigh-in, a four-angle inspection video, four photographs, the updated public tracker, and the day's verification information — due by <strong>10:00 PM Eastern</strong>.</p>
    <p>${d.agreementActive ? 'The agreement is active. The Accountability Partner — not Micheal — reviews submissions and issues official outcomes.' : 'The agreement is pending counter-signature. Until it is confirmed, this site does not present the filing deadline, violation process, or corrective requirements as active; the archive documents available files, dates, and measurements, but does not invent an obligation or a violation that has not taken effect. Once active, the Accountability Partner — not Micheal — reviews submissions and issues official outcomes.'} Micheal does not grade his own work, excuse his own misses, close his own violations, or rewrite an unfavorable outcome. The published <a href="/agreement/">agreement</a> and <a href="/violations/">violation log</a> control if any summary, caption, or third-party description differs.</p>

    <h2>Materials for sharing</h2>
    <div class="standard">
      <div><b>Official photograph</b><p><a href="/photos/official/micheal-ray-berry-official-front-v2.jpg"><img src="/photos/official/micheal-ray-berry-official-front-v2.jpg" srcset="/photos/official/micheal-ray-berry-official-front-480.webp 480w, /photos/official/micheal-ray-berry-official-front-800.webp 800w" sizes="220px" alt="Micheal Ray Berry in the Inspection position, wearing the project uniform. Official project photograph." style="max-width:220px;width:100%;display:block;border:1px solid var(--ink)" loading="lazy"></a><small><a href="/photos/official/micheal-ray-berry-official-front-v2.jpg" download>Full resolution</a></small></p><p><strong>Caption:</strong> Micheal Ray Berry in the Inspection position, wearing the project uniform. Official project photograph.</p><p>Documentation, not a portrait. Use it to introduce the project; for a specific day, use that day's photograph and report card.</p></div>
      <div><b>Daily report cards</b><p>Each card identifies its project day, date, documented status, and supporting entry. Share the complete card with its source link. Do not crop away the date, status, or source to make the record look better — or worse — than it is.</p><p class="share-actions" style="font:600 13px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase">${card ? `<a href="${card.page}">View latest report</a> · <a href="${card.png}" download>Download latest card</a> · ` : ''}<a href="/daily/">Browse previous days</a></p></div>
      <div><b>Copy-ready description</b><blockquote id="share-desc" style="margin:8px 0 12px;padding:12px 18px;border-left:3px solid var(--ink);font-size:15px;line-height:1.55">${desc}</blockquote><p class="share-actions" style="font:600 13px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase"><button type="button" data-copy-from="share-desc" style="all:unset;cursor:pointer;color:var(--accent);text-decoration:underline;text-underline-offset:4px">Copy description</button></p></div>
    </div>

    <h2>Share the facts</h2>
    <p>Welcome: the project link; a dated daily entry; an original project post; a complete, unaltered report card with its source link; the description above; discussion of progress using documented dates, measurements, and outcomes; pointing out a visible publication gap accurately; submitting a possible record issue for review.</p>
    <p>When sharing: link to the original public page; preserve names, dates, measurements, status labels, and recorded outcomes; distinguish files being present from files being filed on time; keep demonstrations labeled as demonstrations; do not present an opinion as an official compliance decision; correct an outdated statement when the record changes. The purpose is to make the record visible, not to replace it with exaggeration, invention, or rumor.</p>

    <h2>The public may witness. The public does not control.</h2>
    <p>Micheal invited observation and responsible sharing. He did not transfer control of his life to every person who finds the website. Sharing the record gives no one authority to direct him, modify the agreement, assign requirements, demand private access, or declare unofficial punishments.</p>
    <p>Do not use the project to harass, threaten, stalk, or impersonate him; contact his employer, workplace, coworkers, clients, or associates; publish private addresses, telephone numbers, account information, or verification data; interfere with his employment or relationships; alter project media to create a false or misleading record; present private or unpublished material as part of the project; place project media in an unrelated context; claim to represent the Accountability Partner or the project; or pressure him to accept requirements outside the published agreement. Public visibility was invited. Uncontrolled intrusion was not.</p>
    <p>Nothing on this page creates an unrestricted license to Micheal's name, likeness, project media, or unpublished information; quotation, embedding, and reproduction must comply with applicable copyright, privacy, publicity, safety, and platform rules. Questions about a proposed use, or reports of misuse: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a>.</p>

    <h2>Follow the record</h2>
    <p>New entries appear in the daily archive. If no new entry appears, the absence stays visible; the project does not need a flattering explanation for a missing record, it needs the record.</p>
    <p><a href="/daily/">Daily archive</a> · <a href="/feed.xml">RSS feed</a> · <a href="https://www.youtube.com/@michealrayberry" rel="noopener">Official YouTube channel</a> · <a href="/live/">Evening Supervision</a></p>
    <h2>Questions and record issues</h2>
    <p>Questions about the rules, the documentation standard, published status, or a possible error go to <a href="/report/">Report a Record Issue</a> or <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a>. Factual errors are corrected transparently; documented outcomes are not removed because they become uncomfortable.</p>
    <p><a href="/agreement/">Agreement</a> · <a href="/positions/">Documentation standard</a> · <a href="/uniform/">Uniform standard</a> · <a href="/corrections/">Corrective sessions</a> · <a href="/live/">Evening Supervision</a> · <a href="/violations/">Violation log</a> · <a href="/llms.txt">Machine-readable overview</a> · <a href="/report/">Report a record issue</a></p>`;
  return synPage({ title, desc: description, canonical, body })
    .replace('</head>', '<script src="/share.js" defer></script>\n</head>')
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${SITE_ORIGIN}${card ? card.png : '/og-image.png'}">`);
}
function protocolPage() {
  const canonical = `${SITE_ORIGIN}/protocol/`;
  const title = 'Protocol — Micheal Ray Berry Public Accountability Project';
  const description = 'The operating standards of the record: the governing agreement, the daily inspection standard, the project uniform, corrective sessions, and evening supervision.';
  const body = `
    <p class="crumb"><a href="/">Record</a> · Protocol</p>
    <h1>Protocol</h1>
    <p class="lede"><strong>The standards every entry on this record is held to.</strong> Each is written down before it is enforced; nothing binds until it is in the agreement or logged as an amendment Micheal has co-signed.</p>
    <div class="standard">
      <div><b><a href="/agreement/">Agreement</a></b><p>The governing document: daily requirements, documentation standard, weight-loss schedule, consequences, and the limits of participation. Pending the Accountability Partner’s counter-signature.</p></div>
      <div><b><a href="/positions/">Inspection</a></b><p>The four fixed positions and the recording standard for the Daily Inspection video and photographs — the same framing every day so records are comparable.</p></div>
      <div><b><a href="/uniform/">Uniform</a></b><p>What is worn in every official recording, and why: a plain black unitard, a plain steel or titanium collar, and a designated correction uniform for corrective sessions.</p></div>
      <div><b><a href="/corrections/">Corrections</a></b><p>What happens after a confirmed missed requirement: corner time by level (10 / 20 / 30 minutes), recorded in one take, filed within 72 hours, published beside the entry.</p></div>
      <div><b><a href="/live/">Supervision</a></b><p>Evening Supervision (§3.4), a proposed fixed-camera session on assigned nights. Not active; public supervision video is disabled pending the Accountability Partner’s safety review.</p></div>
    </div>
    <p>Missed requirements are recorded on the <a href="/violations/">Violation Log</a>. Issues with any entry can be <a href="/report/">reported for review</a>.</p>`;
  return synPage({ title, desc: description, canonical, body });
}

const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA'; // Cloudflare always-passes test key until the real one is set
function observerPage() {
  const canonical = `${SITE_ORIGIN}/report/`;
  const title = 'Report a Record Issue — Micheal Ray Berry Public Accountability Project';
  const description = 'Report a possible missed requirement, an incorrect or inconsistent entry, missing or broken evidence, suspected misuse of public material, or a question for the Accountability Partner. Reports are evidence for review, not verdicts.';
  const TYPES = ['Possible missed requirement', 'Incorrect or inconsistent record', 'Missing or broken evidence', 'Suspected misuse of public material', 'Question for the Accountability Partner'];
  const body = `
    <p class="crumb"><a href="/">Record</a> · Report an issue</p>
    <h1>Report a Record Issue</h1>
    <p class="lede"><strong>This form is for issues with the public record itself.</strong></p>
    <p>Use it to report a possible missed requirement, an entry that looks incorrect or inconsistent, evidence that is missing or will not load, suspected misuse of the project’s public material, or a question for the Accountability Partner.</p>
    <p>A report is evidence for review. It is not a verdict. The Accountability Partner checks each report against the record and the written rules; Micheal does not determine whether a report about his own compliance is valid.</p>
    <form name="observer" method="POST" action="/report" style="display:grid;gap:22px;max-width:640px;margin:32px 0 8px">
      <p style="display:none"><label>Leave this field empty <input name="website" tabindex="-1" autocomplete="off"></label></p>
      <fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px">
        <legend style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);margin-bottom:8px">Type of report — required</legend>
        ${TYPES.map((t, i) => `<label style="display:flex;gap:12px;align-items:center;font-size:16px;cursor:pointer"><input type="radio" name="type" value="${htmlEscape(t)}" ${i === 0 ? 'required' : ''} style="width:18px;height:18px;accent-color:var(--accent)">${htmlEscape(t)}</label>`).join('')}
      </fieldset>
      <label style="display:grid;gap:8px"><span style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase">Date or Project Day concerned — required for compliance and record reports</span>
        <input name="record_ref" maxlength="40" placeholder="e.g. 2026-09-14 or Day 15" style="font:16px inherit;padding:11px 14px;border:1px solid var(--rule);background:#fff;color:var(--ink)" data-required-for="Possible missed requirement|Incorrect or inconsistent record|Missing or broken evidence"></label>
      <label style="display:grid;gap:8px"><span style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase">Report — required</span>
        <textarea name="message" required rows="7" maxlength="4000" placeholder="What you observed, where on the record, and why it appears to be an issue." style="font:16px/1.55 inherit;padding:12px 14px;border:1px solid var(--rule);background:#fff;color:var(--ink);resize:vertical"></textarea></label>
      <label style="display:grid;gap:8px"><span style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase">Link to the entry or material — optional</span>
        <input name="source_url" type="url" maxlength="500" autocomplete="url" placeholder="https://michealrayberry.com/daily/…" style="font:16px inherit;padding:11px 14px;border:1px solid var(--rule);background:#fff;color:var(--ink)"></label>
      <label style="display:grid;gap:8px"><span style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase">Name — optional</span>
        <input name="name" maxlength="120" autocomplete="name" style="font:16px inherit;padding:11px 14px;border:1px solid var(--rule);background:#fff;color:var(--ink)"></label>
      <label style="display:grid;gap:8px"><span style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase">Email — optional, only if you want a reply</span>
        <input name="email" type="email" maxlength="200" autocomplete="email" style="font:16px inherit;padding:11px 14px;border:1px solid var(--rule);background:#fff;color:var(--ink)"></label>
      <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start">
        <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}" data-theme="light" style="margin-bottom:12px"></div>
        <noscript><p style="margin:0 0 12px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">The verification step needs JavaScript. Without it, write to <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a>.</p></noscript>
        <button type="submit" style="font:600 14px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;background:var(--ink);color:#fafaf7;border:0;padding:16px 26px;cursor:pointer">Submit for review</button>
        <p style="margin:0;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:var(--muted)">Nothing is published automatically. Threats, harassment, or private information about anyone will be discarded and are not part of the record. Ordinary request logs are retained by the hosting provider.</p>
      </div>
    </form>
    <div class="standard" style="margin-top:44px">
      <div><b>What happens to a report</b><p>The Accountability Partner reads every report. A possible missed requirement or record error is checked against the evidence and the written rules. If substantiated, the outcome appears in <a href="/updates/">Updates</a> or the <a href="/violations/">Violation Log</a>, with the correction noted. Unsubstantiated reports are closed without publication.</p></div>
      <div><b>What this form is not for</b><p>General comments, encouragement, or messages to Micheal. The record is administered by the Accountability Partner; questions about compliance belong here rather than in a conversation with the participant.</p></div>
      <div><b>If the form returns you here</b><p>A note in the address bar (<code>?error=…</code>) means the verification step failed or the relay was unavailable. Try once more, or write to <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a>.</p></div>
    </div>`;
  return synPage({ title, desc: description, canonical, body })
    .replace('<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">', '<meta name="robots" content="noindex,follow">')
    .replace('</head>', '<script src="/report.js" defer></script>\n</head>');
}
function observerReceivedPage() {
  const canonical = `${SITE_ORIGIN}/report/received/`;
  const body = `
    <p class="crumb"><a href="/">Record</a> · <a href="/report/">Report an issue</a> · Received</p>
    <h1>Received</h1>
    <p class="lede"><strong>Your report has been delivered to the Accountability Partner for review.</strong></p>
    <p>Nothing is published automatically. If you reported a possible missed requirement or a record error, it is checked against the evidence and the written rules; any outcome appears in <a href="/updates/">Updates</a> or the <a href="/violations/">Violation Log</a>.</p>
    <p><a href="/">Return to the record</a></p>`;
  return synPage({ title: 'Received — Report a Record Issue', desc: 'Your report has been delivered to the Accountability Partner.', canonical, body })
    .replace('<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">', '<meta name="robots" content="noindex,follow">');
}

function livePage(supervision = [], violations = [], agreementActive = false, effectiveDate = '', publicUrlsEnabled = false) {
  const canonical = `${SITE_ORIGIN}/live/`;
  const title = 'Evening Supervision — Micheal Ray Berry';
  const description = publicUrlsEnabled
    ? 'Current Evening Supervision status, published operating rules, and eligible historical session outcomes. Eligible archive links require a separate publication flag; public live video remains disabled.'
    : 'Current Evening Supervision status, published operating rules, and eligible historical session outcomes. Public live video is disabled pending safety review.';
  const SESSION_START = '2026-09-13';
  const vioByDate = new Map(violations.map((v) => [v.date, v]));
  const today = todayEtIso();
  const dataBlock = {
    schema_version: 1,
    agreement_active: agreementActive,
    published_at: buildNow().toISOString(),
    sessions: Object.fromEntries(supervision.map((s) => {
      const applies = agreementAppliesOn(s.date, agreementActive, effectiveDate);
      return [s.date, {
        required: applies && s.required,
        status: applies && s.required ? publicSupervisionStatus(s.status) : '',
      }];
    })),
  };
  const RULES = [
    ['Uniform required', 'The full project uniform is worn throughout the supervision period while Micheal is in the monitored areas.'],
    ['Fixed-camera observation', 'Cameras remain in their designated positions. They are not repositioned to avoid observation.'],
    ['Normal activity continues', 'Cooking, eating, cleaning, household work, personal administration, television, reading, and ordinary evening activity are permitted. This is not a performance.'],
    ['Water only', 'Water is the only beverage consumed during the scheduled supervision period.'],
    ['Dinner is prepared at home', 'Delivery, restaurant takeout, and convenience meals purchased during the period are not permitted.'],
    ['Meal standard', 'A healthy home-cooked meal; yogurt for dessert. Nothing outside the planned meal.'],
    ['Visible areas orderly', 'The monitored living and dining areas are brought to the project\u2019s minimum standard of order before the session begins.'],
    [agreementActive ? 'Daily packet relationship' : 'Proposed daily packet relationship', agreementActive
      ? 'Supervision does not substitute for the Daily Inspection, weigh-in, photographs, or tracker update. The active terms set the packet deadline at 10:00 PM Eastern; current file presence does not prove timeliness.'
      : 'The pending agreement describes a separate Daily Inspection, weigh-in, photograph, and tracker process. No packet or supervision requirement is active while execution remains unverified.'],
    ['Necessary privacy is permitted', 'Bathrooms, changing, sensitive work information, private communications, visitors, and other legitimately private matters remain outside public observation.'],
    [agreementActive ? 'A required session remains on the record' : 'Future outcome handling', agreementActive
      ? 'If an activated, scheduled session is not completed, the Accountability Partner may record an adverse outcome unless a documented exception applies.'
      : 'If execution is verified later, the Accountability Partner may record outcomes only for activated, post-effective sessions. Existing pre-effective rows remain neutral.'],
    ['The record controls', 'Completing a later session does not erase a missed one. The historical record remains intact.'],
    ['Observers', 'Anyone watching may report a possible rule breach through the <a href="/report/">Observer Submission</a> page. The Accountability Partner reviews it; Micheal does not.'],
  ];
  const past = supervision.filter((s) => s.date >= SESSION_START && s.date <= today).slice().reverse();
  const recordRows = past.length
    ? past.map((s) => {
        const applies = agreementAppliesOn(s.date, agreementActive, effectiveDate);
        if (!applies) {
          return `<div class="rec"><b>${htmlEscape(longDate(s.date))}</b><span class="st">NO ACTIVE REQUIREMENT</span><span>A schedule row exists, but no active agreement requirement applied on this date.</span></div>`;
        }
        if (!s.required) {
          return `<div class="rec"><b>${htmlEscape(longDate(s.date))}</b><span class="st">NOT REQUIRED</span><span>The reviewed schedule marks no supervision requirement for this date.</span></div>`;
        }
        const st = publicSupervisionStatus(s.status);
        const kind = /^COMPLETED/.test(st) ? 'ok' : /^MISSED/.test(st) ? 'miss' : /^EXCEPTION/.test(st) ? 'exc' : '';
        const v = vioByDate.get(s.date);
        const detail = /^COMPLETED/.test(st)
          ? (htmlEscape(s.start || '6:00 PM') + '–' + htmlEscape(s.end || '10:00 PM') + ' ET' + (publicUrlsEnabled && s.url ? ' · <a href="' + htmlEscape(s.url) + '" rel="noopener">archive</a>' : ''))
          : /^MISSED/.test(st)
            ? ('Required session not completed' + (v ? ' · <a href="/violations/' + v.slug + '/">Violation ' + v.id + '</a>' : ''))
            : /^EXCEPTION/.test(st) ? 'Documented exception' : 'No outcome recorded';
        const label = st.split(/\s*[·\-–]\s*/)[0] || 'NO OUTCOME RECORDED';
        return `<div class="rec ${kind}"><b>${htmlEscape(longDate(s.date))}</b><span class="st">${htmlEscape(label)}</span><span>${detail}</span></div>`;
      }).join('')
    : agreementActive
      ? '<p>No eligible session outcome has been published yet. Reviewed outcomes will appear here after the relevant date.</p>'
      : '<p>No active supervision outcome is published. Pre-effective and inactive schedule rows do not carry compliance labels.</p>';

  const body = `
    <style>
      .sup-eyebrow{font:600 12px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin:36px 32px 0}
      .sup-h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.01em;font-size:clamp(2.2rem,6vw,4.6rem);line-height:.95;margin:10px 32px 18px;max-width:900px}
      .sup-lede{margin:0 32px 28px;max-width:680px;font-size:17px;line-height:1.65}
      .sup-wrap{padding:0 32px 56px}
      .status{background:var(--ink);color:var(--paper);padding:22px 26px;display:flex;flex-direction:column;gap:14px}
      .status .line{font:700 20px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .lamp{width:12px;height:12px;border-radius:50%;background:#5a5955;display:inline-block;flex-shrink:0}
      .lamp.on{background:#FF6B61;box-shadow:0 0 0 0 rgba(255,107,97,.6);animation:supPulse 1.6s ease-out infinite}
      @keyframes supPulse{0%{box-shadow:0 0 0 0 rgba(179,38,30,.6)}70%{box-shadow:0 0 0 10px rgba(179,38,30,0)}100%{box-shadow:0 0 0 0 rgba(179,38,30,0)}}
      .detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0;border-top:1px solid #3A3935}
      .detail div{padding:12px 14px 12px 0;display:flex;flex-direction:column;gap:4px}
      .detail b{font:600 10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#8A8983}
      .detail span{font:600 16px/1.3 'IBM Plex Mono',ui-monospace,monospace}
      .embed{margin:0;background:#000;aspect-ratio:16/9;max-width:100%;display:none}
      .embed iframe{width:100%;height:100%;border:0;display:block}
      h2.sup{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:26px;margin:44px 0 12px}
      .rules{border:1px solid var(--ink)}
      .rules div{display:grid;grid-template-columns:230px 1fr;border-bottom:1px solid var(--rule)}
      .rules div:last-child{border-bottom:none}
      .rules b{padding:14px;border-right:1px solid var(--rule);font:600 12px/1.45 'IBM Plex Mono',ui-monospace,monospace;color:var(--accent)}
      .rules p{padding:14px;margin:0;line-height:1.6;font-size:15px}
      @media(max-width:620px){.rules div{grid-template-columns:1fr}.rules b{border-right:none;border-bottom:1px solid var(--rule)}}
      .why{border-left:3px solid var(--accent);padding-left:16px;max-width:680px}
      .why p{margin:0 0 12px;line-height:1.65}
      .why .em{font-weight:600;font-size:17px}
      .sched{border:1px solid var(--ink);font:600 13px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
      .sched div{display:grid;grid-template-columns:110px 1fr;padding:12px 14px;border-bottom:1px solid var(--rule);color:var(--muted)}
      .sched div:last-child{border-bottom:none}
      .sched div.req{color:var(--ink)}
      .sched div.today{background:#F1F0EA}
      .sched b{font-weight:700}
      .exc{max-width:680px}
      .exc p{margin:0 0 10px;line-height:1.65}
      .record .rec{display:grid;grid-template-columns:200px 120px 1fr;gap:14px;padding:13px 0;border-bottom:1px solid var(--rule);font-size:15px;align-items:baseline}
      .record .rec:last-child{border-bottom:none}
      .record .rec b{font-weight:600}
      .record .st{font:700 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em}
      .record .ok .st{color:#3A6B3A}.record .miss .st{color:var(--accent)}.record .exc .st{color:var(--muted)}
      .record .note{grid-column:3;font-size:13px;color:var(--muted)}
      @media(max-width:620px){.record .rec{grid-template-columns:1fr}.record .note{grid-column:1}}
    </style>
    <script type="application/json" id="supervision-data">${jsonLd(dataBlock)}</script>
    <script src="/live.js" defer></script>
    <p class="sup-eyebrow">Public Accountability / Evening Supervision</p>
    <h1 class="sup-h1">Evening Supervision</h1>
    <p class="sup-lede">${agreementActive
      ? 'Under the verified execution state, a fixed-camera Evening Supervision session is required on nights the Accountability Partner assigns and posts here in advance. Until further notice, nights are assigned, not automatic.'
      : 'The pending agreement provides for fixed-camera Evening Supervision on specified nights, but agreement execution is not verified and the requirement is not active.'} Public live video is disabled pending a dedicated privacy and physical-safety review.</p>
    <div class="sup-wrap">
      <div class="status">
        <div class="line" data-live-status role="status" aria-live="polite"><span class="lamp"></span>CHECKING SCHEDULE…</div>
        <div class="detail" data-live-detail></div>
      </div>
      <figure class="embed" data-live-embed></figure>

      <h2 class="sup">Evening Supervision</h2>
      <p style="max-width:680px">${agreementActive
        ? 'During an explicitly activated session, normal evening activity continues under observation. Micheal is not required to entertain, interact with viewers, or remain directly in front of the camera continuously; the published rules apply until the period ends.'
        : 'If the agreement-execution gate is later activated and a session is explicitly scheduled, normal evening activity may continue under the proposed observation rules. There is no active session requirement now.'}</p>
      <p style="max-width:680px">Sessions run 6:00–10:00 PM Eastern on nights assigned by the Accountability Partner and listed below in advance. ${publicUrlsEnabled ? 'The separate URL-publication flag permits an archive link only for an eligible completed, post-effective session; public live embeds remain disabled.' : 'Public live video and archive URLs are disabled pending a dedicated privacy and physical-safety review.'}</p>

      <h2 class="sup">${agreementActive ? 'Rules while under supervision' : 'Proposed rules'}</h2>
      <div class="rules">${RULES.map(([k, v]) => `<div><b>${k}</b><p>${v}</p></div>`).join('')}</div>

      <h2 class="sup">Why public supervision</h2>
      <div class="why">
        <p>Evening Supervision removes a period in which accountability would otherwise depend entirely upon private decision-making.</p>
        <p>The camera does not make decisions for Micheal. It makes those decisions observable.</p>
        <p>He proposed this requirement in writing because routine is easier to weaken when it is not documented. A public status and later record can show what was reported; they do not independently verify everything that occurred.</p>
        <p class="em">The objective is not constant attention. The objective is accountable behavior when attention may occur.</p>
      </div>

      <h2 class="sup">Today's schedule status</h2>
      <p style="max-width:680px">Only today's explicitly recorded state is shown publicly. Future work and supervision dates are not published here. No requirement is shown as active unless the agreement-execution gate is active.</p>
      <div class="sched" data-live-schedule></div>

      <h2 class="sup">Authorized exceptions</h2>
      <div class="exc">
        <p>Documented exceptions may apply under the published standards. Public entries use a neutral EXCEPTION label; operational or sensitive reasons are retained privately and disclosed only when appropriate.</p>
      </div>

      <h2 class="sup">Supervision record</h2>
      <div class="record">${recordRows}</div>
      <p style="margin-top:24px;font-size:14px;color:var(--muted)">${agreementActive
        ? 'An adverse supervision outcome may become a governed violation entry after Accountability Partner review.'
        : 'No adverse supervision or violation outcome applies while agreement execution remains unverified.'} The process is summarized on <a href="/agreement/">the agreement-status page</a>.</p>
    </div>`;
  return synPage({ title, desc: description, canonical, body, wide: true });
}

function cornerTimePage(entries, violations, demoUrl = '') {
  const canonical = `${SITE_ORIGIN}/corrections/`;
  const title = 'Corrective Sessions — Micheal Ray Berry Public Accountability Project';
  const description =
    'The corrective session is the requirement that answers a documented failure in the ' +
    'Micheal Ray Berry Public Accountability Project: 10, 20, or 30 minutes by level, recorded ' +
    'in one unbroken take and published beside the entry that caused it.';

  const sessions = (violations || []).filter((v) => Boolean(v.recording));
  const demo = String(demoUrl || '').trim();

  const graph = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      about: { '@id': PERSON_ID },
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
    ...(demo ? [{
      /* The demonstration is marked as such in the schema too, so a video
         result can never present an explainer as a served consequence. */
      '@type': 'VideoObject',
      '@id': `${canonical}#demonstration`,
      name: 'Corrective session — demonstration of the required position and standard',
      description:
        'A demonstration of the corrective session position and standard used in the Micheal Ray Berry ' +
        'Public Accountability Project. This is an explainer, not a corrective session: it answers ' +
        'no violation and is filed against no entry.',
      ...videoSchemaSource(demo),
      ...(isSelfHosted(demo) ? { encodingFormat: /\.webm(?:$|\?)/i.test(demo) ? 'video/webm' : 'video/mp4' } : {}),
      publisher: { '@id': PERSON_ID },
      isFamilyFriendly: true,
    }] : []),
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Corrective Sessions', item: canonical },
      ],
    },
  ];

  const levels = [
    ['Level One', 'First confirmed Violation Event', '10 minutes'],
    ['Level Two', 'Second confirmed Violation Event', '20 minutes'],
    ['Level Three and after', 'Third and every later Violation Event', '30 minutes'],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
    .lede{font-size:17px;line-height:1.6;border-left:3px solid var(--accent);padding-left:16px;margin:0 0 18px}
    .levels{width:100%;border-collapse:collapse;margin:18px 0 8px;font-size:15px}
    .levels caption{text-align:left;margin:0 0 8px;font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
    .levels th{text-align:left;background:var(--ink);color:var(--paper);font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;padding:9px 12px}
    .levels td{padding:11px 12px;border-bottom:1px solid var(--rule)}
    .levels td:last-child{font-family:'IBM Plex Mono',ui-monospace,monospace;white-space:nowrap}
    .demo{max-width:300px;aspect-ratio:9/16;background:var(--ink);border:1px solid var(--ink);display:block}
    .standard{border:1px solid var(--ink);padding:0;margin:20px 0}
    .standard div{display:grid;grid-template-columns:86px 1fr;border-bottom:1px solid var(--rule)}
    .standard div:last-child{border-bottom:none}
    .standard b{padding:16px 14px;border-right:1px solid var(--rule);font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:var(--accent)}
    .standard p{padding:16px 14px;margin:0;line-height:1.6}
    .sessions{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
    .sessions a{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;border:1px solid var(--rule);padding:13px 15px;text-decoration:none}
    .sessions a:hover{border-color:var(--ink)}
    .sessions span:last-child{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>
  <header>
    <div class="eyebrow">The corrective requirement</div>
    <h1>Corrective Sessions</h1>
    <p>What answers a documented failure, what the standard is, and every session on the record.</p>
  </header>
  <main id="main-content">
    <p class="lede"><strong>§8 of the agreement defines a corrective session that may answer an Accountability Partner-verified failure to file the Daily Compliance Packet by 10 PM Eastern or to complete a required Evening Supervision session (§3.4), while execution is active.</strong> It is not a consequence for the weight. A gain, a plateau, or a bad month is never a Violation Event.</p>
    <p>While the agreement is active, each verified, post-effective Violation Event is handled under the published standards. The level follows the accumulated count of confirmed violations (§8.1); the Accountability Partner verifies the record rather than creating requirements outside those terms.</p>

    <p>So a second failure costs more than a first and a third costs more than a second.</p>

    <table class="levels">
      <caption>Corrective-session levels</caption>
      <thead><tr><th scope="col">Level</th><th scope="col">Assigned when</th><th scope="col">Duration</th></tr></thead>
      <tbody>${levels.map(([l, w, d]) => `<tr><td>${l}</td><td>${w}</td><td>${d}</td></tr>`).join('')}</tbody>
    </table>

    <h2>The standard</h2>
    <div class="standard">
      <div><b>Position</b><p>Facing the designated corner or wall, standing upright, hands behind the head, feet shoulder-width apart, substantially still for the whole period. No phone, entertainment, reading, or unrelated activity.</p></div>
      <div><b>Uniform</b><p>The correction uniform (§4.2): the designated pink unitard. The black uniform documents the standard; the pink uniform documents a failure to meet it.</p></div>
      <div><b>Timer</b><p>Begins only once the required position is established — not when the recording starts. Time spent getting into position does not count toward the assigned period.</p></div>
      <div><b>Recording</b><p>One continuous take, fully AI-voiced. The participant does not speak. A session challenge code is displayed in the recording and logged with the submission; the current system does not independently prove capture time or rule out every form of replay or editing.</p></div>
      <div><b>Invalidation</b><p>Leaving the position, materially changing posture, or ending early invalidates the attempt. The full period is completed again from zero — a shortened session counts for nothing.</p></div>
      <div><b>Deadline</b><p>The agreement allows 72 hours after an assigned violation notice to complete, record, and file the session, subject to documented §9 exceptions and only while execution is active. The server validates the linked assignment and exact due date.</p></div>
      <div><b>Verification</b><p>Submitting a session does not resolve the entry. It remains corrected and awaiting verification until the Accountability Partner reviews identity, attire, elapsed time, and continuity against the published standard and records a decision.</p></div>
    </div>

    <h2>Demonstration</h2>
    <p>The written standard below is the whole requirement. <strong>Corrective sessions on the
    record are filed against a specific entry</strong>; they appear beside that entry, not here.</p>

    <h2>Why it is published</h2>
    <p>The recording is published beside the entry that caused it and normally remains part of the
    durable record. Completing a corrective requirement closes the obligation; privacy, safety,
    consent, or applicable law may still require redaction or removal, with a transparent change
    history when appropriate.</p>
    <p>The reasoning is the same as for the daily record itself. Every previous attempt at this ended
    quietly, because quitting cost nothing and nobody knew there had been a plan. A consequence
    nobody can see is one that would eventually be discounted too.</p>
    <p>Every published photograph and recording shows the participant in the full project
    uniform. Verification photographs are held privately and are not published.</p>
    <p>§8.2 and §8.6 are summarized on <a href="/agreement/">the agreement page</a>, together with their current execution status.</p>

    <h2>Sessions on the record</h2>
    ${sessions.length
      ? `<ul class="sessions">${sessions.map((v) => `<li><a href="/violations/${v.slug}/"><span>${v.id} — ${htmlEscape(longDate(v.date))}</span><span>View session →</span></a></li>`).join('')}</ul>`
      : `<p>No corrective session has been recorded yet. Any session, once recorded, is normally listed
        here and linked from the entry that required it, subject to required redaction or removal. The
        <a href="/violations/">violation log</a> shows every confirmed failure and its status.</p>`}
  </main>
  <div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col">
        <span class="colhead">Official record</span>
        <span class="links"><a href="https://michealrayberry.com">Website</a></span>
      </div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>
</body>
</html>
`;
}

function violationSitemap(violations) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${violations.map((v) => `  <url>
    <loc>${SITE_ORIGIN}/violations/${v.slug}/</loc>
    <lastmod>${v.resolved || v.submitted || v.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function dailySitemap(records) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${records.map((r) => `  <url><loc>${SITE_ORIGIN}/daily/${r.date}-day-${String(r.day).padStart(3, '0')}/</loc><lastmod>${r.date}</lastmod><changefreq>never</changefreq><priority>0.8</priority></url>
  <url><loc>${SITE_ORIGIN}/daily/${r.date}-day-${String(r.day).padStart(3, '0')}/video/</loc><lastmod>${r.date}</lastmod><changefreq>never</changefreq><priority>0.7</priority></url>`).join('\n')}
</urlset>
`;
}

function imageSitemap(entries) {
  const official = `  <url>
    <loc>${SITE_ORIGIN}/</loc>
    <image:image><image:loc>${SITE_ORIGIN}/photos/official/micheal-ray-berry-official-front-v2.jpg</image:loc><image:title>Micheal Ray Berry — official photograph, project uniform</image:title><image:caption>Official photograph of Micheal Ray Berry in the Inspection position, project uniform. Public Accountability Project: declared start 340 lb, goal 200 lb, documented daily under his real name.</image:caption></image:image>
  </url>
  <url>
    <loc>${SITE_ORIGIN}/tf060/</loc>
    <image:image><image:loc>${SITE_ORIGIN}/photos/official/micheal-ray-berry-tf060-continues.png</image:loc><image:title>TF060 failed. Micheal Ray Berry continues.</image:title><image:caption>Micheal Ray Berry in the project uniform holding a sign that reads: TF060 failed. Micheal Ray Berry continues.</image:caption></image:image>
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${official}
${entries.map(({ record, photos }) => `  <url>
    <loc>${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/</loc>
${Object.entries(photos).map(([angle, p]) => `    <image:image><image:loc>${xmlEscape(p.sourceUrl)}</image:loc><image:title>${xmlEscape(`Micheal Ray Berry — Day ${record.day} daily inspection, ${imageLabel(angle)}, ${longDate(record.date)}`)}</image:title><image:caption>${xmlEscape(`Micheal Ray Berry, Day ${record.day} of the public accountability record, ${imageLabel(angle)}, ${longDate(record.date)}. Recorded weight ${record.weight.toFixed(1)} lb. Project uniform.`)}</image:caption></image:image>`).join('\n')}
    <image:image><image:loc>${SITE_ORIGIN}/cards/${record.date}.png</image:loc><image:title>${xmlEscape(`Micheal Ray Berry — Day ${record.day} report card, ${longDate(record.date)}`)}</image:title><image:caption>${xmlEscape(`Daily report card for Day ${record.day}: recorded weight ${record.weight.toFixed(1)} lb, packet status, and requirements. michealrayberry.com`)}</image:caption></image:image>
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
    <loc>${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/video/</loc>
    <video:video>
      <video:thumbnail_loc>${xmlEscape(photos.front.sourceUrl)}</video:thumbnail_loc>
      <video:title>${xmlEscape(`Micheal Ray Berry Day ${record.day} daily inspection video`)}</video:title>
      <video:description>${xmlEscape(`Four-angle daily inspection video for Day ${record.day} of the Micheal Ray Berry Public Accountability Project at ${record.weight.toFixed(1)} pounds.`)}</video:description>
      ${record.streamUid && streamEmbedUrl(record.streamUid)
        ? `<video:content_loc>${xmlEscape(streamHls(record.streamUid))}</video:content_loc><video:player_loc allow_embed="yes">${xmlEscape(streamEmbedUrl(record.streamUid))}</video:player_loc>`
        : isSelfHosted(record.video) || !embed
        ? `<video:content_loc>${xmlEscape(record.video)}</video:content_loc>`
        : `<video:player_loc allow_embed="yes">${xmlEscape(embed)}</video:player_loc>`}
      ${record.videoSec > 0 ? `<video:duration>${record.videoSec}</video:duration>` : ''}
    </video:video>
  </url>`;
}).join('\n')}
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
  <sitemap><loc>${SITE_ORIGIN}/sitemap-violations.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-pages.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-images.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-videos.xml</loc><lastmod>${latestDate}</lastmod></sitemap>
</sitemapindex>
`;
}

/* About and Agreement are authored once, inside index.html (the DC shell), and
   mirrored here as standalone, indexable static pages so crawlers and social
   cards get real content and per-page metadata. Same source, no drift: the DC
   template syntax is stripped and the inline-styled body wrapped in the site
   shell. The Agreement's dynamic amendment log (live on the SPA page) is
   dropped from the static copy. */
const SYN_CSS = `
    :root{color-scheme:light;--ink:#141412;--paper:#fafaf7;--muted:#6b6a64;--rule:#d8d6cf;--accent:#b3261e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 'IBM Plex Sans',system-ui,-apple-system,sans-serif}
    a{color:var(--ink);text-underline-offset:3px}
    .skip-link{position:fixed;left:16px;top:12px;z-index:10000;transform:translateY(-160%);background:#fafaf7;color:#141412;border:2px solid #141412;padding:10px 14px;font:600 14px "IBM Plex Mono",ui-monospace,monospace}
    .skip-link:focus{transform:translateY(0)}
    .sitehead{border-bottom:2px solid var(--ink);background:var(--paper);padding:0 32px}
    .sitehead-in{max-width:1160px;margin:auto;padding:22px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .wordmark{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink)}
    .wordmark b{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
    .wordmark span{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
    .sitenav{display:flex;flex-direction:column;align-items:flex-end;gap:0}
    .nav-primary,.nav-secondary{display:flex;gap:2px;row-gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
    .sitenav a{font:600 12.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:8px 9px}
    .nav-secondary a{font-weight:500;font-size:11.5px;letter-spacing:.08em;color:#3A3935;padding:5px 9px}
    .sitenav .share{border:1px solid var(--ink);padding:7px 12px;margin-left:6px;font-size:12px;letter-spacing:.08em}.sitenav .share:hover{background:var(--ink);color:var(--paper);text-decoration:none}
    .sitenav a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
    main{max-width:1160px;margin:auto;padding:0}
    main.content-page{padding:40px 32px 72px}
    .crumb{font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 20px}
    .lede{font-size:18px;max-width:720px}.content-page h1{font-family:'IBM Plex Sans Condensed',sans-serif;font-size:clamp(2.4rem,7vw,5rem);line-height:.95;text-transform:uppercase;margin:0 0 24px}.content-page h2{font-family:'IBM Plex Sans Condensed',sans-serif;text-transform:uppercase;margin:42px 0 12px}
    .content-page p,.content-page ul,.content-page blockquote{max-width:760px}
    .standard{border:1px solid var(--ink);margin:20px 0;max-width:880px}
    .standard>div{display:grid;grid-template-columns:minmax(150px,220px) 1fr;border-bottom:1px solid var(--rule)}
    .standard>div:last-child{border-bottom:0}.standard b{padding:16px;border-right:1px solid var(--rule);font:600 12px/1.45 'IBM Plex Mono',ui-monospace,monospace;color:var(--accent)}
    .standard p{padding:16px;margin:0;max-width:none}.standard img{height:auto}
    .copy-button{appearance:none;background:transparent;border:1px solid transparent;color:var(--accent);cursor:pointer;font:inherit;min-height:44px;padding:8px 10px;text-decoration:underline;text-underline-offset:4px}
    .copy-button:hover{color:#8F1E18}.copy-button:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
    .sitefoot{background:var(--ink);color:var(--paper);padding:56px 32px 40px}
    .sitefoot-in{max-width:1160px;margin:auto;display:flex;flex-direction:column;gap:40px}
    .sitefoot-top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
    .sitefoot-bottom{border-top:1px solid #3A3935;padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font:13px 'IBM Plex Mono',ui-monospace,monospace;color:#8A8983}
    .sitefoot-bottom a{color:var(--paper);text-decoration:none}.sitefoot-bottom a:hover{color:#FF6B61}
    .sitefoot-bottom .pair{display:flex;gap:6px 20px;flex-wrap:wrap}.sitefoot-bottom .pair span{white-space:nowrap}
    .sitefoot b{display:block;font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
    .sitefoot .sub{font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#8A8983;margin-top:6px;display:block}
    .sitefoot .col{display:flex;flex-direction:column;gap:10px}
    .sitefoot .colhead{font:10px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#FF6B61}
    .sitefoot .links{display:flex;gap:20px;flex-wrap:wrap;font:12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em}
    .rec{display:inline-flex;align-items:center;gap:7px;color:var(--paper)}.rec:hover{color:#FF6B61}
    .rec-lamp{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0}
    @media(max-width:760px){.sitehead{padding:0 16px}.sitehead-in{align-items:flex-start}.sitenav{width:100%;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav-primary,.nav-secondary{flex-wrap:nowrap;justify-content:flex-start;width:max-content;min-width:100%}.sitenav a{min-height:44px;display:inline-flex;align-items:center}.nav-secondary a{min-height:40px}.sitefoot{padding-left:16px;padding-right:16px}.sitefoot-bottom .pair{min-width:0}.sitefoot-bottom .pair span{white-space:normal}.sitefoot-bottom .pair a{overflow-wrap:anywhere}.sitefoot-bottom>span:last-child{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-width:0}main.content-page{padding-left:16px;padding-right:16px}.standard>div{grid-template-columns:1fr}.standard b{border-right:0;border-bottom:1px solid var(--rule)}}`;
const synHeader = (canonical) => `<div style="background:#141412;color:#FAFAF7;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;gap:10px;align-items:center;padding:7px 32px;flex-wrap:wrap"><span style="width:8px;height:8px;border-radius:50%;background:#B3261E;display:inline-block"></span><span>Public accountability record</span></div>
<div class="sitehead"><div class="sitehead-in">
  <a class="wordmark" href="/"><b>Micheal Ray Berry</b><span>Under public accountability</span></a>
  <nav class="sitenav" aria-label="Site navigation">
    <span class="nav-primary"><a href="/">Home</a><a href="/dashboard/">Dashboard</a><a href="/daily/">The Record</a><a href="/protocol/">Protocol</a><a href="/violations/">Violations</a><a href="/about/">About</a><a class="share" href="/share/">Share</a></span>
    ${sectionRow(canonical)}
  </nav>
</div></div><script src="/livenav.js" defer></script>`;
const SYN_FOOTER = `<div class="sitefoot"><div class="sitefoot-in">
    <div class="sitefoot-top">
      <div class="col"><b>Micheal Ray Berry</b><span class="sub">Public Accountability Project</span></div>
      <div class="col"><span class="colhead">Official record</span><span class="links"><a href="https://michealrayberry.com">Website</a></span></div>
    </div>
    <p class="footline" style="margin:0 0 14px;font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:#8a8983">A voluntary public accountability project with published terms and defined limits. <a href="/agreement/" style="color:#fafaf7">Consent &amp; boundaries</a></p>
    <div class="sitefoot-bottom">
      <span class="pair"><span>Accountability Partner: <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a></span><span>Participant: <a href="mailto:mrb@michealrayberry.com">mrb@michealrayberry.com</a></span></span>
      <span><a href="/share/" style="letter-spacing:.08em;text-transform:uppercase">Share</a> <a href="/report/" style="font-weight:600;letter-spacing:.08em;text-transform:uppercase">Report an issue →</a> <a class="rec" href="/assistant/"><span class="rec-lamp" aria-hidden="true"></span>Recording Assistant</a></span>
    </div>
  </div></div>`;
function synExtract(full, startTag, endMarker) {
  const s = full.indexOf(startTag);
  const e = full.indexOf(endMarker, s);
  if (s === -1 || e === -1) throw new Error('synthetic-page markers not found: ' + startTag);
  return full.slice(s + startTag.length, e).replace(/\s*<\/div>\s*<\/sc-if>\s*$/, '');
}
function synClean(html) {
  return html
    .replace(/<sc-if value="\{\{ hasAmendments \}\}"[\s\S]*$/, '')
    .replace(/\s+onClick="\{\{[^}]*\}\}"/g, '')
    .replace(/\s+aria-current="\{\{[^}]*\}\}"/g, '')
    .replace(/\s+style-hover="[^"]*"/g, '')
    .replace(/\s+style-active="[^"]*"/g, '')
    .replace(/ data-photo-src=/g, ' src=')
    .replace(/\{\{[^}]*\}\}/g, '');
}
/* Section sub-row for the 7-link header: shown only inside The Record or Protocol. */
const RECORD_SECTION = ['/daily/', '/weeks/', '/milestones/', '/updates/', '/cards/'];
const PROTOCOL_SECTION = ['/live/', '/positions/', '/uniform/', '/corrections/', '/agreement/', '/protocol/', '/consent/'];
function sectionRow(canonical) {
  const path = String(canonical || '').replace(SITE_ORIGIN, '');
  const starts = (list) => list.some((pfx) => path === pfx || path.startsWith(pfx));
  const cur = (href) => (path === href || (href !== '/daily/' && path.startsWith(href)) || (href === '/daily/' && /^\/daily\//.test(path))) ? ' aria-current="page"' : '';
  if (starts(RECORD_SECTION)) return `<span class="nav-secondary"><a href="/daily/"${cur('/daily/')}>Daily record</a><a href="/weeks/"${cur('/weeks/')}>Weeks</a><a href="/milestones/"${cur('/milestones/')}>Milestones</a><a href="/updates/"${cur('/updates/')}>Updates</a></span>`;
  if (starts(PROTOCOL_SECTION)) return `<span class="nav-secondary"><a href="/live/" data-live-nav${cur('/live/')}>Supervision</a><a href="/positions/"${cur('/positions/')}>Inspection</a><a href="/uniform/"${cur('/uniform/')}>Uniform</a><a href="/corrections/"${cur('/corrections/')}>Corrections</a><a href="/agreement/"${cur('/agreement/')}>Agreement</a></span>`;
  return '';
}
/* /faq/ — the About FAQ as an indexable page with FAQPage schema. The
   template stays the source of truth; items are re-extracted at build. */
async function faqPage() {
  const tpl = await fs.readFile(path.join(ROOT, 'site.template.html'), 'utf8');
  const f = tpl.indexOf('Questions, answered plainly');
  const sec = tpl.slice(tpl.lastIndexOf('<section', f), tpl.indexOf('</section>', f));
  const items = [...sec.matchAll(/<span style="font-size: 17px; font-weight: 600;">([^<]+)<\/span>\s*((?:<p[^>]*>[\s\S]*?<\/p>\s*)+)/g)]
    .map((m) => ({ q: m[1].trim(), html: m[2].replace(/ style="[^"]*"/g, '').replace(/ onClick="\{\{[^}]*\}\}"/g, '').trim() }))
    .map((i) => ({ ...i, text: i.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }));
  const canonical = `${SITE_ORIGIN}/faq/`;
  const title = 'Questions about the record — Micheal Ray Berry Public Accountability Project';
  const description = 'Plain answers: is this real, is it voluntary, what if I know him, can he delete it, is it medically supervised, when does it end.';
  const body = `
    <p class="crumb"><a href="/">Record</a> · <a href="/about/">About</a> · Questions</p>
    <h1>Questions, answered plainly</h1>
    <div class="standard">
      ${items.map((i) => `<div><b>${htmlEscape(i.q)}</b>${i.html}</div>`).join('\n      ')}
    </div>
    <p>Something not covered? <a href="/report/">Report a record issue</a> or write to <a href="mailto:ap@michealrayberry.com">ap@michealrayberry.com</a>.</p>`;
  const schema = jsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${canonical}#faq`, url: canonical, mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.text } })) });
  return synPage({ title, desc: description, canonical, body }).replace('</head>', `<script type="application/ld+json">${schema}</script>\n</head>`);
}

/* Set in main() once the gate and violations are known. When the agreement is
   active and an entry is open, every generated page carries the red banner. */
let VIOLATION_MODE = null;
function violationBannerHtml() {
  const v = VIOLATION_MODE; if (!v) return '';
  return `<div class="violation-banner" style="background:#B3261E;color:#FAFAF7;border-bottom:3px solid #141412"><div style="max-width:1160px;margin:0 auto;padding:16px 24px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 32px;align-items:center">
    <div style="display:flex;flex-direction:column;gap:5px"><span style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.24em;text-transform:uppercase">Open violation · corrective session due</span>
    <span style="font:700 24px/1.05 'IBM Plex Sans Condensed',sans-serif;text-transform:uppercase">Micheal Ray Berry: ${v.open} unresolved · ${v.owed} min owed${v.overdueSuffix}</span>
    <span style="font:13px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em"><span data-due-iso="${htmlEscape(v.dueIso)}">${htmlEscape(v.dueRelative)}</span> · ${v.dueWord} ${htmlEscape(v.dueLabel)} · pink correction uniform required · served to date: ${v.served} min</span>${v.allOverdue ? `<a href="/tf060/" style="font:12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#FAFAF7;text-decoration:underline;text-underline-offset:4px;margin-top:4px">Prior record: TF060 ended without completion →</a>` : ''}</div>
    <a href="/violations/" style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#B3261E;background:#FAFAF7;padding:12px 18px;text-decoration:none;white-space:nowrap">View the entry →</a></div></div>`;
}
function cornerSummaryForShell(violations) {
  const minutesFor = (i) => [10, 20, 30][Math.min(2, i)];
  const confirmed = violations.filter((v) => v.state === 'open' || v.state === 'resolved').sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let owed = 0, served = 0, soonest = null, openN = 0, overdueN = 0; const now = Date.now();
  confirmed.forEach((v, i) => { const m = minutesFor(i); if (v.state === 'resolved') { served += m; return; } owed += m; openN += 1; const base = v.eventVerifiedAt ? new Date(v.eventVerifiedAt) : new Date(`${v.date}T22:00:00-04:00`); const due = new Date(base.getTime() + 72 * 3600e3); if (Number.isNaN(due.getTime())) return; if (due.getTime() < now) overdueN += 1; if (!soonest || due < soonest) soonest = due; });
  const fmt = (d) => d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const rel = (d) => { const ms = d - Date.now(), a = Math.abs(ms), h = Math.floor(a / 3600e3), m = Math.floor((a % 3600e3) / 60e3); const txt = h >= 24 ? `${h} h` : h > 0 ? `${h} h ${m} m` : `${m} m`; return ms < 0 ? `overdue by ${txt}` : `${txt} remaining`; };
  return { owed, served, open: openN, dueIso: soonest ? soonest.toISOString() : '', dueLabel: soonest ? fmt(soonest) : '', dueRelative: soonest ? rel(soonest) : '', overdueSuffix: !openN ? '' : overdueN === openN ? ' · ALL OVERDUE' : overdueN > 0 ? ` · ${overdueN} OVERDUE` : '', dueWord: overdueN > 0 ? 'earliest due' : 'due', allOverdue: !!(openN && overdueN === openN) };
}

function synPage({ title, desc, canonical, body, wide = false }) {
  const schema = jsonLd({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description: desc, about: { '@id': `${SITE_ORIGIN}/#micheal-ray-berry` }, isPartOf: { '@id': `${SITE_ORIGIN}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Micheal Ray Berry', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: title.split(' \u2014 ')[0], item: canonical } ] } ] });
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(desc)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Micheal Ray Berry \u2014 Daily Record" href="${SITE_ORIGIN}/feed.xml">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Micheal Ray Berry \u2014 Public Accountability Project">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:alt" content="Micheal Ray Berry Public Accountability Project — declared 340-pound start toward a 200-pound goal">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(desc)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png">
  <meta name="twitter:image:alt" content="Micheal Ray Berry Public Accountability Project — declared 340-pound start toward a 200-pound goal">
  <script type="application/ld+json">${schema}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@700&display=swap" rel="stylesheet">
  <style>${SYN_CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
${synHeader(canonical)}${violationBannerHtml()}
<main id="main-content"${wide ? '' : ' class="content-page"'}>
${body}
</main>
${SYN_FOOTER}
</body>
</html>`;
}
function staticCtx(data) {
  return Object.assign({
    ROOT, SITE_ORIGIN, START_DATE, todayIso: todayEtIso(),
    findPhoto, relUrl, publicVideoUrl, videoEmbed, longDate, htmlEscape, normalizeDate,
  }, data);
}

async function main() {
  const feedConfiguration = {
    WEIGHINS_CSV: SHEET_CSV,
    VIOLATION_CSV,
    ATTESTATION_CSV: ATTEST_CSV,
    CONFIRMATIONS_CSV,
    SUPERVISION_CSV,
    UPDATES_CSV,
    SITE_STATE_CSV,
  };
  const missingFeeds = Object.entries(feedConfiguration).filter(([, value]) => !value).map(([name]) => name);
  if (missingFeeds.length) {
    console.error(`Publisher feed configuration missing: ${missingFeeds.join(', ')}. Configure private read-only feed URLs in the deployment environment.`);
    process.exitCode = 1;
    return;
  }
  if (ATTESTATION_SEAL_SECRET.length < 32) {
    console.error('Publisher attestation verification missing: configure ATTESTATION_SEAL_SECRET with the exact private Apps Script SEAL_SECRET (minimum 32 characters).');
    process.exitCode = 1;
    return;
  }
  let csv, attestCsv, confirmationsCsv, violationCsv, siteStateCsv, supervisionCsv, updatesCsv;
  try {
    [csv, attestCsv, confirmationsCsv, violationCsv, siteStateCsv, supervisionCsv, updatesCsv] = await Promise.all([
      fetchText(SHEET_CSV, false),
      fetchText(ATTEST_CSV, false),
      fetchText(CONFIRMATIONS_CSV, false),
      fetchText(VIOLATION_CSV, false),
      fetchText(SITE_STATE_CSV, false),
      fetchText(SUPERVISION_CSV, false),
      fetchText(UPDATES_CSV, false),
    ]);
  } catch (error) {
    console.error('Required record feed fetch failed:', error);
    process.exitCode = 1;
    return;
  }
  const emptyFeeds = [
    ['ATTESTATION_CSV', attestCsv],
    ['CONFIRMATIONS_CSV', confirmationsCsv],
    ['VIOLATION_CSV', violationCsv],
    ['SITE_STATE_CSV', siteStateCsv],
    ['SUPERVISION_CSV', supervisionCsv],
    ['UPDATES_CSV', updatesCsv],
  ].filter(([, text]) => !String(text || '').trim()).map(([name]) => name);
  if (emptyFeeds.length) {
    throw new Error(`Required record feed returned an empty response: ${emptyFeeds.join(', ')}`);
  }
  if (!csv) {
    /* Required record feed unreadable. The generated
       directories are NOT in the repo — a "successful" deploy without them
       ships a site where /daily/, /about, /agreement all 404. Write the
       sheet-independent pages, then FAIL the build so the host keeps the
       last good deploy instead of publishing a gutted one. */
    console.warn('Required record feed unreadable — generating sheet-independent pages, then failing the build.');
    console.warn('Verify the deployment feed URL and its authorized read access, then retry. Do not make the operational workbook public.');
    for (const [slug, html] of await buildStaticSite(staticCtx({ rows: [], violations: [], updates: [], siteState: {}, attestMap: {}, photoFiles: [] }))) {
      await writeIfChanged(path.join(ROOT, slug, 'index.html'), html);
    }
    process.exitCode = 1;
    return;
  }
  let rows, violationRows;
  try {
    rows = validateTable(parseCSV(csv, 'Weigh-ins'), [
      'date', ['weight_lb', 'weight'], 'note', 'photo_front', 'photo_left',
      'photo_rear', 'photo_right', 'video', 'video_sec',
    ], 'Weigh-ins', { optional: ['stream_uid', 'r2_key'] });
    violationRows = validateTable(parseCSV(violationCsv || '', 'Violation Log'), [
      'date', 'violation', 'status', 'submitted', 'resolved',
      'ap_verification', 'corrections', 'recording', 'event_verification',
    ], 'Violation Log', { optional: ['stream_uid'] });
  } catch (error) {
    console.error('Required sheet validation failed:', error.message);
    process.exitCode = 1;
    return;
  }
  /* Site State key/value pairs — parsed FIRST: start_date drives every day
     number computed below. The demo recording URL also lives here (ytfiled). */
  const siteState = {};
  const stateRows = validateTable(
    parseCSV(siteStateCsv, 'Site State'),
    ['key', 'value'],
    'Site State',
  );
  const stateKeys = new Set();
  for (const r of stateRows.slice(1)) {
    const rawKey = String(r[0] ?? '');
    const rawValue = String(r[1] ?? '');
    if (!rawKey && !rawValue) continue;
    const key = rawKey.trim();
    if (!key || rawKey !== key || !/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      throw new Error('Site State contains a blank, malformed, or non-canonical key.');
    }
    if (!rawKey && rawValue) throw new Error('Site State contains a value without a key.');
    if (stateKeys.has(key)) throw new Error(`Site State contains duplicate canonical key: ${key}`);
    stateKeys.add(key);
    /* Apps Script deliberately treats the edition selector as an exact state
       token. Preserve that raw value so surrounding whitespace cannot open
       the publisher gate while the server remains inactive. Other stored
       values retain their established input trimming semantics. */
    siteState[key] = key === 'agreement_edition' ? rawValue : rawValue.trim();
  }
  if (!isRealIsoDate(siteState.start_date)) {
    throw new Error('Site State must contain one explicit valid start_date.');
  }
  START_DATE = siteState.start_date;
  /* Evening Supervision record (§3.4): one row per scheduled night the record
     has ruled on — COMPLETED / MISSED / EXCEPTION · reason. */
  const supervisionColumns = ['date', 'required', 'status', 'start', 'end', 'stream_url', 'note'];
  const supervisionRows = validateTable(
    parseCSV(supervisionCsv, 'Supervision'),
    supervisionColumns,
    'Supervision',
  );
  const supervision = supervisionRows.slice(1)
    .map((r) => ({
      date: normalizeDate(r[0]),
      required: /^(true|yes|1|required)$/i.test(String(r[1] || '').trim()),
      status: String(r[2] || '').trim(),
      start: String(r[3] || '').trim(),
      end: String(r[4] || '').trim(),
      url: publicVideoUrl(r[5]),
      note: String(r[6] || '').trim(),
    }))
    .filter((s) => isRealIsoDate(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const supervisionDates = new Set();
  for (const session of supervision) {
    if (supervisionDates.has(session.date)) throw new Error(`Supervision contains duplicate date: ${session.date}`);
    supervisionDates.add(session.date);
  }
  const updateRows = validateTable(
    parseCSV(updatesCsv, 'Updates'),
    ['date', 'type', 'title', 'body', 'link'],
    'Updates',
  );
  const updates = updateRows.slice(1)
    .map((r) => ({
      date: normalizeDate(r[0]),
      type: String(r[1] || 'official').trim(),
      title: String(r[2] || '').trim(),
      body: String(r[3] || '').trim(),
      link: String(r[4] || '').trim(),
    }))
    .filter((u) => isRealIsoDate(u.date) && u.date <= todayEtIso() && (u.title || u.body));
  PRIOR_NOTE = siteState.prior_attempt_note || '';

  let violations = violationRows.slice(1)
    .map((r) => {
      const date = normalizeDate(r[0]);
      const rawWhat = String(r[1] || '').trim();
      const approval = verifiedViolation(r[8], date, rawWhat);
      const identity = publicViolationIdentity(approval?.digest);
      const submitted = normalizeDate(r[3]);
      const recording = publicVideoUrl(r[7]);
      const rawState = violationState(r[2]);
      const resolution = approval && verifiedViolationResolution(
        r[5], r[4], r[8], date, approval.verifiedAt,
      );
      const correctedEvidence = rawState === 'corrected'
        && isRealIsoDate(submitted) && submitted >= date && submitted <= todayEtIso()
        && Boolean(recording);
      return {
        n: identity?.token || '',
        id: identity?.id || '',
        slug: identity?.slug || '',
        date,
        day: dayNumber(date),
        what: violationText(rawWhat),
        state: resolution ? 'resolved' : correctedEvidence ? 'corrected' : 'open',
        submitted: correctedEvidence || resolution ? submitted : '',
        resolved: resolution?.date || '',
        verification: resolution ? `AP-verified resolution ${resolution.date}` : '',
        corrections: String(r[6] || '').split(';').map((x) => x.trim()).filter(Boolean),
        recording,
        recordingStreamUid: streamUid(String(r[9] || '')),
        eventVerifiedAt: approval?.verifiedAt || '',
      };
    })
    .filter((v) => isRealIsoDate(v.date) && v.what);



  const records = rows.slice(1).map((r) => ({
    date: normalizeDate(r[0]),
    weight: Number.parseFloat(r[1]),
    note: String(r[2] || '').trim(),
    video: publicVideoUrl(r[7]),
    videoSec: Math.round(Number.parseFloat(r[8]) || 0),
    streamUid: streamUid(r[9]),
    r2Key: String(r[10] || '').trim().slice(0, 200),
    transcript: '',
  })).filter((r) => isRealIsoDate(r.date) && r.date <= todayEtIso() && Number.isFinite(r.weight))
    .map((r) => ({ ...r, day: dayNumber(r.date) }))
    .filter((r) => r.day >= 1)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (STREAM_CUSTOMER_CODE) {
    await Promise.all(records.filter((r) => r.streamUid).map(async (r) => {
      const vtt = await fetchText(streamTranscriptUrl(r.streamUid), true);
      r.transcript = vtt && /WEBVTT/.test(vtt) ? vttToText(vtt) : '';
    }));
  }
  const recordDates = new Set();
  for (const record of records) {
    if (recordDates.has(record.date)) throw new Error(`Weigh-ins contains duplicate date: ${record.date}`);
    recordDates.add(record.date);
  }

  if (!records.length) {
    /* Distinguish a broken sheet (fail the build, keep the last good deploy)
       from a fresh attempt whose first weigh-in has not synced yet (publish
       the gap-only archive — that gap IS the record). */
    const anyValid = rows.slice(1).some((r) => isRealIsoDate(normalizeDate(r[0])));
    const headerOk = rows.length > 0 && String(rows[0][0] || '').trim().toLowerCase() === 'date';
    if (!anyValid && !headerOk) {
      console.error('Weigh-ins sheet parsed to zero records and no recognizable header — refusing to publish a blank archive.');
      process.exitCode = 1;
      return;
    }
    if (!anyValid) console.warn('Weigh-ins is empty but reachable (fresh record) — publishing the Day-1 empty archive.');
    console.warn(`No records on/after START_DATE (${START_DATE}) yet — publishing gap-only archive.`);
  }

  const attestMap = new Map();
  const publicAttestations = [];
  const acceptedAttestations = [];
  const acceptedAttestationIdentities = new Set();
  if (attestCsv) {
    const requiredColumns = [
      'logged_at_server', 'date', 'day', 'event', 'code', 'kind',
      'video_sha256', 'photo_sha256s', 'weight', 'status',
      'chunk_chain', 'chunk_count', 'server_seal', 'sealed_at',
    ];
    const arows = validateTable(
      parseCSV(attestCsv, 'Attestation'),
      requiredColumns,
      'Attestation',
    );
    const head = (arows[0] || []).map(normalizedHeader);
    if (head.length === requiredColumns.length && requiredColumns.every((name, index) => head[index] === name)) {
      const loggedAtCol = head.indexOf('logged_at_server');
      const dateCol = head.indexOf('date');
      const dayCol = head.indexOf('day');
      const eventCol = head.indexOf('event');
      const codeCol = head.indexOf('code');
      const kindCol = head.indexOf('kind');
      const videoHashCol = head.indexOf('video_sha256');
      const photoHashesCol = head.indexOf('photo_sha256s');
      const weightCol = head.indexOf('weight');
      const statusCol = head.indexOf('status');
      const chunkChainCol = head.indexOf('chunk_chain');
      const chunkCountCol = head.indexOf('chunk_count');
      const serverSealCol = head.indexOf('server_seal');
      const sealedAtCol = head.indexOf('sealed_at');
      const allowedKinds = new Set(['daily', 'corrective', 'weekly', 'confirmation', 'demo', 'announcement']);
      const hashPattern = /^[a-f0-9]{64}$/;
      for (const row of arows.slice(1)) {
        const date = normalizeDate(row[dateCol]);
        const event = String(row[eventCol] || '').trim();
        const code = String(row[codeCol] || '').trim();
        const kind = String(row[kindCol] || '').trim();
        const status = String(row[statusCol] || '').trim();
        const dayText = String(row[dayCol] || '').trim();
        const day = /^-?\d+$/.test(dayText) ? Number(dayText) : NaN;
        const videoHash = String(row[videoHashCol] || '').trim().toLowerCase();
        const photoHashText = String(row[photoHashesCol] || '').trim().toLowerCase();
        const photoHashes = photoHashText ? photoHashText.split(/\s+/) : [];
        const weightText = String(row[weightCol] || '').trim();
        const weight = weightText === '' ? null : Number(weightText);
        const chunkChain = String(row[chunkChainCol] || '').trim().toLowerCase();
        const chunkCountText = String(row[chunkCountCol] || '').trim();
        const chunkCount = /^\d+$/.test(chunkCountText) ? Number(chunkCountText) : NaN;
        const serverSeal = String(row[serverSealCol] || '').trim().toLowerCase();
        const loggedAtText = String(row[loggedAtCol] || '').trim();
        const sealedAtText = String(row[sealedAtCol] || '').trim();
        const loggedAt = new Date(loggedAtText);
        const sealedAt = new Date(sealedAtText);
        const stampedDateEt = Number.isNaN(sealedAt.getTime()) ? '' : todayEtIso(sealedAt);
        const loggedDateEt = Number.isNaN(loggedAt.getTime()) ? '' : todayEtIso(loggedAt);
        const normalizedWeight = weightText === '' || !Number.isFinite(weight) ? '' : String(Number(weightText));
        const sealMatches = !Number.isNaN(loggedAt.getTime()) && !Number.isNaN(sealedAt.getTime())
          && attestationSealMatches({
            loggedAt: loggedAt.toISOString(),
            date,
            day,
            event,
            code,
            kind,
            videoHash,
            photoHashes: photoHashes.join(' '),
            weight: normalizedWeight,
            status,
            chunkChain,
            chunkCount,
            sealedAt: sealedAt.toISOString(),
          }, serverSeal);
        const rowIsFullyValid = event === 'capture-attested'
          && status === 'VALID-CONSUMED'
          && allowedKinds.has(kind)
          && /^\d{4}$/.test(code)
          && isRealIsoDate(date)
          && date <= todayEtIso()
          && Number.isSafeInteger(day)
          && day >= 1
          && day === dayNumber(date)
          && hashPattern.test(videoHash)
          && photoHashes.every((value) => hashPattern.test(value))
          && (kind !== 'daily' || photoHashes.length === 4)
          && (weight === null || (Number.isFinite(weight) && weight > 0 && weight <= 1500))
          && hashPattern.test(chunkChain)
          && Number.isSafeInteger(chunkCount) && chunkCount >= 1 && chunkCount <= 21600
          && hashPattern.test(serverSeal)
          && sealMatches
          && loggedDateEt === date
          && stampedDateEt === date
          && sealedAt.getTime() >= loggedAt.getTime()
          && sealedAt.getTime() - loggedAt.getTime() <= 5 * 60 * 1000;
        if (!rowIsFullyValid) continue;
        rememberAcceptedAttestation(acceptedAttestationIdentities, date, kind, serverSeal);
        acceptedAttestations.push({
          date,
          kind,
          sealedAt: sealedAt.toISOString(),
          serverSeal,
          videoHash,
        });
        if (kind === 'daily' && date >= START_DATE) {
          attestMap.set(date, 'VALID-CONSUMED');
          publicAttestations.push({
            received_at: sealedAt.toISOString(),
            date,
            day,
            event: 'capture-attested',
            kind: 'daily',
            video_sha256: videoHash,
            photo_sha256s: photoHashes,
            status: 'VALID-CONSUMED',
          });
          // This is an attestation receipt time, not a packet-filing verdict.
          const rec = records.find((r) => r.date === date);
          if (rec && !rec.attestationAt) rec.attestationAt = sealedAt.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
          });
        }
      }
    } else throw new Error(`Attestation schema mismatch; expected ${requiredColumns.join(', ')}.`);
  }

  const confirmations = [];
  if (confirmationsCsv) {
    const requiredColumns = ['logged_at', 'date', 'version', 'day', 'url', 'attestation_seal'];
    const crows = validateTable(
      parseCSV(confirmationsCsv, 'Confirmations'),
      requiredColumns,
      'Confirmations',
    );
    const head = (crows[0] || []).map(normalizedHeader);
    if (head.length === requiredColumns.length && requiredColumns.every((name, index) => head[index] === name)) {
      const loggedAtCol = head.indexOf('logged_at');
      const dateCol = head.indexOf('date');
      const versionCol = head.indexOf('version');
      const dayCol = head.indexOf('day');
      const urlCol = head.indexOf('url');
      const attestationSealCol = head.indexOf('attestation_seal');
      const seenConfirmationKeys = new Set();
      for (const row of crows.slice(1)) {
        const date = normalizeDate(row[dateCol]);
        const versionText = String(row[versionCol] || '').trim();
        const version = /^\d+$/.test(versionText) ? Number(versionText) : NaN;
        if (version === 2 && isRealIsoDate(date)) {
          const key = `${version}|${date}`;
          if (seenConfirmationKeys.has(key)) {
            throw new Error(`Duplicate confirmation records for Edition ${version} on ${date}.`);
          }
          seenConfirmationKeys.add(key);
        }
        const dayText = String(row[dayCol] || '').trim();
        const day = /^-?\d+$/.test(dayText) ? Number(dayText) : NaN;
        const url = String(row[urlCol] || '').trim();
        const publicUrl = confirmationVideoUrl(url);
        const attestationSeal = String(row[attestationSealCol] || '').trim();
        const loggedAt = new Date(String(row[loggedAtCol] || '').trim());
        const loggedDateEt = Number.isNaN(loggedAt.getTime()) ? '' : todayEtIso(loggedAt);
        const accepted = acceptedAttestations.find((entry) => entry.date === date
          && entry.kind === 'confirmation' && entry.serverSeal === attestationSeal);
        const fingerprint = accepted ? agreementConfirmationFingerprint(
          version, date, publicUrl, attestationSeal, accepted.videoHash,
        ) : '';
        if (version === 2 && isRealIsoDate(date) && date <= todayEtIso()
          && Number.isSafeInteger(day) && day >= 1 && day === dayNumber(date)
          && loggedDateEt === date && publicUrl && /^[a-f0-9]{64}$/.test(attestationSeal)
          && accepted && fingerprint) {
          confirmations.push({
            version,
            date,
            day,
            url: publicUrl,
            attestationSeal,
            videoHash: accepted.videoHash,
            fingerprint,
            attestationVerified: true,
          });
        }
      }
    } else throw new Error(`Confirmations schema mismatch; expected ${requiredColumns.join(', ')}.`);
  }
  confirmations.sort((a, b) => a.date.localeCompare(b.date));
  /* agreement_edition asserts activation and therefore requires a complete,
     exact tuple; only a deliberately cleared edition may publish inactive. */
  const agreementGate = agreementExecutionGate(siteState, confirmations, START_DATE, todayEtIso());
  const agreementExecutionActive = agreementGate.active;
  const bannerMode = String((siteState && siteState.banner_mode) || 'auto').toLowerCase();
  const violationAuto = !!((agreementExecutionActive && violations.some((v) => v.state === 'open')));
  VIOLATION_MODE = bannerMode === 'off' ? null : (bannerMode === 'on' || violationAuto) ? cornerSummaryForShell(violations) : null;
  if (siteState) siteState.violation_mode_effective = VIOLATION_MODE ? 'true' : 'false';
  const agreementEffectiveDate = agreementGate.effectiveDate;
  const reviewedConfirmationFingerprint = agreementGate.reviewedConfirmationFingerprint;
  siteState.agreement_execution_active = agreementExecutionActive ? 'true' : 'false';
  siteState.agreement_effective_date = agreementEffectiveDate;
  violations = agreementExecutionActive
    ? violations.filter((entry) => entry.state && entry.eventVerifiedAt
      && agreementAppliesOn(entry.date, true, agreementEffectiveDate))
    : [];
  assertUniqueViolationIdentities(violations);
  const publicSupervisionUrlsEnabled = agreementExecutionActive
    && process.env.PUBLIC_SUPERVISION_URLS_ENABLED === 'true';

  CARD_CTX = {
    rows: records,
    violations,
    supervision,
    agreementActive: agreementExecutionActive,
    agreementEffectiveDate,
  };
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

  await resetGeneratedOutput();

  /* Every Project Day from 1 to the latest documented one, in order — days
     with a complete packet and days without. The chain is built over this
     list, so prev/next is continuous and a crawler never sees Day 10 link
     straight to Day 13. */
  const todayIso = todayEtIso();
  const lastDay = Math.max(
    finalized.at(-1)?.record.day || 0,
    ...records.map((r) => r.day || 0),
    dayNumber(todayIso),
  );
  const byDay = new Map(finalized.map((f) => [f.record.day, f]));
  const rowByDay = new Map(records.map((r) => [r.day, r]));
  const sequence = [];
  for (let d = 1; d <= lastDay; d++) {
    const done = byDay.get(d);
    if (done) {
      sequence.push({
        day: d,
        date: done.record.date,
        complete: true,
        entry: done,
        kind: 'files',
        photoCount: 4,
        obligationActive: agreementAppliesOn(done.record.date, agreementExecutionActive, agreementEffectiveDate),
      });
      continue;
    }
    const row = rowByDay.get(d);
    const date = row ? row.date : dateForDay(d);
    // Say precisely what is absent — a missing video reads differently from
    // a day with nothing filed at all.
    const have = [];
    const missing = [];
    (row && row.weight ? have : missing).push('the recorded weight');
    (row && row.video ? have : missing).push('the inspection video');
    const photoCount = ['front', 'left', 'rear', 'right']
      .filter((a) => findPhoto(photoFiles, row ? row.date : dateForDay(d), d, a)).length;
    (photoCount === 4 ? have : missing).push(photoCount ? photoCount + ' of the four accountability photographs' : 'the four accountability photographs');
    const obligationActive = agreementAppliesOn(date, agreementExecutionActive, agreementEffectiveDate);
    const pending = obligationActive && deadlinePending(date);
    const reason = !obligationActive
      ? have.length
        ? 'Current public files present: ' + have.join(', ') + '. Missing from the current public record: ' + missing.join(', ') + '. No filing requirement was active for this date.'
        : 'No public packet files are currently present. No filing requirement was active for this date.'
      : pending
        ? 'The active filing window closes at 10:00 PM Eastern. No adverse outcome is recorded while that window remains open.'
        : have.length
          ? 'Current public files present: ' + have.join(', ') + '. Missing from the current public record: ' + missing.join(', ') + '. Current presence does not establish filing timeliness, and no immutable deadline verdict is recorded.'
          : 'No public packet files are currently present. No immutable deadline verdict is recorded, so no compliance outcome is inferred from current file presence.';
    sequence.push({
      day: d,
      date,
      complete: false,
      kind: pending ? 'pending' : have.length ? 'partial' : 'none',
      reason,
      photoCount,
      obligationActive,
    });
  }

  const generated = [];
  const changedUrls = new Set();
  const publishedAt = buildNow().toISOString();
  if (await writeIfChanged(path.join(ROOT, 'data', 'feed-manifest.json'), JSON.stringify({
    schema_version: 1,
    published_at: publishedAt,
    project_start_date: START_DATE,
    agreement_active: agreementExecutionActive,
    agreement_effective_date: agreementEffectiveDate,
  }, null, 2) + '\n')) changedUrls.add(`${SITE_ORIGIN}/data/feed-manifest.json`);
  const publicSupervision = Object.fromEntries(supervision
    .filter((session) => session.date <= todayEtIso())
    .map((session) => {
      const applies = agreementAppliesOn(session.date, agreementExecutionActive, agreementEffectiveDate);
      return [session.date, {
        required: applies && session.required,
        status: applies && session.required ? publicSupervisionStatus(session.status) : '',
      }];
    }));
  if (await writeIfChanged(path.join(ROOT, 'data', 'attestations.json'), JSON.stringify({
    schema_version: 1,
    published_at: publishedAt,
    limitations: 'Server-sealed, structurally validated client-reported hashes from exact VALID-CONSUMED capture-attested rows. The deploy verifies HMAC integrity, but the record does not independently establish identity, capture circumstances, or packet-filing timeliness.',
    records: publicAttestations,
  }, null, 2) + '\n')) changedUrls.add(`${SITE_ORIGIN}/data/attestations.json`);
  if (await writeIfChanged(path.join(ROOT, 'data', 'supervision.json'), JSON.stringify({
    schema_version: 1,
    agreement_active: agreementExecutionActive,
    published_at: publishedAt,
    sessions: publicSupervision,
  }, null, 2) + '\n')) changedUrls.add(`${SITE_ORIGIN}/data/supervision.json`);
  const publicViolationRows = violations.map((entry) => [
    entry.id, entry.date, entry.what, entry.state, entry.submitted, entry.resolved,
    entry.verification, entry.corrections.join('; '), entry.recording, publishedAt,
  ]);
  if (await writeIfChanged(path.join(ROOT, 'data', 'violations.csv'), csvDocument(
    ['id', 'date', 'violation', 'status', 'submitted', 'resolved', 'ap_verification', 'corrections', 'recording', 'published_at'],
    publicViolationRows,
  ))) changedUrls.add(`${SITE_ORIGIN}/data/violations.csv`);
  for (let i = 0; i < finalized.length; i++) {
    const { record, photoPaths } = finalized[i];
    const photos = {};
    for (const [angle, source] of Object.entries(photoPaths)) {
      photos[angle] = await generateResponsive(source, record.date, angle, record.day);
      photos[angle].changedUrls.forEach((u) => changedUrls.add(u));
    }
    const pos = sequence.findIndex((s) => s.day === record.day);
    const previous = pos > 0 ? sequence[pos - 1] : null;
    const next = pos >= 0 && pos < sequence.length - 1 ? sequence[pos + 1] : null;
    const pageDir = path.join(ROOT, 'daily', `${record.date}-day-${String(record.day).padStart(3, '0')}`);
    const pageFile = path.join(pageDir, 'index.html');
    const page = dailyPage({ record, photos, previous, next, attestation: attestMap.get(record.date) || '' });
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
        video_url: record.video ? new URL(record.video, SITE_ORIGIN).href : '',
        evidence: { original_r2_key: record.r2Key || null, stream_uid: record.streamUid || null, stream_playback: record.streamUid ? streamHls(record.streamUid) : null, youtube_mirror: record.video && !isSelfHosted(record.video) ? record.video : null },
        canonical_url: `${SITE_ORIGIN}/daily/${record.date}-day-${String(record.day).padStart(3, '0')}/`,
        attestation: attestMap.get(record.date) || null,
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
    {
      const g = generated.at(-1);
      const gPrev = generated.at(-2);
      const wp = watchPage({ record: g.record, photos: g.photos, previous: gPrev ? gPrev.record : null, next: null });
      if (wp) {
        const wdir = path.join(ROOT, 'daily', `${g.record.date}-day-${String(g.record.day).padStart(3, '0')}`, 'video');
        if (await writeIfChanged(path.join(wdir, 'index.html'), wp)) changedUrls.add(`${SITE_ORIGIN}/daily/${g.record.date}-day-${String(g.record.day).padStart(3, '0')}/video/`);
      }
    }
  }

  const generatedByDate = new Map(generated.map((entry) => [entry.record.date, entry]));
  const publicWeighIns = records.map((record) => {
    const entry = generatedByDate.get(record.date);
    const photoUrls = ['front', 'left', 'rear', 'right']
      .map((angle) => publicPhotoDerivative(entry?.photos?.[angle]));
    return [
      record.date,
      record.weight,
      record.note,
      ...photoUrls,
      publicVideoUrl(record.video),
      publishedAt,
    ];
  });
  if (await writeIfChanged(path.join(ROOT, 'data', 'weigh-ins.csv'), csvDocument(
    ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video', 'published_at'],
    publicWeighIns,
  ))) changedUrls.add(`${SITE_ORIGIN}/data/weigh-ins.csv`);

  /* Card PNGs — one per Project Day, the shareable unit. Regenerated each
     build so a verdict change (violation declared, corrected) re-renders. */
  for (const s of sequence) {
    try {
      const done = s.complete ? byDay.get(s.day) : null;
      // A partial packet may contain a source photo, but it is not eligible to
      // appear in a public card until all packet media is present.
      const photoPath = done ? done.photoPaths.front : null;
      const cc = cardCtx(s.day, { date: s.date, complete: s.complete, photoCount: s.complete ? 4 : (s.photoCount || 0), photo: photoPath ? { path: photoPath } : null });
      const u = await writeCard(cc);
      changedUrls.add(u);
    } catch (e) { throw new Error('Card image failed for ' + s.date + ': ' + e.message); }
  }

  for (let i = 0; i < sequence.length; i++) {
    const s = sequence[i];
    if (s.complete) continue;
    const slug = `${s.date}-day-${String(s.day).padStart(3, '0')}`;
    const file = path.join(ROOT, 'daily', slug, 'index.html');
    const page = noRecordPage({
      date: s.date, day: s.day, reason: s.reason, kind: s.kind || 'none', photoCount: s.photoCount || 0,
      obligationActive: s.obligationActive,
      previous: i > 0 ? sequence[i - 1] : null,
      next: i < sequence.length - 1 ? sequence[i + 1] : null,
    });
    if (await writeIfChanged(file, page)) changedUrls.add(`${SITE_ORIGIN}/daily/${slug}/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'daily', 'index.html'), dailyIndexPage(
    generated,
    new Map(sequence.map((s) => [s.date, {
      kind: s.kind || (s.complete ? 'files' : 'none'),
      photoCount: s.photoCount || 0,
      obligationActive: s.obligationActive,
    }])),
    new Map(violations.map((v) => [v.date, v.state])),
    agreementExecutionActive,
    agreementEffectiveDate,
    violations,
  ))) {
    changedUrls.add(`${SITE_ORIGIN}/daily/`);
  }

  const extraUrls = [];
  for (const target of MILESTONES) {
    const file = path.join(ROOT, 'milestones', `${target}-lb`, 'index.html');
    if (await writeIfChanged(file, milestonePage(target, generated))) changedUrls.add(`${SITE_ORIGIN}/milestones/${target}-lb/`);
    extraUrls.push(`${SITE_ORIGIN}/milestones/${target}-lb/`);
  }
  const maxWeek = Math.ceil(lastDay / 7);
  for (let w = 1; w <= maxWeek; w++) {
    const inWeek = generated.filter(({ record }) => Math.ceil(record.day / 7) === w);
    const file = path.join(ROOT, 'weeks', `week-${String(w).padStart(2, '0')}`, 'index.html');
    if (await writeIfChanged(file, weekPage(w, inWeek, generated, maxWeek))) changedUrls.add(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
    extraUrls.push(`${SITE_ORIGIN}/weeks/week-${String(w).padStart(2, '0')}/`);
  }
  if (await writeIfChanged(path.join(ROOT, 'weeks', 'index.html'), weeksIndexPage(generated, lastDay))) changedUrls.add(`${SITE_ORIGIN}/weeks/`);

  /* A revoked or later-dated gate must not leave a previously generated
     adverse page reachable. Only machine-named violation directories are
     pruned; the index itself is rewritten below. */
  const allowedViolationSlugs = new Set(violations.map((entry) => entry.slug));
  const violationRoot = path.join(ROOT, 'violations');
  if (await exists(violationRoot)) {
    for (const item of await fs.readdir(violationRoot, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^v-(?:\d{3,}|[a-f0-9]{12})$/.test(item.name) || allowedViolationSlugs.has(item.name)) continue;
      await fs.rm(path.join(violationRoot, item.name), { recursive: true, force: true });
    }
  }
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i];
    const page = violationPage(v, violations[i - 1] || null, violations[i + 1] || null);
    if (await writeIfChanged(path.join(ROOT, 'violations', v.slug, 'index.html'), page)) {
      changedUrls.add(`${SITE_ORIGIN}/violations/${v.slug}/`);
    }
  }
  if (violations.length) console.log('Violation entries published: ' + violations.length);

  if (await writeIfChanged(path.join(ROOT, 'violations', 'index.html'), violationsIndexPage(violations))) {
    changedUrls.add(`${SITE_ORIGIN}/violations/`);
  }
  extraUrls.push(`${SITE_ORIGIN}/violations/`);

  if (await writeIfChanged(path.join(ROOT, 'positions', 'index.html'), positionsPage(generated, siteState))) {
    changedUrls.add(`${SITE_ORIGIN}/positions/`);
  }

  const demoUrl = publicVideoUrl(siteState.demo_video_url || siteState.ytfiled || siteState.demo_url || '');
  if (await writeIfChanged(path.join(ROOT, 'corrections', 'index.html'), cornerTimePage(generated, violations, demoUrl))) {
    changedUrls.add(`${SITE_ORIGIN}/corrections/`);
  }
  extraUrls.push(`${SITE_ORIGIN}/corrections/`);

  if (await writeIfChanged(path.join(ROOT, 'live', 'index.html'), livePage(
    supervision,
    violations,
    agreementExecutionActive,
    agreementEffectiveDate,
    publicSupervisionUrlsEnabled,
  ))) {
    changedUrls.add(`${SITE_ORIGIN}/live/`);
  }
  extraUrls.push(`${SITE_ORIGIN}/live/`);

  if (await writeIfChanged(path.join(ROOT, 'protocol', 'index.html'), protocolPage())) changedUrls.add(`${SITE_ORIGIN}/protocol/`);
  extraUrls.push(`${SITE_ORIGIN}/protocol/`);
  if (await writeIfChanged(path.join(ROOT, 'tf060', 'index.html'), tf060Page())) changedUrls.add(`${SITE_ORIGIN}/tf060/`);
  if (await writeIfChanged(path.join(ROOT, 'faq', 'index.html'), await faqPage())) changedUrls.add(`${SITE_ORIGIN}/faq/`);
  extraUrls.push(`${SITE_ORIGIN}/faq/`);
  extraUrls.push(`${SITE_ORIGIN}/tf060/`);
  if (await writeIfChanged(path.join(ROOT, 'report', 'index.html'), observerPage())) {
    changedUrls.add(`${SITE_ORIGIN}/report/`);
  }
  ;
  await writeIfChanged(path.join(ROOT, 'report', 'received', 'index.html'), observerReceivedPage());
  {
    const longDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
    const s = sequence.filter((x) => x.complete).at(-1);
    const last = records.at(-1);
    const nowEt = buildNow().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const shareData = {
      today: dayNumber(todayEtIso()),
      latest: s ? { day: s.day, date: s.date, dateLong: longDate(s.date), page: `/daily/${s.date}-day-${String(s.day).padStart(3, '0')}/`, png: `/cards/${s.date}.png` } : null,
      weight: last ? last.weight.toFixed(1) : '',
      weightDate: last ? longDate(last.date) : '',
      open: violations.filter((v) => v.state !== 'resolved').length,
      agreementActive: agreementExecutionActive,
      agreementEffectiveDateLong: agreementEffectiveDate ? longDate(agreementEffectiveDate) : '',
      asOf: nowEt,
      published: nowEt,
    };
    if (await writeIfChanged(path.join(ROOT, 'share', 'index.html'), sharePage(shareData))) changedUrls.add(`${SITE_ORIGIN}/share/`);
    extraUrls.push(`${SITE_ORIGIN}/share/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'consent', 'index.html'), consentPage(
    confirmations,
    agreementExecutionActive,
    agreementEffectiveDate,
    reviewedConfirmationFingerprint,
  ))) {
    changedUrls.add(`${SITE_ORIGIN}/consent/`);
  }
  extraUrls.push(`${SITE_ORIGIN}/consent/`);

  /* The public shell — home, dashboard, milestones, uniform,
     updates, about, agreement — rendered from site.template.html with every
     hole filled from the record. Zero template braces reach a visitor. */
  for (const [slug, html] of await buildStaticSite(staticCtx({ rows, violations, updates, siteState, attestMap: Object.fromEntries(attestMap), photoFiles }))) {
    if (await writeIfChanged(path.join(ROOT, slug, 'index.html'), html)) changedUrls.add(slug ? `${SITE_ORIGIN}/${slug}/` : `${SITE_ORIGIN}/`);
  }

  if (await writeIfChanged(path.join(ROOT, 'feed.xml'), rssFeed(generated))) {
    changedUrls.add(`${SITE_ORIGIN}/feed.xml`);
  }

  const latestDate = generated.at(-1)?.record.date || START_DATE;
  const sitemapFiles = [
    ['sitemap-static.xml', staticSitemap(latestDate)],
    ['sitemap-violations.xml', violationSitemap(violations)],
    ['sitemap-daily.xml', dailySitemap(sequence.map((s) => ({ date: s.date, day: s.day })))],
    ['sitemap-pages.xml', extraSitemap(extraUrls.filter((u) => !new Set(STATIC_PAGES.map(([slug]) => `${SITE_ORIGIN}/${slug}`)).has(u)), latestDate)],
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
    await fs.appendFile(output, `page_count=${generated.length}\n`);
    await fs.appendFile(output, `latest_url=${generated.at(-1) ? `${SITE_ORIGIN}/daily/${generated.at(-1).record.date}-day-${String(generated.at(-1).record.day).padStart(3, '0')}/` : SITE_ORIGIN}\n`);
  }
  console.log(`Finalized records published: ${generated.length}`);
  console.log(`IndexNow candidate URLs: ${changedUrls.size}`);
}

if (process.argv.includes('--self-test')) {
  const eventDate = '2026-09-10';
  const text = 'Exact reviewed event wording';
  const digest = sha256(Buffer.from(`violation-v1\n${eventDate}\n${text}`, 'utf8'));
  const marker = `APV1|2026-09-11|${digest}`;
  const approval = verifiedViolation(marker, eventDate, text, '2026-09-12');
  const resolutionDate = '2026-09-12';
  const resolutionDigest = sha256(Buffer.from(`violation-resolution-v1\n${marker}\n${resolutionDate}`, 'utf8'));
  const resolutionMarker = `APR1|${resolutionDate}|${resolutionDigest}`;
  const identity = publicViolationIdentity(approval?.digest);
  const otherIdentity = publicViolationIdentity(sha256(Buffer.from('different verified violation', 'utf8')));
  const confirmationSeal = 'a'.repeat(64);
  const confirmationVideoHash = 'b'.repeat(64);
  const confirmationFingerprint = agreementConfirmationFingerprint(
    2, '2026-09-12', 'https://youtu.be/AAAAAAAAAAA', confirmationSeal, confirmationVideoHash,
  );
  const verifiedConfirmationEvidence = {
    version: 2,
    date: '2026-09-12',
    url: 'https://youtu.be/AAAAAAAAAAA',
    attestationSeal: confirmationSeal,
    videoHash: confirmationVideoHash,
    fingerprint: confirmationFingerprint,
    attestationVerified: true,
  };
  const completeActivationState = {
    agreement_edition: '2',
    mrb_signature_verified_at: '2026-09-11',
    ap_signature_verified_at: '2026-09-11',
    agreement_confirmation_date: '2026-09-12',
    agreement_confirmation_verified_at: '2026-09-12',
    agreement_confirmation_fingerprint: confirmationFingerprint,
  };
  const rejectsOperation = (operation) => {
    try {
      operation();
      return false;
    } catch {
      return true;
    }
  };
  const validGate = agreementExecutionGate(
    completeActivationState,
    [verifiedConfirmationEvidence],
    '2026-09-10',
    '2026-09-12',
  );
  const completeInvalidGateRejected = rejectsOperation(() => agreementExecutionGate(
      { ...completeActivationState, agreement_confirmation_fingerprint: 'c'.repeat(64) },
      [verifiedConfirmationEvidence],
      '2026-09-10',
      '2026-09-12',
    ));
  const completeUnverifiedGateRejected = rejectsOperation(() => agreementExecutionGate(
      completeActivationState,
      [{ ...verifiedConfirmationEvidence, attestationVerified: false }],
      '2026-09-10',
      '2026-09-12',
    ));
  const incompleteGateRejected = rejectsOperation(() => agreementExecutionGate(
    { ...completeActivationState, agreement_confirmation_fingerprint: '' },
    [],
    '2026-09-10',
    '2026-09-12',
  ));
  const impossibleDateGateRejected = rejectsOperation(() => agreementExecutionGate(
    { ...completeActivationState, mrb_signature_verified_at: '2026-02-30' },
    [verifiedConfirmationEvidence],
    '2026-09-10',
    '2026-09-12',
  ));
  const shortFingerprintGateRejected = rejectsOperation(() => agreementExecutionGate(
    { ...completeActivationState, agreement_confirmation_fingerprint: 'a'.repeat(63) },
    [verifiedConfirmationEvidence],
    '2026-09-10',
    '2026-09-12',
  ));
  const unsupportedEditionRejected = rejectsOperation(() => agreementExecutionGate(
    { ...completeActivationState, agreement_edition: '3' },
    [verifiedConfirmationEvidence],
    '2026-09-10',
    '2026-09-12',
  ));
  const paddedEditionRejected = rejectsOperation(() => agreementExecutionGate(
    { ...completeActivationState, agreement_edition: ' 2 ' },
    [verifiedConfirmationEvidence],
    '2026-09-10',
    '2026-09-12',
  ));
  const noncanonicalConfirmationRejected = rejectsOperation(() => agreementExecutionGate(
    completeActivationState,
    [{ ...verifiedConfirmationEvidence, url: 'https://youtu.be/AAAAAAAAAAA/' }],
    '2026-09-10',
    '2026-09-12',
  ));
  const uppercaseConfirmationSealRejected = rejectsOperation(() => agreementExecutionGate(
    completeActivationState,
    [{ ...verifiedConfirmationEvidence, attestationSeal: confirmationSeal.toUpperCase() }],
    '2026-09-10',
    '2026-09-12',
  ));
  const clearedGate = agreementExecutionGate({}, [], '2026-09-10', '2026-09-12');
  const rejectsCsv = rejectsOperation;
  const validQuotedCsv = parseCSV(
    'first,second\r\n"line 1\r\nline 2","say ""yes"""\r\n',
    'Self-test valid CSV',
  );
  const unclosedQuoteRejected = rejectsCsv(() => parseCSV('first,second\r\n"unclosed,value\r\n', 'Self-test'));
  const embeddedQuoteRejected = rejectsCsv(() => parseCSV('first,second\r\nun"quoted,value\r\n', 'Self-test'));
  const postQuoteCharacterRejected = rejectsCsv(() => parseCSV('first,second\r\n"closed"x,value\r\n', 'Self-test'));
  const rowArityRejected = rejectsCsv(() => validateTable(
    parseCSV('first,second\r\none,two,three\r\n', 'Self-test'),
    ['first', 'second'],
    'Self-test',
  ));
  const delimiterOnlyArityRejected = rejectsCsv(() => validateTable(
    parseCSV('first,second\r\n,\r\n,,\r\n', 'Self-test'),
    ['first', 'second'],
    'Self-test',
  ));
  const acceptedAttestationIdentities = new Set();
  let distinctAcceptedAttestationsAllowed = true;
  let duplicateAcceptedAttestationRejected = false;
  try {
    rememberAcceptedAttestation(acceptedAttestationIdentities, '2026-09-12', 'confirmation', 'a'.repeat(64));
    rememberAcceptedAttestation(acceptedAttestationIdentities, '2026-09-12', 'confirmation', 'b'.repeat(64));
  } catch {
    distinctAcceptedAttestationsAllowed = false;
  }
  try {
    rememberAcceptedAttestation(acceptedAttestationIdentities, '2026-09-12', 'confirmation', 'a'.repeat(64));
  } catch {
    duplicateAcceptedAttestationRejected = true;
  }
  let duplicateRejected = false;
  try {
    assertUniqueViolationIdentities([
      { id: identity?.id, slug: identity?.slug },
      { id: identity?.id, slug: identity?.slug },
    ]);
  } catch {
    duplicateRejected = true;
  }
  const cases = [
    [verifiedViolationDate(marker, eventDate, text, '2026-09-12') === '2026-09-11', 'valid marker rejected'],
    [verifiedViolationDate(marker, eventDate, `${text}.`, '2026-09-12') === '', 'edited text accepted'],
    [verifiedViolationDate(marker, '2026-09-09', text, '2026-09-12') === '', 'copied marker accepted'],
    [verifiedViolationDate(marker, eventDate, text, '2026-09-10') === '', 'future verification accepted'],
    [verifiedViolationDate(`APV1|2026-09-09|${digest}`, eventDate, text, '2026-09-12') === '', 'pre-event verification accepted'],
    [verifiedViolationDate('APV1|bad', eventDate, text, '2026-09-12') === '', 'malformed marker accepted'],
    [Boolean(verifiedViolationResolution(resolutionMarker, resolutionDate, marker, eventDate, approval?.verifiedAt, '2026-09-12')), 'valid resolution marker rejected'],
    [!verifiedViolationResolution(resolutionMarker, resolutionDate, `${marker}x`, eventDate, approval?.verifiedAt, '2026-09-12'), 'resolution marker accepted for a different event'],
    [!verifiedViolationResolution(resolutionMarker, resolutionDate, marker, eventDate, approval?.verifiedAt, '2026-09-11'), 'future resolution marker accepted'],
    [Boolean(identity && /^V-[0-9A-F]{12}$/.test(identity.id) && /^v-[0-9a-f]{12}$/.test(identity.slug)), 'opaque public identity malformed'],
    [publicViolationIdentity(digest)?.id === identity?.id, 'opaque public identity is not stable'],
    [otherIdentity?.id !== identity?.id, 'distinct digests produced the same test identity'],
    [duplicateRejected, 'duplicate public identities were accepted'],
    [/^[a-f0-9]{64}$/.test(confirmationFingerprint), 'valid confirmation fingerprint rejected'],
    [agreementConfirmationFingerprint(2, '2026-09-12', 'https://youtu.be/BBBBBBBBBBB', confirmationSeal, confirmationVideoHash) !== confirmationFingerprint, 'confirmation fingerprint did not bind the URL'],
    [agreementConfirmationFingerprint(2, '2026-09-12', 'https://youtu.be/AAAAAAAAAAA', 'c'.repeat(64), confirmationVideoHash) !== confirmationFingerprint, 'confirmation fingerprint did not bind the attestation seal'],
    [validGate.active && validGate.effectiveDate === '2026-09-12', 'complete valid activation tuple did not activate'],
    [completeInvalidGateRejected, 'complete activation tuple with mismatched fingerprint published inactive'],
    [completeUnverifiedGateRejected, 'complete activation tuple without HMAC-verified evidence published inactive'],
    [incompleteGateRejected, 'asserted activation with a blank field published inactive'],
    [impossibleDateGateRejected, 'asserted activation with an impossible date published inactive'],
    [shortFingerprintGateRejected, 'asserted activation with a malformed fingerprint published inactive'],
    [unsupportedEditionRejected, 'unsupported agreement edition published inactive'],
    [paddedEditionRejected, 'non-canonical agreement edition published inactive'],
    [noncanonicalConfirmationRejected, 'non-canonical confirmation URL preserved an active gate'],
    [uppercaseConfirmationSealRejected, 'uppercase confirmation seal preserved an active gate'],
    [!clearedGate.active && !clearedGate.activationTupleComplete, 'cleared activation tuple did not publish inactive'],
    [confirmationVideoUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA') === 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'canonical www confirmation URL rejected'],
    [confirmationVideoUrl('https://youtube.com/watch?v=AAAAAAAAAAA') === 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'canonical no-www confirmation URL was not normalized'],
    [confirmationVideoUrl('https://youtu.be/AAAAAAAAAAA') === 'https://youtu.be/AAAAAAAAAAA', 'canonical short confirmation URL rejected'],
    [confirmationVideoUrl('https://youtu.be/AAAAAAAAAAA/') === '', 'confirmation URL with a trailing slash accepted'],
    [confirmationVideoUrl('https://YOUTUBE.com/watch?v=AAAAAAAAAAA') === '', 'uppercase confirmation hostname accepted'],
    [confirmationVideoUrl('https://youtu.be/AAAAAAAAAA%41') === '', 'percent-encoded confirmation ID accepted'],
    [confirmationVideoUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA&t=1') === '', 'confirmation URL with an extra query accepted'],
    [confirmationVideoUrl('https://youtu.be/AAAAAAAAAAA#fragment') === '', 'confirmation URL with a fragment accepted'],
    [validQuotedCsv.length === 2 && validQuotedCsv[1][0] === 'line 1\r\nline 2' && validQuotedCsv[1][1] === 'say "yes"', 'valid escaped quotes or CRLF were not preserved'],
    [unclosedQuoteRejected, 'unclosed quoted field was accepted'],
    [embeddedQuoteRejected, 'quote inside an unquoted field was accepted'],
    [postQuoteCharacterRejected, 'character after a closing quote was accepted'],
    [rowArityRejected, 'row with unexpected column count was accepted'],
    [delimiterOnlyArityRejected, 'delimiter-only row bypassed column-count validation'],
    [distinctAcceptedAttestationsAllowed, 'distinct accepted attestation seals were treated as duplicates'],
    [duplicateAcceptedAttestationRejected, 'duplicate accepted date/kind/server-seal identity was accepted'],
  ];
  const failed = cases.find(([ok]) => !ok);
  if (failed) throw new Error(`Publisher self-test failed: ${failed[1]}`);
  console.log('Publisher self-test passed: CSV and activation evidence fail closed; approvals bind exact records; opaque public identities are stable and unique.');
} else {
  main().catch((error) => {
    console.error('Publisher failed:', error);
    process.exitCode = 1;
  });
}
