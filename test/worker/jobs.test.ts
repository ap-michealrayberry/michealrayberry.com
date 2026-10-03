import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { correctiveDeadlineWatch, morningBrief, nightlyCheck, supervisionCheck } from '../../src/cron/jobs';
import { syncWeights } from '../../src/cron/fitbit';

const ORIGIN = 'https://michealrayberry.com';
let sent: { To: string; Subject: string; TextBody: string; MessageStream: string; Headers: { Name: string; Value: string }[] }[] = [];
let turnstileOk = true;
let fitbitLogs: unknown[] = [];

function mockNetwork() {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://api.postmarkapp.com/email') {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ErrorCode: 0, MessageID: `m${sent.length}` });
    }
    if (url.includes('turnstile/v0/siteverify')) return Response.json({ success: turnstileOk, hostname: 'michealrayberry.com', action: 'observer' });
    if (url.startsWith('https://api.fitbit.com/1/user/-/body/log/weight/')) return Response.json({ weight: fitbitLogs });
    return real(input, init);
  });
}

beforeAll(async () => {
  await env.DB.batch([
    "INSERT INTO site_state (key, value) VALUES ('agreement_edition', '2'), ('participant_signature_verified_on', '2026-10-03'), ('ap_signature_verified_on', '2026-10-03'), ('consent_recording_date', '2026-10-03'), ('consent_reviewed_on', '2026-10-03')",
    "INSERT INTO confirmations (logged_at, date, edition, day) VALUES ('2026-10-03T16:00:00Z', '2026-10-03', 2, 1)",
    "INSERT INTO subscribers (email, status, token) VALUES ('watcher@example.com', 'ACTIVE', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')",
  ].map((s) => env.DB.prepare(s)));
});
beforeEach(() => { sent = []; mockNetwork(); });
afterEach(() => vi.restoreAllMocks());

describe('10 PM nightly check (§4, §8)', () => {
  it('flags an incomplete packet privately, tells the AP, and tells subscribers it is an automated flag', async () => {
    await env.DB.prepare("INSERT INTO days (date, weight_lb, photo_front) VALUES ('2026-10-05', 338.4, 'x')").run();
    expect(await nightlyCheck(env, new Date('2026-10-06T02:00:00Z'))).toBe('flagged');
    const flag = await env.DB.prepare("SELECT status, public_id, source, requirement, violation FROM violations WHERE date = '2026-10-05'").first<Record<string, string | null>>();
    expect(flag).toMatchObject({ status: 'flagged', public_id: null, source: 'nightly', requirement: 'daily-packet' });
    expect(flag!.violation).toContain('accountability photographs (1/4 filed), four-angle inspection video');
    const ap = sent.find((m) => m.To === 'ap@michealrayberry.com')!;
    expect(ap.Subject).toBe('MRB Day 3 — AP REVIEW REQUIRED: packet files incomplete when checked');
    expect(ap.TextBody).toContain('This observation is not a deadline verdict or a Violation Event.');
    const sub = sent.find((m) => m.To === 'watcher@example.com')!;
    expect(sub.Subject).toBe('Ray Berry — Daily Result: INCOMPLETE AT 10 PM — Day 3');
    expect(sub.TextBody).toContain('An automated flag does not by itself establish a missed deadline.');
    expect(sub.TextBody).toContain(`Unsubscribe: ${ORIGIN}/api/subscribe?unsubscribe=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
    expect(sub.MessageStream).toBe('broadcast');
    expect(sub.Headers).toContainEqual({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' });
  });

  it('adds no second flag on a re-run', async () => {
    expect(await nightlyCheck(env, new Date('2026-10-06T02:10:00Z'))).toBe('flagged');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM violations WHERE date = '2026-10-05'").first('n')).toBe(1);
    expect(sent.find((m) => m.To === 'ap@michealrayberry.com')!.TextBody).toContain('The existing private review signal was retained.');
  });

  it('reports a filed packet', async () => {
    await env.DB.prepare("INSERT INTO days (date, weight_lb, photo_front, photo_left, photo_rear, photo_right, video) VALUES ('2026-10-06', 338.0, 'a', 'b', 'c', 'd', 'v')").run();
    expect(await nightlyCheck(env, new Date('2026-10-07T02:00:00Z'))).toBe('complete');
    expect(sent.map((m) => m.Subject)).toEqual(['Ray Berry — Daily Result: PACKET FILED — Day 4']);
  });

  it('does nothing before activation or on a date outside the agreement', async () => {
    expect(await nightlyCheck(env, new Date('2026-10-03T02:00:00Z'))).toBe('inactive'); // Oct 2: before Day 1
    expect(sent).toEqual([]);
  });

  it('never publishes a flag', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/health`);
    expect(res.status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM violations WHERE status = 'flagged' AND public_id IS NOT NULL").first('n')).toBe(0);
  });
});

describe('22:20 supervision check (§6)', () => {
  it('marks REVIEW REQUIRED on a required night with nothing submitted, never MISSED', async () => {
    expect(await supervisionCheck(env, new Date('2026-10-06T02:20:00Z'))).toBe('review required'); // Monday night
    expect(await env.DB.prepare("SELECT status FROM supervision WHERE date = '2026-10-05'").first('status')).toBe('REVIEW REQUIRED');
    expect(sent[0].Subject).toBe('REVIEW REQUIRED — Evening Supervision 2026-10-05');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM supervision WHERE status = 'MISSED'").first('n')).toBe(0);
  });

  it('leaves a submitted night alone and skips nights that are not required', async () => {
    await env.DB.prepare("INSERT INTO supervision (date, required, status) VALUES ('2026-10-06', 1, 'SUBMITTED · awaiting AP verification')").run();
    expect(await supervisionCheck(env, new Date('2026-10-07T02:20:00Z'))).toMatch(/^already SUBMITTED/);
    expect(await supervisionCheck(env, new Date('2026-10-10T02:20:00Z'))).toBe('not required'); // Friday
    expect(sent).toEqual([]);
  });
});

describe('corrective deadline watch (§8)', () => {
  beforeAll(async () => {
    await env.DB.prepare("INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-10-04', 'Missed 10 PM ET deadline', 'open', '2026-10-05', 'V-0123456789AB')").run();
    await env.DB.prepare("INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status) SELECT id, 'C-AAAAAAAAAAAAAAAAAAAAAAAA', '2026-10-05T14:00:00.000Z', '2026-10-08T14:00:00.000Z', 1, 10, 'assigned' FROM violations WHERE public_id = 'V-0123456789AB'").run();
  });
  it('flags only after the exact due time, once, and never escalates', async () => {
    expect(await correctiveDeadlineWatch(env, new Date('2026-10-08T13:59:00Z'))).toBe('0 flagged');
    expect(await correctiveDeadlineWatch(env, new Date('2026-10-08T14:01:00Z'))).toBe('1 flagged');
    expect(await correctiveDeadlineWatch(env, new Date('2026-10-08T15:01:00Z'))).toBe('0 flagged');
    expect(sent.map((m) => m.Subject)).toEqual(['AP REVIEW REQUIRED — possible corrective-window lapse']);
    expect(await env.DB.prepare("SELECT status FROM violations WHERE public_id = 'V-0123456789AB'").first('status')).toBe('open');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM violations WHERE public_id IS NOT NULL").first('n')).toBe(1);
  });
});

describe('morning brief', () => {
  it("lists the packet, tonight's supervision and the governed consequence", async () => {
    expect(await morningBrief(env, new Date('2026-10-07T11:00:00Z'))).toBe('sent');
    const m = sent[0];
    expect(m.To).toBe('contact@michealrayberry.com');
    expect(m.Subject).toBe('Day 5 — due by 10 PM ET tonight');
    expect(m.TextBody).toContain('EVENING SUPERVISION tonight, 6:00–10:00 PM Eastern (§6)');
    expect(m.TextBody).toContain('If the AP verifies a deadline miss, the governed consequence would be: Level 2 — 20 continuous minutes');
    expect(m.TextBody).toContain('Nothing in this message is published.');
  });
});

describe('notifications sign-up (double opt-in)', () => {
  const post = (body: string, path = '/api/subscribe') => exports.default.fetch(`${ORIGIN}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  it('confirms by email, then unsubscribes, and an old confirm link never re-activates', async () => {
    expect((await post('email=New@Example.com')).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].Subject).toBe('Confirm: Micheal Ray Berry public accountability notifications');
    const token = sent[0].TextBody.match(/confirm=([a-f0-9]{32})/)![1];
    expect((await post('email=new@example.com')).status).toBe(200);
    expect(sent).toHaveLength(1); // pending: no second email within 10 minutes
    const confirm = await exports.default.fetch(`${ORIGIN}/api/subscribe?confirm=${token}`);
    expect(await confirm.text()).toContain('Subscribed');
    expect(await env.DB.prepare("SELECT status FROM subscribers WHERE email = 'new@example.com'").first('status')).toBe('ACTIVE');
    expect((await post('', `/api/subscribe?unsubscribe=${token}`)).status).toBe(200); // one-click
    expect(await env.DB.prepare("SELECT status FROM subscribers WHERE email = 'new@example.com'").first('status')).toBe('UNSUBSCRIBED');
    expect((await exports.default.fetch(`${ORIGIN}/api/subscribe?confirm=${token}`)).status).toBe(400);
  });
  it('refuses invalid addresses and honours the honeypot', async () => {
    expect((await post('email=not-an-email')).status).toBe(400);
    expect((await post('email=bot@example.com&website=x')).status).toBe(200);
    expect(sent).toEqual([]);
  });
});

describe('observer reports (§10)', () => {
  const form = (fields: Record<string, string>) => exports.default.fetch(`${ORIGIN}/api/observer`, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
  });
  it('stores the report and tells the AP; nothing publishes', async () => {
    const res = await form({ type: 'Possible compliance issue', message: 'The stream was off at 8 PM.', 'cf-turnstile-response': 't', source_url: 'http://not-https.example' });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/observer/received/`);
    const row = await env.DB.prepare('SELECT type, review, source_url FROM observer_reports').first();
    expect(row).toEqual({ type: 'Possible compliance issue', review: 'received', source_url: null });
    expect(sent[0].Subject).toMatch(/^Observer submission #\d+ — Possible compliance issue$/);
  });
  it('refuses failed verification and unknown types', async () => {
    turnstileOk = false;
    expect((await form({ type: 'Other', message: 'x', 'cf-turnstile-response': 't' })).headers.get('location')).toContain('error=verify');
    turnstileOk = true;
    expect((await form({ type: 'Threat', message: 'x', 'cf-turnstile-response': 't' })).headers.get('location')).toContain('error=form');
  });
});

describe('Fitbit sync (§4)', () => {
  it('writes the latest scale reading of each date and ignores manual entries', async () => {
    await env.CACHE.put('fitbit:tokens', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600_000, user_id: 'u' }));
    fitbitLogs = [
      { logId: 11, date: '2026-10-08', time: '07:00:00', weight: 337.64, source: 'Aria' },
      { logId: 12, date: '2026-10-08', time: '09:00:00', weight: 330.0, source: 'Web' },
    ];
    expect(await syncWeights(env, new Date('2026-10-08T15:00:00Z'))).toBe('2 readings, 1 dates updated, 1 ignored');
    expect(await env.DB.prepare("SELECT weight_lb, note FROM days WHERE date = '2026-10-08'").first()).toEqual({ weight_lb: 337.6, note: 'scale-synced (Fitbit)' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM weight_readings').first('n')).toBe(2);
  });
});
