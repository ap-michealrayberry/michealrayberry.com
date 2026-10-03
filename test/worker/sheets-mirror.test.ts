import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mirrorSheets } from '../../src/cron/sheets-mirror';

const NOW = new Date('2026-10-05T16:00:00Z');
const csv = (rows: string[][]) => rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');

const FEEDS: Record<string, string> = {
  WEIGHINS_CSV: csv([
    ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video', 'video_sec', 'stream_uid', 'r2_key'],
    ['2026-10-04', '338.9', 'scale-synced', '', '', '', '', '', '', '', ''],
  ]),
  VIOLATION_CSV: csv([['date', 'violation', 'status', 'submitted', 'resolved', 'ap_verification', 'corrections', 'recording', 'event_verification']]),
  ATTESTATION_CSV: csv([['logged_at_server', 'date', 'day', 'event', 'code', 'kind', 'video_sha256', 'photo_sha256s', 'weight', 'status', 'chunk_chain', 'chunk_count', 'server_seal', 'sealed_at']]),
  SITE_STATE_CSV: csv([['key', 'value'], ['start_date', '2026-10-11'], ['intro_video_url', 'https://youtu.be/abc']]),
  CONFIRMATIONS_CSV: csv([['logged_at', 'date', 'version', 'day', 'url', 'attestation_seal']]),
  SUPERVISION_CSV: csv([['date', 'required', 'status', 'start', 'end', 'stream_url', 'note']]),
  UPDATES_CSV: csv([['date', 'type', 'title', 'body', 'link'], ['2026-10-03', 'official', 'Entry 001', 'Day 1.', '']]),
};
const urls = Object.fromEntries(Object.keys(FEEDS).map((k) => [k, `https://sheets.test/${k}`]));
const mirrorEnv = { ...env, SHEETS_FEEDS: JSON.stringify(urls) };

function mockFeeds(overrides: Record<string, string> = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const name = String(input instanceof Request ? input.url : input).split('/').pop()!;
    return new Response(overrides[name] ?? FEEDS[name]);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Sheets mirror (steps 2–3)', () => {
  it('replaces the mirrored tables and upserts Site State', async () => {
    await env.DB.prepare("INSERT INTO site_state (key, value) VALUES ('participant_signature_verified_on', '2026-10-03')").run();
    mockFeeds();
    const result = await mirrorSheets(mirrorEnv, NOW);
    expect(result).toMatchObject({ changed: true, counts: { days: 1, updates: 1 } });
    expect(await env.DB.prepare('SELECT weight_lb FROM days WHERE date = ?').bind('2026-10-04').first('weight_lb')).toBe(338.9);
    const state = await env.DB.prepare('SELECT key, value FROM site_state ORDER BY key').all<{ key: string; value: string }>();
    // start_date never carries over; a key recorded only in D1 survives.
    expect(state.results).toEqual([
      { key: 'intro_video_url', value: 'https://youtu.be/abc' },
      { key: 'participant_signature_verified_on', value: '2026-10-03' },
    ]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM events WHERE action = 'sheets.mirror'").first('n')).toBe(1);
  });

  it('does nothing when the feeds have not changed', async () => {
    mockFeeds();
    expect(await mirrorSheets(mirrorEnv, NOW)).toEqual({ changed: false });
  });

  it('refuses a feed whose header changed, leaving D1 as it was', async () => {
    mockFeeds({ UPDATES_CSV: csv([['when', 'what']]) });
    await expect(mirrorSheets(mirrorEnv, NOW)).rejects.toThrow(/Updates header changed/);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM days').first('n')).toBe(1);
  });
});
