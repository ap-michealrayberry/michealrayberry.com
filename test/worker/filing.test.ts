import { env, exports } from 'cloudflare:workers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptId, hmacHex, sealPayload, weeklyFigures, weeklyState } from '../../src/api/filing';
import { agreementGate } from '../../src/rules';
import { PHOTO_JPEG_BASE64 } from '../fixtures/photo';

const ORIGIN = 'https://michealrayberry.com';
const TEAM = 'mrb-test.cloudflareaccess.com';
const MRB = 'michealrayberry@gmail.com';
const AP = 'ap@michealrayberry.com';
// Monday 2026-10-05, 2:00 PM EDT: Project Day 3.
const NOW = new Date('2026-10-05T18:00:00Z');
const hex = (n: number, c = 'a') => c.repeat(n);
const PHOTO = PHOTO_JPEG_BASE64;
const STREAM = 'https://customer-sbx737pkvhyavdz9.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe';

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj: unknown) => b64u(new TextEncoder().encode(JSON.stringify(obj)));
async function token(email: string, aud: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'k1' });
  const body = enc({ iss: `https://${TEAM}`, aud: [aud], email, exp: now + 3600, iat: now });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}

async function call(role: 'mrb' | 'ap', path: string, payload?: unknown, init: RequestInit = {}) {
  const jwt = role === 'mrb' ? await token(MRB, 'aud-assistant') : await token(AP, 'aud-ap');
  const res = await exports.default.fetch(`${ORIGIN}${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: ORIGIN, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    ...init,
  });
  return { status: res.status, json: await res.json<Record<string, any>>() };
}

async function capture(kind: string, extra: Record<string, unknown> = {}, attestExtra: Record<string, unknown> = {}) {
  const ch = await call('mrb', '/api/challenge', { kind, ...extra });
  expect(ch.status).toBe(200);
  const at = await call('mrb', '/api/attest', {
    date: '2026-10-05', day: 3, kind, code: ch.json.code, video_sha256: hex(64, 'b'), chunk_chain: hex(64, 'c'), chunk_count: 12,
    photo_sha256s: kind === 'daily' ? [hex(64, '1'), hex(64, '2'), hex(64, '3'), hex(64, '4')] : [], ...extra, ...attestExtra,
  });
  expect(at.status).toBe(200);
  return { code: ch.json.code as string, seal: at.json.seal as string, sealedAt: at.json.sealed_at as string };
}

beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keys.publicKey) as JsonWebKey;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [{ ...jwk, kid: 'k1' }] });
    if (url.includes('/stream?direct_user=true')) {
      return new Response(null, { status: 201, headers: { Location: 'https://upload.videodelivery.net/tus/abc', 'stream-media-id': '0123456789abcdef0123456789abcdef' } });
    }
    return realFetch(input, init);
  });
  await env.DB.prepare("INSERT INTO days (date, weight_lb, note) VALUES ('2026-10-05', 338.4, 'scale-synced')").run();
});
afterAll(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('roles and origin', () => {
  it('refuses filing for the AP and AP actions for Micheal', async () => {
    expect((await call('ap', '/api/challenge', { kind: 'daily' })).status).toBe(403);
    expect((await call('mrb', '/api/ap/state', { key: 'agreement_edition', value: '2' })).status).toBe(403);
    expect((await call('mrb', '/api/ap/build', {})).status).toBe(403);
  });

  it('refuses cross-origin writes', async () => {
    const res = await call('mrb', '/api/challenge', { kind: 'demo' }, { headers: { 'Cf-Access-Jwt-Assertion': await token(MRB, 'aud-assistant'), Origin: 'https://evil.example', 'content-type': 'application/json' } });
    expect(res.status).toBe(403);
  });

  it('gives Micheal no way to edit or remove an entry of record', async () => {
    for (const path of ['/api/violations/V-0123456789AB', '/api/days/2026-10-05', '/api/packet', '/api/corrective', '/api/correction-request']) {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const res = await call('mrb', path, {}, { method });
        expect([403, 404]).toContain(res.status);
      }
    }
    for (const path of ['/api/ap/state', '/api/ap/build']) expect((await call('mrb', path, {})).status).toBe(403);
  });
});

describe('protected apps (Access)', () => {
  it('serves the assistant and the portal only to Micheal', async () => {
    for (const path of ['/assistant/', '/mrb/']) {
      const mrb = await exports.default.fetch(`${ORIGIN}${path}`, { headers: { 'Cf-Access-Jwt-Assertion': await token(MRB, path === '/mrb/' ? 'aud-mrb' : 'aud-assistant') } });
      expect(mrb.status).toBe(200);
      expect(mrb.headers.get('cache-control')).toBe('no-store');
      expect(await mrb.text()).toContain('<html');
      expect((await exports.default.fetch(`${ORIGIN}${path}`, { headers: { 'Cf-Access-Jwt-Assertion': await token(AP, 'aud-ap') } })).status).toBe(403);
      expect((await exports.default.fetch(`${ORIGIN}${path}`)).status).toBe(403);
    }
    expect((await exports.default.fetch(`${ORIGIN}/mrb/mrb.js`)).status).toBe(403);
  });
});

describe('agreement gate (§1)', () => {
  it('refuses requirement filings before activation, but takes the consent confirmation', async () => {
    const res = await call('mrb', '/api/challenge', { kind: 'daily' });
    expect(res).toMatchObject({ status: 403, json: { error: 'agreement execution inactive' } });
    const { seal } = await capture('confirmation');
    const filed = await call('mrb', '/api/confirmation', { date: '2026-10-05', version: '2', attestation_seal: seal, url: STREAM });
    expect(filed).toMatchObject({ status: 200, json: { ok: true, pending_url: false } });
  });

  it('lets the AP record the execution dates, refusing future dates', async () => {
    expect((await call('ap', '/api/ap/state', { key: 'consent_reviewed_on', value: '2026-10-06' })).status).toBe(400);
    expect((await call('ap', '/api/ap/state', { key: 'start_date', value: '2026-10-11' })).status).toBe(400);
    for (const [key, value] of [['agreement_edition', '2'], ['participant_signature_verified_on', '2026-10-03'], ['ap_signature_verified_on', '2026-10-03'], ['consent_recording_date', '2026-10-05'], ['consent_reviewed_on', '2026-10-05']]) {
      expect((await call('ap', '/api/ap/state', { key, value })).status).toBe(200);
    }
    const me = await call('mrb', '/api/me');
    expect(me.json).toMatchObject({ agreementActive: true, agreement: { effective_date: '2026-10-05' } });
    const event = await env.DB.prepare("SELECT actor, payload FROM events WHERE action = 'ap.state' AND subject = 'consent_reviewed_on'").first<{ actor: string; payload: string }>();
    expect(event).toMatchObject({ actor: `ap:${AP}` });
  });

  it('refuses a new confirmation once the agreement is active (§12)', async () => {
    const res = await call('mrb', '/api/challenge', { kind: 'confirmation' });
    const at = await call('mrb', '/api/attest', { date: '2026-10-05', day: 3, kind: 'confirmation', code: res.json.code, video_sha256: hex(64, 'd'), chunk_chain: hex(64, 'c'), chunk_count: 3 });
    const filed = await call('mrb', '/api/confirmation', { date: '2026-10-05', version: '2', attestation_seal: at.json.seal });
    expect(filed.status).toBe(409);
  });
});

describe('challenge and attest (§5)', () => {
  it('issues a four-digit code with the day and the scale weight', async () => {
    const res = await call('mrb', '/api/challenge', { kind: 'daily' });
    expect(res.json).toMatchObject({ ok: true, day: 3, weight: 338.4 });
    expect(res.json.code).toMatch(/^\d{4}$/);
  });

  it('seals with HMAC over the Code.gs payload, once per challenge', async () => {
    const ch = await call('mrb', '/api/challenge', { kind: 'daily' });
    const body = { date: '2026-10-05', day: 3, kind: 'daily', code: ch.json.code, video_sha256: hex(64, 'e'), chunk_chain: hex(64, 'c'), chunk_count: 9, photo_sha256s: [hex(64, '1'), hex(64, '2'), hex(64, '3'), hex(64, '4')], weight: 338.4 };
    const first = await call('mrb', '/api/attest', body);
    const expected = await hmacHex(env.ATTEST_HMAC_KEY, sealPayload({
      loggedAt: first.json.sealed_at, date: '2026-10-05', day: 3, code: ch.json.code, kind: 'daily', videoHash: hex(64, 'e'),
      photoHashes: [hex(64, '1'), hex(64, '2'), hex(64, '3'), hex(64, '4')].join(' '), weight: '338.4', chunkChain: hex(64, 'c'), chunkCount: 9, sealedAt: first.json.sealed_at,
    }));
    expect(first.json.seal).toBe(expected);
    expect((await call('mrb', '/api/attest', body)).json).toMatchObject({ seal: expected, idempotent: true });
    expect((await call('mrb', '/api/attest', { ...body, video_sha256: hex(64, 'f') })).status).toBe(409);
  });

  it('refuses unknown codes, wrong days, missing photo hashes and expired challenges', async () => {
    const base = { date: '2026-10-05', day: 3, kind: 'daily', video_sha256: hex(64, 'e'), chunk_chain: hex(64, 'c'), chunk_count: 9, photo_sha256s: [hex(64, '1'), hex(64, '2'), hex(64, '3'), hex(64, '4')] };
    expect((await call('mrb', '/api/attest', { ...base, code: '0000' })).status).toBe(400);
    const ch = await call('mrb', '/api/challenge', { kind: 'daily' });
    expect((await call('mrb', '/api/attest', { ...base, code: ch.json.code, day: 4 })).status).toBe(400);
    expect((await call('mrb', '/api/attest', { ...base, code: ch.json.code, photo_sha256s: [hex(64, '1')] })).status).toBe(400);
    vi.setSystemTime(new Date(NOW.getTime() + 91 * 60 * 1000));
    expect((await call('mrb', '/api/attest', { ...base, code: ch.json.code })).json.error).toMatch(/expired/);
    vi.setSystemTime(NOW);
  });
});

describe('daily packet (§4)', () => {
  let seal = '';
  beforeEach(async () => { if (!seal) seal = (await capture('daily')).seal; });

  it('opens a Stream upload', async () => {
    const res = await call('mrb', '/api/stream-upload', { kind: 'daily', date: '2026-10-05', day: 3, size: 1000, name: 'x.webm' });
    expect(res.json).toMatchObject({ ok: true, uid: '0123456789abcdef0123456789abcdef', url: STREAM, uploadUrl: 'https://upload.videodelivery.net/tus/abc' });
  });

  it('stores each photograph once, immutably', async () => {
    const put = (name: string, image = PHOTO) => call('mrb', '/api/media-put', { date: '2026-10-05', day: 3, name, image_b64: image });
    const res = await put('micheal-ray-berry-day-003-front-2026-10-05.jpg');
    expect(res.json.url).toBe(`${ORIGIN}/photos/2026/10/05/micheal-ray-berry-day-003-front-2026-10-05.jpg`);
    expect((await put('micheal-ray-berry-day-003-front-2026-10-05.jpg')).status).toBe(200);
    expect((await put('micheal-ray-berry-day-003-front-2026-10-05.jpg', btoa('x'.repeat(2000)))).status).toBe(409);
    expect((await call('mrb', '/api/media-put', { date: '2026-10-05', day: 4, name: 'front.jpg', image_b64: PHOTO })).status).toBe(400);
  });

  it('creates the tracker row on first filing and fills each component once', async () => {
    for (const view of ['left', 'rear', 'right']) {
      await call('mrb', '/api/media-put', { date: '2026-10-05', day: 3, name: `micheal-ray-berry-day-003-${view}-2026-10-05.jpg`, image_b64: PHOTO });
    }
    for (const view of ['front', 'left', 'rear', 'right']) {
      const res = await call('mrb', '/api/packet', { date: '2026-10-05', photo_url: `${ORIGIN}/photos/2026/10/05/micheal-ray-berry-day-003-${view}-2026-10-05.jpg`, attestation_seal: seal, weight: 100 });
      expect(res.status).toBe(200);
    }
    const res = await call('mrb', '/api/packet', { date: '2026-10-05', video_url: STREAM.replace('/iframe', '/watch'), duration_sec: 300, attestation_seal: seal, finalize: true });
    expect(res.status).toBe(200);
    const day = await env.DB.prepare("SELECT * FROM days WHERE date = '2026-10-05'").first<Record<string, any>>();
    expect(day).toMatchObject({ weight_lb: 338.4, video: STREAM, video_sec: 300, stream_uid: '0123456789abcdef0123456789abcdef' });
    expect(Object.keys(JSON.parse(day!.receipts))).toEqual(expect.arrayContaining(['front', 'left', 'rear', 'right', 'video', 'seal']));
  });

  it('never replaces a filed component or accepts a device weight', async () => {
    const other = 'https://customer-sbx737pkvhyavdz9.cloudflarestream.com/ffffffffffffffffffffffffffffffff/iframe';
    expect((await call('mrb', '/api/packet', { date: '2026-10-05', video_url: other, attestation_seal: seal })).status).toBe(409);
    expect((await call('mrb', '/api/packet', { date: '2026-10-05', video_url: STREAM, duration_sec: 301, attestation_seal: seal })).status).toBe(409);
    expect(await env.DB.prepare("SELECT weight_lb FROM days WHERE date = '2026-10-05'").first('weight_lb')).toBe(338.4);
  });

  it('refuses a seal that is not a same-date daily attestation, and unfiled photographs', async () => {
    expect((await call('mrb', '/api/packet', { date: '2026-10-05', video_url: STREAM, attestation_seal: hex(64, '9') })).status).toBe(400);
    const res = await call('mrb', '/api/packet', { date: '2026-10-05', photo_url: `${ORIGIN}/photos/2026/10/05/micheal-ray-berry-day-003-front-2026-10-04.jpg`, attestation_seal: seal });
    expect(res.status).toBe(400);
  });

  it('accepts a filing after 10:00 PM and records that it came after the deadline (§4)', async () => {
    vi.setSystemTime(new Date('2026-10-07T03:30:00Z')); // 11:30 PM EDT, Tuesday Oct 6 (Day 4)
    const ch = await call('mrb', '/api/challenge', { kind: 'daily' });
    const at = await call('mrb', '/api/attest', { date: '2026-10-06', day: 4, kind: 'daily', code: ch.json.code, video_sha256: hex(64, 'b'), chunk_chain: hex(64, 'c'), chunk_count: 3, photo_sha256s: [hex(64, '1'), hex(64, '2'), hex(64, '3'), hex(64, '4')] });
    expect((await call('mrb', '/api/packet', { date: '2026-10-06', video_url: STREAM, attestation_seal: at.json.seal })).status).toBe(200);
    const receipts = JSON.parse((await env.DB.prepare("SELECT receipts FROM days WHERE date = '2026-10-06'").first<string>('receipts'))!);
    expect(receipts.after_deadline).toBe('2026-10-07T03:30:00.000Z');
    vi.setSystemTime(NOW);
  });
});

describe('weekly review on Mondays (§7)', () => {
  it('reports only active dates; with none yet, the review is not offered', async () => {
    const me = await call('mrb', '/api/me');
    expect(me.json.weekly).toMatchObject({ eligible: false, reason: 'No active dates to review yet.', date: '2026-10-05', day: 3, week: 1, dates: [] });
  });

  it('computes the figures from the record for the dates covered', async () => {
    const gate = agreementGate({ agreement_edition: '2', participant_signature_verified_on: '2026-10-03', ap_signature_verified_on: '2026-10-03', consent_recording_date: '2026-10-03', consent_reviewed_on: '2026-10-03' }, ['2026-10-03'], '2026-10-12');
    const state = await weeklyState(env, gate);
    expect(state).toMatchObject({ eligible: true, date: '2026-10-12', week: 2, dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'] });
    expect(await weeklyFigures(env, gate, state.dates)).toEqual({ documented: 1, required: 7, weight: 338.4, open: 0 });
  });

  it('refuses a review on any other day', async () => {
    const res = await call('mrb', '/api/weekly', { date: '2026-10-05', day: 3, week: 1, documented: 0, required: 0, open: 0, url: STREAM, attestation_seal: hex(64) });
    expect(res.status).toBe(409);
  });
});

describe('corrective session (§8)', () => {
  it('files the session against its exact assignment and attempt, once', async () => {
    await env.DB.prepare("INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-10-05', 'Missed 10 PM ET deadline', 'open', '2026-10-05', 'V-0123456789AB')").run();
    await env.DB.prepare("INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status) SELECT id, 'C-AAAAAAAAAAAAAAAAAAAAAAAA', '2026-10-05T14:00:00.000Z', '2026-10-08T14:00:00.000Z', 1, 10, 'assigned' FROM violations WHERE public_id = 'V-0123456789AB'").run();
    const atid = await attemptId('C-AAAAAAAAAAAAAAAAAAAAAAAA', null);
    const me = await call('mrb', '/api/me');
    expect(me.json.corrective).toEqual([expect.objectContaining({ id: 'V-0123456789AB', assignmentId: 'C-AAAAAAAAAAAAAAAAAAAAAAAA', attemptId: atid, level: 1, minutes: 10, due: '2026-10-08' })]);
    const ctx = { ref: 'V-0123456789AB', assignment_id: 'C-AAAAAAAAAAAAAAAAAAAAAAAA', attempt_id: atid };
    expect((await call('mrb', '/api/challenge', { kind: 'corrective', ...ctx, attempt_id: `A-${'B'.repeat(24)}` })).status).toBe(409);
    const { seal } = await capture('corrective', ctx);
    const filed = await call('mrb', '/api/corrective', { ...ctx, date: '2026-10-05', url: STREAM, attestation_seal: seal });
    expect(filed.json).toMatchObject({ ok: true, status: 'submitted-awaiting-ap-verification', idempotent: false });
    expect(await env.DB.prepare("SELECT status FROM violations WHERE public_id = 'V-0123456789AB'").first('status')).toBe('submitted');
    expect((await call('mrb', '/api/corrective', { ...ctx, date: '2026-10-05', url: STREAM, attestation_seal: seal })).json).toMatchObject({ idempotent: true });
    // A further session for the same entry is refused while one awaits AP verification.
    expect((await call('mrb', '/api/challenge', { kind: 'corrective', ...ctx })).status).toBe(409);
  });
});

describe('milestone (§7)', () => {
  it('needs a scale reading at or below the threshold', async () => {
    expect((await call('mrb', '/api/challenge', { kind: 'milestone', threshold: 333 })).status).toBe(400);
    const ch = await call('mrb', '/api/challenge', { kind: 'milestone', threshold: 320 });
    const at = await call('mrb', '/api/attest', { date: '2026-10-05', day: 3, kind: 'milestone', code: ch.json.code, video_sha256: hex(64, 'b'), chunk_chain: hex(64, 'c'), chunk_count: 3 });
    const res = await call('mrb', '/api/milestone', { date: '2026-10-05', threshold: 320, url: STREAM, attestation_seal: at.json.seal });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/at or below 320/);
  });
});

describe('factual correction request (§3)', () => {
  it('accepts one request per entry, with an https link', async () => {
    const short = await call('mrb', '/api/correction-request', { violation_id: 'V-0123456789AB', reason: 'too short' });
    expect(short.status).toBe(400);
    const bad = await call('mrb', '/api/correction-request', { violation_id: 'V-0123456789AB', reason: 'The packet was filed at 9:41 PM; see the receipt.', evidence_url: 'http://x' });
    expect(bad.status).toBe(400);
    const ok = await call('mrb', '/api/correction-request', { violation_id: 'V-0123456789AB', reason: 'The packet was filed at 9:41 PM; see the receipt.', evidence_url: 'https://example.com/receipt' });
    expect(ok.status).toBe(200);
    expect((await call('mrb', '/api/correction-request', { violation_id: 'V-0123456789AB', reason: 'The packet was filed at 9:41 PM; see the receipt.' })).status).toBe(409);
    expect((await call('mrb', '/api/correction-request', { violation_id: 'V-FFFFFFFFFFFF', reason: 'The packet was filed at 9:41 PM; see the receipt.' })).status).toBe(404);
    // The request changes nothing on the entry itself.
    expect(await env.DB.prepare("SELECT status FROM violations WHERE public_id = 'V-0123456789AB'").first('status')).toBe('submitted');
  });
});
