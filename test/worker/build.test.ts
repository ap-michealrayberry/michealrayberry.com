import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderSite, runBuild, SITE_PREFIX } from '../../src/build';
import { imageSize } from '../../src/build/image-meta';
import { runScheduled } from '../../src/worker';
import { PHOTO_JPEG_BASE64 } from '../fixtures/photo';

const ORIGIN = 'https://michealrayberry.com';
// 2026-10-05 8:00 PM EDT (Monday), after Day 3's packet was filed.
const NOW = new Date('2026-10-06T00:00:00Z');
const photo = Uint8Array.from(atob(PHOTO_JPEG_BASE64), (c) => c.charCodeAt(0));
const photoKey = (view: string) => `photos/2026/10/05/micheal-ray-berry-day-003-${view}-2026-10-05.jpg`;

async function read(path: string): Promise<string | null> {
  const object = await env.MEDIA.get(SITE_PREFIX + path);
  return object ? object.text() : null;
}

beforeAll(async () => {
  await env.DB.batch([
    "INSERT INTO site_state (key, value) VALUES ('agreement_edition', '2'), ('participant_signature_verified_on', '2026-10-03'), ('ap_signature_verified_on', '2026-10-03'), ('consent_recording_date', '2026-10-03'), ('consent_reviewed_on', '2026-10-03')",
    "INSERT INTO confirmations (logged_at, date, edition, day) VALUES ('2026-10-03T16:00:00Z', '2026-10-03', 2, 1)",
    `INSERT INTO days (date, weight_lb, note, photo_front, photo_left, photo_rear, photo_right, video, video_sec) VALUES ('2026-10-05', 338.4, 'scale-synced', '${ORIGIN}/${photoKey('front')}', '${ORIGIN}/${photoKey('left')}', '${ORIGIN}/${photoKey('rear')}', '${ORIGIN}/${photoKey('right')}', 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe', 300)`,
    // A legacy violation from before Day 1 and one AP-verified after it, with its assignment.
    "INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-09-15', 'Missed 10 PM ET deadline — legacy', 'open', '2026-09-20', 'V-AAAAAAAAAAAA')",
    "INSERT INTO violations (date, violation, status, verified_at, public_id) VALUES ('2026-10-04', 'Missed 10 PM ET deadline — Daily Compliance Packet incomplete', 'open', '2026-10-05', 'V-0123456789AB')",
    "INSERT INTO violations (date, violation, status) VALUES ('2026-10-04', 'Unreviewed automated flag', 'flagged')",
    "INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status) SELECT id, 'C-1', '2026-10-05T14:00:00.000Z', '2026-10-08T14:00:00.000Z', 1, 10, 'assigned' FROM violations WHERE public_id = 'V-0123456789AB'",
  ].map((s) => env.DB.prepare(s)));
  for (const view of ['front', 'left', 'rear', 'right']) {
    await env.MEDIA.put(photoKey(view), photo, { httpMetadata: { contentType: 'image/jpeg' } });
  }
});

describe('image header sizes', () => {
  it('reads JPEG dimensions without decoding', () => {
    expect(imageSize(photo)).toEqual({ width: 270, height: 480 });
  });
});

describe('static build (D1 → R2)', () => {
  it('builds the site into R2 and records the build', async () => {
    const result = await runBuild(env, 'test', NOW);
    expect(result).toMatchObject({ built: true });
    expect(result.files).toBeGreaterThan(40);
    const event = await env.DB.prepare("SELECT payload FROM events WHERE action = 'site.build' ORDER BY id DESC").first<{ payload: string }>();
    expect(JSON.parse(event!.payload)).toMatchObject({ reason: 'test' });
    expect(await env.CACHE.get('site:build')).toBe(NOW.toISOString());
  });

  it('publishes the complete day with its photographs, manifest and digest', async () => {
    const page = await read('daily/2026-10-05-day-003/index.html');
    expect(page).toContain('338.4');
    expect(page).toContain(`${ORIGIN}/${photoKey('rear')}`);
    const manifest = JSON.parse((await read('manifests/2026-10-05.json'))!);
    expect(manifest.record).toMatchObject({ date: '2026-10-05', day: 3, weight_lb: 338.4 });
    expect(manifest.photos.front).toMatchObject({ width: 270, height: 480 });
    expect(manifest.photos.front.sha256).toMatch(/^[a-f0-9]{64}$/);
    const digest = await read('manifests/2026-10-05.sha256');
    const manifestText = (await read('manifests/2026-10-05.json'))!;
    const expected = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(digest).toBe(`${expected}  2026-10-05.json\n`);
  });

  it('fills in the days without a record', async () => {
    expect(await read('daily/2026-10-03-day-001/index.html')).toContain('Day 1');
    expect(await read('daily/2026-10-04-day-002/index.html')).not.toBeNull();
  });

  it('publishes only AP-verified events on or after the effective date (§1, §8)', async () => {
    const index = (await read('violations/index.html'))!;
    expect(index).toContain('V-0123456789AB');
    expect(index).not.toContain('V-AAAAAAAAAAAA');
    expect(index).not.toContain('Unreviewed automated flag');
    expect(await read('violations/v-aaaaaaaaaaaa/index.html')).toBeNull();
  });

  it('shows the recorded corrective requirement and its exact due time', async () => {
    const page = (await read('violations/v-0123456789ab/index.html'))!;
    expect(page).toContain('LEVEL 1 · 10 MINUTES');
    expect(page).toContain('10/08/2026, 10:00 AM EDT');
    expect(page).not.toContain('next level follows');
  });

  it('uses Cloudflare Image Transformations for derivatives once enabled', async () => {
    const { files } = await renderSite({ ...env, IMAGE_TRANSFORMS: 'on' }, NOW);
    const page = String(files.get('daily/2026-10-05-day-003/index.html'));
    expect(page).toContain(`${ORIGIN}/cdn-cgi/image/width=270,format=webp,quality=82/${photoKey('front')}`);
    const manifest = JSON.parse(String(files.get('manifests/2026-10-05.json')));
    expect(manifest.photos.front.url).toBe(`${ORIGIN}/${photoKey('front')}`);
  });

  it('renders report cards as PNG, embedding the front photograph', async () => {
    const card = await env.MEDIA.get(`${SITE_PREFIX}cards/2026-10-05.png`);
    expect(card?.httpMetadata?.contentType).toBe('image/png');
    const bytes = new Uint8Array(await card!.arrayBuffer());
    expect(imageSize(bytes)).toEqual({ width: 1080, height: 1350 });
  });

  it('rewrites only what changed and removes what a build no longer produces', async () => {
    await env.MEDIA.put(`${SITE_PREFIX}violations/v-ffffffffffff/index.html`, 'stale');
    const again = await runBuild(env, 'test', NOW);
    expect(again).toMatchObject({ built: true, written: 0, cards: 0, deleted: 1 });
    expect(await read('violations/v-ffffffffffff/index.html')).toBeNull();
  });

  it('runs one build at a time', async () => {
    await env.DB.prepare("UPDATE locks SET until = '2999-01-01T00:00:00.000Z' WHERE name = 'build'").run();
    expect(await runBuild(env, 'test', NOW)).toEqual({ built: false, reason: 'another build is running' });
    await env.DB.prepare("UPDATE locks SET until = '1970-01-01T00:00:00.000Z' WHERE name = 'build'").run();
  });
});

describe('serving', () => {
  it('serves generated pages with the site security headers', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/violations/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await res.text()).toContain('V-0123456789AB');
  });

  it('redirects a directory without its slash', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/violations`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/violations/`);
  });

  it('serves filed photographs from R2, immutable', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/${photoKey('front')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(photo);
  });

  it('answers 404 for missing pages and refuses traversal and writes', async () => {
    expect((await exports.default.fetch(`${ORIGIN}/daily/2099-01-01-day-999/`)).status).toBe(404);
    expect((await exports.default.fetch(`${ORIGIN}/%2e%2e/backups/x.sql`)).status).toBe(404);
    expect((await exports.default.fetch(`${ORIGIN}/daily/`, { method: 'POST' })).status).toBe(405);
  });

  it('never serves objects outside site/ and photos/', async () => {
    await env.MEDIA.put('backups/2026-10-05.sql', 'secret');
    expect((await exports.default.fetch(`${ORIGIN}/backups/2026-10-05.sql`)).status).toBe(404);
  });

  it('redirects www to the canonical host, keeping the path', async () => {
    const res = await exports.default.fetch('https://www.michealrayberry.com/daily/?x=1', { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://michealrayberry.com/daily/?x=1');
  });

  it('builds only from the AP role', async () => {
    const mrb = await exports.default.fetch('http://localhost:8787/api/ap/build', { method: 'POST' });
    expect(mrb.status).toBe(403);
  });
});

describe('cron', () => {
  it('runs the nightly build and backup at 00:10 ET, once, in both EDT and EST', async () => {
    expect((await runScheduled(env, new Date('2026-10-06T04:10:00Z')))['nightly-build-backup']).toMatch(/^build done; backup \d+ bytes$/);
    expect((await runScheduled(env, new Date('2026-10-06T04:15:00Z')))['nightly-build-backup']).toBeUndefined();
    expect((await runScheduled(env, new Date('2026-10-06T05:10:00Z')))['nightly-build-backup']).toBeUndefined();
    expect((await runScheduled(env, new Date('2026-11-10T05:10:00Z')))['nightly-build-backup']).toMatch(/^build done/);
    expect(await env.MEDIA.head('backups/2026-10-05.sql')).not.toBeNull();
  });
});
