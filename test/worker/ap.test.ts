import { env, exports } from 'cloudflare:workers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptId } from '../../src/api/filing';

const ORIGIN = 'https://michealrayberry.com';
const TEAM = 'mrb-test.cloudflareaccess.com';
const NOW = new Date('2026-10-06T18:00:00Z'); // Tue Oct 6, 2 PM EDT
let keys: CryptoKeyPair;
let jwk: JsonWebKey;
let sent: { To: string; Subject: string; TextBody: string }[] = [];
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj: unknown) => b64u(new TextEncoder().encode(JSON.stringify(obj)));
async function token(email: string, aud: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'k1' });
  const body = enc({ iss: `https://${TEAM}`, aud: [aud], email, exp: now + 3600 });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}
async function ap(path: string, payload?: unknown, as: 'ap' | 'mrb' = 'ap') {
  const jwt = as === 'ap' ? await token('ap@michealrayberry.com', 'aud-ap') : await token('michealrayberry@gmail.com', 'aud-mrb');
  const res = await exports.default.fetch(`${ORIGIN}${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: ORIGIN, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, json: type.includes('json') ? await res.json<Record<string, any>>() : null, text: type.includes('csv') ? await res.text() : '' };
}
let flagSeq = 0;
const flagRow = async (date: string, text = 'Record-presence review — packet files were incomplete when checked.') =>
  (await env.DB.prepare("INSERT INTO violations (date, violation, status, source, requirement, subject_ref) VALUES (?, ?, 'flagged', 'nightly', 'daily-packet', ?)")
    .bind(date, text, `fixture-${++flagSeq}`).run()).meta.last_row_id;

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keys.publicKey) as JsonWebKey;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [{ ...jwk, kid: 'k1' }] });
    if (url === 'https://api.postmarkapp.com/email') { sent.push(JSON.parse(String(init?.body))); return Response.json({ ErrorCode: 0, MessageID: 'x' }); }
    if (url.includes('/stream/')) return new Response(null, { status: 200 });
    return real(input, init);
  });
  await env.DB.batch([
    "INSERT INTO site_state (key, value) VALUES ('agreement_edition', '2'), ('participant_signature_verified_on', '2026-10-03'), ('ap_signature_verified_on', '2026-10-03'), ('consent_recording_date', '2026-10-03'), ('consent_reviewed_on', '2026-10-03')",
    "INSERT INTO confirmations (logged_at, date, edition, day) VALUES ('2026-10-03T16:00:00Z', '2026-10-03', 2, 1)",
    "INSERT INTO subscribers (email, status, token) VALUES ('watcher@example.com', 'ACTIVE', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')",
  ].map((s) => env.DB.prepare(s)));
});
beforeEach(() => { sent = []; });
afterAll(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AP only', () => {
  it('refuses every AP endpoint to Micheal', async () => {
    for (const path of ['/api/ap/state', '/api/ap/export.csv?table=days']) expect((await ap(path, undefined, 'mrb')).status).toBe(403);
    for (const path of ['/api/ap/violation', '/api/ap/supervision', '/api/ap/update', '/api/ap/takedown', '/api/ap/state', '/api/ap/correction-request', '/api/ap/observer', '/api/ap/milestone', '/api/ap/recording', '/api/ap/build']) {
      expect((await ap(path, {}, 'mrb')).status).toBe(403);
    }
  });
  it('serves the console only to the AP', async () => {
    const mine = await exports.default.fetch(`${ORIGIN}/ap/`, { headers: { 'Cf-Access-Jwt-Assertion': await token('ap@michealrayberry.com', 'aud-ap') } });
    expect(mine.status).toBe(200);
    expect(await mine.text()).toContain('AP Console');
    expect((await exports.default.fetch(`${ORIGIN}/ap/`, { headers: { 'Cf-Access-Jwt-Assertion': await token('michealrayberry@gmail.com', 'aud-mrb') } })).status).toBe(403);
  });
});

describe('verifying flags (§8)', () => {
  it('publishes the event and assigns levels 1, 2, 3, 3 with the exact 72-hour due time', async () => {
    const ids = [await flagRow('2026-10-04'), await flagRow('2026-10-05'), await flagRow('2026-10-05', 'Second flag same day'), await flagRow('2026-10-06')];
    const levels = [];
    for (const id of ids) {
      const res = await ap('/api/ap/violation', { op: 'verify', id });
      expect(res.status).toBe(200);
      expect(res.json!.publicId).toMatch(/^V-[A-F0-9]{12}$/);
      expect(res.json!.dueAt).toBe('2026-10-09T18:00:00.000Z');
      levels.push([res.json!.level, res.json!.minutes]);
    }
    expect(levels).toEqual([[1, 10], [2, 20], [3, 30], [3, 30]]);
    const first = await env.DB.prepare('SELECT v.status, v.public_id, c.assignment_id, c.assigned_at FROM violations v JOIN correctives c ON c.violation_id = v.id WHERE v.id = ?').bind(ids[0]).first<Record<string, string>>();
    expect(first).toMatchObject({ status: 'open', assigned_at: '2026-10-06T18:00:00.000Z' });
    expect(first!.assignment_id).toMatch(/^C-[A-F0-9]{24}$/);
  });

  it('emails Micheal and subscribers with the §8 wording (no automatic escalation)', async () => {
    const id = await flagRow('2026-10-06', 'Daily Compliance Packet incomplete at 10 PM');
    await ap('/api/ap/violation', { op: 'verify', id });
    await vi.waitFor(() => expect(sent.length).toBe(2));
    const mrb = sent.find((m) => m.To === 'contact@michealrayberry.com')!;
    expect(mrb.Subject).toBe('AP-VERIFIED VIOLATION — Day 4 — 2026-10-06');
    expect(mrb.TextBody).toContain('Due: Fri, Oct 9, 2026, 2:00 PM ET (72 hours, §8).');
    const sub = sent.find((m) => m.To === 'watcher@example.com')!;
    expect(sub.TextBody).toContain('A missed deadline is reviewed by the Accountability Partner before any further Violation Event is confirmed.');
    expect(sub.TextBody).not.toContain('next level');
  });

  it('refuses events dated before the effective date and re-verifying', async () => {
    const early = await flagRow('2026-10-02');
    expect((await ap('/api/ap/violation', { op: 'verify', id: early })).status).toBe(409);
    expect(await env.DB.prepare('SELECT status FROM violations WHERE id = ?').bind(early).first('status')).toBe('flagged');
    const open = await env.DB.prepare("SELECT id FROM violations WHERE status = 'open' LIMIT 1").first<number>('id');
    expect((await ap('/api/ap/violation', { op: 'verify', id: open })).status).toBe(409);
  });

  it('rejects a flag only with a reason, keeping it private', async () => {
    const id = await flagRow('2026-10-06', 'flag to reject');
    expect((await ap('/api/ap/violation', { op: 'reject', id })).status).toBe(400);
    expect((await ap('/api/ap/violation', { op: 'reject', id, reason: 'Receipts show the video was filed at 9:42 PM.' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT status, public_id FROM violations WHERE id = ?').bind(id).first()).toEqual({ status: 'rejected', public_id: null });
  });
});

describe('corrective review (§8)', () => {
  it('resolves only after a submitted session; an overrule needs the written reason and starts a new attempt', async () => {
    const v = await env.DB.prepare("SELECT v.id, c.assignment_id FROM violations v JOIN correctives c ON c.violation_id = v.id WHERE v.status = 'open' ORDER BY v.id LIMIT 1").first<{ id: number; assignment_id: string }>();
    expect((await ap('/api/ap/violation', { op: 'resolve', id: v!.id })).status).toBe(409);
    await env.DB.prepare("UPDATE violations SET status = 'submitted', submitted_at = '2026-10-07T15:00:00Z', recording = 'https://customer-x.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe' WHERE id = ?").bind(v!.id).run();
    expect((await ap('/api/ap/violation', { op: 'overrule', id: v!.id, reason: 'short' })).status).toBe(400);
    const over = await ap('/api/ap/violation', { op: 'overrule', id: v!.id, reason: 'Left the position at 6:12 (§8 invalid attempt).' });
    expect(over.status).toBe(200);
    expect(over.json!.next_attempt).not.toBe(await attemptId(v!.assignment_id, null));
    const after = await env.DB.prepare('SELECT status, recording, corrections FROM violations WHERE id = ?').bind(v!.id).first<Record<string, string | null>>();
    expect(after).toMatchObject({ status: 'open', recording: null });
    expect(after!.corrections).toContain('2026-10-06: corrective session not accepted — Left the position');
    // Micheal sees the new attempt in his state.
    const me = await ap('/api/me', undefined, 'mrb');
    expect(me.json!.corrective.find((c: { assignmentId: string }) => c.assignmentId === v!.assignment_id).attemptId).toBe(over.json!.next_attempt);

    await env.DB.prepare("UPDATE violations SET status = 'submitted', submitted_at = '2026-10-08T15:00:00Z' WHERE id = ?").bind(v!.id).run();
    sent = [];
    expect((await ap('/api/ap/violation', { op: 'resolve', id: v!.id, note: 'Full 10 minutes, one take.' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT status, resolved_at FROM violations WHERE id = ?').bind(v!.id).first()).toEqual({ status: 'resolved', resolved_at: '2026-10-06' });
    expect(await env.DB.prepare('SELECT completed_at FROM correctives WHERE violation_id = ?').bind(v!.id).first('completed_at')).not.toBeNull();
    await vi.waitFor(() => expect(sent.map((m) => m.Subject)).toContain('Ray Berry — CORRECTION COMPLETED: 2026-10-04'));
  });

  it('records a §9 exception with a revised due time', async () => {
    const v = await env.DB.prepare("SELECT id FROM violations WHERE status = 'open' ORDER BY id LIMIT 1").first<number>('id');
    expect((await ap('/api/ap/violation', { op: 'exception', id: v, reason: 'Safety stop at minute 7; dizziness.', revised_due_at: '2026-10-12T22:00:00Z' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT revised_due_at, exception_note FROM correctives WHERE violation_id = ?').bind(v).first())
      .toEqual({ revised_due_at: '2026-10-12T22:00:00.000Z', exception_note: '2026-10-06: Safety stop at minute 7; dizziness.' });
  });
});

describe('supervision rulings (§6)', () => {
  it('rules nights; MISSED emails subscribers; an exception needs a reason', async () => {
    await env.DB.prepare("INSERT INTO supervision (date, required, status) VALUES ('2026-10-05', 1, 'REVIEW REQUIRED')").run();
    expect((await ap('/api/ap/supervision', { date: '2026-10-05', op: 'exception' })).status).toBe(400);
    expect((await ap('/api/ap/supervision', { date: '2026-10-05', op: 'missed' })).json).toMatchObject({ status: 'MISSED' });
    await vi.waitFor(() => expect(sent.map((m) => m.Subject)).toContain('Ray Berry — MISSED: Evening Supervision — 2026-10-05'));
    expect((await ap('/api/ap/supervision', { date: '2026-10-04', op: 'exception', reason: 'Work schedule conflict' })).json).toMatchObject({ status: 'EXCEPTION · Work schedule conflict' });
    expect((await ap('/api/ap/supervision', { date: '2026-10-02', op: 'missed' })).status).toBe(409);
  });
});

describe('updates, exports, takedown', () => {
  it('requires a co-signature date for an amendment (§12)', async () => {
    expect((await ap('/api/ap/update', { type: 'amendment', title: 'Schedule change', body: 'Supervision moves to Mon–Fri.' })).status).toBe(400);
    expect((await ap('/api/ap/update', { type: 'amendment', title: 'Schedule change', body: 'Supervision moves to Mon–Fri.', cosigned_on: '2026-10-06' })).status).toBe(200);
  });

  it('exports CSV with formula injection neutralised', async () => {
    await env.DB.prepare("INSERT INTO observer_reports (received_at, type, message) VALUES ('2026-10-06T12:00:00Z', 'Other', '=HYPERLINK(\"x\")')").run();
    const res = await ap('/api/ap/export.csv?table=observer_reports');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect((await ap('/api/ap/export.csv?table=sqlite_master')).status).toBe(400);
  });

  it('takes a file down under §10 with a dated explanation', async () => {
    await env.DB.prepare("INSERT INTO days (date, weight_lb, video) VALUES ('2026-10-05', 338.4, 'https://customer-x.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe')").run();
    expect((await ap('/api/ap/takedown', { date: '2026-10-05', field: 'video', explanation: 'short' })).status).toBe(400);
    expect((await ap('/api/ap/takedown', { date: '2026-10-05', field: 'video', explanation: 'A non-consenting visitor appears in frame.' })).status).toBe(200);
    const day = await env.DB.prepare("SELECT video, note FROM days WHERE date = '2026-10-05'").first<{ video: string | null; note: string }>();
    expect(day!.video).toBeNull();
    expect(day!.note).toBe('2026-10-06: inspection video removed under §10 — A non-consenting visitor appears in frame.');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM redactions').first('n')).toBe(1);
  });

  it('shows the AP everything pending', async () => {
    const st = await ap('/api/ap/state');
    expect(st.json).toMatchObject({ ok: true, agreement: { active: true } });
    // Pre-Day-1 entries are history, not a review queue (§1): hidden and counted.
    expect(st.json!.flags.map((f: { date: string }) => f.date)).not.toContain('2026-10-02');
    expect(st.json!.pre_agreement_entries).toBe(1);
    expect(st.json!.subscribers).toEqual({ ACTIVE: 1 });
    expect(st.json!.recent.length).toBeGreaterThan(0);
  });
});
