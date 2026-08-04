/* Verify that Cloudflare Pages is serving the MERGED content before IndexNow is
   notified — never notify search engines about a version production has not
   published yet.

   Strategy (no Cloudflare token required): cache-busted polling.
     - The latest canonical daily page must return HTTP 200 AND its body must
       contain its own canonical URL (the marker). An old production version
       returns 200 but WITHOUT the new page/marker, so it is not mistaken for a
       successful deploy.
     - sitemap.xml must return HTTP 200.
     - Redirects are followed; bounded retries with a delay; a clear failure
       when the deploy cannot be verified.

   Usage:
     node scripts/check-deployment.mjs --marker-url <canonical daily url> \
       [--sitemap <url>] [--retries N] [--delay-ms MS]
   If --marker-url is omitted it is derived from the latest manifest. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_ORIGIN } from './lib/common.mjs';
import { loadManifests } from './lib/manifest.mjs';

export function withCacheBust(url, token = Date.now()) {
  const u = new URL(url);
  u.searchParams.set('_cb', String(token));
  return u.toString();
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* One probe: fetch cache-busted url, require 200, and (when a marker is given)
   require the body to contain it. Transport errors (timeout, redirect loop)
   resolve to { ok:false } rather than throwing, so polling can retry. */
export async function probe({ url, marker = null, fetchImpl = fetch, token }) {
  let res;
  try { res = await fetchImpl(withCacheBust(url, token), { redirect: 'follow' }); }
  catch (e) { return { ok: false, reason: `request failed: ${e.message}` }; }
  if (res.status !== 200) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  if (marker) {
    let body = '';
    try { body = await res.text(); } catch (e) { return { ok: false, reason: `body read failed: ${e.message}` }; }
    if (!body.includes(marker)) return { ok: false, status: 200, reason: 'marker not present (stale/previous version)' };
  }
  return { ok: true, status: 200 };
}

/* Poll until the merged content is live or retries are exhausted.
   targets: [{ url, marker? }]. Returns { ok, attempts, failures }. */
export async function verifyDeployment({
  targets, fetchImpl = fetch, retries = 20, delayMs = 15000, sleep = defaultSleep,
}) {
  let lastFailures = [];
  for (let attempt = 1; attempt <= retries; attempt++) {
    const token = `${Date.now()}-${attempt}`;
    const results = await Promise.all(
      targets.map(async (t) => ({ target: t, ...(await probe({ ...t, fetchImpl, token })) })),
    );
    lastFailures = results.filter((r) => !r.ok);
    if (lastFailures.length === 0) return { ok: true, attempts: attempt, failures: [] };
    if (attempt < retries) await sleep(delayMs);
  }
  return { ok: false, attempts: retries, failures: lastFailures };
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  let markerUrl = arg('marker-url');
  if (!markerUrl) {
    const manifests = await loadManifests();
    manifests.sort((a, b) => a.day - b.day);
    const latest = manifests.at(-1);
    if (!latest) { console.error('No manifests found; cannot determine a deployment marker.'); process.exit(1); }
    markerUrl = latest.canonical_url;
  }
  const sitemap = arg('sitemap', `${SITE_ORIGIN}/sitemap.xml`);
  const retries = Number(arg('retries', '20'));
  const delayMs = Number(arg('delay-ms', '15000'));

  const targets = [
    { url: markerUrl, marker: markerUrl },
    { url: sitemap },
  ];
  console.log(`Verifying deployment of ${markerUrl} (and ${sitemap}) — up to ${retries} attempts, ${delayMs}ms apart.`);
  const result = await verifyDeployment({ targets, retries, delayMs });
  if (!result.ok) {
    console.error(`Deployment NOT verified after ${result.attempts} attempts:`);
    for (const f of result.failures) console.error(`  ${f.target.url} — ${f.reason}`);
    process.exit(1);
  }
  console.log(`Deployment verified in ${result.attempts} attempt(s): production is serving the merged content.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
