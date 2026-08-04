/* IndexNow submission. Reads an explicit list of changed URLs (default
   .seo-changed-urls.json, produced by scripts/collect-changed-urls.mjs) and
   submits them to the IndexNow API.

   Usage:
     node scripts/submit-indexnow.mjs [--input .seo-changed-urls.json] [--dry-run]

   Contract:
     - Key from INDEXNOW_KEY, else indexnow-key.txt; validated for format.
     - The key file must be publicly reachable at SITE_ORIGIN/indexnow-key.txt
       and its contents must equal the key (the protocol requires this).
     - URLs are de-duplicated and external hosts are rejected.
     - Requests are split at the protocol's 10,000-URL limit.
     - HTTP 200 and 202 are accepted; anything else fails.
     - ANY failure (invalid key, unreachable key file, network error, malformed
       input, rejected submission) exits nonzero so the SEO workflow fails —
       while the already-deployed site stays online. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, SITE_ORIGIN } from './lib/common.mjs';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const MAX_URLS_PER_REQUEST = 10000;
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

export function validateKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw new Error(`Invalid IndexNow key format: ${JSON.stringify(key)} (expect 8–128 chars of [A-Za-z0-9-]).`);
  }
  return key;
}

export function normalizeUrls(urls, origin = SITE_ORIGIN) {
  if (!Array.isArray(urls)) throw new Error('URL list is not a JSON array.');
  const host = new URL(origin).host;
  const kept = [];
  const rejected = [];
  const seen = new Set();
  for (const u of urls) {
    let parsed;
    try { parsed = new URL(u); } catch { rejected.push(u); continue; }
    if (parsed.host !== host) { rejected.push(u); continue; }
    if (seen.has(parsed.toString())) continue;
    seen.add(parsed.toString());
    kept.push(parsed.toString());
  }
  return { urls: kept, rejected };
}

export function batch(urls, size = MAX_URLS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size));
  return out;
}

/* Confirm the key file is publicly served and matches the key — a hard
   requirement of the IndexNow protocol. */
export async function assertKeyPublished({ origin = SITE_ORIGIN, key, fetchImpl = fetch }) {
  const keyLocation = `${origin}/indexnow-key.txt`;
  let res;
  try { res = await fetchImpl(keyLocation, { redirect: 'follow' }); }
  catch (e) { throw new Error(`Could not fetch key file ${keyLocation}: ${e.message}`); }
  if (!res.ok) throw new Error(`Key file ${keyLocation} not publicly reachable: HTTP ${res.status}`);
  const body = (await res.text()).trim();
  if (body !== key) throw new Error(`Key file ${keyLocation} does not match the submission key.`);
  return keyLocation;
}

/* Submit already-normalized same-origin URLs. Returns per-batch results.
   Throws on any non-2xx (other than 202) or transport failure. */
export async function submitUrls({ urls, key, origin = SITE_ORIGIN, endpoint = INDEXNOW_ENDPOINT, fetchImpl = fetch }) {
  const host = new URL(origin).host;
  const keyLocation = `${origin}/indexnow-key.txt`;
  const results = [];
  for (const urlList of batch(urls)) {
    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation, urlList }),
      });
    } catch (e) {
      throw new Error(`IndexNow request failed (network): ${e.message}`);
    }
    if (res.status !== 200 && res.status !== 202) {
      let detail = '';
      try { detail = await res.text(); } catch { /* ignore */ }
      throw new Error(`IndexNow rejected submission: HTTP ${res.status} ${detail}`.trim());
    }
    results.push({ count: urlList.length, status: res.status });
  }
  return results;
}

async function main() {
  const inputIdx = process.argv.indexOf('--input');
  const input = inputIdx >= 0 && process.argv[inputIdx + 1] ? process.argv[inputIdx + 1] : '.seo-changed-urls.json';
  const dryRun = process.argv.includes('--dry-run');

  let raw;
  try { raw = await fs.readFile(path.resolve(ROOT, input), 'utf8'); }
  catch (e) { throw new Error(`Cannot read URL list ${input}: ${e.message}`); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`URL list ${input} is not valid JSON: ${e.message}`); }

  const { urls, rejected } = normalizeUrls(parsed);
  if (rejected.length) console.warn(`Excluded ${rejected.length} non-${new URL(SITE_ORIGIN).host} or malformed URL(s):\n  ${rejected.join('\n  ')}`);

  if (urls.length === 0) { console.log('No changed URLs to submit.'); return; }

  const key = validateKey((process.env.INDEXNOW_KEY || await fs.readFile(path.join(ROOT, 'indexnow-key.txt'), 'utf8')).trim());

  if (dryRun) {
    console.log(`[dry-run] would submit ${urls.length} URL(s) in ${batch(urls).length} request(s) to ${INDEXNOW_ENDPOINT}:`);
    for (const u of urls) console.log(`  ${u}`);
    return;
  }

  await assertKeyPublished({ key });
  const results = await submitUrls({ urls, key });
  for (const r of results) console.log(`IndexNow accepted ${r.count} URL(s) (HTTP ${r.status}).`);
  console.log(`IndexNow submission complete: ${urls.length} URL(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
