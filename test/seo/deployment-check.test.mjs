import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_ORIGIN } from '../../scripts/lib/common.mjs';
import { withCacheBust, probe, verifyDeployment } from '../../scripts/check-deployment.mjs';

const O = SITE_ORIGIN;
const PAGE = `${O}/daily/2026-08-02-day-014/`;
const SITEMAP = `${O}/sitemap.xml`;
const resp = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const noSleep = async () => {};
const clean = (u) => u.split('?')[0];
const targets = () => [{ url: PAGE, marker: PAGE }, { url: SITEMAP }];

test('withCacheBust adds a unique cache-busting query parameter', () => {
  const a = withCacheBust(PAGE, 't1');
  const b = withCacheBust(PAGE, 't2');
  assert.ok(a.includes('_cb=t1'));
  assert.notEqual(a, b);
  assert.equal(clean(a), PAGE);
});

test('probe follows redirects and passes when the marker is present', async () => {
  const r = await probe({ url: PAGE, marker: PAGE, fetchImpl: async () => resp(200, `canonical ${PAGE}`) });
  assert.equal(r.ok, true);
});

test('probe fails when the body lacks the marker (previous version)', async () => {
  const r = await probe({ url: PAGE, marker: PAGE, fetchImpl: async () => resp(200, 'old homepage, no new page') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /marker/);
});

test('deployment verified once the page becomes available with its marker', async () => {
  let pageHits = 0;
  const fetchImpl = async (u) => {
    if (clean(u) === SITEMAP) return resp(200, '<sitemapindex/>');
    pageHits++;
    return pageHits < 3 ? resp(404) : resp(200, `<link rel="canonical" href="${PAGE}">`);
  };
  const r = await verifyDeployment({ targets: targets(), fetchImpl, retries: 5, delayMs: 1, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
});

test('old content served without the marker eventually passes when the marker appears', async () => {
  let pageHits = 0;
  const fetchImpl = async (u) => {
    if (clean(u) === SITEMAP) return resp(200, '<sitemapindex/>');
    pageHits++;
    return pageHits < 2 ? resp(200, 'stale previous deploy') : resp(200, `here is ${PAGE} now`);
  };
  const r = await verifyDeployment({ targets: targets(), fetchImpl, retries: 4, delayMs: 1, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test('a persistent HTTP 404 fails after bounded retries', async () => {
  const fetchImpl = async (u) => (clean(u) === SITEMAP ? resp(200, 'x') : resp(404));
  const r = await verifyDeployment({ targets: targets(), fetchImpl, retries: 3, delayMs: 1, sleep: noSleep });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.ok(r.failures.some((f) => /404/.test(f.reason)));
});

test('a redirect loop (fetch throws) is a bounded failure', async () => {
  const fetchImpl = async () => { throw new Error('maximum redirect reached'); };
  const r = await verifyDeployment({ targets: targets(), fetchImpl, retries: 2, delayMs: 1, sleep: noSleep });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /request failed/.test(f.reason)));
});

test('a timeout (AbortError) is a bounded failure', async () => {
  const fetchImpl = async () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; };
  const r = await verifyDeployment({ targets: [{ url: PAGE, marker: PAGE }], fetchImpl, retries: 2, delayMs: 1, sleep: noSleep });
  assert.equal(r.ok, false);
});

test('deployment fails when the sitemap is not updated even if the page is live', async () => {
  const fetchImpl = async (u) => (clean(u) === SITEMAP ? resp(404) : resp(200, PAGE));
  const r = await verifyDeployment({ targets: targets(), fetchImpl, retries: 2, delayMs: 1, sleep: noSleep });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.target.url === SITEMAP));
});
