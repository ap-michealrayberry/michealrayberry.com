import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyAt, everyTickBetween, hourly, runDue, type Job } from '../../src/cron/schedule';
import { pollSupervision, SUBMITTED } from '../../src/cron/twitch';
import { dailyWeights } from '../../src/cron/fitbit';
import { dumpDatabase } from '../../src/cron/backup';

afterEach(() => vi.restoreAllMocks());

describe('Eastern-time slots across DST', () => {
  const at22 = dailyAt(22, 0, 55);
  it('fires at 22:00 EDT and 22:00 EST', () => {
    expect(at22(new Date('2026-10-06T02:00:00Z'))).toBe('2026-10-05'); // 22:00 EDT
    expect(at22(new Date('2026-11-03T03:00:00Z'))).toBe('2026-11-02'); // 22:00 EST
    expect(at22(new Date('2026-11-03T02:00:00Z'))).toBeNull();         // 21:00 EST
  });
  it('catches up within the window, not after it', () => {
    expect(at22(new Date('2026-10-06T02:50:00Z'))).toBe('2026-10-05');
    expect(at22(new Date('2026-10-06T02:56:00Z'))).toBeNull();
  });
  it('honours weekdays (Monday 09:00)', () => {
    const monday = dailyAt(9, 0, 55, [1]);
    expect(monday(new Date('2026-10-05T13:00:00Z'))).toBe('2026-10-05');
    expect(monday(new Date('2026-10-06T13:00:00Z'))).toBeNull();
  });
  it('slots hourly jobs by Eastern hour and ticks by 5 minutes', () => {
    expect(hourly(new Date('2026-10-06T03:30:00Z'))).toBe('2026-10-05T23');
    const poll = everyTickBetween([17, 45], [22, 15]);
    expect(poll(new Date('2026-10-05T21:46:10Z'))).toBe('2026-10-05T21:45:00.000Z');
    expect(poll(new Date('2026-10-05T21:40:00Z'))).toBeNull();
    expect(poll(new Date('2026-10-06T02:20:00Z'))).toBeNull();
  });
});

describe('job ledger', () => {
  it('runs a job once per slot and retries a failed run', async () => {
    let calls = 0;
    let fail = true;
    const job: Job = { name: 'test-job', slot: () => 'S1', run: async () => { calls++; if (fail) throw new Error('boom'); return 'ok'; } };
    expect(await runDue(env, [job], new Date())).toEqual({ 'test-job': 'failed: boom' });
    fail = false;
    expect(await runDue(env, [job], new Date())).toEqual({ 'test-job': 'ok' });
    expect(await runDue(env, [job], new Date())).toEqual({});
    expect(calls).toBe(2);
  });
});

describe('Twitch supervision poller (§6)', () => {
  const twitch = (live: boolean) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://id.twitch.tv/')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    return Response.json({ data: live ? [{ type: 'live', title: 'Evening Supervision' }] : [] });
  });
  const row = () => env.DB.prepare("SELECT status, start_at, end_at FROM supervision WHERE date = '2026-10-05'").first();

  it('records start on the first live sample and SUBMITTED on the first offline sample after', async () => {
    twitch(false);
    expect(await pollSupervision(env, '2026-10-05', new Date('2026-10-05T21:50:00Z'))).toBe('sampled');
    expect(await row()).toMatchObject({ status: 'SCHEDULED', start_at: null });
    vi.restoreAllMocks(); twitch(true);
    expect(await pollSupervision(env, '2026-10-05', new Date('2026-10-05T22:00:00Z'))).toBe('started');
    expect(await pollSupervision(env, '2026-10-05', new Date('2026-10-05T23:00:00Z'))).toBe('sampled');
    expect(await row()).toMatchObject({ status: 'IN PROGRESS', start_at: '2026-10-05T22:00:00.000Z' });
    vi.restoreAllMocks(); twitch(false);
    expect(await pollSupervision(env, '2026-10-05', new Date('2026-10-06T02:05:00Z'))).toBe('submitted');
    expect(await row()).toMatchObject({ status: SUBMITTED, end_at: '2026-10-06T02:05:00.000Z' });
  });

  it('never overrides an AP ruling', async () => {
    await env.DB.prepare("INSERT INTO supervision (date, required, status) VALUES ('2026-10-06', 1, 'MISSED') ON CONFLICT(date) DO UPDATE SET status = 'MISSED'").run();
    twitch(true);
    await pollSupervision(env, '2026-10-06', new Date('2026-10-06T22:30:00Z'));
    expect(await env.DB.prepare("SELECT status, start_at FROM supervision WHERE date = '2026-10-06'").first()).toEqual({ status: 'MISSED', start_at: null });
  });

  it('closes a session still live at 22:00 ET as submitted', async () => {
    twitch(true);
    await pollSupervision(env, '2026-10-07', new Date('2026-10-07T22:00:00Z'));
    expect(await pollSupervision(env, '2026-10-07', new Date('2026-10-08T02:05:00Z'))).toBe('submitted');
  });
});

describe('Fitbit weights (§4)', () => {
  const logs = [
    { logId: 1, date: '2026-10-05', time: '07:01:00', weight: 338.42, source: 'Aria' },
    { logId: 2, date: '2026-10-05', time: '07:03:00', weight: 338.2, source: 'Aria' },
    { logId: 3, date: '2026-10-05', time: '08:00:00', weight: 330.0, source: 'Web' },
    { logId: 4, date: '2026-10-06', time: '06:59:00', weight: 337.9, source: 'Aria' },
  ];
  it('takes the latest scale reading of each date and ignores manual entries', () => {
    const { accepted, rejected } = dailyWeights(logs, ['Aria']);
    expect(accepted.get('2026-10-05')?.logId).toBe(2);
    expect(accepted.get('2026-10-06')?.logId).toBe(4);
    expect(rejected.map((r) => r.logId)).toEqual([3]);
  });
});

describe('nightly backup', () => {
  it('dumps the schema and every row as SQL', async () => {
    await env.DB.prepare("INSERT INTO updates (date, type, title, body) VALUES ('2026-10-03', 'official', 'It''s Day 1', 'x')").run();
    const sql = await dumpDatabase(env.DB);
    expect(sql).toContain('CREATE TABLE days');
    expect(sql).toContain('CREATE TRIGGER events_no_update');
    expect(sql).toContain("'It''s Day 1'");
  });
});
