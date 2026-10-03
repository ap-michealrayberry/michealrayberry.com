import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMe } from '../../src/api/me';

const MRB = { ok: true as const, email: 'michealrayberry@gmail.com', role: 'mrb' as const };
// 2026-10-05 3:00 PM EDT, a Monday.
const NOW = new Date('2026-10-05T19:00:00Z');

async function seed(statements: string[]) {
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
}

const EXECUTED = [
  "INSERT INTO site_state (key, value) VALUES ('agreement_edition', '2'), ('participant_signature_verified_on', '2026-10-03'), ('ap_signature_verified_on', '2026-10-03'), ('consent_recording_date', '2026-10-03'), ('consent_reviewed_on', '2026-10-03')",
  "INSERT INTO confirmations (logged_at, date, edition, day) VALUES ('2026-10-03T16:00:00Z', '2026-10-03', 2, 1)",
];

beforeEach(async () => {
  await seed(['DELETE FROM correctives', 'DELETE FROM correction_requests', 'DELETE FROM violations', 'DELETE FROM days', 'DELETE FROM site_state', 'DELETE FROM confirmations', 'DELETE FROM supervision']);
});

describe('GET /api/me', () => {
  it('requires a signed-in identity off localhost', async () => {
    const res = await exports.default.fetch('https://michealrayberry.com/api/me');
    expect(res.status).toBe(401);
  });

  it('answers on localhost through DEV_ACCESS_EMAIL', async () => {
    const res = await exports.default.fetch('http://localhost:8787/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, role: 'mrb' });
  });

  it('serves /api/health without sign-in and 404s unknown API routes', async () => {
    expect((await exports.default.fetch('https://michealrayberry.com/api/health')).status).toBe(200);
    expect((await exports.default.fetch('http://localhost:8787/api/nope')).status).toBe(404);
  });

  it('only accepts GET: there is nothing to write in step 1', async () => {
    const res = await exports.default.fetch('http://localhost:8787/api/me', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });

  it('reports the gate as inactive and requires nothing before execution is recorded', async () => {
    const me = await getMe(env.DB, MRB, NOW);
    expect(me.agreement.active).toBe(false);
    expect(me.packet.required).toBe(false);
    expect(me.supervision.required).toBe(false);
    expect(me.day).toBe(3);
  });

  it('shows today\'s packet, the 10 PM deadline and supervision once active', async () => {
    await seed([...EXECUTED, "INSERT INTO days (date, weight_lb, video, photo_front, photo_left) VALUES ('2026-10-05', 338.4, 'https://customer-x.cloudflarestream.com/u/iframe', 'f', 'l')"]);
    const me = await getMe(env.DB, MRB, NOW);
    expect(me.agreement).toMatchObject({ active: true, effective_date: '2026-10-03' });
    expect(me.packet).toMatchObject({
      required: true, deadline: '2026-10-06T02:00:00.000Z', seconds_left: 7 * 3600,
      tracker: true, weight: true, video: true, photos: 2, complete: false,
    });
    expect(me.supervision.required).toBe(true); // Monday night precedes a workday
  });

  it('never counts violations dated before the effective date (§1)', async () => {
    await seed([
      ...EXECUTED,
      "INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-09-15', 'legacy', 'open', '2026-09-20', 'V-AAAAAAAAAAAA')",
      "INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-10-04', 'Missed 10 PM ET deadline', 'open', '2026-10-05', 'V-BBBBBBBBBBBB')",
      "INSERT INTO violations (date, violation, status) VALUES ('2026-10-04', 'unreviewed flag', 'flagged')",
      "INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status) SELECT id, 'C-1', '2026-10-05T14:00:00Z', '2026-10-08T14:00:00Z', 1, 10, 'assigned' FROM violations WHERE public_id = 'V-BBBBBBBBBBBB'",
      "INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status) SELECT id, 'C-0', '2026-09-20', '2026-09-23', 1, 10, 'assigned' FROM violations WHERE public_id = 'V-AAAAAAAAAAAA'",
    ]);
    const me = await getMe(env.DB, MRB, NOW);
    expect(me.violations.map((v) => v.public_id)).toEqual(['V-BBBBBBBBBBBB']);
    expect(me.owed).toEqual([expect.objectContaining({ public_id: 'V-BBBBBBBBBBBB', level: 1, minutes: 10, due_at: '2026-10-08T14:00:00Z' })]);
  });

  it('reports a §9 revised due time in place of the original', async () => {
    await seed([
      ...EXECUTED,
      "INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-10-04', 'x', 'open', '2026-10-05', 'V-CCCCCCCCCCCC')",
      "INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status, revised_due_at) SELECT id, 'C-2', '2026-10-05T14:00:00Z', '2026-10-08T14:00:00Z', 1, 10, 'assigned', '2026-10-10T14:00:00Z' FROM violations",
    ]);
    const me = await getMe(env.DB, MRB, NOW);
    expect(me.owed[0].due_at).toBe('2026-10-10T14:00:00Z');
  });

  it('does not write anything', async () => {
    const before = await env.DB.prepare('SELECT (SELECT count(*) FROM events) + (SELECT count(*) FROM days) AS n').first<{ n: number }>();
    await exports.default.fetch('http://localhost:8787/api/me');
    const after = await env.DB.prepare('SELECT (SELECT count(*) FROM events) + (SELECT count(*) FROM days) AS n').first<{ n: number }>();
    expect(after).toEqual(before);
  });
});
