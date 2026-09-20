import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(process.argv[2] || 'dist');
const files = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Public symlink: ' + full);
    if (entry.isDirectory()) await walk(full);
    else files.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
}
await walk(ROOT);
const paths = new Set(files);
const origin = 'https://michealrayberry.com';
const errors = [];
let links = 0, pages = 0, photos = 0;
const aliases = new Map([['/reference','/share/'],['/penalties','/violations/'],['/log','/violations/'],['/corner-time','/corrections/']]);
function targetFile(url) {
  let p = decodeURIComponent(url.pathname);
  p = aliases.get(p.replace(/\/$/, '')) || p;
  p = p.replace(/^\//, '');
  if (paths.has(p)) return p;
  return p.replace(/\/$/, '') + (p ? '/' : '') + 'index.html';
}
for (const file of files) {
  if (/^(?:apps-script|scripts|functions|node_modules)\//.test(file)
    || /(?:^|\/)(?:README\.md|package(?:-lock)?\.json|site\.template\.html|\.env)$/.test(file)) errors.push('Source file deployed: ' + file);
  if (!file.endsWith('.html')) continue;
  pages++;
  const html = await fs.readFile(path.join(ROOT, file), 'utf8');
  if (/\{\{|<sc-(?:if|for)|text\/x-dc/.test(html)) errors.push('Unrendered template: ' + file);
  if (!file.startsWith('assistant/') && /docs\.google\.com\/spreadsheets|drive\.google\.com\/(?:file|drive|thumbnail)/.test(html)) errors.push('Operational Google link in public page: ' + file);
  for (const image of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\bsrc="[^"]+"/.test(image[0])) errors.push('Image missing src: ' + file);
    if (!/\balt=/.test(image[0])) errors.push('Image missing alt: ' + file);
  }
  const base = new URL('/' + file.replace(/index\.html$/, ''), origin);
  for (const match of html.matchAll(/\b(?:href|src|action)="([^"]*)"/g)) {
    const value = match[1].replaceAll('&amp;', '&');
    if (!value || /^(?:mailto:|tel:|data:|blob:)/i.test(value)) continue;
    let url;
    try { url = new URL(value, base); } catch { errors.push('Invalid URL: ' + file); continue; }
    if (url.origin !== origin) continue;
    links++;
    const target = targetFile(url);
    if (!paths.has(target)) errors.push(file + ' -> missing ' + url.pathname);
  }
}
for (const file of files.filter(f => f.startsWith('manifests/') && f.endsWith('.json'))) {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8'));
  for (const photo of Object.values(manifest.photos)) {
    for (const entry of [photo, ...photo.responsive]) {
      const target = targetFile(new URL(entry.url));
      const buffer = await fs.readFile(path.join(ROOT, target));
      assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), entry.sha256, 'Public photo hash: ' + target);
    }
  }
}
for (const file of files.filter(f => /^(?:photos|media\/responsive)\//.test(f) && /\.(?:jpg|png|webp)$/i.test(f))) {
  const meta = await sharp(path.join(ROOT, file)).metadata();
  if (meta.exif || meta.xmp || meta.iptc) errors.push('Photo metadata remains: ' + file);
  photos++;
}
if (errors.length) throw new Error([...new Set(errors)].join('\n'));
console.log(`Public output passed: ${pages} HTML pages, ${links} internal targets, ${photos} metadata-free photos; manifest hashes match.`);
