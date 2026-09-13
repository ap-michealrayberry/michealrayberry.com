// Only website assets go to Netlify. The original repository remains intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = await fs.mkdtemp(path.join(ROOT, '.dist-stage-'));
const files = [
  'index.html', '404.html', '_headers', '_redirects', 'forms.html',
  'avatar.png', 'favicon.png', 'favicon.svg', 'og-image.png',
  '4554f3d3df9ebbf5cc1ec9578b5f4589.txt', 'indexnow-key.txt',
  'robots.txt', 'llms.txt', 'feed.xml', 'public.css', 'live.js',
  'livenav.js', 'record.js', 'share.js', 'unsw.js',
  'sitemap.xml', 'sitemap-static.xml', 'sitemap-pages.xml', 'sitemap-daily.xml',
  'sitemap-images.xml', 'sitemap-videos.xml', 'sitemap-violations.xml',
  'assistant/index.html', 'assistant/app.js', 'assistant/styles.css',
  'assistant/sw.js', 'assistant/manifest.webmanifest',
  'assistant/icons/icon-192.png', 'assistant/icons/icon-512.png',
  'assistant/file/index.html', 'assistant/file/file.js', 'assistant/file/file.css',
  'verify/index.html', 'verify/verify.js', 'live/overlay.html', 'live/overlay.js',
  'photos/official/micheal-ray-berry-official-front-v2.jpg',
  'photos/official/micheal-ray-berry-official-front-480.webp',
  'photos/official/micheal-ray-berry-official-front-800.webp',
  'photos/official/micheal-ray-berry-official-front-1200.webp',
];
const directories = [
  'about', 'agreement', 'consent', 'corrections', 'daily', 'dashboard',
  'milestones', 'observer', 'positions', 'share', 'uniform',
  'updates', 'violations', 'weeks', 'cards', 'manifests', 'media/responsive',
];
const feeds = ['record.json', 'supervision.json', 'attestations.json', 'weigh-ins.csv'];
files.push('live/index.html', ...feeds.map(name => 'data/' + name));

async function copy(relative) {
  const source = path.join(ROOT, relative), target = path.join(STAGE, relative);
  if (!(await fs.lstat(source)).isFile()) throw new Error('Not a regular asset: ' + relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}
async function walk(relative) {
  for (const entry of await fs.readdir(path.join(ROOT, relative), { withFileTypes: true })) {
    const child = relative + '/' + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Unexpected public symlink: ' + child);
    if (entry.isDirectory()) await walk(child);
    else if (/\.(?:html|png|webp|json|sha256)$/.test(entry.name)
      && !entry.name.startsWith('.') && !/readme|package|secret|backup/i.test(entry.name)) await copy(child);
    else throw new Error('Unexpected generated asset: ' + child);
  }
}
try {
  for (const relative of files) await copy(relative);
  for (const relative of directories) await walk(relative);
  // Preserve old official image URLs for bookmarks, with metadata-free bytes.
  const front = await fs.readFile(path.join(ROOT, 'photos/official/micheal-ray-berry-official-front-v2.jpg'));
  await fs.writeFile(path.join(STAGE, 'photos/official/micheal-ray-berry-official-front.jpg'), front);
  const correction = await sharp(path.join(ROOT, 'photos/official/micheal-ray-berry-correction-uniform.jpg')).rotate().jpeg({ quality: 88 }).toBuffer();
  await fs.writeFile(path.join(STAGE, 'photos/official/micheal-ray-berry-correction-uniform.jpg'), correction);
  // Old dated photo links remain valid; copies are stripped of metadata in dist.
  async function copyPhotos(relative) {
    for (const entry of await fs.readdir(path.join(ROOT, relative), { withFileTypes: true })) {
      const child = relative + '/' + entry.name;
      if (entry.isDirectory()) await copyPhotos(child);
      else if (entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name)) {
        const target = path.join(STAGE, child);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const format = /\.jpe?g$/i.test(child) ? 'jpeg' : path.extname(child).slice(1).toLowerCase();
        const buffer = await sharp(path.join(ROOT, child)).rotate().toFormat(format).toBuffer();
        await fs.writeFile(target, buffer);
      } else throw new Error('Unexpected dated photo: ' + child);
    }
  }
  for (const entry of await fs.readdir(path.join(ROOT, 'photos'), { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d{4}$/.test(entry.name)) await copyPhotos('photos/' + entry.name);
  }
  await fs.mkdir(path.join(STAGE, 'schemas'), { recursive: true });
  await copy('schemas/daily-record-manifest-v1.json');
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.rename(STAGE, DIST);
  console.log('Prepared public website in dist. Backend source and raw workbook exports are excluded.');
} finally { await fs.rm(STAGE, { recursive: true, force: true }); }
