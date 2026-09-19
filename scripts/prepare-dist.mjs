import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DIST = path.join(ROOT, 'dist');
const SITE_ORIGIN = 'https://michealrayberry.com';
if (path.dirname(DIST) !== ROOT || path.basename(DIST) !== 'dist') {
  throw new Error(`Refusing unsafe deploy output path: ${DIST}`);
}
let packageManifest;
try {
  packageManifest = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
} catch (error) {
  throw new Error(`Refusing to prepare dist outside the project root: ${error.message}`);
}
if (packageManifest.name !== 'mrb-seo-publisher') {
  throw new Error(`Refusing unexpected project root: ${ROOT}`);
}

// Explicit deploy allowlist. Repository source, operations notes, Apps Script,
// local tooling, and future stray files are excluded unless reviewed here.
const FILES = [
  'index.html', '404.html', '_headers', '_redirects',
  '4554f3d3df9ebbf5cc1ec9578b5f4589.txt', 'indexnow-key.txt',
  'avatar.png', 'favicon.png', 'favicon.svg', 'og-image.png',
  'feed.xml', 'robots.txt', 'llms.txt',
  'live.js', 'livenav.js', 'share.js', 'unsw.js',
  'data/attestations.json', 'data/supervision.json', 'data/feed-manifest.json',
  'data/weigh-ins.csv', 'data/violations.csv',
  // Netlify uses this hidden page to discover the observer form at deploy time.
  'forms.html',
  'sitemap.xml', 'sitemap-static.xml', 'sitemap-pages.xml',
  'sitemap-daily.xml', 'sitemap-images.xml', 'sitemap-videos.xml',
  'sitemap-violations.xml',
];

const DIRECTORIES = [
  'about', 'agreement', 'ap', 'assistant', 'cards', 'consent', 'corrections',
  'daily', 'dashboard', 'live', 'manifests', 'media', 'milestones',
  'observer', 'photos', 'positions', 'schemas', 'share',
  'uniform', 'updates', 'verify', 'violations', 'weeks',
];

const REVIEWED_DIRECTORY_FILES = new Set([
  'about/index.html', 'agreement/index.html',
  'ap/index.html', 'ap/ap.js', 'ap/ap.css',
  'assistant/index.html', 'assistant/app.js', 'assistant/styles.css',
  'assistant/sw.js', 'assistant/manifest.webmanifest',
  'assistant/icons/icon-192.png', 'assistant/icons/icon-512.png',
  'assistant/file/index.html', 'assistant/file/file.js', 'assistant/file/file.css',
  'consent/index.html', 'corrections/index.html', 'daily/index.html',
  'dashboard/index.html', 'live/index.html', 'milestones/index.html',
  'observer/index.html', 'observer/received/index.html', 'positions/index.html',
  'schemas/daily-record-manifest-v1.json', 'share/index.html',
  'uniform/index.html', 'updates/index.html',
  'verify/index.html', 'verify/verify.js', 'violations/index.html', 'weeks/index.html',
  'photos/official/micheal-ray-berry-correction-uniform.png',
  'photos/official/micheal-ray-berry-official-front-v2.jpg',
  'photos/official/micheal-ray-berry-official-front-480.webp',
  'photos/official/micheal-ray-berry-official-front-800.webp',
  'photos/official/micheal-ray-berry-official-front-1200.webp',
]);

// These paths remain useful as private/local source, but are not runtime files.
const PRIVATE_PATHS = new Set([
  'assistant/bundle-sections.json',
  'assistant/js',
  'live/overlay.html',
  'live/overlay.js',
]);

const PUBLIC_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.jpeg', '.jpg', '.js', '.json',
  '.mp4', '.png', '.sha256', '.svg', '.txt', '.webm', '.webmanifest', '.webp',
  '.woff', '.woff2', '.xml',
]);

const FORBIDDEN_BASENAMES = new Set([
  '.ds_store', '.env', 'package.json', 'package-lock.json', 'readme.md',
  'netlify.toml', 'wrangler.toml', 'site.template.html',
]);

function isPrivatePath(relativePath) {
  return [...PRIVATE_PATHS].some((candidate) => (
    relativePath === candidate || relativePath.startsWith(`${candidate}/`)
  ));
}

function isUnpublishedDailyPhoto(relativePath) {
  return /^photos\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.(?:jpe?g|png|webp)$/i.test(relativePath)
    && !REVIEWED_MANIFEST_ASSETS.has(relativePath);
}

function isReviewedDirectoryFile(relativePath) {
  if (REVIEWED_DIRECTORY_FILES.has(relativePath)) return true;
  if (REVIEWED_LOCAL_MEDIA.has(relativePath)) return true;
  if (REVIEWED_MANIFEST_ASSETS.has(relativePath)) return true;
  return [
    /^cards\/\d{4}-\d{2}-\d{2}\.png$/,
    /^daily\/\d{4}-\d{2}-\d{2}-day-\d{3,}\/(?:video\/)?index\.html$/,
    /^manifests\/\d{4}-\d{2}-\d{2}\.(?:json|sha256)$/,
    /^milestones\/(?:200|225|250|275|300|320)-lb\/index\.html$/,
    /^violations\/v-[a-f0-9]{12}\/index\.html$/,
    /^weeks\/week-\d{2,}\/index\.html$/,
  ].some((pattern) => pattern.test(relativePath));
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function canonicalLocalMedia(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//') || /[%\\]/.test(raw)) return '';
  const rootRelative = raw.startsWith('/');
  let parsed;
  try { parsed = new URL(raw, SITE_ORIGIN); } catch { return ''; }
  if (
    parsed.protocol !== 'https:' || parsed.origin !== SITE_ORIGIN
    || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash
    || !/^\/media\/[A-Za-z0-9._\/-]+\.(?:mp4|webm)$/.test(parsed.pathname)
  ) return '';
  const canonical = rootRelative ? parsed.pathname : `${SITE_ORIGIN}${parsed.pathname}`;
  return raw === canonical ? parsed.pathname.replace(/^\/+/, '') : '';
}

async function referencedLocalMedia() {
  const output = new Set();
  for (const [relativePath, columnName] of [
    ['data/weigh-ins.csv', 'video'], ['data/violations.csv', 'recording'],
  ]) {
    const rows = parseCsv(await fs.readFile(path.join(ROOT, relativePath), 'utf8'));
    const column = (rows[0] || []).indexOf(columnName);
    if (column < 0) continue;
    for (const row of rows.slice(1)) {
      const mediaPath = canonicalLocalMedia(row[column]);
      if (mediaPath) output.add(mediaPath);
    }
  }
  return output;
}

async function referencedManifestAssets() {
  const output = new Set();
  const manifestRoot = path.join(ROOT, 'manifests');
  let names;
  try { names = await fs.readdir(manifestRoot); } catch (error) {
    if (error.code === 'ENOENT') return output;
    throw error;
  }
  for (const name of names.sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(manifestRoot, name), 'utf8')); }
    catch { continue; }
    for (const photo of Object.values(manifest?.photos || {})) {
      for (const raw of [photo?.url, ...(Array.isArray(photo?.responsive) ? photo.responsive.map((item) => item?.url) : [])]) {
        if (typeof raw !== 'string') continue;
        let parsed;
        try { parsed = new URL(raw); } catch { continue; }
        if (parsed.origin !== SITE_ORIGIN || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) continue;
        const relativePath = parsed.pathname.replace(/^\/+/, '');
        if (
          /^photos\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.(?:jpe?g|png|webp)$/i.test(relativePath)
          || /^media\/responsive\/\d{4}\/\d{2}\/\d{2}\/micheal-ray-berry-day-\d{3,}-(?:front|left|rear|right)-\d{4}-\d{2}-\d{2}-\d+\.webp$/i.test(relativePath)
        ) output.add(relativePath);
      }
    }
  }
  return output;
}

function assertPublicFile(relativePath) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  const extension = path.posix.extname(basename).toLowerCase();
  if (
    basename.startsWith('.')
    || FORBIDDEN_BASENAMES.has(basename)
    || /(?:~|\.bak|\.orig|\.rej|\.swp|\.tmp)$/i.test(basename)
    || /\.(?:cjs|map|mjs|ts|tsx|jsx)$/i.test(basename)
  ) {
    throw new Error(`Refusing to publish forbidden file: ${relativePath}`);
  }
  if (!PUBLIC_EXTENSIONS.has(extension)) {
    throw new Error(`Public file type is not allowlisted: ${relativePath}`);
  }
  if (!isReviewedDirectoryFile(relativePath)) {
    throw new Error(`Public file path is not allowlisted: ${relativePath}`);
  }
}

async function requireRegularFile(source, relativePath) {
  let ancestor = ROOT;
  for (const part of relativePath.split('/').slice(0, -1)) {
    ancestor = path.join(ancestor, part);
    const ancestorInfo = await fs.lstat(ancestor);
    if (ancestorInfo.isSymbolicLink()) throw new Error(`Refusing public symlink ancestor: ${relativePath}`);
    if (!ancestorInfo.isDirectory()) throw new Error(`Required public ancestor is not a directory: ${relativePath}`);
  }
  let info;
  try { info = await fs.lstat(source); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Required public file is missing: ${relativePath}`);
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`Refusing public symlink: ${relativePath}`);
  if (!info.isFile()) throw new Error(`Required public path is not a file: ${relativePath}`);
}

async function copyPublicDirectory(sourceRoot, destinationRoot, prefix) {
  let sourceInfo;
  try { sourceInfo = await fs.lstat(sourceRoot); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Required public directory is missing: ${prefix}`);
    throw error;
  }
  if (sourceInfo.isSymbolicLink()) throw new Error(`Refusing public symlink: ${prefix}`);
  if (!sourceInfo.isDirectory()) throw new Error(`Required public path is not a directory: ${prefix}`);

  await fs.mkdir(destinationRoot, { recursive: true });
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relativePath = `${prefix}/${entry.name}`.split(path.sep).join('/');
    if (isPrivatePath(relativePath) || isUnpublishedDailyPhoto(relativePath)) continue;
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing public symlink: ${relativePath}`);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) throw new Error(`Refusing hidden public directory: ${relativePath}`);
      await copyPublicDirectory(source, destination, relativePath);
    } else if (entry.isFile()) {
      assertPublicFile(relativePath);
      await fs.copyFile(source, destination);
    } else {
      throw new Error(`Unsupported public filesystem entry: ${relativePath}`);
    }
  }
}

const REVIEWED_LOCAL_MEDIA = await referencedLocalMedia();
const REVIEWED_MANIFEST_ASSETS = await referencedManifestAssets();
if (isReviewedDirectoryFile('violations/v-001/index.html')) {
  throw new Error('Deploy allowlist invariant failed: legacy numeric violation routes must remain private.');
}
const stage = await fs.mkdtemp(path.join(ROOT, '.dist-stage-'));
let staged = true;
try {
  for (const name of FILES) {
    const source = path.join(ROOT, name);
    await requireRegularFile(source, name);
    const destination = path.join(stage, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }

  for (const name of DIRECTORIES) {
    const source = path.join(ROOT, name);
    await copyPublicDirectory(source, path.join(stage, name), name);
  }

  await fs.rm(DIST, { recursive: true, force: true });
  await fs.rename(stage, DIST);
  staged = false;
} finally {
  if (staged) await fs.rm(stage, { recursive: true, force: true });
}

console.log('Prepared allowlisted deploy output in dist/.');
