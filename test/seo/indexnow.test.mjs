import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_ORIGIN } from '../../scripts/lib/common.mjs';
import {
  validateKey, normalizeUrls, batch, assertKeyPublished, submitUrls, INDEXNOW_ENDPOINT,
} from '../../scripts/submit-indexnow.mjs';

const O = SITE_ORIGIN;
const KEY = 'abcdef0123456789abcdef0123456789';
const resp = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('validateKey accepts a well-formed key and rejects bad ones', () => {
  assert.equal(validateKey(KEY), KEY);
  assert.throws(() => validateKey('short'));
  assert.throws(() => validateKey('has spaces and !!'));
  assert.throws(() => validateKey(null));
});

test('normalizeUrls keeps same-origin, dedupes, and rejects external/malformed', () => {
  const { urls, rejected } = normalizeUrls([
    `${O}/daily/`, `${O}/daily/`, 'https://evil.example.com/x', 'not a url', `${O}/feed.xml`,
  ]);
  assert.deepEqual(urls, [`${O}/daily/`, `${O}/feed.xml`]);
  assert.deepEqual(rejected, ['https://evil.example.com/x', 'not a url']);
});

test('normalizeUrls throws on a non-array (malformed input)', () => {
  assert.throws(() => normalizeUrls({ not: 'an array' }));
});

test('batch splits at the configured limit', () => {
  assert.deepEqual(batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(batch([], 2), []);
});

test('empty submission makes no HTTP calls', async () => {
  let calls = 0;
  const results = await submitUrls({ urls: [], key: KEY, fetchImpl: async () => { calls++; return resp(200); } });
  assert.equal(calls, 0);
  assert.deepEqual(results, []);
});

test('assertKeyPublished passes when the key file matches', async () => {
  const loc = await assertKeyPublished({ key: KEY, fetchImpl: async () => resp(200, `${KEY}\n`) });
  assert.equal(loc, `${O}/indexnow-key.txt`);
});

test('assertKeyPublished fails on mismatch, 404, and network error', async () => {
  await assert.rejects(assertKeyPublished({ key: KEY, fetchImpl: async () => resp(200, 'different') }));
  await assert.rejects(assertKeyPublished({ key: KEY, fetchImpl: async () => resp(404) }));
  await assert.rejects(assertKeyPublished({ key: KEY, fetchImpl: async () => { throw new Error('ENET'); } }));
});

test('submitUrls accepts HTTP 200', async () => {
  const results = await submitUrls({ urls: [`${O}/daily/`], key: KEY, fetchImpl: async () => resp(200) });
  assert.deepEqual(results, [{ count: 1, status: 200 }]);
});

test('submitUrls accepts HTTP 202', async () => {
  const results = await submitUrls({ urls: [`${O}/daily/`], key: KEY, fetchImpl: async () => resp(202) });
  assert.deepEqual(results, [{ count: 1, status: 202 }]);
});

for (const status of [400, 403, 429]) {
  test(`submitUrls rejects HTTP ${status}`, async () => {
    await assert.rejects(
      submitUrls({ urls: [`${O}/daily/`], key: KEY, fetchImpl: async () => resp(status, 'nope') }),
      new RegExp(String(status)),
    );
  });
}

test('submitUrls surfaces a network failure', async () => {
  await assert.rejects(
    submitUrls({ urls: [`${O}/daily/`], key: KEY, fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
    /network/,
  );
});

test('submitUrls batches requests above the protocol limit', async () => {
  const many = Array.from({ length: 10001 }, (_, i) => `${O}/daily/2099-01-01-day-${i}/`);
  let calls = 0;
  const sizes = [];
  await submitUrls({
    urls: many, key: KEY,
    fetchImpl: async (_url, opts) => { calls++; sizes.push(JSON.parse(opts.body).urlList.length); return resp(200); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(sizes, [10000, 1]);
});

test('submitUrls posts the correct IndexNow payload to the endpoint', async () => {
  let captured = null;
  await submitUrls({
    urls: [`${O}/daily/`], key: KEY,
    fetchImpl: async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return resp(200); },
  });
  assert.equal(captured.url, INDEXNOW_ENDPOINT);
  assert.equal(captured.body.host, new URL(O).host);
  assert.equal(captured.body.key, KEY);
  assert.equal(captured.body.keyLocation, `${O}/indexnow-key.txt`);
  assert.deepEqual(captured.body.urlList, [`${O}/daily/`]);
});
