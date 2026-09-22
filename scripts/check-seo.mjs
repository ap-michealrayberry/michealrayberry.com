/* SEO regression checks over dist/. Warn-only: prints findings, never
   fails the build (promote individual checks to errors once they are clean). */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const DIST = path.resolve(process.argv[2] || 'dist');
const ORIGIN = 'https://michealrayberry.com';
const warn = [];
const read = (f) => fs.readFile(f, 'utf8').catch(() => '');
async function walk(dir, out = []) { for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) { const f = path.join(dir, e.name); if (e.isDirectory()) await walk(f, out); else if (e.name === 'index.html') out.push(f); } return out; }
const pages = await walk(DIST);
const meta = new Map();
for (const f of pages) {
  const html = await read(f);
  const rel = '/' + path.relative(DIST, path.dirname(f)).split(path.sep).join('/');
  const url = ORIGIN + (rel === '/' ? '/' : rel + '/');
  const robots = (html.match(/<meta name="robots" content="([^"]+)"/i) || [])[1] || '';
  const canon = (html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1] || '';
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const desc = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || '';
  const noindex = /noindex/i.test(robots);
  meta.set(url, { noindex, canon });
  if (!noindex) {
    if (!title.trim()) warn.push(url + ': missing <title>');
    if (!desc.trim()) warn.push(url + ': missing meta description');
    if (!canon) warn.push(url + ': missing canonical');
  }
  if ((html.match(/<meta name="robots"/gi) || []).length > 1) warn.push(url + ': more than one robots meta');
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { warn.push(url + ': invalid JSON-LD'); continue; }
    const nodes = [].concat(j['@graph'] || j);
    for (const n of nodes) if (n && n['@type'] === 'VideoObject') for (const k of ['name', 'thumbnailUrl', 'uploadDate']) if (!n[k]) warn.push(url + ': VideoObject missing ' + k);
    for (const n of nodes) if (n && n['@type'] === 'FAQPage') warn.push(url + ': FAQPage markup present (discontinued)');
  }
}
for (const sm of (await fs.readdir(DIST).catch(() => [])).filter((f) => /^sitemap-.*\.xml$/.test(f))) {
  const xml = await read(path.join(DIST, sm));
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (!u.startsWith(ORIGIN)) continue;
    const key = /\/$/.test(u) ? u : u + '/';
    const pm = meta.get(key);
    if (!pm) { if (!/\.(xml|txt|png|jpe?g|webp)$/i.test(u)) warn.push(sm + ': ' + u + ' not in dist'); continue; }
    if (pm.noindex) warn.push(sm + ': ' + u + ' is noindex but listed');
    if (pm.canon && pm.canon !== u && pm.canon !== key) warn.push(sm + ': ' + u + ' canonical is ' + pm.canon);
  }
}
if (warn.length) { console.warn('SEO checks — ' + warn.length + ' finding(s):'); for (const w of warn.slice(0, 60)) console.warn('  · ' + w); if (warn.length > 60) console.warn('  … ' + (warn.length - 60) + ' more'); }
else console.log('SEO checks — clean.');
