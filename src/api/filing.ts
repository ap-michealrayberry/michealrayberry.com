/* Filing API (role mrb): file-only. Nothing here edits, resolves or deletes an
   entry of record; existing files are never replaced (contract §3, §10).
   Ported from Code.gs (challenge, attest, packet, weeklyfiled,
   confirmationfiled, correctivefiled) and the Pages Functions
   (stream-upload, media-put), with Cloudflare Access in place of the device
   key and unlock code. Contract differences from Code.gs:
   - §4: a packet filed after 10:00 PM is accepted and stays with its date;
     receipts record when each component arrived, for AP review.
   - §8: a corrective session filed after its 72-hour deadline is accepted as
     evidence; whether the deadline was met is the AP's review.
   - §7: the Weekly Review is filed on Mondays and covers the active dates of
     the preceding seven days. */
import type { Context } from 'hono';
import {
  appliesOn, dayNumber, DAY_ONE, EDITION, etDate, etWallTime, isIsoDate, MILESTONES, weekday,
  type AgreementGate,
} from '../rules';
import { loadGate, loadSiteState } from '../state';
import { appendEvent, sha256Hex } from '../events';
import { buildSoon } from '../build';
import { mailAP } from '../mail';
import type { Identity } from '../auth/access';

type Who = Extract<Identity, { ok: true }>;
export type Ctx = Context<{ Bindings: Env; Variables: { who: Who } }>;

const HEX64 = /^[a-f0-9]{64}$/;
const REF = /^V-[A-F0-9]{12}$/;
const ASSIGNMENT = /^C-[A-F0-9]{24}$/;
const ATTEMPT = /^A-[A-F0-9]{24}$/;
const CAPTURE_KINDS = ['daily', 'corrective', 'weekly', 'confirmation', 'milestone', 'demo', 'announcement'] as const;
type CaptureKind = (typeof CAPTURE_KINDS)[number];
/* Kinds that document the project itself rather than a requirement: allowed before activation. */
const UNGATED: CaptureKind[] = ['confirmation', 'demo', 'announcement'];
const CHALLENGE_TTL_MS = 90 * 60 * 1000;
const ANGLES = ['front', 'left', 'rear', 'right'] as const;

export class FilingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400, readonly extra: Record<string, unknown> = {}) { super(message); }
}
const fail = (message: string, status: 400 | 403 | 404 | 409 = 400, extra: Record<string, unknown> = {}) => {
  throw new FilingError(message, status, extra);
};

export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Ported verbatim from Code.gs attestationSealPayload (domain MRB_ATTESTATION_SEAL_V2). */
export function sealPayload(f: {
  loggedAt: string; date: string; day: number; code: string; kind: string; videoHash: string;
  photoHashes: string; weight: string; chunkChain: string; chunkCount: number; sealedAt: string;
}): string {
  return JSON.stringify(['MRB_ATTESTATION_SEAL_V2', f.loggedAt, f.date, String(f.day), 'capture-attested', f.code, f.kind,
    f.videoHash, f.photoHashes, f.weight, 'VALID-CONSUMED', f.chunkChain, String(f.chunkCount), f.sealedAt]);
}

/** Canonical Cloudflare Stream player URL and its video uid, or null. */
export function streamUrl(raw: unknown): { url: string; uid: string } | null {
  const s = String(raw ?? '').trim();
  let m = s.match(/^https:\/\/(customer-[a-z0-9]+)\.cloudflarestream\.com\/([a-f0-9]{32})\/(?:iframe|watch)$/);
  if (m) return { url: `https://${m[1]}.cloudflarestream.com/${m[2]}/iframe`, uid: m[2] };
  m = s.match(/^https:\/\/iframe\.videodelivery\.net\/([a-f0-9]{32})$/);
  return m ? { url: s, uid: m[1] } : null;
}

function captureKind(raw: unknown): CaptureKind {
  const k = String(raw ?? '').trim() as CaptureKind;
  if (!CAPTURE_KINDS.includes(k)) fail('Unknown capture kind.');
  return k;
}

async function body(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid request.');
    return value as Record<string, unknown>;
  } catch (e) {
    if (e instanceof FilingError) throw e;
    return fail('Invalid request.');
  }
}

async function gateFor(env: Env, now: Date): Promise<AgreementGate> {
  return loadGate(env.DB, now);
}

function requireActive(gate: AgreementGate, date: string) {
  if (!appliesOn(date, gate)) fail('agreement execution inactive', 403, { missing: gate.missing });
}

const actor = (c: Ctx) => `${c.get('who').role}:${c.get('who').email}`;

async function record(c: Ctx, action: string, subject: string | null, payload: unknown, build = true) {
  await appendEvent(c.env.DB, { actor: actor(c), action, subject, payload });
  if (build) c.executionCtx.waitUntil(buildSoon(c.env, action));
}

interface AttestationRow { id: number; date: string; day: number; kind: string; code: string; video_sha256: string; photo_sha256s: string; weight: number | null; server_seal: string; sealed_at: string; logged_at: string }

/** The accepted attestation of `kind` on `date` with this seal (from /api/attest). */
async function filingAttestation(env: Env, date: string, kind: CaptureKind, seal: unknown): Promise<AttestationRow> {
  const s = String(seal ?? '').trim().toLowerCase();
  if (!HEX64.test(s)) fail('A valid attestation seal is required.');
  const row = await env.DB.prepare(
    "SELECT * FROM attestations WHERE date = ? AND kind = ? AND server_seal = ? AND event = 'capture-attested' AND status = 'VALID-CONSUMED'",
  ).bind(date, kind, s).first<AttestationRow>();
  if (!row) fail(`No accepted ${kind} attestation on ${date} matches the supplied seal.`);
  return row!;
}

// ───────────────────────────── challenge ─────────────────────────────

export async function challenge(c: Ctx) {
  const b = await body(c);
  const now = new Date();
  const today = etDate(now);
  const kind = captureKind(b.kind);
  const gate = await gateFor(c.env, now);
  if (!UNGATED.includes(kind)) requireActive(gate, today);
  const day = dayNumber(today);
  if (day < 1) fail('The project has not started.');

  let context: string | null = null;
  const echo: Record<string, string> = {};
  if (kind === 'corrective') {
    const target = await correctiveTarget(c.env, b.ref, b.assignment_id, b.attempt_id);
    if (target.recordingOnFile) fail('A corrective recording is already on file.', 409);
    context = `CTX3|${target.ref}|${target.assignmentId}|${target.attemptId}`;
    Object.assign(echo, { ref: target.ref, assignment_id: target.assignmentId, attempt_id: target.attemptId });
  } else if (kind === 'milestone') {
    const threshold = Number(b.threshold);
    if (!MILESTONES.includes(threshold)) fail('Unknown milestone threshold.');
    context = `MS|${threshold}`;
    echo.threshold = String(threshold);
  } else if (b.ref || b.assignment_id || b.attempt_id) {
    fail('Challenge context is valid only for corrective capture.');
  }

  // Four-digit codes, never reissued for the same date and kind.
  const issuedAt = now.toISOString();
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    const res = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO challenges (date, kind, code, day, issued_at, context) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(today, kind, code, day, issuedAt, context).run();
    if (res.meta.changes === 1) {
      const weight = await c.env.DB.prepare('SELECT weight_lb FROM days WHERE date = ?').bind(today).first<number | null>('weight_lb');
      await record(c, 'filing.challenge', null, { kind, date: today, day, context }, false);
      return c.json({ ok: true, code, day, issuedAt, weight: weight ?? '', ...echo });
    }
  }
  return fail('Could not issue a challenge code; try again.', 409);
}

// ───────────────────────────── attest ─────────────────────────────

export async function attest(c: Ctx) {
  const b = await body(c);
  const now = new Date();
  const today = etDate(now);
  const date = String(b.date ?? today);
  if (date !== today) fail('Attestation date is not today.');
  const kind = captureKind(b.kind);
  const code = String(b.code ?? '');
  if (!/^\d{4}$/.test(code)) fail('Invalid challenge code.');
  const day = Number(b.day);
  if (!Number.isInteger(day) || day !== dayNumber(date)) fail('Attestation project day mismatch.');
  const videoHash = String(b.video_sha256 ?? '').toLowerCase();
  if (!HEX64.test(videoHash)) fail('Invalid video hash.');
  const photos = b.photo_sha256s == null ? [] : b.photo_sha256s;
  if (!Array.isArray(photos) || photos.some((h) => !HEX64.test(String(h).toLowerCase()))) fail('Invalid photo hashes.');
  const photoHashes = (photos as string[]).map((h) => String(h).toLowerCase());
  if (kind === 'daily' && photoHashes.length !== 4) fail('A daily attestation needs exactly four photo hashes.');
  const chunkChain = String(b.chunk_chain ?? '').toLowerCase();
  if (!HEX64.test(chunkChain)) fail('Invalid chunk chain.');
  const chunkCount = Number(b.chunk_count);
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 21600) fail('Invalid chunk count.');
  let weightText = '';
  if (b.weight != null && b.weight !== '') {
    const w = Number(b.weight);
    if (!Number.isFinite(w) || w <= 0 || w > 1500) fail('Invalid weight.');
    weightText = String(w);
  }

  const gate = await gateFor(c.env, now);
  if (!UNGATED.includes(kind)) requireActive(gate, date);

  let context: string | null = null;
  if (kind === 'corrective') {
    const ref = String(b.ref ?? '').trim().toUpperCase();
    const aid = String(b.assignment_id ?? '').trim().toUpperCase();
    const atid = String(b.attempt_id ?? '').trim().toUpperCase();
    if (!REF.test(ref) || !ASSIGNMENT.test(aid) || !ATTEMPT.test(atid)) fail('Corrective attestation context is incomplete.');
    context = `CTX3|${ref}|${aid}|${atid}`;
  } else if (b.ref || b.assignment_id || b.attempt_id) {
    fail('Attestation context is valid only for corrective capture.');
  }

  const ch = await c.env.DB.prepare('SELECT * FROM challenges WHERE date = ? AND kind = ? AND code = ?')
    .bind(date, kind, code).first<{ id: number; day: number; issued_at: string; context: string | null; used_at: string | null }>();
  if (!ch || (kind === 'corrective' && ch.context !== context)) fail('Unknown challenge for this date, capture kind, and context.');
  if (ch!.day !== day) fail('Challenge day mismatch.');

  // Idempotent replay: the same evidence already attested with this challenge.
  if (ch!.used_at) {
    const prior = await c.env.DB.prepare(
      `SELECT server_seal, sealed_at FROM attestations WHERE event = 'capture-attested' AND date = ? AND kind = ? AND code = ?
       AND video_sha256 = ? AND photo_sha256s = ? AND IFNULL(CAST(weight AS TEXT), '') = ? AND chunk_chain = ? AND chunk_count = ?`,
    ).bind(date, kind, code, videoHash, photoHashes.join(' '), weightText, chunkChain, chunkCount).first<{ server_seal: string; sealed_at: string }>();
    if (prior) return c.json({ ok: true, status: 'VALID-CONSUMED', seal: prior.server_seal, sealed_at: prior.sealed_at, idempotent: true });
    fail('Challenge already used by different evidence.', 409);
  }
  const age = now.getTime() - Date.parse(ch!.issued_at);
  if (age < 0 || age > CHALLENGE_TTL_MS) fail('Challenge expired; request a new one.');

  const stamped = now.toISOString();
  const seal = await hmacHex(c.env.ATTEST_HMAC_KEY, sealPayload({
    loggedAt: stamped, date, day, code, kind, videoHash, photoHashes: photoHashes.join(' '),
    weight: weightText, chunkChain, chunkCount, sealedAt: stamped,
  }));
  // One-time use: only the request that flips used_at may record the attestation.
  const burn = await c.env.DB.prepare('UPDATE challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(stamped, ch!.id).run();
  if (burn.meta.changes !== 1) fail('Challenge already used.', 409);
  const statements = [c.env.DB.prepare(
    `INSERT INTO attestations (logged_at, date, day, event, code, kind, video_sha256, photo_sha256s, weight, status, chunk_chain, chunk_count, server_seal, sealed_at)
     VALUES (?, ?, ?, 'capture-attested', ?, ?, ?, ?, ?, 'VALID-CONSUMED', ?, ?, ?, ?)`,
  ).bind(stamped, date, day, code, kind, videoHash, photoHashes.join(' '), weightText === '' ? null : Number(weightText), chunkChain, chunkCount, seal, stamped)];
  if (context?.startsWith('CTX3|')) {
    const [, ref, aid, atid] = context.split('|');
    statements.push(c.env.DB.prepare('INSERT INTO corrective_contexts (seal, date, ref, assignment_id, attempt_id, video_sha256) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(seal, date, ref, aid, atid, videoHash));
  }
  await c.env.DB.batch(statements);
  await record(c, 'filing.attest', null, { kind, date, day, code, seal }, false);
  return c.json({ ok: true, status: 'VALID-CONSUMED', seal, sealed_at: stamped });
}

// ───────────────────────────── uploads ─────────────────────────────

/** POST /api/stream-upload: a tus Direct Creator Upload URL on Cloudflare Stream. */
export async function streamUpload(c: Ctx) {
  const b = await body(c);
  const kind = captureKind(b.kind);
  const date = String(b.date ?? '');
  const size = Number(b.size);
  if (!isIsoDate(date)) fail('Bad date.');
  if (!Number.isInteger(size) || size < 1 || size > 4 * 1024 ** 3) fail('Bad size.');
  const name = String(b.name ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 160) || `mrb-${kind}-${date}.webm`;
  if (!c.env.STREAM_API_TOKEN) fail('Cloudflare Stream is not configured.', 403);
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
  const meta = [`name ${b64(name)}`, `maxdurationseconds ${b64('3600')}`, `expiry ${b64(new Date(Date.now() + 5 * 3600e3).toISOString())}`].join(',');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/stream?direct_user=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.STREAM_API_TOKEN}`, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(size), 'Upload-Metadata': meta },
  });
  const uploadUrl = r.headers.get('Location');
  const uid = r.headers.get('stream-media-id') ?? '';
  if (!r.ok || !uploadUrl || !/^[a-f0-9]{32}$/.test(uid)) {
    const text = await r.text().catch(() => '');
    return c.json({ ok: false, error: `Cloudflare Stream refused the upload (${r.status}). ${text.slice(0, 160)}` }, 502);
  }
  const code = c.env.STREAM_CUSTOMER_CODE.replace(/^customer-/, '');
  await record(c, 'filing.stream-upload', uid, { kind, date, size, name }, false);
  return c.json({ ok: true, uploadUrl, uid, url: `https://customer-${code}.cloudflarestream.com/${uid}/iframe` });
}

/** POST /api/media-put: a filed photograph into R2, immutable per view and date. */
export async function mediaPut(c: Ctx) {
  const b = await body(c);
  const date = String(b.date ?? '');
  const day = Number(b.day);
  if (!isIsoDate(date) || date > etDate(new Date())) fail('Bad date.');
  if (!Number.isInteger(day) || day < 1 || day !== dayNumber(date)) fail('Bad day.');
  const name = String(b.name ?? '');
  const view = (name.match(/(front|left|rear|right|wait)/i) || [])[1]?.toLowerCase();
  if (!view) fail('Photo view not recognized.');
  const ext = /\.png$/i.test(name) ? 'png' : /\.webp$/i.test(name) ? 'webp' : 'jpg';
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(String(b.image_b64 ?? '')), (ch) => ch.charCodeAt(0)); } catch { return fail('Bad image data.'); }
  if (bytes.length < 1000 || bytes.length > 15 * 1024 * 1024) fail('Image size out of range.');
  const [y, m, d] = date.split('-');
  const key = `${view === 'wait' ? 'wait' : 'photos'}/${y}/${m}/${d}/micheal-ray-berry-day-${String(day).padStart(3, '0')}-${view}-${date}.${ext}`;
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const existing = await c.env.MEDIA.head(key);
  if (existing && existing.customMetadata?.sha256 !== sha) fail(`The ${view} photograph for ${date} is already on file and cannot be replaced.`, 409);
  if (!existing) {
    await c.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { sha256: sha, date, view },
    });
    await record(c, 'filing.media', key, { date, view, sha256: sha }, false);
  }
  return c.json({ ok: true, url: `${c.env.SITE_ORIGIN}/${key}`, sha256: sha });
}

// ───────────────────────────── packet ─────────────────────────────

/** POST /api/packet: adds a photograph or the inspection video to the day's tracker row (creating it). */
export async function packet(c: Ctx) {
  const b = await body(c);
  const now = new Date();
  const gate = await gateFor(c.env, now);
  const date = String(b.date ?? gate.today);
  if (!isIsoDate(date) || date > gate.today) fail('Bad date.');
  requireActive(gate, date);
  const att = await filingAttestation(c.env, date, 'daily', b.attestation_seal ?? b.seal);
  const stamp = now.toISOString();

  const row = await c.env.DB.prepare('SELECT * FROM days WHERE date = ?').bind(date)
    .first<Record<string, string | number | null> & { receipts: string }>();
  const receipts = JSON.parse(String(row?.receipts ?? '{}')) as Record<string, string>;
  const set: Record<string, string | number> = {};

  if (b.photo_url != null) {
    const url = String(b.photo_url);
    const prefix = `${c.env.SITE_ORIGIN}/`;
    const key = url.startsWith(prefix) ? url.slice(prefix.length) : '';
    const m = key.match(/^(photos|wait)\/\d{4}\/\d{2}\/\d{2}\/micheal-ray-berry-day-(\d{3,})-(front|left|rear|right|wait)-(\d{4}-\d{2}-\d{2})\.(?:jpe?g|png|webp)$/);
    if (!m || m[4] !== date || Number(m[2]) !== dayNumber(date)) fail('Photograph URL is not a filed photograph for this date.');
    if (!(await c.env.MEDIA.head(key))) fail('Photograph is not in the record media store.', 404);
    const view = m![3];
    if (view === 'wait') {
      // The Wait still is not a progress photograph (§5); it illustrates the position.
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO site_state (key, value) VALUES ('wait_still_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(date),
        c.env.DB.prepare("INSERT INTO site_state (key, value) VALUES ('wait_still_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(url),
      ]);
      await record(c, 'filing.wait-still', date, { url, seal: att.server_seal });
      return c.json({ ok: true });
    }
    const col = `photo_${view}`;
    const current = row?.[col];
    if (current && current !== url) fail(`The ${view} photograph is already on file and cannot be replaced.`, 409);
    if (!current) { set[col] = url; receipts[view] = stamp; }
  }

  if (b.video_url != null) {
    const video = streamUrl(b.video_url);
    if (!video) fail('The inspection video must be a Cloudflare Stream URL.');
    const current = row?.video;
    if (current && current !== video!.url) fail('A daily recording is already on file and cannot be replaced.', 409);
    const dur = Math.round(Number(b.duration_sec));
    if (dur > 0 && row?.video_sec && row.video_sec !== dur) fail('Daily recording duration is immutable; conflicting value rejected.', 409);
    if (!current) { set.video = video!.url; set.stream_uid = video!.uid; receipts.video = stamp; }
    if (dur > 0 && !row?.video_sec) set.video_sec = dur;
  }
  // The weight is never taken from the device: only the scale sync writes it (§4).

  if (Object.keys(set).length) {
    receipts.seal = att.server_seal;
    if (date < gate.today || now.getTime() >= etWallTime(date, 22).getTime()) receipts.after_deadline = receipts.after_deadline ?? stamp;
    const cols = Object.keys(set);
    if (!row) {
      // The first filing for a date creates the tracker row (§4).
      await c.env.DB.prepare(`INSERT INTO days (date, ${cols.join(', ')}, receipts) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`)
        .bind(date, ...cols.map((k) => set[k]), JSON.stringify(receipts)).run();
    } else {
      // Only empty cells are filled; a concurrent filing cannot overwrite one.
      const res = await c.env.DB.prepare(`UPDATE days SET ${cols.map((k) => `${k} = ?`).join(', ')}, receipts = ? WHERE date = ? AND ${cols.map((k) => `${k} IS NULL`).join(' AND ')}`)
        .bind(...cols.map((k) => set[k]), JSON.stringify(receipts), date).run();
      if (res.meta.changes !== 1) fail('That component was filed by another request; reload and check.', 409);
    }
    await record(c, 'filing.packet', date, { set, receipts });
  } else if (b.finalize) {
    c.executionCtx.waitUntil(buildSoon(c.env, 'filing.packet.finalize'));
  }
  return c.json({ ok: true });
}

// ───────────────────────────── weekly (§7) ─────────────────────────────

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export interface WeeklyState { eligible: boolean; reason: string; date: string; day: number; week: number; dates: string[] }

/** Monday reviews, numbered from the first Monday on or after Day 1, covering the preceding seven active dates. */
export async function weeklyState(env: Env, gate: AgreementGate): Promise<WeeklyState> {
  const today = gate.today;
  const day = dayNumber(today);
  let firstMonday = DAY_ONE;
  while (weekday(firstMonday) !== 1) firstMonday = addDays(firstMonday, 1);
  const week = today >= firstMonday ? Math.floor((dayNumber(today) - dayNumber(firstMonday)) / 7) + 1 : 0;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i - 7)).filter((d) => appliesOn(d, gate));
  const base = { date: today, day, week, dates };
  if (!gate.active) return { eligible: false, reason: 'Edition 2 execution is not active.', ...base };
  if (weekday(today) !== 1) return { eligible: false, reason: 'The Weekly Review is filed on Mondays.', ...base };
  if (!dates.length) return { eligible: false, reason: 'No active dates to review yet.', ...base };
  const filed = await env.DB.prepare('SELECT id FROM weekly WHERE week = ? OR date = ?').bind(week, today).first();
  if (filed) return { eligible: false, reason: 'This Weekly Review is already filed.', ...base };
  return { eligible: true, reason: 'The Weekly Review is available today.', ...base };
}

/** The review's figures from the record (§7: figures must agree with the underlying record). */
export async function weeklyFigures(env: Env, gate: AgreementGate, dates: string[]) {
  const weights = dates.length
    ? (await env.DB.prepare(`SELECT date, weight_lb FROM days WHERE weight_lb IS NOT NULL AND date IN (${dates.map(() => '?').join(',')}) ORDER BY date`)
      .bind(...dates).all<{ date: string; weight_lb: number }>()).results
    : [];
  const open = (await env.DB.prepare("SELECT date FROM violations WHERE status IN ('open', 'submitted') AND public_id IS NOT NULL").all<{ date: string }>())
    .results.filter((v) => appliesOn(v.date, gate)).length;
  return { documented: weights.length, required: dates.length, weight: weights.at(-1)?.weight_lb ?? null, open };
}

export async function weekly(c: Ctx) {
  const b = await body(c);
  const gate = await gateFor(c.env, new Date());
  requireActive(gate, gate.today);
  const state = await weeklyState(c.env, gate);
  if (!state.eligible) fail(state.reason, 409);
  if (String(b.date) !== state.date || Number(b.day) !== state.day || Number(b.week) !== state.week) fail('Weekly schedule mismatch; reload.');
  const video = streamUrl(b.url);
  if (!video) fail('The Weekly Review must be a Cloudflare Stream URL.');
  const att = await filingAttestation(c.env, state.date, 'weekly', b.attestation_seal);
  if (att.day !== state.day) fail('Attestation day mismatch.');
  const fig = await weeklyFigures(c.env, gate, state.dates);
  const sent = { documented: Number(b.documented), required: Number(b.required), open: Number(b.open), weight: b.weight == null || b.weight === '' ? null : Number(b.weight) };
  if (sent.documented !== fig.documented || sent.required !== fig.required || sent.open !== fig.open || sent.weight !== fig.weight) {
    fail('Weekly figures do not match the record.', 409, { figures: fig });
  }
  await c.env.DB.prepare('INSERT INTO weekly (logged_at, date, week, documented, required, weight_lb, open_entries, url, attestation_seal, covers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), state.date, state.week, fig.documented, fig.required, fig.weight, fig.open, video!.url, att.server_seal, JSON.stringify(state.dates)).run();
  await record(c, 'filing.weekly', String(state.week), { ...fig, url: video!.url, covers: state.dates });
  return c.json({ ok: true, idempotent: false });
}

// ───────────────────────────── confirmation (§1) ─────────────────────────────

/** The Edition 2 consent confirmation. Accepted only before activation (it is what activation reviews). */
export async function confirmation(c: Ctx) {
  const b = await body(c);
  const gate = await gateFor(c.env, new Date());
  if (gate.active) fail('The agreement is already active; a new confirmation needs a written amendment (§12).', 409);
  const date = String(b.date ?? gate.today);
  if (date !== gate.today) fail('A confirmation is filed on the day it is recorded.');
  if (String(b.version ?? EDITION) !== EDITION) fail('Only Edition 2 confirmations are accepted.');
  const day = dayNumber(date);
  if (day < 1) fail('The project has not started.');
  const att = await filingAttestation(c.env, date, 'confirmation', b.attestation_seal);
  const video = b.url == null || b.url === '' ? null : streamUrl(b.url);
  if (b.url && !video) fail('The confirmation recording must be a Cloudflare Stream URL.');

  const existing = await c.env.DB.prepare('SELECT id, url, attestation_seal FROM confirmations WHERE edition = 2 AND date = ?').bind(date).first<{ id: number; url: string | null; attestation_seal: string | null }>();
  if (existing) {
    if (existing.attestation_seal && existing.attestation_seal !== att.server_seal) fail('A different confirmation is already on file for this date.', 409);
    if (video && existing.url && existing.url !== video.url) fail('The confirmation recording is already on file and cannot be replaced.', 409);
    if (video && !existing.url) {
      await c.env.DB.prepare('UPDATE confirmations SET url = ? WHERE id = ? AND url IS NULL').bind(video.url, existing.id).run();
      await record(c, 'filing.confirmation', date, { url: video.url, seal: att.server_seal });
    }
    return c.json({ ok: true, idempotent: true, pending_url: !(video || existing.url) });
  }
  await c.env.DB.prepare('INSERT INTO confirmations (logged_at, date, edition, day, url, attestation_seal) VALUES (?, ?, 2, ?, ?, ?)')
    .bind(new Date().toISOString(), date, day, video?.url ?? null, att.server_seal).run();
  await record(c, 'filing.confirmation', date, { url: video?.url ?? null, seal: att.server_seal });
  return c.json({ ok: true, pending_url: !video });
}

// ───────────────────────────── corrective (§8) ─────────────────────────────

export function attemptId(assignmentId: string, lastRejection: string | null): Promise<string> {
  return sha256Hex(`corrective-attempt-v1\n${assignmentId}\n${lastRejection ?? 'INITIAL'}`).then((h) => `A-${h.slice(0, 24).toUpperCase()}`);
}

interface CorrectiveTarget { violationId: number; ref: string; assignmentId: string; attemptId: string; recordingOnFile: boolean; dueAt: string }

async function correctiveTarget(env: Env, refRaw: unknown, aidRaw: unknown, atidRaw: unknown): Promise<CorrectiveTarget> {
  const ref = String(refRaw ?? '').trim().toUpperCase();
  const aid = String(aidRaw ?? '').trim().toUpperCase();
  const atid = String(atidRaw ?? '').trim().toUpperCase();
  if (!REF.test(ref) || !ASSIGNMENT.test(aid) || !ATTEMPT.test(atid)) fail('Corrective assignment or attempt identity is incomplete.');
  const row = await env.DB.prepare(
    `SELECT v.id AS violation_id, v.status, v.recording, c.assignment_id, c.attempts, c.completed_at, c.due_at, c.revised_due_at
     FROM correctives c JOIN violations v ON v.id = c.violation_id WHERE v.public_id = ? AND c.assignment_id = ?`,
  ).bind(ref, aid).first<{ violation_id: number; status: string; recording: string | null; assignment_id: string; attempts: string; completed_at: string | null; due_at: string; revised_due_at: string | null }>();
  if (!row) fail('No such corrective assignment for this entry.', 404);
  if (row!.status === 'resolved' || row!.completed_at) fail('This corrective requirement is already resolved.', 409);
  const attempts = JSON.parse(row!.attempts || '[]') as { rejection_id?: string }[];
  const lastRejection = [...attempts].reverse().find((a) => a.rejection_id)?.rejection_id ?? null;
  if (atid !== await attemptId(aid, lastRejection)) fail('Corrective attempt identity is stale; reload.', 409);
  return { violationId: row!.violation_id, ref, assignmentId: aid, attemptId: atid, recordingOnFile: row!.status === 'submitted', dueAt: row!.revised_due_at ?? row!.due_at };
}

export async function corrective(c: Ctx) {
  const b = await body(c);
  const gate = await gateFor(c.env, new Date());
  const date = String(b.date ?? gate.today);
  if (!isIsoDate(date) || date > gate.today) fail('Bad date.');
  requireActive(gate, date);
  const target = await correctiveTarget(c.env, b.ref ?? b.id, b.assignment_id, b.attempt_id);
  const video = streamUrl(b.url);
  if (!video) fail('The corrective session must be a Cloudflare Stream URL.');
  const att = await filingAttestation(c.env, date, 'corrective', b.attestation_seal);
  const ctx = await c.env.DB.prepare('SELECT * FROM corrective_contexts WHERE seal = ?').bind(att.server_seal)
    .first<{ ref: string; assignment_id: string; attempt_id: string; video_sha256: string }>();
  if (!ctx || ctx.ref !== target.ref || ctx.assignment_id !== target.assignmentId || ctx.attempt_id !== target.attemptId) {
    fail('The attestation is not bound to this corrective assignment and attempt.', 409);
  }
  const urlHash = await sha256Hex(`corrective-recording-video-id-v1\n${video!.uid}`);
  const prior = await c.env.DB.prepare('SELECT url_hash, attestation_seal FROM corrective_filings WHERE assignment_id = ? AND attempt_id = ?')
    .bind(target.assignmentId, target.attemptId).first<{ url_hash: string; attestation_seal: string }>();
  if (prior) {
    if (prior.url_hash === urlHash && prior.attestation_seal === att.server_seal) {
      return c.json({ ok: true, status: 'submitted-awaiting-ap-verification', assignment_id: target.assignmentId, attempt_id: target.attemptId, idempotent: true });
    }
    fail('A corrective recording is already on file for this attempt; it cannot be replaced.', 409);
  }
  const stamp = new Date().toISOString();
  const late = Date.parse(stamp) > Date.parse(target.dueAt);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO corrective_filings (violation_id, assignment_id, attempt_id, date, url, url_hash, attestation_seal) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(target.violationId, target.assignmentId, target.attemptId, date, video!.url, urlHash, att.server_seal),
    // The entry stays open until the AP verifies the session (§8); submission is recorded beside it.
    c.env.DB.prepare("UPDATE violations SET status = 'submitted', submitted_at = ?, recording = ? WHERE id = ? AND status = 'open'")
      .bind(stamp, video!.url, target.violationId),
  ]);
  await record(c, 'filing.corrective', target.ref, { assignment_id: target.assignmentId, attempt_id: target.attemptId, url: video!.url, after_due: late });
  const v = await c.env.DB.prepare('SELECT date, violation FROM violations WHERE id = ?').bind(target.violationId).first<{ date: string; violation: string }>();
  c.executionCtx.waitUntil(mailAP(c.env, `Corrective session submitted — ${v?.date} — awaiting your verification`,
    `A corrective session has been submitted against the entry ${target.ref} for ${v?.date}.\n\n` +
    `Submitted: ${stamp}${late ? ' (after the recorded due time — your review decides whether the deadline was met, §8)' : ''}\n` +
    `Assignment: ${target.assignmentId}\nAttempt: ${target.attemptId}\nRequirement missed: ${v?.violation}\nRecording: ${video!.url}\n\n` +
    'The entry remains submitted and unresolved; the recording is published beside it on the next build.\n' +
    'Review it for identity, attire, posture, elapsed time, and completion (§8).\n' +
    'If accepted, resolve the entry in the AP console. If it fails, overrule with the written reason and require a replacement session.', 'corrective-submitted'));
  return c.json({ ok: true, status: 'submitted-awaiting-ap-verification', assignment_id: target.assignmentId, attempt_id: target.attemptId, idempotent: false });
}

// ───────────────────────────── milestone (§7) ─────────────────────────────

export async function milestone(c: Ctx) {
  const b = await body(c);
  const gate = await gateFor(c.env, new Date());
  const date = String(b.date ?? gate.today);
  if (!isIsoDate(date) || date > gate.today) fail('Bad date.');
  requireActive(gate, date);
  const threshold = Number(b.threshold);
  if (!MILESTONES.includes(threshold)) fail('Unknown milestone threshold.');
  const video = streamUrl(b.url);
  if (!video) fail('The milestone video must be a Cloudflare Stream URL.');
  const att = await filingAttestation(c.env, date, 'milestone', b.attestation_seal);
  const ch = await c.env.DB.prepare("SELECT context FROM challenges WHERE date = ? AND kind = 'milestone' AND code = ?").bind(date, att.code).first<string>('context');
  if (ch !== `MS|${threshold}`) fail('The attestation was not issued for this milestone.', 409);
  // A crossing is a scale reading at or below the threshold (§7); the video verifies it.
  const weight = await c.env.DB.prepare('SELECT weight_lb FROM days WHERE date = ?').bind(date).first<number | null>('weight_lb');
  if (weight == null || weight > threshold) fail(`No scale reading at or below ${threshold} lb is on the record for ${date}.`, 409);
  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO milestone_filings (date, threshold, weight_lb, url, attestation_seal) VALUES (?, ?, ?, ?, ?)')
    .bind(date, threshold, weight, video!.url, att.server_seal).run();
  if (res.meta.changes === 1) {
    await record(c, 'filing.milestone', String(threshold), { date, weight, url: video!.url });
    c.executionCtx.waitUntil(mailAP(c.env, `Milestone verification filed — ${threshold} lb — ${date}`,
      `Micheal filed the milestone video for the ${threshold}-pound threshold.\n\nScale-synced weight on ${date}: ${weight} lb\nRecording: ${video!.url}\n\n` +
      'The milestone becomes official only after your review of the verification weigh-in and the video (§7).', 'milestone-filed'));
  }
  return c.json({ ok: true, status: 'submitted-awaiting-ap-review', idempotent: res.meta.changes !== 1 });
}

// ───────────────────────────── factual correction (§3) ─────────────────────────────

/** One request per entry, any time. It asks the AP to review; it changes nothing on the record. */
export async function correctionRequest(c: Ctx) {
  const b = await body(c);
  const ref = String(b.violation_id ?? '').trim().toUpperCase();
  if (!REF.test(ref)) fail('Unknown entry.');
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 20 || reason.length > 2000) fail('Explain the factual error in 20 to 2,000 characters.');
  const evidence = String(b.evidence_url ?? '').trim();
  if (evidence) {
    let ok = false;
    try { const u = new URL(evidence); ok = u.protocol === 'https:' && !u.username && !u.password; } catch { /* invalid */ }
    if (!ok || evidence.length > 500) fail('Evidence must be an https link.');
  }
  const gate = await gateFor(c.env, new Date());
  const v = await c.env.DB.prepare("SELECT id, date FROM violations WHERE public_id = ? AND status IN ('open', 'submitted', 'resolved')").bind(ref).first<{ id: number; date: string }>();
  if (!v || !appliesOn(v.date, gate)) fail('Unknown entry.', 404);
  const res = await c.env.DB.prepare("INSERT OR IGNORE INTO correction_requests (received_at, violation_id, reason, evidence_url, status) VALUES (?, ?, ?, ?, 'received')")
    .bind(new Date().toISOString(), v!.id, reason, evidence || null).run();
  if (res.meta.changes !== 1) fail('A correction request for this entry is already on file.', 409);
  await record(c, 'filing.correction-request', ref, { reason, evidence_url: evidence || null }, false);
  c.executionCtx.waitUntil(mailAP(c.env, `CORRECTION REQUEST — ${ref} (${v!.date})`,
    `Micheal requested a factual correction of this Violation Event (contract §3).\n\nEntry: ${ref}\n\nReason:\n${reason}\n\nEvidence: ${evidence || '(none given)'}\n\n` +
    'Review it against the written rules (§8) and record a dated explanation if anything changes. The request is in the AP console.', 'correction-request'));
  return c.json({ ok: true });
}

// ───────────────────────────── assistant state ─────────────────────────────

/** The fields the Recording Assistant reads (Code.gs mystate shape), plus the review's dates. */
export async function assistantState(env: Env, now = new Date()) {
  const state = await loadSiteState(env.DB);
  const gate = await loadGate(env.DB, now, state);
  const corrective = gate.active ? (await env.DB.prepare(
    `SELECT v.public_id, v.date, v.violation, c.assignment_id, c.attempts, c.level, c.minutes, c.due_at, c.revised_due_at
     FROM correctives c JOIN violations v ON v.id = c.violation_id
     WHERE v.status = 'open' AND c.completed_at IS NULL ORDER BY c.due_at`,
  ).all<{ public_id: string; date: string; violation: string; assignment_id: string; attempts: string; level: number; minutes: number; due_at: string; revised_due_at: string | null }>()).results : [];
  const entries = [];
  for (const r of corrective) {
    if (!appliesOn(r.date, gate)) continue;
    const attempts = JSON.parse(r.attempts || '[]') as { rejection_id?: string }[];
    const last = [...attempts].reverse().find((a) => a.rejection_id)?.rejection_id ?? null;
    const due = r.revised_due_at ?? r.due_at;
    entries.push({
      id: r.public_id, assignmentId: r.assignment_id, attemptId: await attemptId(r.assignment_id, last),
      violationDate: r.date, violation: r.violation,
      assignment: `Level ${r.level} · ${r.minutes} minutes of corner time · due ${new Date(due).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET`,
      due: etDate(new Date(due)), dueAt: due, level: r.level, minutes: r.minutes,
    });
  }
  const weekly = await weeklyState(env, gate);
  const figures = weekly.eligible ? await weeklyFigures(env, gate, weekly.dates) : null;
  return { projectStart: DAY_ONE, agreementActive: gate.active, corrective: entries, weekly: { ...weekly, figures } };
}

// ───────────────────────────── other recordings ─────────────────────────────

/** POST /api/recording: an announcement or demonstration recording, queued for the AP to publish (§3, §10). */
export async function recording(c: Ctx) {
  const b = await body(c);
  const kind = String(b.kind ?? '');
  if (kind !== 'announcement' && kind !== 'demo') fail('Unknown recording kind.');
  const date = String(b.date ?? etDate(new Date()));
  if (!isIsoDate(date)) fail('Bad date.');
  const video = streamUrl(b.url);
  if (!video) fail('The recording must be a Cloudflare Stream URL.');
  const att = await filingAttestation(c.env, date, kind as CaptureKind, b.attestation_seal);
  const existing = await c.env.DB.prepare("SELECT id FROM portal_filings WHERE kind = ? AND url = ?").bind(kind, video!.url).first();
  if (!existing) {
    await c.env.DB.prepare("INSERT INTO portal_filings (received_at, kind, url, status) VALUES (?, ?, ?, 'awaiting AP')")
      .bind(new Date().toISOString(), kind, video!.url).run();
    await record(c, 'filing.recording', kind, { date, url: video!.url, seal: att.server_seal }, false);
  }
  return c.json({ ok: true, status: 'received-awaiting-ap', idempotent: !!existing });
}
