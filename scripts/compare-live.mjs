#!/usr/bin/env node
/* Page-for-page comparison of the Worker-built site against the live site
   (migration step 2). Fetches every URL in the live sitemaps plus the data
   files from both, normalises build timestamps, and reports differences.

     node scripts/compare-live.mjs --local http://localhost:8787 [--live https://michealrayberry.com] [--out dir]

   With --out, both copies of each differing file are written there for diffing. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  local: { type: 'string', default: 'http://localhost:8787' },
  live: { type: 'string', default: 'https://michealrayberry.com' },
  out: { type: 'string' },
  // Compare against a directory written by the original generator instead of the live site.
  baseline: { type: 'string' },
} });
const LIVE = values.live.replace(/\/$/, '');
const LOCAL = values.local.replace(/\/$/, '');

const EXTRA = [
  '/sitemap.xml', '/feed.xml', '/robots.txt', '/llms.txt',
  '/data/attestations.json', '/data/supervision.json', '/data/feed-manifest.json',
  '/data/weigh-ins.csv', '/data/violations.csv', '/observer/received/', '/verify/',
];

async function text(url) {
  if (values.baseline && url.startsWith(LIVE)) {
    const { readFile } = await import('node:fs/promises');
    const path = new URL(url).pathname;
    const file = join(values.baseline, path.endsWith('/') ? `${path}index.html` : path);
    try { return { status: 200, location: null, body: await readFile(file, 'utf8') }; }
    catch { return { status: 404, location: null, body: '' }; }
  }
  const res = await fetch(url, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), body: res.status === 200 ? await res.text() : '' };
}

/* Build-time stamps and Cloudflare's email obfuscation differ between any two builds. */
function normalise(body) {
  return body
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>')
    .replace(/(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4},? (?:at )?\d{1,2}:\d{2}\s?[AP]M(?: [EC][DS]T)?/g, '<ET-TIME>')
    .replace(/<a href="\/cdn-cgi\/l\/email-protection[^"]*"[^>]*>[\s\S]*?<\/a>/g, '<EMAIL>')
    .replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"]*email-decode\.min\.js"><\/script>/g, '')
    .replace(/[ \t]+$/gm, '');
}

const sitemapUrls = async () => {
  const index = await text(`${LIVE}/sitemap.xml`);
  const maps = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = new Set();
  for (const map of maps) {
    const body = (await text(map)).body;
    for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(new URL(m[1]).pathname);
  }
  return [...urls];
};

const paths = [...new Set([...(await sitemapUrls()), ...EXTRA])].sort();
const report = { same: [], differ: [], status: [] };
for (const path of paths) {
  const [a, b] = await Promise.all([text(LIVE + path), text(LOCAL + path)]);
  if (a.status !== b.status) { report.status.push(`${path}  live ${a.status}${a.location ? ` → ${a.location}` : ''}  local ${b.status}${b.location ? ` → ${b.location}` : ''}`); continue; }
  const na = normalise(a.body), nb = normalise(b.body);
  if (na === nb) { report.same.push(path); continue; }
  const la = na.split('\n'), lb = nb.split('\n');
  const changed = la.filter((l, i) => l !== lb[i]).length + Math.max(0, lb.length - la.length);
  report.differ.push(`${path}  (${changed} of ${la.length} lines differ)`);
  if (values.out) {
    const name = path.replace(/\/$/, '/index.html').replace(/^\//, '').replace(/\//g, '__');
    await mkdir(values.out, { recursive: true });
    await writeFile(join(values.out, `${name}.live`), na);
    await writeFile(join(values.out, `${name}.local`), nb);
  }
}
console.log(`identical: ${report.same.length}`);
for (const line of report.same) console.log(`  = ${line}`);
console.log(`different: ${report.differ.length}`);
for (const line of report.differ) console.log(`  ~ ${line}`);
console.log(`status differs: ${report.status.length}`);
for (const line of report.status) console.log(`  ! ${line}`);
