#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import vm from 'node:vm';
import { crc32, inflateSync } from 'node:zlib';

const SITE_ORIGIN = 'https://michealrayberry.com';
const SITE_URL = new URL(SITE_ORIGIN);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEED_ENV_NAMES = [
  'WEIGHINS_CSV', 'VIOLATION_CSV', 'ATTESTATION_CSV', 'CONFIRMATIONS_CSV',
  'SUPERVISION_CSV', 'UPDATES_CSV', 'SITE_STATE_CSV', 'ATTESTATION_SEAL_SECRET',
];
function configuredFeedIdentifiers(environment = process.env) {
  const identifiers = new Set();
  for (const name of FEED_ENV_NAMES) {
    const configured = String(environment[name] || '').trim();
    for (const match of configured.matchAll(/[A-Za-z0-9_-]{25,}/g)) identifiers.add(match[0]);
  }
  return identifiers;
}
const CONFIGURED_FEED_IDENTIFIERS = configuredFeedIdentifiers();
const CROSS_IDENTITY_PATH = 'photos/official/maid-ray-berry-portrait.jpg';
const CROSS_IDENTITY_FILENAME = path.posix.basename(CROSS_IDENTITY_PATH);
const FORBIDDEN_PUBLIC_PATHS = new Set([
  CROSS_IDENTITY_PATH,
  'photos/official/micheal-ray-berry-official-front.jpg',
  'live/overlay.html',
  'manifest.webmanifest',
  'record.js',
]);
const PUBLIC_DATA_FILES = new Set([
  'data/attestations.json', 'data/supervision.json', 'data/feed-manifest.json',
  'data/weigh-ins.csv', 'data/violations.csv',
]);
const PUBLIC_ROOT_FILES = new Set([
  'index.html', '404.html', '_headers', '_redirects',
  '4554f3d3df9ebbf5cc1ec9578b5f4589.txt', 'indexnow-key.txt',
  'avatar.png', 'favicon.png', 'favicon.svg', 'og-image.png',
  'feed.xml', 'robots.txt', 'llms.txt',
  'live.js', 'livenav.js', 'share.js', 'unsw.js', 'forms.html',
  'sitemap.xml', 'sitemap-static.xml', 'sitemap-pages.xml',
  'sitemap-daily.xml', 'sitemap-images.xml', 'sitemap-videos.xml',
  'sitemap-violations.xml',
]);
const PUBLIC_TOP_LEVEL_DIRECTORIES = new Set([
  'about', 'agreement', 'assistant', 'cards', 'consent', 'corrections',
  'daily', 'dashboard', 'data', 'live', 'manifests', 'media', 'milestones',
  'observer', 'photos', 'positions', 'schemas', 'share',
  'uniform', 'updates', 'verify', 'violations', 'weeks',
]);
const PUBLIC_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.jpeg', '.jpg', '.js', '.json',
  '.mp4', '.png', '.sha256', '.svg', '.txt', '.webm', '.webmanifest', '.webp',
  '.woff', '.woff2', '.xml',
]);
const PUBLIC_OFFICIAL_PHOTOS = new Set([
  'photos/official/micheal-ray-berry-correction-uniform.png',
  'photos/official/micheal-ray-berry-official-front-v2.jpg',
  'photos/official/micheal-ray-berry-official-front-480.webp',
  'photos/official/micheal-ray-berry-official-front-800.webp',
  'photos/official/micheal-ray-berry-official-front-1200.webp',
]);
const REQUIRED_FILES = [
  'index.html', '404.html', '_headers', '_redirects', 'forms.html',
  'robots.txt', 'llms.txt', 'feed.xml', 'favicon.png', 'favicon.svg',
  'og-image.png', 'avatar.png', 'indexnow-key.txt',
  '4554f3d3df9ebbf5cc1ec9578b5f4589.txt',
  'live.js', 'livenav.js', 'share.js', 'unsw.js',
  'assistant/index.html', 'assistant/app.js', 'assistant/styles.css',
  'assistant/sw.js', 'assistant/manifest.webmanifest',
  'assistant/icons/icon-192.png', 'assistant/icons/icon-512.png',
  'assistant/file/index.html', 'assistant/file/file.js', 'assistant/file/file.css',
  'verify/index.html', 'verify/verify.js',
  'data/attestations.json', 'data/supervision.json',
  'data/weigh-ins.csv', 'data/violations.csv', 'data/feed-manifest.json',
  'photos/official/micheal-ray-berry-correction-uniform.png',
  'photos/official/micheal-ray-berry-official-front-v2.jpg',
  'photos/official/micheal-ray-berry-official-front-480.webp',
  'photos/official/micheal-ray-berry-official-front-800.webp',
  'photos/official/micheal-ray-berry-official-front-1200.webp',
  'schemas/daily-record-manifest-v1.json',
  'daily/index.html', 'dashboard/index.html', 'milestones/index.html',
  'about/index.html', 'agreement/index.html', 'violations/index.html',
  'corrections/index.html', 'positions/index.html', 'consent/index.html',
  'uniform/index.html', 'updates/index.html', 'share/index.html',
  'live/index.html', 'observer/index.html', 'observer/received/index.html',
  'weeks/index.html',
  'sitemap.xml', 'sitemap-static.xml', 'sitemap-pages.xml',
  'sitemap-daily.xml', 'sitemap-images.xml', 'sitemap-videos.xml',
  'sitemap-violations.xml',
];
const REQUIRED_COUNTS = [
  // This is a production release invariant, not a statement that the renderer
  // cannot represent an empty/fresh sheet. Once the public record exists, a
  // transient upstream failure must not replace it with a gap-only deployment.
  { code: 'daily-pages', pattern: /^daily\/\d{4}-\d{2}-\d{2}-day-\d+\/index\.html$/, minimum: 1 },
  { code: 'cards', pattern: /^cards\/\d{4}-\d{2}-\d{2}\.png$/, minimum: 1 },
  { code: 'milestone-pages', pattern: /^milestones\/(?:200|225|250|275|300|320)-lb\/index\.html$/, exact: 6 },
  { code: 'week-pages', pattern: /^weeks\/week-\d+\/index\.html$/, minimum: 1 },
];
const REQUIRED_SITEMAPS = [
  'sitemap-static.xml', 'sitemap-pages.xml', 'sitemap-daily.xml',
  'sitemap-images.xml', 'sitemap-videos.xml', 'sitemap-violations.xml',
];
const PUBLIC_JAVASCRIPT = new Set([
  'live.js', 'livenav.js', 'share.js', 'unsw.js',
  'assistant/app.js', 'assistant/sw.js', 'assistant/file/file.js',
  'verify/verify.js',
]);
const DYNAMIC_MEDIA_IDS = new Set([
  'assistant/index.html#preflight-video',
  'assistant/index.html#capture-video',
  'assistant/index.html#parked-video',
  'assistant/index.html#narration-audio',
]);
const JPEG_EXIF_HEADER = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_RIFF = Buffer.from('RIFF');
const WEBP_SIGNATURE = Buffer.from('WEBP');
const RELEASE_FIXTURE_MARKER = /\b(?:integration[\s_-]*test|self[\s_-]*test|synthetic[\s_-]+(?:event|fixture|record|test|violation))\b/giu;
const VIOLATION_FIXTURE_MARKER = /\b(?:integration[\s_-]*test|self[\s_-]*test|synthetic)\b/iu;

function usage() {
  console.log('Usage: node scripts/audit-output.mjs [public-root]');
  console.log('Defaults to the current working directory.');
  console.log('       node scripts/audit-output.mjs --self-test');
  console.log('       node scripts/audit-output.mjs --check-bundle');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (positional.length > 1) {
  usage();
  process.exit(2);
}

const publicRoot = path.resolve(positional[0] || process.cwd());
const errors = [];
const errorKeys = new Set();
const symlinks = [];
const skippedTrees = [];

function addError(code, file, message, line = null) {
  const key = `${code}\u0000${file}\u0000${line ?? ''}\u0000${message}`;
  if (errorKeys.has(key)) return;
  errorKeys.add(key);
  errors.push({ code, file, line, message });
}

function slash(relativePath) {
  return relativePath.split(path.sep).join('/');
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      symlinks.push(relativePath);
    } else if (entry.isDirectory() && (entry.name === '.git' || entry.name === 'node_modules')) {
      skippedTrees.push(relativePath);
    } else if (entry.isDirectory()) {
      files.push(...await walk(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function htmlDecode(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#38;', '&')
    .replaceAll('&#x26;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRedirectSource(source) {
  const decoded = safeDecode(source);
  let expression = '';

  for (let index = 0; index < decoded.length;) {
    const character = decoded[index];
    if (character === '*') {
      expression += '(.*)';
      index += 1;
      continue;
    }
    if (character === ':') {
      const match = decoded.slice(index + 1).match(/^[A-Za-z][A-Za-z0-9_]*/);
      if (match) {
        expression += match[0] === 'splat' ? '(.*)' : '([^/]+)';
        index += match[0].length + 1;
        continue;
      }
    }
    expression += escapeRegex(character);
    index += 1;
  }

  return new RegExp(`^${expression}$`);
}

async function readRedirects() {
  const redirectPath = path.join(publicRoot, '_redirects');
  let source;
  try {
    source = await readFile(redirectPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const rules = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const [from, to, rawStatus = '200'] = line.split(/\s+/);
    if (!from?.startsWith('/') || from.startsWith('//') || !to) continue;
    const status = Number.parseInt(rawStatus, 10);
    rules.push({
      from: safeDecode(from),
      to,
      status: Number.isFinite(status) ? status : 200,
      pattern: compileRedirectSource(from),
    });
  }
  return rules;
}

function firstRedirect(pathname, redirectRules) {
  return redirectRules.find((rule) => rule.pattern.test(pathname)) || null;
}

function isBlockedRoute(pathname, redirectRules) {
  const rule = firstRedirect(pathname, redirectRules);
  return Boolean(rule && rule.status >= 400);
}

function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function routeCandidates(pathname) {
  const decoded = safeDecode(pathname);
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, '');
  if (!normalized || normalized === '.') return ['index.html'];

  const candidates = [normalized];
  if (decoded.endsWith('/')) {
    candidates.push(path.posix.join(normalized, 'index.html'));
  } else {
    candidates.push(path.posix.join(normalized, 'index.html'));
    if (!path.posix.extname(normalized)) candidates.push(`${normalized}.html`);
  }
  return [...new Set(candidates)];
}

function internalTargetStatus(pathname, fileSet, redirectRules) {
  const decodedPath = safeDecode(pathname);
  const redirect = firstRedirect(decodedPath, redirectRules);
  if (redirect) {
    if (redirect.status >= 400) {
      return { ok: false, reason: `route is deliberately blocked (${redirect.status})` };
    }
    return { ok: true, reason: 'redirect' };
  }

  const candidates = routeCandidates(decodedPath);
  if (candidates.some((candidate) => fileSet.has(candidate))) {
    return { ok: true, reason: 'file' };
  }
  return { ok: false, reason: `no file or redirect (tried ${candidates.join(', ')})` };
}

function publicPathForFile(relativePath) {
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`;
  return `/${relativePath}`;
}

function parseTagAttributes(source, baseOffset = 0) {
  const attributes = new Map();
  const pattern = /([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    attributes.set(name, {
      name,
      value: htmlDecode(match[2] ?? match[3] ?? match[4] ?? '').trim(),
      offset: baseOffset + match.index,
    });
  }
  return attributes;
}

function htmlTags(html) {
  const tags = [];
  const pattern = /<([A-Za-z][\w:-]*)\b([^<>]*?)>/g;
  let match;
  while ((match = pattern.exec(html))) {
    tags.push({
      name: match[1].toLowerCase(),
      source: match[0],
      offset: match.index,
      attributes: parseTagAttributes(match[2], match.index + match[0].indexOf(match[2])),
    });
  }
  return tags;
}

function resolveInternalReference(rawValue, relativePath) {
  if (!rawValue || rawValue.startsWith('#')) return null;
  let parsed;
  try {
    parsed = new URL(rawValue, `${SITE_ORIGIN}${publicPathForFile(relativePath)}`);
  } catch {
    return { invalid: true, rawValue };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin !== SITE_URL.origin) return null;
  return { pathname: safeDecode(parsed.pathname), rawValue };
}

function srcsetValues(value) {
  // Generated srcsets contain ordinary URLs, not data URLs. Ignore data URLs
  // rather than splitting their payload at a comma.
  if (/^\s*data:/i.test(value)) return [];
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]).filter(Boolean);
}

function extractHtmlReferences(relativePath, html, tags = htmlTags(html)) {
  const references = [];
  const attributesByTag = {
    a: ['href'], area: ['href'], audio: ['src'], form: ['action'], iframe: ['src'],
    button: ['formaction'], image: ['href', 'xlink:href'], img: ['src', 'srcset'],
    input: ['src', 'formaction'], link: ['href', 'imagesrcset'], object: ['data'],
    script: ['src'], source: ['src', 'srcset'], track: ['src'], use: ['href', 'xlink:href'],
    video: ['src', 'poster'],
  };

  for (const tag of tags) {
    const names = attributesByTag[tag.name] || [];
    for (const name of names) {
      const attribute = tag.attributes.get(name);
      if (!attribute) continue;
      if (!attribute.value) {
        references.push({ invalid: true, rawValue: '', attribute: name, offset: attribute.offset, reason: 'empty URL attribute' });
        continue;
      }
      const values = name.endsWith('srcset') ? srcsetValues(attribute.value) : [attribute.value];
      for (const value of values) {
        const resolved = resolveInternalReference(value, relativePath);
        if (resolved) references.push({ ...resolved, attribute: name, offset: attribute.offset });
        else if (name === 'action' || name === 'formaction') {
          references.push({
            invalid: true,
            rawValue: value,
            attribute: name,
            offset: attribute.offset,
            reason: 'form targets must be same-origin under the deployed CSP',
          });
        }
      }
    }

    if (tag.name === 'meta') {
      const key = (tag.attributes.get('property')?.value || tag.attributes.get('name')?.value || '').toLowerCase();
      if (/^(?:og:(?:url|image|video)|twitter:image)$/.test(key)) {
        const content = tag.attributes.get('content');
        if (!content?.value) {
          references.push({ invalid: true, rawValue: '', attribute: 'content', offset: content?.offset ?? tag.offset, reason: `${key} has no URL` });
        } else {
          const resolved = resolveInternalReference(content.value, relativePath);
          if (resolved) references.push({ ...resolved, attribute: 'content', offset: content.offset });
        }
      }
    }
  }
  return references;
}

function extractCardReferences(html) {
  const references = [];
  const cardPattern = /\/cards\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.png/gi;
  let match;
  while ((match = cardPattern.exec(html))) {
    references.push({ pathname: match[0], offset: match.index });
  }
  return references;
}

function inspectTemplateMarkers(relativePath, html) {
  const markers = [
    { pattern: /{{\s*[^{}<>\r\n]+?\s*}}/g, label: 'Mustache' },
    { pattern: /{%\s*[^{}<>\r\n]+?\s*%}/g, label: 'Liquid/Jinja' },
    { pattern: /<%[\s\S]*?%>/g, label: 'ERB/EJS' },
  ];

  for (const marker of markers) {
    let match;
    while ((match = marker.pattern.exec(html))) {
      addError(
        'template-marker',
        relativePath,
        `${marker.label} marker "${match[0]}" remains in public HTML`,
        lineAt(html, match.index),
      );
    }
  }

  const componentMarker = /<\/?(?:sc-if|sc-for|x-dc|helmet)\b|\bdata-photo-src\s*=/gi;
  let componentMatch;
  while ((componentMatch = componentMarker.exec(html))) {
    addError(
      'template-component',
      relativePath,
      `template-only component or attribute remains: ${componentMatch[0]}`,
      lineAt(html, componentMatch.index),
    );
  }
}

function forbiddenReason(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  const basename = path.posix.basename(lowerPath);
  const parts = lowerPath.split('/');
  if (FORBIDDEN_PUBLIC_PATHS.has(lowerPath)) return 'explicitly private or retired path';
  if (/^(?:scripts|apps-script|functions|assistant\/js)(?:\/|$)/.test(lowerPath)) return 'source-only directory';
  if (parts.length === 1 && !PUBLIC_ROOT_FILES.has(lowerPath)) return 'root file is not in the reviewed deploy allowlist';
  if (parts.length > 1 && !PUBLIC_TOP_LEVEL_DIRECTORIES.has(parts[0])) return 'top-level directory is not in the reviewed deploy allowlist';
  if (parts.length > 1 && !PUBLIC_EXTENSIONS.has(path.posix.extname(basename))) return 'public file type is not allowlisted';
  if (lowerPath.startsWith('data/') && !PUBLIC_DATA_FILES.has(lowerPath)) return 'data output is not in the reviewed public feed allowlist';
  if (lowerPath.endsWith('.csv') && !PUBLIC_DATA_FILES.has(lowerPath)) return 'CSV output is not in the reviewed public feed allowlist';
  if (lowerPath.startsWith('photos/official/') && !PUBLIC_OFFICIAL_PHOTOS.has(lowerPath)) return 'official photo is not in the reviewed public asset allowlist';
  if (lowerPath.startsWith('photos/') && !lowerPath.startsWith('photos/official/')
    && !/^photos\/\d{4}\/\d{2}\/\d{2}\/.+\.(?:jpe?g|png|webp)$/.test(lowerPath)) {
    return 'photo path is outside the reviewed date-based public asset layout';
  }
  if (parts.length > 1 && !isReviewedNestedPath(lowerPath)) return 'file path is not in the reviewed deploy allowlist';
  if (lowerPath.split('/').some((part) => part.startsWith('.'))) return 'hidden file or directory';
  if (basename.startsWith('.env')) return 'environment file';
  if (/^(?:package(?:-lock)?\.json|readme(?:\.[a-z0-9]+)?|netlify\.toml|wrangler\.toml|site\.template\.html)$/.test(basename)) return 'build/source file';
  if (/(?:~|\.bak|\.orig|\.rej|\.swp|\.tmp)$/i.test(basename)) return 'backup or temporary file';
  if (/\.(?:cjs|map|mjs|ts|tsx|jsx)$/i.test(basename)) return 'source or source-map file';
  if (lowerPath.endsWith('.js') && !PUBLIC_JAVASCRIPT.has(lowerPath)) return 'JavaScript file is not in the reviewed runtime allowlist';
  return '';
}

function isReviewedNestedPath(relativePath) {
  if (REQUIRED_FILES.includes(relativePath)) return true;
  return [
    /^cards\/\d{4}-\d{2}-\d{2}\.png$/,
    /^daily\/\d{4}-\d{2}-\d{2}-day-\d{3,}\/index\.html$/,
    /^manifests\/\d{4}-\d{2}-\d{2}\.(?:json|sha256)$/,
    /^media\/(?!responsive\/)[a-z0-9][a-z0-9._\/-]*\.(?:mp4|webm)$/,
    /^media\/responsive\/\d{4}\/\d{2}\/\d{2}\/micheal-ray-berry-day-\d{3,}-(?:front|left|rear|right)-\d{4}-\d{2}-\d{2}-\d+\.webp$/,
    /^milestones\/(?:200|225|250|275|300|320)-lb\/index\.html$/,
    /^photos\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.(?:jpe?g|png|webp)$/,
    /^violations\/v-[a-f0-9]{12}\/index\.html$/,
    /^weeks\/week-\d{2,}\/index\.html$/,
  ].some((pattern) => pattern.test(relativePath));
}

function inspectInventory(fileSet, normalizedFiles) {
  for (const required of REQUIRED_FILES) {
    if (!fileSet.has(required)) addError('required-output', required, 'required deploy output is missing');
  }
  for (const rule of REQUIRED_COUNTS) {
    const count = normalizedFiles.filter((file) => rule.pattern.test(file)).length;
    if (rule.exact != null && count !== rule.exact) {
      addError('output-count', '.', `${rule.code}: expected exactly ${rule.exact}, found ${count}`);
    } else if (rule.minimum != null && count < rule.minimum) {
      addError('output-count', '.', `${rule.code}: expected at least ${rule.minimum}, found ${count}`);
    }
  }
}

function inspectHtmlStructure(relativePath, html, tags) {
  const ids = new Map();
  for (const tag of tags) {
    const id = tag.attributes.get('id')?.value;
    if (id) {
      if (ids.has(id)) addError('duplicate-id', relativePath, `duplicate id="${id}"`, lineAt(html, tag.offset));
      else ids.set(id, tag.offset);
    }
    if (tag.name === 'img' && !tag.attributes.get('src')?.value && !tag.attributes.get('srcset')?.value) {
      addError('source-less-media', relativePath, '<img> has neither src nor srcset', lineAt(html, tag.offset));
    }
    if (tag.name === 'source' && !tag.attributes.get('src')?.value && !tag.attributes.get('srcset')?.value) {
      addError('source-less-media', relativePath, '<source> has neither src nor srcset', lineAt(html, tag.offset));
    }
    if (tag.name === 'iframe' && !tag.attributes.get('src')?.value) {
      addError('source-less-media', relativePath, '<iframe> has no src', lineAt(html, tag.offset));
    }
  }

  const mediaPattern = /<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let mediaMatch;
  while ((mediaMatch = mediaPattern.exec(html))) {
    const attributes = parseTagAttributes(mediaMatch[2], mediaMatch.index);
    const id = attributes.get('id')?.value || '';
    const hasOwnSource = Boolean(attributes.get('src')?.value);
    const hasChildSource = /<source\b[^>]+\b(?:src|srcset)\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)/i.test(mediaMatch[3]);
    if (!hasOwnSource && !hasChildSource && !DYNAMIC_MEDIA_IDS.has(`${relativePath}#${id}`)) {
      addError('source-less-media', relativePath, `<${mediaMatch[1].toLowerCase()}> has no source`, lineAt(html, mediaMatch.index));
    }
  }

  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptPattern.exec(html))) {
    const attributes = parseTagAttributes(scriptMatch[1], scriptMatch.index);
    if (attributes.get('src')?.value) continue;
    const type = (attributes.get('type')?.value || 'text/javascript').toLowerCase();
    if (!['text/javascript', 'application/javascript', 'text/x-dc', 'module'].includes(type)) continue;
    if (!scriptMatch[2].trim()) continue;
    if (type === 'module') {
      const syntax = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
        input: scriptMatch[2], encoding: 'utf8',
      });
      if (syntax.error || syntax.status !== 0) {
        const detail = (syntax.stderr || syntax.stdout || syntax.error?.message || 'unknown parse error').trim().split(/\r?\n/, 1)[0];
        addError('javascript-syntax', relativePath, `inline module does not parse: ${detail}`, lineAt(html, scriptMatch.index));
      }
    } else {
      try {
        new vm.Script(scriptMatch[2], { filename: `${relativePath}:inline` });
      } catch (error) {
        addError('javascript-syntax', relativePath, `inline script does not parse: ${error.message}`, lineAt(html, scriptMatch.index));
      }
    }
  }
}

function withoutEmbeddedCode(html) {
  // Preserve line breaks so findings still point at the original document.
  // Markup-looking strings inside scripts and styles are not document nodes.
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) => (
    block.replace(/[^\r\n]/g, ' ')
  ));
}

function visibleHtmlText(source) {
  return htmlDecode(String(source || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAriaName(tag, idSet) {
  if (tag.attributes.get('aria-label')?.value.trim()) return true;
  if (tag.attributes.get('title')?.value.trim()) return true;
  const references = (tag.attributes.get('aria-labelledby')?.value || '').split(/\s+/).filter(Boolean);
  return references.length > 0 && references.every((id) => idSet.has(id));
}

function isNonIndexableUtilityPage(relativePath, tags) {
  if (relativePath === '404.html' || relativePath.startsWith('assistant/') || relativePath.startsWith('verify/')) return true;
  const robots = tags
    .filter((tag) => tag.name === 'meta' && (tag.attributes.get('name')?.value || '').toLowerCase() === 'robots')
    .map((tag) => tag.attributes.get('content')?.value || '')
    .join(',');
  return /(?:^|[,\s])noindex(?:$|[,\s])/i.test(robots);
}

function inspectHtmlBaseline(relativePath, html) {
  const documentHtml = withoutEmbeddedCode(html);
  const tags = htmlTags(documentHtml);
  const idSet = new Set(tags.map((tag) => tag.attributes.get('id')?.value).filter(Boolean));
  const indexable = !isNonIndexableUtilityPage(relativePath, tags);
  const headHtml = documentHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] || '';
  const headTags = htmlTags(headHtml);

  const htmlElements = tags.filter((tag) => tag.name === 'html');
  const language = htmlElements[0]?.attributes.get('lang')?.value || '';
  if (htmlElements.length !== 1 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    addError('html-lang', relativePath, 'document must have exactly one <html> element with a valid non-empty lang attribute');
  }

  // Restrict this to <head>; an accessible SVG may legitimately contain its
  // own <title>, which is not the document title.
  const titleMatches = [...headHtml.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
  if (titleMatches.length !== 1 || !visibleHtmlText(titleMatches[0]?.[1])) {
    addError('html-title', relativePath, 'document must have exactly one non-empty <title>');
  }

  const descriptions = headTags.filter((tag) => (
    tag.name === 'meta' && (tag.attributes.get('name')?.value || '').toLowerCase() === 'description'
  ));
  if (indexable && (descriptions.length !== 1 || !descriptions[0]?.attributes.get('content')?.value.trim())) {
    addError('meta-description', relativePath, 'indexable document must have exactly one non-empty meta description');
  }

  const headings = [...documentHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)];
  if (indexable && (headings.length !== 1 || !visibleHtmlText(headings[0]?.[1]))) {
    addError('h1', relativePath, 'indexable document must have exactly one non-empty <h1>');
  }

  for (const tag of tags.filter((item) => item.name === 'img')) {
    if (!tag.attributes.has('alt')) {
      addError('image-alt', relativePath, '<img> must have an alt attribute (use alt="" for decorative images)', lineAt(documentHtml, tag.offset));
    }
  }

  for (const tag of tags.filter((item) => item.name === 'iframe')) {
    if (!tag.attributes.get('title')?.value.trim()) {
      addError('frame-title', relativePath, '<iframe> must have a non-empty title', lineAt(documentHtml, tag.offset));
    }
  }

  for (const tag of tags.filter((item) => (item.attributes.get('role')?.value || '').toLowerCase() === 'img')) {
    if (tag.name !== 'img' && !hasAriaName(tag, idSet)) {
      addError('image-name', relativePath, 'element with role="img" must have an accessible name', lineAt(documentHtml, tag.offset));
    }
  }

  const labelRanges = [];
  const explicitLabels = new Set();
  const labelPattern = /<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi;
  let labelMatch;
  while ((labelMatch = labelPattern.exec(documentHtml))) {
    const attributes = parseTagAttributes(labelMatch[1], labelMatch.index);
    const labelText = visibleHtmlText(labelMatch[2]);
    const target = attributes.get('for')?.value || '';
    if (target && !idSet.has(target)) {
      addError('label-target', relativePath, `<label for="${target}"> does not reference an element in the document`, lineAt(documentHtml, labelMatch.index));
    }
    if (target && labelText) explicitLabels.add(target);
    labelRanges.push({ start: labelMatch.index, end: labelPattern.lastIndex, hasText: Boolean(labelText) });
  }

  const hasLabel = (tag) => {
    if (hasAriaName(tag, idSet)) return true;
    const id = tag.attributes.get('id')?.value || '';
    if (id && explicitLabels.has(id)) return true;
    return labelRanges.some((range) => range.hasText && tag.offset > range.start && tag.offset < range.end);
  };

  for (const tag of tags.filter((item) => ['input', 'select', 'textarea'].includes(item.name))) {
    const type = (tag.attributes.get('type')?.value || 'text').toLowerCase();
    if (tag.name === 'input' && type === 'hidden') continue;
    if (tag.name === 'input' && ['button', 'submit', 'reset'].includes(type)) {
      if (!tag.attributes.get('value')?.value.trim() && !hasAriaName(tag, idSet)) {
        addError('control-label', relativePath, `<input type="${type}"> must have an accessible name`, lineAt(documentHtml, tag.offset));
      }
      continue;
    }
    if (tag.name === 'input' && type === 'image') {
      if (!tag.attributes.get('alt')?.value.trim() && !hasAriaName(tag, idSet)) {
        addError('control-label', relativePath, '<input type="image"> must have a non-empty alt or ARIA label', lineAt(documentHtml, tag.offset));
      }
      continue;
    }
    if (!hasLabel(tag)) {
      addError('control-label', relativePath, `<${tag.name}> must have an associated label or accessible name`, lineAt(documentHtml, tag.offset));
    }
  }

  const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi;
  let buttonMatch;
  while ((buttonMatch = buttonPattern.exec(documentHtml))) {
    const attributes = parseTagAttributes(buttonMatch[1], buttonMatch.index);
    const tag = { attributes };
    if (!visibleHtmlText(buttonMatch[2]) && !hasAriaName(tag, idSet)) {
      addError('button-name', relativePath, '<button> must have an accessible name', lineAt(documentHtml, buttonMatch.index));
    }
  }
}

function cssReferences(css) {
  const references = [];
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)/gi;
  let match;
  while ((match = urlPattern.exec(css))) {
    references.push({ value: match[1] ?? match[2] ?? match[3] ?? '', offset: match.index });
  }
  const importPattern = /@import\s+(?:"([^"]+)"|'([^']+)')/gi;
  while ((match = importPattern.exec(css))) references.push({ value: match[1] ?? match[2], offset: match.index });
  return references;
}

function assertXmlEntities(source, relativePath) {
  const invalid = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.exec(source);
  if (invalid) addError('xml-syntax', relativePath, 'unescaped or invalid XML entity', lineAt(source, invalid.index));
  const numericPattern = /&#(?:x([\da-f]+)|(\d+));/gi;
  let numeric;
  while ((numeric = numericPattern.exec(source))) {
    const codePoint = numeric[1] ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2], 10);
    if (!isValidXmlCodePoint(codePoint)) {
      addError('xml-syntax', relativePath, `numeric entity is outside the XML character range: ${numeric[0]}`, lineAt(source, numeric.index));
    }
  }
}

function isValidXmlCodePoint(codePoint) {
  return Number.isInteger(codePoint) && (
    codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function decodeXmlCodePoint(raw, radix) {
  const codePoint = Number.parseInt(raw, radix);
  return isValidXmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : '\ufffd';
}

function inspectXml(relativePath, source) {
  const stack = [];
  let roots = 0;
  let index = 0;
  assertXmlEntities(source, relativePath);

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) break;
    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4);
      if (close < 0) { addError('xml-syntax', relativePath, 'unclosed XML comment', lineAt(source, open)); return; }
      index = close + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const close = source.indexOf(']]>', open + 9);
      if (close < 0) { addError('xml-syntax', relativePath, 'unclosed CDATA section', lineAt(source, open)); return; }
      index = close + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      const close = source.indexOf('?>', open + 2);
      if (close < 0) { addError('xml-syntax', relativePath, 'unclosed XML processing instruction', lineAt(source, open)); return; }
      index = close + 2;
      continue;
    }
    if (source.startsWith('<!', open)) {
      addError('xml-syntax', relativePath, 'unsupported XML declaration', lineAt(source, open));
      return;
    }

    let close = open + 1;
    let quote = '';
    for (; close < source.length; close += 1) {
      const character = source[close];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (close >= source.length || quote) {
      addError('xml-syntax', relativePath, 'unclosed XML tag', lineAt(source, open));
      return;
    }

    const raw = source.slice(open + 1, close).trim();
    const closing = raw.startsWith('/');
    const selfClosing = raw.endsWith('/');
    const nameMatch = raw.match(closing ? /^\/\s*([A-Za-z_][\w:.-]*)\s*$/ : /^([A-Za-z_][\w:.-]*)\b/);
    if (!nameMatch) {
      addError('xml-syntax', relativePath, `invalid XML tag <${raw.slice(0, 40)}>`, lineAt(source, open));
      return;
    }
    const name = nameMatch[1];
    if (closing) {
      const expected = stack.pop();
      if (expected !== name) {
        addError('xml-syntax', relativePath, `closing tag </${name}> does not match <${expected || '(none)'}>`, lineAt(source, open));
        return;
      }
    } else if (!selfClosing) {
      if (stack.length === 0) roots += 1;
      stack.push(name);
    } else if (stack.length === 0) roots += 1;
    index = close + 1;
  }

  if (stack.length) addError('xml-syntax', relativePath, `unclosed XML tag <${stack.at(-1)}>`, null);
  if (roots !== 1) addError('xml-syntax', relativePath, `expected one XML root element, found ${roots}`, null);
}

function xmlDecode(value) {
  return value
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, n) => decodeXmlCodePoint(n, 10))
    .replace(/&#x([\da-f]+);/gi, (_, n) => decodeXmlCodePoint(n, 16));
}

function xmlLocs(source) {
  return [...source.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)]
    .map((match) => xmlDecode(match[1].trim()));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function metadataHasGpsText(buffer) {
  const text = buffer.toString('latin1');
  return /(?:exif:GPS|GPS(?:Latitude|Longitude|Altitude|Position|Dest|ImgDirection|MapDatum|DateStamp|ProcessingMethod|AreaInformation)|\bgeo:(?:lat|long)\b)/i.test(text);
}

function tiffHasGps(buffer, tiffStart, tiffLength) {
  if (tiffLength < 8 || tiffStart < 0 || tiffStart + tiffLength > buffer.length) return false;
  const byteOrder = buffer.toString('ascii', tiffStart, tiffStart + 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return false;
  const littleEndian = byteOrder === 'II';
  const end = tiffStart + tiffLength;

  const read16 = (offset) => {
    if (offset < tiffStart || offset + 2 > end) return null;
    return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  };
  const read32 = (offset) => {
    if (offset < tiffStart || offset + 4 > end) return null;
    return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  };

  if (read16(tiffStart + 2) !== 42) return false;
  const firstIfd = read32(tiffStart + 4);
  if (firstIfd === null) return false;

  const pending = [firstIfd];
  const visited = new Set();
  while (pending.length) {
    const relativeOffset = pending.pop();
    if (!relativeOffset || visited.has(relativeOffset)) continue;
    visited.add(relativeOffset);

    const ifdStart = tiffStart + relativeOffset;
    const entryCount = read16(ifdStart);
    if (entryCount === null || entryCount > 4096) continue;
    const entriesEnd = ifdStart + 2 + entryCount * 12;
    if (entriesEnd + 4 > end) continue;

    for (let index = 0; index < entryCount; index += 1) {
      const entry = ifdStart + 2 + index * 12;
      const tag = read16(entry);
      const valueOffset = read32(entry + 8);
      if (tag === 0x8825) return true; // GPSInfo IFD pointer
      if ((tag === 0x8769 || tag === 0xa005) && valueOffset) pending.push(valueOffset);
    }

    const nextIfd = read32(entriesEnd);
    if (nextIfd) pending.push(nextIfd);
  }
  return false;
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { malformed: 'invalid JPEG signature', hasExif: false, hasGps: false };
  }
  if (buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) {
    return { malformed: 'JPEG is missing a terminal EOI marker or has trailing bytes', hasExif: false, hasGps: false };
  }

  let offset = 2;
  // Scan the full container as well as ordinary pre-scan segments. Progressive
  // JPEGs can legally place metadata between scans, after the first SOS.
  let hasExif = buffer.indexOf(JPEG_EXIF_HEADER) !== -1;
  let hasGps = metadataHasGpsText(buffer);
  let width = 0;
  let height = 0;

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) {
      return { malformed: 'truncated JPEG segment length', hasExif, hasGps };
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return { malformed: 'invalid JPEG segment length', hasExif, hasGps };
    }
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;
    const segment = buffer.subarray(dataStart, dataEnd);

    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    );
    if (isStartOfFrame) {
      if (segment.length < 6) return { malformed: 'truncated JPEG frame header', hasExif, hasGps, width, height };
      height = segment.readUInt16BE(1);
      width = segment.readUInt16BE(3);
      if (!width || !height) return { malformed: 'JPEG has invalid image dimensions', hasExif, hasGps, width, height };
    } else if (marker === 0xe1 && segment.subarray(0, 6).equals(JPEG_EXIF_HEADER)) {
      hasExif = true;
      hasGps ||= tiffHasGps(buffer, dataStart + 6, dataEnd - dataStart - 6);
      hasGps ||= metadataHasGpsText(segment);
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      hasGps ||= metadataHasGpsText(segment);
    }

    offset = dataEnd;
  }

  if (!width || !height) return { malformed: 'JPEG has no valid frame header', hasExif, hasGps, width, height };
  return { malformed: null, hasExif, hasGps, width, height };
}

function pngText(buffer, type, dataStart, dataEnd) {
  const data = buffer.subarray(dataStart, dataEnd);
  try {
    if (type === 'tEXt') return data;

    const keywordEnd = data.indexOf(0);
    if (keywordEnd < 0) return data;
    const keyword = data.subarray(0, keywordEnd);

    if (type === 'zTXt') {
      const compressed = data.subarray(keywordEnd + 2);
      return Buffer.concat([keyword, inflateSync(compressed, { maxOutputLength: 1_048_576 })]);
    }

    if (type === 'iTXt') {
      const compressionFlag = data[keywordEnd + 1];
      let cursor = keywordEnd + 3;
      const languageEnd = data.indexOf(0, cursor);
      if (languageEnd < 0) return data;
      cursor = languageEnd + 1;
      const translatedEnd = data.indexOf(0, cursor);
      if (translatedEnd < 0) return data;
      cursor = translatedEnd + 1;
      const content = data.subarray(cursor);
      const decoded = compressionFlag === 1
        ? inflateSync(content, { maxOutputLength: 1_048_576 })
        : content;
      return Buffer.concat([keyword, decoded]);
    }
  } catch {
    return data;
  }
  return data;
}

function inspectPng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { malformed: 'invalid PNG signature', hasExif: false, hasGps: false };
  }

  let offset = 8;
  let hasExif = false;
  let hasGps = false;
  let sawEnd = false;
  let sawHeader = false;
  let sawImage = false;
  let width = 0;
  let height = 0;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > buffer.length) {
      return { malformed: `invalid PNG ${type || '(unknown)'} chunk length`, hasExif, hasGps };
    }
    if ((crc32(buffer.subarray(offset + 4, dataEnd)) >>> 0) !== buffer.readUInt32BE(dataEnd)) {
      return { malformed: `PNG ${type || '(unknown)'} chunk has an invalid CRC`, hasExif, hasGps, width, height };
    }

    if (type === 'IHDR') {
      if (sawHeader || offset !== 8 || length !== 13) {
        return { malformed: 'PNG must begin with exactly one 13-byte IHDR chunk', hasExif, hasGps, width, height };
      }
      sawHeader = true;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      if (!width || !height) return { malformed: 'PNG has invalid image dimensions', hasExif, hasGps, width, height };
    } else if (type === 'IDAT') {
      sawImage = true;
    } else if (type === 'eXIf') {
      hasExif = true;
      hasGps ||= tiffHasGps(buffer, dataStart, length);
      hasGps ||= metadataHasGpsText(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      hasGps ||= metadataHasGpsText(pngText(buffer, type, dataStart, dataEnd));
    }

    offset = chunkEnd;
    if (type === 'IEND') {
      if (length !== 0) return { malformed: 'PNG IEND chunk must be empty', hasExif, hasGps, width, height };
      sawEnd = true;
      break;
    }
  }

  return {
    malformed: !sawHeader
      ? 'PNG has no valid IHDR chunk'
      : !sawEnd
        ? 'PNG has no complete IEND chunk'
        : !sawImage
          ? 'PNG has no image-data chunk'
        : offset !== buffer.length
          ? 'PNG has bytes or chunks after IEND'
          : null,
    hasExif,
    hasGps,
    width,
    height,
  };
}

function inspectWebp(buffer) {
  if (
    buffer.length < 12
    || !buffer.subarray(0, 4).equals(WEBP_RIFF)
    || !buffer.subarray(8, 12).equals(WEBP_SIGNATURE)
  ) {
    return { malformed: 'invalid WebP RIFF signature', hasExif: false, hasGps: false };
  }
  const declaredLength = buffer.readUInt32LE(4) + 8;
  if (declaredLength > buffer.length) {
    return { malformed: 'truncated WebP RIFF container', hasExif: false, hasGps: false };
  }
  if (declaredLength !== buffer.length) {
    return { malformed: 'WebP has bytes outside its declared RIFF container', hasExif: false, hasGps: false };
  }

  let offset = 12;
  let hasExif = false;
  let hasGps = false;
  let sawImage = false;
  let width = 0;
  let height = 0;
  while (offset + 8 <= declaredLength) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd < dataStart || dataEnd > declaredLength) {
      return { malformed: `invalid WebP ${type || '(unknown)'} chunk length`, hasExif, hasGps };
    }
    const chunk = buffer.subarray(dataStart, dataEnd);
    if (type === 'EXIF') {
      hasExif = true;
      const tiffOffset = chunk.subarray(0, 6).equals(JPEG_EXIF_HEADER) ? 6 : 0;
      hasGps ||= tiffHasGps(chunk, tiffOffset, chunk.length - tiffOffset);
      hasGps ||= metadataHasGpsText(chunk);
    } else if (type === 'XMP ') {
      hasGps ||= metadataHasGpsText(chunk);
    } else if (type === 'VP8X' && chunk.length >= 10) {
      width ||= chunk.readUIntLE(4, 3) + 1;
      height ||= chunk.readUIntLE(7, 3) + 1;
    } else if (type === 'VP8 ' && chunk.length >= 10) {
      if (chunk[3] !== 0x9d || chunk[4] !== 0x01 || chunk[5] !== 0x2a) {
        return { malformed: 'WebP VP8 frame header is invalid', hasExif, hasGps, width, height };
      }
      width ||= chunk.readUInt16LE(6) & 0x3fff;
      height ||= chunk.readUInt16LE(8) & 0x3fff;
      sawImage = true;
    } else if (type === 'VP8L' && chunk.length >= 5) {
      if (chunk[0] !== 0x2f) return { malformed: 'WebP VP8L frame header is invalid', hasExif, hasGps, width, height };
      const dimensions = chunk.readUInt32LE(1);
      width ||= (dimensions & 0x3fff) + 1;
      height ||= ((dimensions >>> 14) & 0x3fff) + 1;
      sawImage = true;
    } else if (type === 'VP8 ' || type === 'VP8L') {
      return { malformed: `WebP ${type.trim()} frame header is truncated`, hasExif, hasGps, width, height };
    }
    offset = dataEnd + (length % 2);
  }
  if (offset !== declaredLength) return { malformed: 'WebP ends with a partial chunk', hasExif, hasGps, width, height };
  if (!sawImage) return { malformed: 'WebP has no image chunk', hasExif, hasGps, width, height };
  if (!width || !height) return { malformed: 'WebP has invalid image dimensions', hasExif, hasGps, width, height };
  return { malformed: null, hasExif, hasGps, width, height };
}

function routeFile(pathname, fileSet) {
  return routeCandidates(pathname).find((candidate) => fileSet.has(candidate)) || '';
}

function inspectReference(reference, relativePath, source, fileSet, redirectRules) {
  if (reference.invalid) {
    addError(
      'invalid-url',
      relativePath,
      `${reference.attribute || 'URL'} is invalid${reference.reason ? `: ${reference.reason}` : ''}`,
      lineAt(source, reference.offset || 0),
    );
    return false;
  }
  const result = internalTargetStatus(reference.pathname, fileSet, redirectRules);
  if (!result.ok) {
    addError(
      'broken-internal-target',
      relativePath,
      `${reference.rawValue} is unresolved: ${result.reason}`,
      lineAt(source, reference.offset || 0),
    );
    return false;
  }
  return true;
}

function sameOriginReference(value, basePath = '/') {
  if (typeof value !== 'string' || (!value.startsWith('/') && !/^https?:\/\//i.test(value))) return null;
  return resolveInternalReference(value, basePath === '/' ? 'index.html' : basePath.replace(/^\//, ''));
}

function collectJsonReferences(value, output = [], location = '$', relativePath = 'index.html', key = '') {
  if (typeof value === 'string') {
    const urlKey = /^(?:@id|id|sameAs|url|contentUrl|embedUrl|thumbnailUrl|image|logo)$/i.test(key)
      || /(?:^|_)(?:url|uri)$/i.test(key);
    if (urlKey && !value.trim()) {
      output.push({ invalid: true, rawValue: value, location, reason: `${location} is an empty URL` });
      return output;
    }
    const reference = urlKey
      ? resolveInternalReference(value, relativePath)
      : sameOriginReference(value, relativePath);
    if (reference) output.push({ ...reference, location });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonReferences(item, output, `${location}[${index}]`, relativePath, key));
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, item] of Object.entries(value)) {
      collectJsonReferences(item, output, `${location}.${childKey}`, relativePath, childKey);
    }
  }
  return output;
}

function exactObjectKeys(value, expected, relativePath, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addError('json-schema', relativePath, `${location} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\u0000') !== wanted.join('\u0000')) {
    addError(
      'json-schema',
      relativePath,
      `${location} keys must be exactly ${wanted.join(', ')}; found ${actual.join(', ') || '(none)'}`,
    );
    return false;
  }
  return true;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validIsoTimestamp(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match || !validIsoDate(match[1])) return false;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false;
  if (match[6] && (Number(match[7]) > 59 || Number(match[6]) > 14 || (Number(match[6]) === 14 && Number(match[7]) !== 0))) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function inspectFreshTimestamp(relativePath, value, location = 'published_at') {
  if (!validIsoTimestamp(value)) {
    addError('feed-freshness', relativePath, `${location} must be an ISO-8601 timestamp with timezone`);
    return;
  }
  const age = Date.now() - new Date(value).getTime();
  if (age < -5 * 60 * 1000) addError('feed-freshness', relativePath, `${location} is more than five minutes in the future`);
  if (age > 48 * 60 * 60 * 1000) addError('feed-freshness', relativePath, `${location} is older than 48 hours`);
}

function inspectPublicFeed(relativePath, value) {
  if (relativePath === 'data/attestations.json') {
    exactObjectKeys(value, ['schema_version', 'published_at', 'limitations', 'records'], relativePath, '$');
    if (value?.schema_version !== 1) addError('json-schema', relativePath, 'schema_version must equal 1');
    inspectFreshTimestamp(relativePath, value?.published_at);
    if (typeof value?.limitations !== 'string' || !value.limitations.trim()) {
      addError('json-schema', relativePath, 'limitations must be a non-empty string');
    }
    if (!Array.isArray(value?.records)) {
      addError('json-schema', relativePath, 'records must be an array');
      return;
    }
    value.records.forEach((record, index) => {
      const location = `$.records[${index}]`;
      if (!exactObjectKeys(record, [
        'received_at', 'date', 'day', 'event', 'kind', 'video_sha256',
        'photo_sha256s', 'status',
      ], relativePath, location)) return;
      if (!validIsoTimestamp(record.received_at)) {
        addError('json-schema', relativePath, `${location}.received_at must be an ISO-8601 timestamp with timezone`);
      }
      if (!validIsoDate(record.date)) addError('json-schema', relativePath, `${location}.date must be a real YYYY-MM-DD date`);
      if (!Number.isInteger(record.day) || record.day < 1) addError('json-schema', relativePath, `${location}.day must be a positive integer`);
      if (record.event !== 'capture-attested') addError('json-schema', relativePath, `${location}.event must equal capture-attested`);
      if (record.kind !== 'daily') addError('json-schema', relativePath, `${location}.kind must equal daily`);
      if (record.status !== 'VALID-CONSUMED') addError('json-schema', relativePath, `${location}.status must equal VALID-CONSUMED`);
      if (record.video_sha256 !== null && !/^[a-f0-9]{64}$/.test(String(record.video_sha256 || ''))) {
        addError('json-schema', relativePath, `${location}.video_sha256 must be null or a lowercase SHA-256 digest`);
      }
      if (!Array.isArray(record.photo_sha256s) || record.photo_sha256s.some((hash) => !/^[a-f0-9]{64}$/.test(String(hash)))) {
        addError('json-schema', relativePath, `${location}.photo_sha256s must contain only lowercase SHA-256 digests`);
      }
    });
    return;
  }

  if (relativePath === 'data/supervision.json') {
    exactObjectKeys(value, ['schema_version', 'agreement_active', 'published_at', 'sessions'], relativePath, '$');
    if (value?.schema_version !== 1) addError('json-schema', relativePath, 'schema_version must equal 1');
    if (typeof value?.agreement_active !== 'boolean') addError('json-schema', relativePath, 'agreement_active must be boolean');
    inspectFreshTimestamp(relativePath, value?.published_at);
    if (!value?.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions)) {
      addError('json-schema', relativePath, 'sessions must be an object keyed by date');
      return;
    }
    const statuses = new Set(['', 'COMPLETED', 'MISSED', 'EXCEPTION', 'IN PROGRESS']);
    for (const [date, session] of Object.entries(value.sessions)) {
      const location = `$.sessions.${date}`;
      if (!validIsoDate(date)) addError('json-schema', relativePath, `${location} uses an invalid date key`);
      if (!exactObjectKeys(session, ['required', 'status'], relativePath, location)) continue;
      if (typeof session.required !== 'boolean') addError('json-schema', relativePath, `${location}.required must be boolean`);
      if (!statuses.has(session.status)) addError('json-schema', relativePath, `${location}.status is not an allowed public status`);
    }
    return;
  }

  if (relativePath === 'data/feed-manifest.json') {
    exactObjectKeys(value, [
      'schema_version', 'published_at', 'project_start_date',
      'agreement_active', 'agreement_effective_date',
    ], relativePath, '$');
    if (value?.schema_version !== 1) addError('json-schema', relativePath, 'schema_version must equal 1');
    inspectFreshTimestamp(relativePath, value?.published_at);
    if (!validIsoDate(value?.project_start_date)) {
      addError('json-schema', relativePath, 'project_start_date must be a real YYYY-MM-DD date');
    }
    if (typeof value?.agreement_active !== 'boolean') {
      addError('json-schema', relativePath, 'agreement_active must be boolean');
    }
    if (typeof value?.agreement_effective_date !== 'string') {
      addError('json-schema', relativePath, 'agreement_effective_date must be a string');
    } else if (value?.agreement_active) {
      if (!validIsoDate(value.agreement_effective_date)
        || value.agreement_effective_date < value.project_start_date
        || value.agreement_effective_date > new Date().toISOString().slice(0, 10)) {
        addError('json-schema', relativePath, 'active agreement_effective_date must be a real date from project start through today');
      }
    } else if (value.agreement_effective_date !== '') {
      addError('json-schema', relativePath, 'inactive agreement_effective_date must be empty');
    }
  }
}

function exactStringArray(value, expected, relativePath, location) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    addError('json-schema', relativePath, `${location} must be a string array`);
    return false;
  }
  const actual = [...value].sort();
  const wanted = [...expected].sort();
  if (actual.join('\u0000') !== wanted.join('\u0000')) {
    addError('json-schema', relativePath, `${location} must contain exactly ${wanted.join(', ')}`);
    return false;
  }
  return true;
}

function inspectPublishedManifestSchema(relativePath, value) {
  if (!exactObjectKeys(value, ['$schema', '$id', 'title', 'type', 'required', 'properties', '$defs', 'additionalProperties'], relativePath, '$')) return;
  if (value.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    addError('json-schema', relativePath, '$.$schema must identify JSON Schema draft 2020-12');
  }
  if (value.$id !== `${SITE_ORIGIN}/schemas/daily-record-manifest-v1.json`) {
    addError('json-schema', relativePath, '$.$id must equal the canonical published schema URL');
  }
  if (value.type !== 'object' || value.additionalProperties !== false || typeof value.title !== 'string' || !value.title.trim()) {
    addError('json-schema', relativePath, 'published schema must describe a closed, titled object');
  }
  const topLevel = ['schema', 'person', 'project', 'record', 'photos'];
  exactStringArray(value.required, topLevel, relativePath, '$.required');
  if (!exactObjectKeys(value.properties, topLevel, relativePath, '$.properties')) return;
  if (value.properties.schema?.const !== `${SITE_ORIGIN}/schemas/daily-record-manifest-v1.json`) {
    addError('json-schema', relativePath, '$.properties.schema.const must equal the canonical schema URL');
  }
  const requiredBySection = {
    person: ['name', 'id'],
    project: ['name', 'start_date', 'start_weight_lb', 'goal_weight_lb'],
    record: ['date', 'day', 'weight_lb', 'note', 'video_url', 'canonical_url', 'attestation'],
    photos: ['front', 'left', 'rear', 'right'],
  };
  for (const [section, required] of Object.entries(requiredBySection)) {
    const definition = value.properties[section];
    if (!definition || typeof definition !== 'object' || Array.isArray(definition) || definition.type !== 'object') {
      addError('json-schema', relativePath, `$.properties.${section} must be an object schema`);
      continue;
    }
    exactStringArray(definition.required, required, relativePath, `$.properties.${section}.required`);
    if (definition.additionalProperties !== false) {
      addError('json-schema', relativePath, `$.properties.${section}.additionalProperties must be false`);
    }
    exactObjectKeys(definition.properties, required, relativePath, `$.properties.${section}.properties`);
  }
  for (const angle of ['front', 'left', 'rear', 'right']) {
    if (value.properties.photos?.properties?.[angle]?.$ref !== '#/$defs/photo') {
      addError('json-schema', relativePath, `$.properties.photos.properties.${angle} must reference #/$defs/photo`);
    }
  }
  if (!exactObjectKeys(value.$defs, ['photo', 'responsivePhoto'], relativePath, '$.$defs')) return;
  const definitionRequirements = {
    photo: ['url', 'width', 'height', 'sha256', 'responsive'],
    responsivePhoto: ['url', 'width', 'height', 'bytes', 'sha256'],
  };
  for (const [name, required] of Object.entries(definitionRequirements)) {
    const definition = value.$defs[name];
    if (!exactObjectKeys(definition, ['type', 'required', 'properties', 'additionalProperties'], relativePath, `$.$defs.${name}`)) continue;
    if (definition.type !== 'object' || definition.additionalProperties !== false) {
      addError('json-schema', relativePath, `$.$defs.${name} must be a closed object schema`);
    }
    exactStringArray(definition.required, required, relativePath, `$.$defs.${name}.required`);
    exactObjectKeys(definition.properties, required, relativePath, `$.$defs.${name}.properties`);
    for (const key of ['width', 'height', ...(name === 'responsivePhoto' ? ['bytes'] : [])]) {
      const property = definition.properties?.[key];
      if (property?.type !== 'integer' || property.minimum !== 1) {
        addError('json-schema', relativePath, `$.$defs.${name}.properties.${key} must be a positive integer`);
      }
    }
    if (definition.properties?.url?.type !== 'string' || definition.properties.url.format !== 'uri') {
      addError('json-schema', relativePath, `$.$defs.${name}.properties.url must be a URI string`);
    }
    if (definition.properties?.sha256?.type !== 'string' || definition.properties.sha256.pattern !== '^[a-f0-9]{64}$') {
      addError('json-schema', relativePath, `$.$defs.${name}.properties.sha256 must require a lowercase SHA-256 digest`);
    }
  }
  const responsive = value.$defs.photo?.properties?.responsive;
  if (
    responsive?.type !== 'array' || responsive.minItems !== 1
    || responsive.items?.$ref !== '#/$defs/responsivePhoto'
  ) {
    addError('json-schema', relativePath, '$.$defs.photo.properties.responsive must be a non-empty responsivePhoto array');
  }
  const recordProperties = value.properties.record?.properties;
  for (const key of ['date', 'note', 'video_url', 'canonical_url']) {
    if (recordProperties?.[key]?.type !== 'string') addError('json-schema', relativePath, `$.properties.record.properties.${key} must be a string`);
  }
  if (recordProperties?.day?.type !== 'integer' || recordProperties.day.minimum !== 1) {
    addError('json-schema', relativePath, '$.properties.record.properties.day must be a positive integer');
  }
  if (recordProperties?.weight_lb?.type !== 'number') {
    addError('json-schema', relativePath, '$.properties.record.properties.weight_lb must be numeric');
  }
  if (recordProperties?.video_url?.format !== 'uri' || recordProperties?.canonical_url?.format !== 'uri') {
    addError('json-schema', relativePath, 'record video_url and canonical_url must use URI format validation');
  }
  const attestation = recordProperties?.attestation?.oneOf;
  if (
    !Array.isArray(attestation) || attestation.length !== 2
    || !attestation.some((choice) => choice?.const === 'VALID-CONSUMED')
    || !attestation.some((choice) => choice?.type === 'null')
  ) {
    addError('json-schema', relativePath, 'record attestation must allow exactly VALID-CONSUMED or null');
  }
}

async function inspectDailyManifest(relativePath, manifest, fileSet) {
  const date = path.posix.basename(relativePath, '.json');
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    addError('manifest-schema', relativePath, 'daily manifest is not an object');
    return;
  }
  exactObjectKeys(manifest, ['schema', 'person', 'project', 'record', 'photos'], relativePath, '$');
  exactObjectKeys(manifest.person, ['name', 'id'], relativePath, '$.person');
  exactObjectKeys(manifest.project, ['name', 'start_date', 'start_weight_lb', 'goal_weight_lb'], relativePath, '$.project');
  exactObjectKeys(manifest.record, ['date', 'day', 'weight_lb', 'note', 'video_url', 'canonical_url', 'attestation'], relativePath, '$.record');
  exactObjectKeys(manifest.photos, ['front', 'left', 'rear', 'right'], relativePath, '$.photos');
  if (manifest.schema !== `${SITE_ORIGIN}/schemas/daily-record-manifest-v1.json`) {
    addError('manifest-schema', relativePath, 'daily manifest has the wrong schema identifier');
  }
  if (manifest.person?.name !== 'Micheal Ray Berry' || manifest.person?.id !== `${SITE_ORIGIN}/#micheal-ray-berry`) {
    addError('manifest-schema', relativePath, 'person identity does not match the canonical project identity');
  }
  if (!validIsoDate(manifest.project?.start_date)) addError('manifest-schema', relativePath, 'project.start_date must be a real YYYY-MM-DD date');
  if (!Number.isFinite(manifest.project?.start_weight_lb) || !Number.isFinite(manifest.project?.goal_weight_lb)) {
    addError('manifest-schema', relativePath, 'project weights must be numeric');
  }
  if (manifest.record?.date !== date) addError('manifest-schema', relativePath, 'record.date does not match the manifest filename');
  if (!Number.isInteger(manifest.record?.day) || manifest.record.day < 1) addError('manifest-schema', relativePath, 'record.day must be a positive integer');
  if (!Number.isFinite(manifest.record?.weight_lb)) addError('manifest-schema', relativePath, 'record.weight_lb must be numeric');
  if (typeof manifest.record?.note !== 'string') addError('manifest-schema', relativePath, 'record.note must be a string');
  const reviewedManifestVideo = reviewedVideoUrl(manifest.record?.video_url);
  if (!reviewedManifestVideo || reviewedManifestVideo.kind === 'blank') {
    addError('manifest-schema', relativePath, 'record.video_url must be a non-empty approved same-origin or canonical YouTube URL');
  } else if (reviewedManifestVideo.kind === 'same-origin' && !routeFile(reviewedManifestVideo.parsed.pathname, fileSet)) {
    addError('manifest-schema', relativePath, `record.video_url does not resolve to a deployed media file: ${reviewedManifestVideo.parsed.pathname}`);
  }
  if (manifest.record?.attestation !== null && manifest.record?.attestation !== 'VALID-CONSUMED') {
    addError('manifest-schema', relativePath, 'record.attestation must be null or VALID-CONSUMED');
  }
  const expectedCanonical = `${SITE_ORIGIN}/daily/${date}-day-${String(manifest.record?.day || '').padStart(3, '0')}/`;
  if (manifest.record?.canonical_url !== expectedCanonical) {
    addError('manifest-schema', relativePath, `record.canonical_url must equal ${expectedCanonical}`);
  }
  const expectedAngles = ['front', 'left', 'rear', 'right'];
  for (const angle of expectedAngles) {
    const photo = manifest.photos?.[angle];
    if (!photo || typeof photo !== 'object') {
      addError('manifest-schema', relativePath, `photos.${angle} is missing`);
      continue;
    }
    exactObjectKeys(photo, ['url', 'width', 'height', 'sha256', 'responsive'], relativePath, `$.photos.${angle}`);
    if (!Number.isInteger(photo.width) || photo.width < 1 || !Number.isInteger(photo.height) || photo.height < 1) {
      addError('manifest-schema', relativePath, `photos.${angle} must have positive integer dimensions`);
    }
    const assets = [{
      url: photo.url, expectedHash: photo.sha256,
      expectedWidth: photo.width, expectedHeight: photo.height,
      label: `photos.${angle}`,
    }];
    if (!Array.isArray(photo.responsive) || photo.responsive.length === 0) {
      addError('manifest-schema', relativePath, `photos.${angle}.responsive is empty`);
    } else {
      const widths = new Set();
      photo.responsive.forEach((item, index) => assets.push({
        url: item?.url,
        expectedHash: item?.sha256,
        expectedBytes: item?.bytes,
        expectedWidth: item?.width,
        expectedHeight: item?.height,
        label: `photos.${angle}.responsive[${index}]`,
      }));
      photo.responsive.forEach((item, index) => {
        exactObjectKeys(item, ['url', 'width', 'height', 'bytes', 'sha256'], relativePath, `$.photos.${angle}.responsive[${index}]`);
        if (!Number.isInteger(item?.width) || item.width < 1 || !Number.isInteger(item?.height) || item.height < 1) {
          addError('manifest-schema', relativePath, `photos.${angle}.responsive[${index}] must have positive integer dimensions`);
        }
        if (!Number.isInteger(item?.bytes) || item.bytes < 1) {
          addError('manifest-schema', relativePath, `photos.${angle}.responsive[${index}].bytes must be a positive integer`);
        }
        if (widths.has(item?.width)) addError('manifest-schema', relativePath, `photos.${angle}.responsive repeats width ${item?.width}`);
        widths.add(item?.width);
      });
    }
    for (const asset of assets) {
      const reference = sameOriginReference(asset.url || '');
      if (!reference?.pathname) {
        addError('manifest-schema', relativePath, `${asset.label}.url must use the canonical site origin`);
        continue;
      }
      const assetPath = reference?.pathname ? routeFile(reference.pathname, fileSet) : '';
      if (!assetPath) continue; // Generic JSON target reporting supplies the clearer missing-path error.
      if (!/^[a-f0-9]{64}$/i.test(String(asset.expectedHash || ''))) {
        addError('manifest-hash', relativePath, `${asset.label}.sha256 is missing or malformed`);
        continue;
      }
      const bytes = await readFile(path.join(publicRoot, assetPath));
      if (sha256(bytes) !== String(asset.expectedHash).toLowerCase()) {
        addError('manifest-hash', relativePath, `${asset.label}.sha256 does not match ${assetPath}`);
      }
      if (asset.expectedBytes != null && asset.expectedBytes !== bytes.length) {
        addError('manifest-size', relativePath, `${asset.label}.bytes does not match ${assetPath}`);
      }
      const metadata = imageMetadata(bytes, assetPath);
      if (!metadata.malformed && asset.expectedWidth != null && asset.expectedHeight != null && (
        asset.expectedWidth !== metadata.width || asset.expectedHeight !== metadata.height
      )) {
        addError('manifest-dimensions', relativePath, `${asset.label} dimensions do not match ${assetPath}`);
      }
    }
  }

  const sidecarPath = `manifests/${date}.sha256`;
  if (fileSet.has(sidecarPath)) {
    const manifestBytes = await readFile(path.join(publicRoot, relativePath));
    const sidecar = (await readFile(path.join(publicRoot, sidecarPath), 'utf8')).trim();
    const match = sidecar.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match || match[2] !== `${date}.json` || match[1].toLowerCase() !== sha256(manifestBytes)) {
      addError('manifest-sidecar', sidecarPath, `sidecar does not authenticate ${date}.json`);
    }
  }
}

function inspectHeaders(source) {
  const globalBlock = source.match(/(?:^|\n)\/\*\s*\n([\s\S]*?)(?=\n\/|$)/)?.[1] || '';
  for (const header of [
    'Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options',
    'Referrer-Policy', 'Permissions-Policy', 'X-Frame-Options',
  ]) {
    if (!new RegExp(`^\\s*${escapeRegex(header)}\\s*:`, 'mi').test(globalBlock)) {
      addError('required-header', '_headers', `${header} is missing from the global /* block`);
    }
  }
  const verifyBlock = source.match(/(?:^|\n)\/verify\/\*\s*\n([\s\S]*?)(?=\n\/|$)/)?.[1] || '';
  if (!/^\s*X-Robots-Tag\s*:\s*[^\n]*noindex/mi.test(verifyBlock)) addError('required-header', '_headers', '/verify/* must set X-Robots-Tag: noindex');
  if (!/^\s*Cache-Control\s*:\s*[^\n]*no-store/mi.test(verifyBlock)) addError('required-header', '_headers', '/verify/* must set Cache-Control: no-store');
  const assistantBlock = source.match(/(?:^|\n)\/assistant\/\*\s*\n([\s\S]*?)(?=\n\/|$)/)?.[1] || '';
  if (!/^\s*X-Robots-Tag\s*:\s*[^\n]*noindex/mi.test(assistantBlock)) addError('required-header', '_headers', '/assistant/* must set X-Robots-Tag: noindex');
  if (!/^\s*Cache-Control\s*:\s*[^\n]*no-store/mi.test(assistantBlock)) addError('required-header', '_headers', '/assistant/* must set Cache-Control: no-store');
  const dataBlock = source.match(/(?:^|\n)\/data\/\*\s*\n([\s\S]*?)(?=\n\/|$)/)?.[1] || '';
  const dataCache = dataBlock.match(/^\s*Cache-Control\s*:\s*([^\n]+)/mi)?.[1] || '';
  const maxAge = Number.parseInt(dataCache.match(/(?:^|[,\s])max-age=(\d+)/i)?.[1] || '', 10);
  if (!dataCache || (!/\bno-store\b/i.test(dataCache) && (!Number.isInteger(maxAge) || maxAge > 300))) {
    addError('required-header', '_headers', '/data/* must be no-store or have max-age no greater than 300 seconds');
  }
  if (/docs\.google\.com\/spreadsheets|\/gviz\/tq/i.test(globalBlock)) {
    addError('header-containment', '_headers', 'global policy still allows direct Google Sheets reads');
  }
}

function inspectRedirectDestinations(redirectRules, fileSet) {
  const duplicateSources = new Set();
  const seenSources = new Set();
  for (const rule of redirectRules) {
    if (seenSources.has(rule.from)) duplicateSources.add(rule.from);
    seenSources.add(rule.from);
    if (!rule.to.startsWith('/')) continue;
    if (rule.status >= 400) {
      if (!routeFile(new URL(rule.to, SITE_ORIGIN).pathname, fileSet)) {
        addError('redirect-target', '_redirects', `${rule.from} uses missing error target ${rule.to}`);
      }
      continue;
    }
    if (/[:*]/.test(rule.to)) continue; // Parameterized targets need a concrete request to expand.
    const targetPath = new URL(rule.to, SITE_ORIGIN).pathname;
    const targetRule = firstRedirect(targetPath, redirectRules);
    if (targetRule?.from === rule.from || targetPath === rule.from) {
      addError('redirect-loop', '_redirects', `${rule.from} redirects to itself`);
    } else if (!targetRule && !routeFile(targetPath, fileSet)) {
      addError('redirect-target', '_redirects', `${rule.from} redirects to missing target ${rule.to}`);
    }
  }
  for (const source of duplicateSources) addError('redirect-duplicate', '_redirects', `duplicate redirect source ${source}`);

  for (const rule of redirectRules) {
    if (/[:*]/.test(rule.from) || !rule.to.startsWith('/') || /[:*]/.test(rule.to) || rule.status >= 400) continue;
    const visited = new Set([rule.from]);
    let current = new URL(rule.to, SITE_ORIGIN).pathname;
    for (let depth = 0; depth < 25; depth += 1) {
      if (visited.has(current)) {
        addError('redirect-loop', '_redirects', `${rule.from} enters a redirect loop at ${current}`);
        break;
      }
      visited.add(current);
      const next = firstRedirect(current, redirectRules);
      if (!next || next.status >= 400 || !next.to.startsWith('/') || /[:*]/.test(next.to)) break;
      current = new URL(next.to, SITE_ORIGIN).pathname;
      if (depth === 24) addError('redirect-loop', '_redirects', `${rule.from} exceeds 25 redirect hops`);
    }
  }
}

function sitemapHtmlMetadata(html, tags) {
  const canonicals = tags.filter((tag) => (
    tag.name === 'link'
    && (tag.attributes.get('rel')?.value || '').toLowerCase().split(/\s+/).includes('canonical')
  )).map((tag) => tag.attributes.get('href')?.value || '');
  const robots = tags.filter((tag) => (
    tag.name === 'meta' && (tag.attributes.get('name')?.value || '').toLowerCase() === 'robots'
  )).map((tag) => tag.attributes.get('content')?.value || '').join(',');
  return { canonicals, noindex: /(?:^|[,\s])noindex(?:$|[,\s])/i.test(robots), html };
}

function extractXmlReferences(relativePath, source) {
  const references = [];
  const elementPattern = /<((?:[A-Za-z_][\w.-]*:)?(?:loc|link|guid|content_loc|player_loc|thumbnail_loc))\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  while ((match = elementPattern.exec(source))) {
    const rawValue = xmlDecode(match[2].trim());
    const resolved = rawValue ? resolveInternalReference(rawValue, relativePath) : { invalid: true, rawValue };
    if (resolved) references.push({ ...resolved, rawValue, offset: match.index, attribute: `<${match[1]}>` });
  }

  const attributePattern = /\b(href|url|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((match = attributePattern.exec(source))) {
    const rawValue = xmlDecode(match[2] ?? match[3] ?? '');
    const resolved = rawValue ? resolveInternalReference(rawValue, relativePath) : { invalid: true, rawValue };
    if (resolved) references.push({ ...resolved, rawValue, offset: match.index, attribute: match[1].toLowerCase() });
  }
  return references;
}

function sitemapPageLocs(source) {
  const output = [];
  const pattern = /<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const loc = match[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i);
    if (loc) output.push(xmlDecode(loc[1].trim()));
  }
  return output;
}

function javascriptLiteralReferences(relativePath, source) {
  const references = [];
  const callPattern = /(?:\bfetch|\bimportScripts|\.serviceWorker\.register|\bnavigator\.serviceWorker\.register|\bnew\s+(?:Shared)?Worker)\s*\(\s*(["'])([^"']+)\1/gi;
  let match;
  while ((match = callPattern.exec(source))) {
    const resolved = resolveInternalReference(match[2], relativePath);
    if (resolved) references.push({ ...resolved, rawValue: match[2], offset: match.index, attribute: 'JavaScript URL' });
  }

  if (relativePath.endsWith('/sw.js') || relativePath === 'sw.js') {
    const assetsMatch = source.match(/\b(?:const|let|var)\s+ASSETS\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (assetsMatch) {
      try {
        const assets = vm.runInNewContext(assetsMatch[1], Object.create(null), { timeout: 100 });
        if (!Array.isArray(assets) || assets.some((asset) => typeof asset !== 'string')) throw new TypeError('ASSETS is not a string array');
        for (const asset of assets) {
          const resolved = resolveInternalReference(asset, relativePath);
          if (resolved) references.push({ ...resolved, rawValue: asset, offset: assetsMatch.index, attribute: 'service-worker asset' });
        }
      } catch (error) {
        addError('service-worker-assets', relativePath, `cannot statically validate ASSETS: ${error.message}`);
      }
    } else {
      addError('service-worker-assets', relativePath, 'service worker has no statically reviewable ASSETS array');
    }
  }
  return references;
}

function resetFindings() {
  errors.length = 0;
  errorKeys.clear();
  symlinks.length = 0;
  skippedTrees.length = 0;
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function compareSets(code, file, label, actual, expected) {
  for (const value of setDifference(expected, actual)) addError(code, file, `${label} is missing ${value}`);
  for (const value of setDifference(actual, expected)) addError(code, file, `${label} unexpectedly contains ${value}`);
}

function robotsDisallowPaths(source) {
  return source.split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .map((line) => line.match(/^Disallow\s*:\s*(\S*)/i)?.[1] || '')
    .filter(Boolean);
}

function webmanifestReferences(relativePath, value) {
  const output = [];
  const visit = (item, location = '$', key = '') => {
    if (typeof item === 'string' && ['id', 'scope', 'src', 'start_url'].includes(key)) {
      const reference = resolveInternalReference(item, relativePath);
      if (reference) output.push({ ...reference, rawValue: item, location, offset: 0, attribute: location });
    } else if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${location}[${index}]`, key));
    } else if (item && typeof item === 'object') {
      for (const [childKey, child] of Object.entries(item)) visit(child, `${location}.${childKey}`, childKey);
    }
  };
  visit(value);
  return output;
}

function parseCsv(relativePath, source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    row.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      addError('csv-syntax', relativePath, 'unexpected characters after a closing quote', lineAt(source, index));
      closedQuote = false;
    }
    if (character === '"') {
      if (field) addError('csv-syntax', relativePath, 'quote begins in the middle of an unquoted field', lineAt(source, index));
      quoted = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      finishRow();
    } else {
      field += character;
    }
  }
  if (quoted) addError('csv-syntax', relativePath, 'unclosed quoted field', lineAt(source, source.length));
  if (field || row.length || closedQuote) finishRow();
  return rows;
}

function strictSameOriginAsset(value, prefix, extensions) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//') || /[%\\]/.test(raw)) return null;
  const rootRelative = raw.startsWith('/');
  let parsed;
  try { parsed = new URL(raw, SITE_ORIGIN); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.origin !== SITE_URL.origin || parsed.username || parsed.password || parsed.port) return null;
  if (!rootRelative && !/^https:\/\//.test(raw)) return null;
  if (parsed.search || parsed.hash || !parsed.pathname.startsWith(prefix)) return null;
  if (extensions && !extensions.some((extension) => parsed.pathname.toLowerCase().endsWith(extension))) return null;
  const canonical = rootRelative ? parsed.pathname : `${SITE_ORIGIN}${parsed.pathname}`;
  if (raw !== canonical) return null;
  return parsed;
}

function reviewedVideoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { kind: 'blank', parsed: null };
  const local = strictSameOriginAsset(raw, '/media/', ['.mp4', '.webm']);
  if (local) return { kind: 'same-origin', parsed: local };

  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
  if (parsed.hostname === 'youtu.be') {
    if (parsed.search || !/^\/[A-Za-z0-9_-]{11}$/.test(parsed.pathname)) return null;
    if (raw !== `https://youtu.be${parsed.pathname}`) return null;
    return { kind: 'youtube', parsed };
  }
  if (parsed.hostname === 'youtube.com' || parsed.hostname === 'www.youtube.com') {
    if (parsed.pathname !== '/watch' || parsed.searchParams.size !== 1) return null;
    const videoId = parsed.searchParams.get('v') || '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || parsed.search !== `?v=${videoId}`) return null;
    if (raw !== `https://${parsed.hostname}/watch?v=${videoId}`) return null;
    return { kind: 'youtube', parsed };
  }
  return null;
}

function inspectCanonicalCsvAsset(relativePath, source, rawValue, pathname, attribute, fileSet, redirectRules, row) {
  const status = internalTargetStatus(pathname, fileSet, redirectRules);
  if (!status.ok) {
    inspectReference({ pathname, rawValue, offset: 0, attribute }, relativePath, source, fileSet, redirectRules);
  } else if (status.reason !== 'file') {
    addError('csv-containment', relativePath, `row ${row}, column ${attribute} must resolve directly, not through a redirect`, row);
  }
}

function inspectSensitiveText(relativePath, source, feedIdentifiers = CONFIGURED_FEED_IDENTIFIERS, reportLine = true) {
  // JSON and inline scripts may spell URL slashes as `\/`; normalizing them
  // keeps containment checks semantic without changing line boundaries.
  const searchable = source.replace(/\\\//g, '/');
  const patterns = [
    { pattern: /docs\.google\.com\/spreadsheets/gi, label: 'direct Google Sheets URL' },
    { pattern: /sheets\.googleapis\.com\/v4\/spreadsheets\/[A-Za-z0-9_-]+/gi, label: 'direct Google Sheets API URL' },
    { pattern: /(?:https?:)?\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+/gi, label: 'operational Apps Script deployment URL' },
    { pattern: /(?:https?:)?\/\/script\.googleusercontent\.com\/(?:macros|userCodeAppPanel)/gi, label: 'operational Apps Script response URL' },
    { pattern: /\bAKfycb[A-Za-z0-9_-]{15,}\b/g, label: 'raw Apps Script deployment identifier' },
    {
      pattern: /["']?(?:GOOGLE[-_]?)?(?:SHEET|SPREADSHEET|WORKBOOK)(?:[-_]?ID)?["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{25,}/gi,
      label: 'raw workbook configuration identifier',
    },
  ];
  for (const entry of patterns) {
    let match;
    while ((match = entry.pattern.exec(searchable))) {
      addError(
        'operational-identifier', relativePath, `${entry.label} is forbidden in deploy output`,
        reportLine ? lineAt(searchable, match.index) : null,
      );
    }
  }
  for (const identifier of feedIdentifiers) {
    let offset = searchable.indexOf(identifier);
    while (offset !== -1) {
      addError(
        'operational-identifier', relativePath, 'configured private feed identifier is forbidden in deploy output',
        reportLine ? lineAt(searchable, offset) : null,
      );
      offset = searchable.indexOf(identifier, offset + identifier.length);
    }
  }
}

function inspectReleaseFixtureMarkers(relativePath, source) {
  RELEASE_FIXTURE_MARKER.lastIndex = 0;
  let match;
  while ((match = RELEASE_FIXTURE_MARKER.exec(source))) {
    addError(
      'test-fixture-content',
      relativePath,
      `release output contains test-only marker "${match[0]}"`,
      lineAt(source, match.index),
    );
  }
}

async function inspectSensitiveBinary(relativePath, absolutePath) {
  const handle = await open(absolutePath, 'r');
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let carry = Buffer.alloc(0);
  try {
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      const combined = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      inspectSensitiveText(relativePath, combined.toString('latin1'), CONFIGURED_FEED_IDENTIFIERS, false);
      carry = combined.subarray(Math.max(0, combined.length - 1024));
    }
  } finally {
    await handle.close();
  }
}

function inspectCsv(relativePath, source, fileSet, redirectRules) {
  const expectedHeaders = {
    'data/weigh-ins.csv': ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video', 'published_at'],
    'data/violations.csv': ['id', 'date', 'violation', 'status', 'submitted', 'resolved', 'ap_verification', 'corrections', 'recording', 'published_at'],
  };
  const expected = expectedHeaders[relativePath];
  if (!expected) return [];
  const rows = parseCsv(relativePath, source);
  const header = rows[0] || [];
  const columnIndex = Object.fromEntries(expected.map((name, index) => [name, index]));
  const violationIds = new Set();
  if (header.join('\u0000') !== expected.join('\u0000')) {
    addError('csv-schema', relativePath, `header must be exactly ${expected.join(', ')}; found ${header.join(', ') || '(none)'}`, 1);
  }
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.length !== expected.length) {
      addError('csv-schema', relativePath, `row ${rowIndex + 1} has ${row.length} fields; expected ${expected.length}`, rowIndex + 1);
      continue;
    }
    for (let column = 0; column < row.length; column += 1) {
      if (/^[\s\uFEFF]*[=+\-@]/u.test(row[column])) {
        addError('csv-formula', relativePath, `row ${rowIndex + 1}, column ${expected[column]} begins like a spreadsheet formula`, rowIndex + 1);
      }
    }
    if (!validIsoDate(row[columnIndex.date])) addError('csv-schema', relativePath, `row ${rowIndex + 1} has an invalid date`, rowIndex + 1);
    inspectFreshTimestamp(relativePath, row[columnIndex.published_at], `row ${rowIndex + 1} published_at`);
    if (relativePath === 'data/weigh-ins.csv' && (!Number.isFinite(Number(row[1])) || Number(row[1]) <= 0)) {
      addError('csv-schema', relativePath, `row ${rowIndex + 1} weight_lb must be a positive number`, rowIndex + 1);
    }
    if (relativePath === 'data/weigh-ins.csv') {
      for (const column of [3, 4, 5, 6]) {
        if (!row[column]) continue;
        const parsed = strictSameOriginAsset(row[column], '/media/responsive/', ['.webp']);
        if (!parsed) {
          addError('csv-containment', relativePath, `row ${rowIndex + 1}, column ${expected[column]} must be blank or a canonical same-origin responsive WebP derivative`, rowIndex + 1);
        } else {
          inspectCanonicalCsvAsset(
            relativePath, source, row[column], safeDecode(parsed.pathname), expected[column],
            fileSet, redirectRules, rowIndex + 1,
          );
        }
      }
      const video = reviewedVideoUrl(row[columnIndex.video]);
      if (!video) {
        addError('csv-containment', relativePath, `row ${rowIndex + 1}, column video is not an approved same-origin or canonical YouTube URL`, rowIndex + 1);
      } else if (video.kind === 'same-origin') {
        inspectCanonicalCsvAsset(
          relativePath, source, row[columnIndex.video], safeDecode(video.parsed.pathname), 'video',
          fileSet, redirectRules, rowIndex + 1,
        );
      }
    } else {
      const id = row[columnIndex.id];
      if (!/^V-[0-9A-F]{12}$/.test(id)) {
        addError('violation-id', relativePath, `row ${rowIndex + 1} id must be an opaque identifier in V-XXXXXXXXXXXX format`, rowIndex + 1);
      } else if (violationIds.has(id)) {
        addError('violation-id', relativePath, `row ${rowIndex + 1} repeats opaque identifier ${id}`, rowIndex + 1);
      } else {
        violationIds.add(id);
      }
      const violationText = row[columnIndex.violation];
      if (VIOLATION_FIXTURE_MARKER.test(violationText)) {
        addError('test-fixture-content', relativePath, `row ${rowIndex + 1} violation text contains a test-only marker`, rowIndex + 1);
      }
      const video = reviewedVideoUrl(row[columnIndex.recording]);
      if (!video) {
        addError('csv-containment', relativePath, `row ${rowIndex + 1}, column recording is not an approved same-origin or canonical YouTube URL`, rowIndex + 1);
      } else if (video.kind === 'same-origin') {
        inspectCanonicalCsvAsset(
          relativePath, source, row[columnIndex.recording], safeDecode(video.parsed.pathname), 'recording',
          fileSet, redirectRules, rowIndex + 1,
        );
      }
    }
  }
  return rows;
}

function imageFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).equals(WEBP_RIFF) && buffer.subarray(8, 12).equals(WEBP_SIGNATURE)) return 'webp';
  return '';
}

function imageMetadata(buffer, relativePath = '') {
  const format = imageFormat(buffer)
    || (/\.png$/i.test(relativePath) ? 'png' : /\.webp$/i.test(relativePath) ? 'webp' : 'jpeg');
  if (format === 'png') return inspectPng(buffer);
  if (format === 'webp') return inspectWebp(buffer);
  return inspectJpeg(buffer);
}

async function assertAssistantBundleParity(projectRoot = PROJECT_ROOT) {
  const expectedNames = [
    '00-namespace.js',
    '01-config.js',
    '02-crypto.js',
    '03-dates.js',
    '04-csv.js',
    '05-api.js',
    '06-overlay.js',
    '07-audio.js',
    '08-camera.js',
    '09-frame-loop.js',
    '10-pose.js',
    '11-recorder.js',
    '12-scripts.js',
    '13-state-machine.js',
    '14-upload-queue.js',
    '15-preflight.js',
    '16-ui.js',
    '17-session.js',
    '18-app.js',
    '19-wake.js',
    '20-download.js',
  ];
  const moduleRoot = path.join(projectRoot, 'assistant', 'js');
  const modules = (await readdir(moduleRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
  const bundle = await readFile(path.join(projectRoot, 'assistant', 'app.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'assistant', 'bundle-sections.json'), 'utf8'));
  if (
    !manifest
    || manifest.version !== 1
    || manifest.algorithm !== 'sha256-normalized-v1'
    || !manifest.preamble
    || typeof manifest.preamble !== 'object'
    || !Array.isArray(manifest.sections)
  ) {
    throw new Error('assistant/bundle-sections.json has an unsupported schema');
  }
  const normalize = (source) => source.replace(/\r\n?/g, '\n').trim();
  const boundaryPattern = /^\/\* ==== ([0-9]{2}-[a-z0-9-]+\.js) ==== \*\/$/gm;
  const boundaries = [...bundle.matchAll(boundaryPattern)];
  if (boundaries.length === 0) {
    throw new Error('assistant/app.js has no bundle section boundaries');
  }
  const preambleDigest = String(manifest.preamble.sha256 || '');
  if (!/^[a-f0-9]{64}$/.test(preambleDigest)) {
    throw new Error('assistant bundle manifest has an invalid preamble digest');
  }
  const actualPreambleDigest = createHash('sha256')
    .update(normalize(bundle.slice(0, boundaries[0].index)))
    .digest('hex');
  if (actualPreambleDigest !== preambleDigest) {
    throw new Error('assistant/app.js preamble differs from its checked-in digest manifest');
  }
  const bundledSections = boundaries.map((match, index) => ({
    name: match[1],
    source: bundle.slice(match.index + match[0].length, index + 1 < boundaries.length ? boundaries[index + 1].index : bundle.length),
  }));
  const bundledNames = bundledSections.map((section) => section.name);
  const declaredNames = manifest.sections.map((section) => section && section.name);
  assert.deepEqual(declaredNames, expectedNames, 'assistant bundle manifest must declare the exact ordered sections 00 through 20');
  assert.deepEqual(bundledNames, expectedNames, 'assistant bundle must contain the exact ordered sections 00 through 20');
  for (const [index, section] of bundledSections.entries()) {
    const declared = manifest.sections[index];
    if (!/^[a-f0-9]{64}$/.test(String(declared.sha256 || ''))) {
      throw new Error(`assistant bundle manifest has an invalid digest for ${section.name}`);
    }
    const actualDigest = createHash('sha256').update(normalize(section.source)).digest('hex');
    if (actualDigest !== declared.sha256) {
      throw new Error(`assistant/app.js section ${section.name} differs from its checked-in digest manifest`);
    }
  }

  for (const name of modules) {
    const bundled = bundledSections.find((section) => section.name === name);
    if (!bundled) throw new Error(`assistant/js/${name} has no corresponding bundle section`);
    const modularSource = await readFile(path.join(moduleRoot, name), 'utf8');
    if (normalize(bundled.source) !== normalize(modularSource)) {
      throw new Error(`assistant/app.js section ${name} differs from assistant/js/${name}`);
    }
  }
  return bundledNames;
}

async function runSelfTests() {
  resetFindings();
  const sample = '<link href="file.css"><img srcset="../icons/a.png 1x, /favicon.png 2x"><form action="../../observer/"></form>';
  const refs = extractHtmlReferences('assistant/file/index.html', sample);
  assert.deepEqual(refs.map((item) => item.pathname), [
    '/assistant/file/file.css', '/assistant/icons/a.png', '/favicon.png', '/observer/',
  ]);
  assert.deepEqual(cssReferences('@import "theme.css";a{background:url(../avatar.png)}').map((item) => item.value), ['../avatar.png', 'theme.css']);
  const validModule = '<script type="module">export const answer = await Promise.resolve(42);</script>';
  inspectHtmlStructure('module.html', validModule, htmlTags(validModule));
  assert.equal(errors.length, 0);
  const invalidModule = '<script type="module">export const = 42;</script>';
  inspectHtmlStructure('bad-module.html', invalidModule, htmlTags(invalidModule));
  assert.ok(errors.some((error) => error.code === 'javascript-syntax' && error.file === 'bad-module.html'));
  resetFindings();

  const validHtml = '<!doctype html><html lang="en-US"><head><title>Accessible page</title>'
    + '<meta name="description" content="A useful description."></head><body><h1>Accessible page</h1>'
    + '<label for="query">Search</label><input id="query"><img src="decorative.png" alt="">'
    + '<svg role="img" aria-label="Trend"></svg><iframe src="/" title="Preview"></iframe>'
    + '<button type="button"><span>Run</span></button></body></html>';
  inspectHtmlBaseline('valid.html', validHtml);
  assert.equal(errors.length, 0);
  const invalidHtml = '<!doctype html><html lang="en_US"><head><title> </title>'
    + '<meta name="description" content=""></head><body><h1></h1><h1>Second</h1>'
    + '<label for="missing">Missing</label><input id="query"><img src="photo.png">'
    + '<svg role="img"></svg><iframe src="/"></iframe><button type="button"></button></body></html>';
  inspectHtmlBaseline('invalid.html', invalidHtml);
  for (const code of ['html-lang', 'html-title', 'meta-description', 'h1', 'label-target', 'control-label', 'image-alt', 'image-name', 'frame-title', 'button-name']) {
    assert.ok(errors.some((error) => error.code === code), `HTML baseline self-test did not produce ${code}`);
  }
  resetFindings();

  inspectXml('valid.xml', '<?xml version="1.0"?><root><item href="/">safe &amp; sound</item></root>');
  assert.equal(errors.length, 0);
  inspectXml('bad.xml', '<root><item></root>');
  assert.ok(errors.some((error) => error.code === 'xml-syntax' && error.file === 'bad.xml'));
  inspectXml('bad-entity.xml', '<root>&#x110000;</root>');
  assert.ok(errors.some((error) => error.code === 'xml-syntax' && error.file === 'bad-entity.xml'));
  assert.equal(xmlDecode('&#x110000;'), '\ufffd');
  resetFindings();

  const webpChunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8Header = Buffer.alloc(10);
  vp8Header.set([0x9d, 0x01, 0x2a], 3);
  vp8Header.writeUInt16LE(480, 6);
  vp8Header.writeUInt16LE(743, 8);
  const webpBody = Buffer.concat([
    Buffer.from('WEBP'),
    webpChunk('VP8 ', vp8Header),
    webpChunk('EXIF', Buffer.from('GPSLatitude')),
  ]);
  const webpHeader = Buffer.alloc(8);
  webpHeader.write('RIFF', 0, 4, 'ascii');
  webpHeader.writeUInt32LE(webpBody.length, 4);
  const webp = inspectWebp(Buffer.concat([webpHeader, webpBody]));
  assert.equal(webp.malformed, null);
  assert.equal(webp.hasExif, true);
  assert.equal(webp.hasGps, true);
  assert.deepEqual([webp.width, webp.height], [480, 743]);
  assert.match(forbiddenReason('live/overlay.html'), /private|retired/);
  assert.match(forbiddenReason('record.js'), /private|retired/);
  assert.match(forbiddenReason('assistant/js/05-api.js'), /source-only/);
  assert.match(forbiddenReason('about/private.pem'), /file type/);
  assert.match(forbiddenReason('unexpected/index.html'), /top-level/);
  assert.match(forbiddenReason('credentials.txt'), /root file/);
  assert.match(forbiddenReason('violations/v-001/index.html'), /allowlist/);
  assert.deepEqual(webmanifestReferences('assistant/manifest.webmanifest', {
    start_url: './index.html', icons: [{ src: 'icons/icon-192.png' }],
  }).map((item) => item.pathname), ['/assistant/index.html', '/assistant/icons/icon-192.png']);
  assert.equal(collectJsonReferences({ url: 'asset.json' }, [], '$', 'data/example.json')[0].pathname, '/data/asset.json');

  assert.equal(strictSameOriginAsset('/photos/2026/09/13/front.webp', '/photos/', ['.webp'])?.pathname, '/photos/2026/09/13/front.webp');
  assert.equal(strictSameOriginAsset(`${SITE_ORIGIN}/photos/2026/09/13/front.jpg`, '/photos/', ['.jpg'])?.pathname, '/photos/2026/09/13/front.jpg');
  assert.equal(strictSameOriginAsset('photos/2026/09/13/front.jpg', '/photos/', ['.jpg']), null);
  assert.equal(strictSameOriginAsset('https://drive.google.com/file/d/secret/view', '/photos/', ['.jpg']), null);
  assert.equal(reviewedVideoUrl('/media/weigh-in.webm')?.kind, 'same-origin');
  assert.equal(reviewedVideoUrl(`${SITE_ORIGIN}/media/weigh-in.mp4`)?.kind, 'same-origin');
  assert.equal(reviewedVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.kind, 'youtube');
  assert.equal(reviewedVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.kind, 'youtube');
  for (const value of [
    'http://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
    'https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ',
    'https://youtu.be:443/dQw4w9WgXcQ',
    'https://drive.google.com/file/d/secret/view',
    'https://user:password@youtu.be/dQw4w9WgXcQ',
    'https://example.com/video.mp4',
  ]) assert.equal(reviewedVideoUrl(value), null, `${value} must not pass the public video allowlist`);

  inspectSensitiveText('leak.js', [
    'const SHEET_ID = "abcdefghijklmnopqrstuvwxyz123456";',
    'const config = {"spreadsheetId":"abcdefghijklmnopqrstuvwxyz123456"};',
    'https:\\/\\/script.google.com\\/macros\\/s\\/AKfycbabcdefghijklmnop\\/exec',
  ].join('\n'));
  assert.ok(errors.some((error) => error.code === 'operational-identifier' && /workbook/.test(error.message)));
  assert.ok(errors.some((error) => error.code === 'operational-identifier' && /Apps Script/.test(error.message)));
  resetFindings();
  const syntheticWorkbookId = 'synthetic_private_workbook_id_1234567890';
  const syntheticIdentifiers = configuredFeedIdentifiers({
    WEIGHINS_CSV: `https://docs.google.test/spreadsheets/d/${syntheticWorkbookId}/export?format=csv`,
  });
  assert.deepEqual([...syntheticIdentifiers], [syntheticWorkbookId]);
  inspectSensitiveText('synthetic-leak.txt', `private source ${syntheticWorkbookId}`, syntheticIdentifiers);
  assert.ok(errors.some((error) => error.code === 'operational-identifier' && /configured private feed/.test(error.message)));
  resetFindings();

  const now = new Date().toISOString();
  inspectPublishedManifestSchema('schemas/daily-record-manifest-v1.json', {});
  assert.ok(errors.some((error) => error.code === 'json-schema' && error.file === 'schemas/daily-record-manifest-v1.json'));
  resetFindings();
  inspectPublicFeed('data/feed-manifest.json', {
    schema_version: 1,
    published_at: now,
    project_start_date: '2026-08-31',
    agreement_active: false,
    agreement_effective_date: '',
  });
  assert.equal(errors.length, 0);
  inspectPublicFeed('data/feed-manifest.json', {
    schema_version: 1,
    published_at: now,
    project_start_date: '2026-08-31',
    agreement_active: false,
    agreement_effective_date: '2026-09-13',
  });
  assert.ok(errors.some((error) => error.code === 'json-schema' && /inactive agreement_effective_date/.test(error.message)));
  resetFindings();
  inspectPublicFeed('data/attestations.json', {
    schema_version: 1,
    published_at: now,
    limitations: 'Hash matches are not independent authenticity findings.',
    records: [{
      received_at: now, date: '2026-09-13', day: 14, event: 'capture-attested',
      kind: 'daily', video_sha256: null, photo_sha256s: [], status: 'VALID',
    }],
  });
  assert.ok(errors.some((error) => error.code === 'json-schema' && /VALID-CONSUMED/.test(error.message)));
  resetFindings();
  const csv = 'date,weight_lb,note,photo_front,photo_left,photo_rear,photo_right,video,published_at\n'
    + `"2026-09-13","200","=SUM(1,1)","","","","","","${now}"\n`;
  inspectCsv('data/weigh-ins.csv', csv, new Set(), []);
  assert.ok(errors.some((error) => error.code === 'csv-formula'));
  resetFindings();

  const validViolation = 'id,date,violation,status,submitted,resolved,ap_verification,corrections,recording,published_at\n'
    + `"V-A1B2C3D4E5F6","2026-09-13","Reviewed event","open","","","","","","${now}"\n`;
  inspectCsv('data/violations.csv', validViolation, new Set(), []);
  assert.equal(errors.length, 0);

  const invalidViolations = 'id,date,violation,status,submitted,resolved,ap_verification,corrections,recording,published_at\n'
    + `"V-A1B2C3D4E5F6","2026-09-13","Reviewed event","open","","","","","","${now}"\n`
    + `"V-A1B2C3D4E5F6","2026-09-13","Synthetic integration-test event","open","","","","","","${now}"\n`;
  inspectCsv('data/violations.csv', invalidViolations, new Set(), []);
  assert.ok(errors.some((error) => error.code === 'violation-id' && /repeats/.test(error.message)));
  assert.ok(errors.some((error) => error.code === 'test-fixture-content'));
  resetFindings();

  inspectReleaseFixtureMarkers('violations/v-a1b2c3d4e5f6/index.html', '<p>Exact integration-test event</p>');
  assert.ok(errors.some((error) => error.code === 'test-fixture-content'));
  resetFindings();
  inspectReleaseFixtureMarkers('assistant/app.js', 'const narration = "Synthetic narration";');
  assert.equal(errors.length, 0);

  const checkedModules = await assertAssistantBundleParity();
  assert.ok(checkedModules.length > 0);
  resetFindings();
  console.log('Audit self-test passed: HTML accessibility, bundle parity, targets, parsing, public-feed schemas, URL containment, image metadata, and forbidden output.');
}

async function main() {
  resetFindings();
  let rootInfo;
  try {
    rootInfo = await lstat(publicRoot);
  } catch (error) {
    console.error(`Audit root is unavailable: ${publicRoot} (${error.message})`);
    process.exitCode = 2;
    return;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    console.error(`Audit root is not a directory: ${publicRoot}`);
    process.exitCode = 2;
    return;
  }

  const [allFiles, redirectRules] = await Promise.all([walk(publicRoot), readRedirects()]);
  const normalizedFiles = allFiles.map(slash);
  const fileSet = new Set(normalizedFiles);
  inspectInventory(fileSet, normalizedFiles);

  for (const relativePath of symlinks) addError('public-symlink', relativePath, 'symbolic links are forbidden in deploy output');
  for (const relativePath of skippedTrees) addError('forbidden-tree', relativePath, 'source/dependency tree is forbidden in deploy output');
  for (const relativePath of normalizedFiles) {
    const reason = forbiddenReason(relativePath);
    if (reason) addError('forbidden-output', relativePath, reason);
    const lowerPath = relativePath.toLowerCase();
    if (lowerPath === CROSS_IDENTITY_PATH || path.posix.basename(lowerPath) === CROSS_IDENTITY_FILENAME) {
      addError('cross-identity-asset', relativePath, `removed cross-identity asset is present (blocked path: /${CROSS_IDENTITY_PATH})`);
    }
  }

  const textualFiles = normalizedFiles.filter((relativePath) => (
    /\.(?:css|csv|html|js|json|sha256|svg|txt|webmanifest|xml)$/i.test(relativePath)
    || relativePath === '_headers'
    || relativePath === '_redirects'
  ));
  const textualFileSet = new Set(textualFiles);
  for (const relativePath of normalizedFiles) {
    inspectSensitiveText(relativePath, relativePath);
    const absolutePath = path.join(publicRoot, relativePath);
    if (textualFileSet.has(relativePath)) {
      const source = await readFile(absolutePath, 'utf8');
      inspectSensitiveText(relativePath, source);
      inspectReleaseFixtureMarkers(relativePath, source);
    } else {
      await inspectSensitiveBinary(relativePath, absolutePath);
    }
  }

  if (fileSet.has('_headers')) inspectHeaders(await readFile(path.join(publicRoot, '_headers'), 'utf8'));
  inspectRedirectDestinations(redirectRules, fileSet);
  if (fileSet.has('forms.html') && !isBlockedRoute('/forms.html', redirectRules)) {
    addError('private-route', '_redirects', '/forms.html must remain a build-discovery file and return an explicit error to public requests');
  }

  const htmlFiles = normalizedFiles.filter((relativePath) => (
    relativePath.toLowerCase().endsWith('.html')
    && !isBlockedRoute(publicPathForFile(relativePath), redirectRules)
  ));
  if (htmlFiles.length === 0) addError('no-html', '.', 'no public HTML files were found under the audit root');

  let internalReferenceCount = 0;
  let cardReferenceCount = 0;
  const htmlMetadata = new Map();
  for (const relativePath of htmlFiles) {
    const html = await readFile(path.join(publicRoot, relativePath), 'utf8');
    const tags = htmlTags(html);
    inspectTemplateMarkers(relativePath, html);
    inspectHtmlStructure(relativePath, html, tags);
    inspectHtmlBaseline(relativePath, html);
    htmlMetadata.set(relativePath, sitemapHtmlMetadata(html, tags));

    if (html.toLowerCase().includes(CROSS_IDENTITY_FILENAME)) {
      const offset = html.toLowerCase().indexOf(CROSS_IDENTITY_FILENAME);
      addError('cross-identity-reference', relativePath, `public HTML references removed asset ${CROSS_IDENTITY_FILENAME}`, lineAt(html, offset));
    }

    for (const reference of extractHtmlReferences(relativePath, html, tags)) {
      internalReferenceCount += 1;
      inspectReference(reference, relativePath, html, fileSet, redirectRules);
    }
    cardReferenceCount += extractCardReferences(html).length;

    const jsonLdPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let scriptMatch;
    while ((scriptMatch = jsonLdPattern.exec(html))) {
      const attributes = parseTagAttributes(scriptMatch[1], scriptMatch.index);
      if ((attributes.get('type')?.value || '').toLowerCase() !== 'application/ld+json') continue;
      try {
        const value = JSON.parse(scriptMatch[2]);
        for (const reference of collectJsonReferences(value, [], '$', relativePath)) {
          internalReferenceCount += 1;
          inspectReference({ ...reference, offset: scriptMatch.index, rawValue: reference.rawValue }, relativePath, html, fileSet, redirectRules);
        }
      } catch (error) {
        addError('json-syntax', relativePath, `JSON-LD does not parse: ${error.message}`, lineAt(html, scriptMatch.index));
      }
    }

    const styleBlockPattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
    let styleMatch;
    while ((styleMatch = styleBlockPattern.exec(html))) {
      for (const item of cssReferences(styleMatch[1])) {
        const reference = resolveInternalReference(item.value, relativePath);
        if (reference) {
          internalReferenceCount += 1;
          inspectReference({ ...reference, rawValue: item.value, offset: styleMatch.index + item.offset, attribute: 'CSS URL' }, relativePath, html, fileSet, redirectRules);
        }
      }
    }
    for (const tag of tags) {
      const inlineStyle = tag.attributes.get('style');
      if (!inlineStyle) continue;
      for (const item of cssReferences(inlineStyle.value)) {
        const reference = resolveInternalReference(item.value, relativePath);
        if (reference) {
          internalReferenceCount += 1;
          inspectReference({ ...reference, rawValue: item.value, offset: inlineStyle.offset + item.offset, attribute: 'style URL' }, relativePath, html, fileSet, redirectRules);
        }
      }
    }
  }

  const javascriptFiles = normalizedFiles.filter((relativePath) => relativePath.toLowerCase().endsWith('.js'));
  for (const relativePath of javascriptFiles) {
    const absolutePath = path.join(publicRoot, relativePath);
    const source = await readFile(absolutePath, 'utf8');
    try {
      // Every reviewed deployed script is loaded as a classic browser script
      // (including the assistant worker), so parse in that grammar explicitly.
      new vm.Script(source, { filename: relativePath });
    } catch (error) {
      addError('javascript-syntax', relativePath, `classic script does not parse: ${error.message}`);
    }
    for (const reference of javascriptLiteralReferences(relativePath, source)) {
      internalReferenceCount += 1;
      inspectReference(reference, relativePath, source, fileSet, redirectRules);
    }
  }

  const cssFiles = normalizedFiles.filter((relativePath) => relativePath.toLowerCase().endsWith('.css'));
  for (const relativePath of cssFiles) {
    const source = await readFile(path.join(publicRoot, relativePath), 'utf8');
    for (const item of cssReferences(source)) {
      const reference = resolveInternalReference(item.value, relativePath);
      if (!reference) continue;
      internalReferenceCount += 1;
      inspectReference({ ...reference, rawValue: item.value, offset: item.offset, attribute: 'CSS URL' }, relativePath, source, fileSet, redirectRules);
    }
  }

  const parsedJson = new Map();
  const jsonFiles = normalizedFiles.filter((relativePath) => /\.(?:json|webmanifest)$/i.test(relativePath));
  for (const relativePath of jsonFiles) {
    const source = await readFile(path.join(publicRoot, relativePath), 'utf8');
    try {
      const value = JSON.parse(source);
      parsedJson.set(relativePath, value);
      const references = relativePath.endsWith('.webmanifest')
        ? webmanifestReferences(relativePath, value)
        : collectJsonReferences(value, [], '$', relativePath);
      for (const reference of references) {
        internalReferenceCount += 1;
        inspectReference({ ...reference, offset: reference.offset || 0 }, relativePath, source, fileSet, redirectRules);
      }
      if (/^manifests\/\d{4}-\d{2}-\d{2}\.json$/.test(relativePath)) {
        await inspectDailyManifest(relativePath, value, fileSet);
      }
      if (relativePath === 'schemas/daily-record-manifest-v1.json') {
        inspectPublishedManifestSchema(relativePath, value);
      }
      if (relativePath.startsWith('data/')) inspectPublicFeed(relativePath, value);
    } catch (error) {
      addError('json-syntax', relativePath, `JSON does not parse: ${error.message}`);
    }
  }

  const csvFiles = normalizedFiles.filter((relativePath) => relativePath.toLowerCase().endsWith('.csv'));
  const parsedCsv = new Map();
  for (const relativePath of csvFiles) {
    const source = await readFile(path.join(publicRoot, relativePath), 'utf8');
    parsedCsv.set(relativePath, inspectCsv(relativePath, source, fileSet, redirectRules));
  }
  const expectedLocalVideos = new Set();
  for (const relativePath of ['data/weigh-ins.csv', 'data/violations.csv']) {
    const rows = parsedCsv.get(relativePath) || [];
    const videoColumn = (rows[0] || []).indexOf(relativePath === 'data/weigh-ins.csv' ? 'video' : 'recording');
    if (videoColumn < 0) continue;
    for (const row of rows.slice(1)) {
      const reviewed = reviewedVideoUrl(row[videoColumn]);
      if (reviewed?.kind === 'same-origin') expectedLocalVideos.add(reviewed.parsed.pathname.replace(/^\/+/, ''));
    }
  }
  for (const [relativePath, manifest] of parsedJson) {
    if (!/^manifests\/\d{4}-\d{2}-\d{2}\.json$/.test(relativePath)) continue;
    const reviewed = reviewedVideoUrl(manifest?.record?.video_url);
    if (reviewed?.kind === 'same-origin') expectedLocalVideos.add(reviewed.parsed.pathname.replace(/^\/+/, ''));
  }
  const actualLocalVideos = new Set(normalizedFiles.filter((relativePath) => /^media\/.+\.(?:mp4|webm)$/i.test(relativePath)));
  compareSets('video-inventory', 'media', 'reviewed local video inventory', actualLocalVideos, expectedLocalVideos);

  const feedPublishedAt = parsedJson.get('data/feed-manifest.json')?.published_at;
  if (typeof feedPublishedAt === 'string') {
    for (const relativePath of ['data/attestations.json', 'data/supervision.json']) {
      const publishedAt = parsedJson.get(relativePath)?.published_at;
      if (publishedAt !== feedPublishedAt) addError('feed-freshness', relativePath, 'published_at does not match data/feed-manifest.json');
    }
    for (const relativePath of ['data/weigh-ins.csv', 'data/violations.csv']) {
      const rows = parsedCsv.get(relativePath) || [];
      const publishedAtColumn = (rows[0] || []).indexOf('published_at');
      if (publishedAtColumn < 0) continue;
      for (const [index, row] of rows.slice(1).entries()) {
        if (row[publishedAtColumn] !== feedPublishedAt) addError('feed-freshness', relativePath, `row ${index + 2} published_at does not match data/feed-manifest.json`, index + 2);
      }
    }
  }

  const feedManifest = parsedJson.get('data/feed-manifest.json');
  const supervisionFeed = parsedJson.get('data/supervision.json');
  if (typeof feedManifest?.agreement_active === 'boolean'
    && typeof supervisionFeed?.agreement_active === 'boolean'
    && feedManifest.agreement_active !== supervisionFeed.agreement_active) {
    addError('state-consistency', 'data/supervision.json', 'agreement_active does not match data/feed-manifest.json');
  }
  if (supervisionFeed?.sessions && typeof supervisionFeed.sessions === 'object') {
    for (const [date, session] of Object.entries(supervisionFeed.sessions)) {
      if (!session?.required && session?.status) {
        addError('state-consistency', 'data/supervision.json', `non-required session ${date} must not carry an outcome status`);
      }
      if (feedManifest?.agreement_active === false && (session?.required || session?.status)) {
        addError('state-consistency', 'data/supervision.json', `inactive agreement cannot publish an operative session on ${date}`);
      }
    }
  }
  const violationRows = parsedCsv.get('data/violations.csv') || [];
  if (feedManifest?.agreement_active === false && violationRows.length > 1) {
    addError('state-consistency', 'data/violations.csv', 'inactive agreement cannot publish operative violation rows');
  }
  if (validIsoDate(feedManifest?.project_start_date)) {
    const startTime = Date.parse(`${feedManifest.project_start_date}T12:00:00Z`);
    for (const [relativePath, manifest] of parsedJson) {
      if (!/^manifests\/\d{4}-\d{2}-\d{2}\.json$/.test(relativePath)) continue;
      if (manifest?.project?.start_date !== feedManifest.project_start_date) {
        addError('state-consistency', relativePath, 'project.start_date does not match data/feed-manifest.json');
      }
      if (validIsoDate(manifest?.record?.date)) {
        const expectedDay = Math.round((Date.parse(`${manifest.record.date}T12:00:00Z`) - startTime) / 86_400_000) + 1;
        if (manifest.record.day !== expectedDay) {
          addError('state-consistency', relativePath, `record.day must be ${expectedDay} for the published project start date`);
        }
      }
    }
    for (const [index, record] of (parsedJson.get('data/attestations.json')?.records || []).entries()) {
      if (!validIsoDate(record?.date)) continue;
      const expectedDay = Math.round((Date.parse(`${record.date}T12:00:00Z`) - startTime) / 86_400_000) + 1;
      if (record.day !== expectedDay) {
        addError('state-consistency', 'data/attestations.json', `record ${index + 1} day must be ${expectedDay} for the published project start date`);
      }
    }
  }

  const xmlFiles = normalizedFiles.filter((relativePath) => relativePath.toLowerCase().endsWith('.xml'));
  const xmlSources = new Map();
  for (const relativePath of xmlFiles) {
    const source = await readFile(path.join(publicRoot, relativePath), 'utf8');
    xmlSources.set(relativePath, source);
    inspectXml(relativePath, source);
    if (relativePath === 'sitemap.xml' && !/<sitemapindex\b/i.test(source)) {
      addError('xml-schema', relativePath, 'sitemap index must have a <sitemapindex> root');
    } else if (/^sitemap-.+\.xml$/i.test(relativePath) && !/<urlset\b/i.test(source)) {
      addError('xml-schema', relativePath, 'child sitemap must have a <urlset> root');
    } else if (relativePath === 'feed.xml' && !/<rss\b/i.test(source)) {
      addError('xml-schema', relativePath, 'feed must have an <rss> root');
    }
    for (const reference of extractXmlReferences(relativePath, source)) {
      internalReferenceCount += 1;
      inspectReference(reference, relativePath, source, fileSet, redirectRules);
    }
  }

  const robotsSource = fileSet.has('robots.txt')
    ? await readFile(path.join(publicRoot, 'robots.txt'), 'utf8')
    : '';
  const disallowed = robotsDisallowPaths(robotsSource);
  if (robotsSource) {
    const sitemapDirectives = robotsSource.split(/\r?\n/)
      .map((line) => line.replace(/\s+#.*$/, '').trim().match(/^Sitemap\s*:\s*(\S+)/i)?.[1])
      .filter(Boolean);
    if (sitemapDirectives.length !== 1 || sitemapDirectives[0] !== `${SITE_ORIGIN}/sitemap.xml`) {
      addError('robots-sitemap', 'robots.txt', `expected exactly one Sitemap directive for ${SITE_ORIGIN}/sitemap.xml`);
    }
  }
  const sitemapLocs = new Map();
  for (const sitemap of ['sitemap.xml', ...REQUIRED_SITEMAPS]) {
    const source = xmlSources.get(sitemap);
    if (!source) continue;
    const locs = xmlLocs(source);
    sitemapLocs.set(sitemap, locs);
    const duplicates = locs.filter((loc, index) => locs.indexOf(loc) !== index);
    for (const duplicate of new Set(duplicates)) addError('sitemap-duplicate', sitemap, `duplicate loc: ${duplicate}`);
    for (const loc of locs) {
      let parsed;
      try { parsed = new URL(loc); } catch {
        addError('sitemap-url', sitemap, `loc is not an absolute URL: ${loc}`);
        continue;
      }
      if (parsed.protocol !== 'https:' || parsed.origin !== SITE_URL.origin) {
        addError('sitemap-url', sitemap, `loc must use the canonical HTTPS origin: ${loc}`);
      }
    }
  }

  const expectedSitemapLocs = new Set(REQUIRED_SITEMAPS.map((name) => `${SITE_ORIGIN}/${name}`));
  if (sitemapLocs.has('sitemap.xml')) {
    compareSets('sitemap-index', 'sitemap.xml', 'sitemap index', new Set(sitemapLocs.get('sitemap.xml')), expectedSitemapLocs);
  }

  const generalSitemaps = ['sitemap-static.xml', 'sitemap-pages.xml', 'sitemap-daily.xml', 'sitemap-violations.xml'];
  const seenGeneralLocs = new Map();
  for (const sitemap of generalSitemaps) {
    const source = xmlSources.get(sitemap);
    if (!source) continue;
    for (const loc of sitemapPageLocs(source)) {
      if (seenGeneralLocs.has(loc)) addError('sitemap-overlap', sitemap, `${loc} already appears in ${seenGeneralLocs.get(loc)}`);
      else seenGeneralLocs.set(loc, sitemap);
      let parsed;
      try { parsed = new URL(loc); } catch { continue; }
      if (parsed.origin !== SITE_URL.origin) continue;
      if (disallowed.some((prefix) => parsed.pathname.startsWith(prefix))) {
        addError('sitemap-robots', sitemap, `${loc} is disallowed by robots.txt`);
      }
      const redirect = firstRedirect(parsed.pathname, redirectRules);
      if (redirect) addError('sitemap-redirect', sitemap, `${loc} is handled by redirect rule ${redirect.from}`);
      const targetFile = routeFile(parsed.pathname, fileSet);
      const metadata = htmlMetadata.get(targetFile);
      if (!targetFile) continue; // Generic XML target reporting already records it.
      if (!metadata) {
        addError('sitemap-target', sitemap, `${loc} does not resolve to audited public HTML`);
        continue;
      }
      if (metadata.noindex) addError('sitemap-noindex', sitemap, `${loc} is both in a sitemap and marked noindex`);
      if (metadata.canonicals.length !== 1) {
        addError('canonical', targetFile, `sitemap page must have exactly one canonical link; found ${metadata.canonicals.length}`);
      } else {
        let canonical;
        try { canonical = new URL(metadata.canonicals[0]).href; } catch { canonical = ''; }
        if (canonical !== parsed.href) addError('canonical', targetFile, `canonical ${metadata.canonicals[0] || '(invalid)'} does not match sitemap URL ${loc}`);
      }
    }
  }

  const dailyPageFiles = normalizedFiles.filter((file) => /^daily\/\d{4}-\d{2}-\d{2}-day-\d+\/index\.html$/.test(file));
  const dailyUrls = new Set(dailyPageFiles.map((file) => `${SITE_ORIGIN}/${file.slice(0, -'index.html'.length)}`));
  if (sitemapLocs.has('sitemap-daily.xml')) {
    compareSets('daily-inventory', 'sitemap-daily.xml', 'daily sitemap', new Set(sitemapPageLocs(xmlSources.get('sitemap-daily.xml'))), dailyUrls);
  }
  const dailyDates = new Set(dailyPageFiles.map((file) => file.match(/^daily\/(\d{4}-\d{2}-\d{2})-/)[1]));
  const cardDates = new Set(normalizedFiles.filter((file) => /^cards\/\d{4}-\d{2}-\d{2}\.png$/.test(file)).map((file) => path.posix.basename(file, '.png')));
  compareSets('card-inventory', 'cards', 'daily card inventory', cardDates, dailyDates);

  const manifestJsonDates = new Set(normalizedFiles.filter((file) => /^manifests\/\d{4}-\d{2}-\d{2}\.json$/.test(file)).map((file) => path.posix.basename(file, '.json')));
  const manifestHashDates = new Set(normalizedFiles.filter((file) => /^manifests\/\d{4}-\d{2}-\d{2}\.sha256$/.test(file)).map((file) => path.posix.basename(file, '.sha256')));
  compareSets('manifest-inventory', 'manifests', 'manifest sidecars', manifestHashDates, manifestJsonDates);
  const weighInRows = parsedCsv.get('data/weigh-ins.csv') || [];
  const weighInHeader = weighInRows[0] || [];
  const dateColumn = weighInHeader.indexOf('date');
  const videoColumn = weighInHeader.indexOf('video');
  const photoColumns = ['photo_front', 'photo_left', 'photo_rear', 'photo_right']
    .map((name) => weighInHeader.indexOf(name));
  const finalizedFeedDates = new Set(weighInRows.slice(1)
    .filter((row) => dateColumn >= 0 && videoColumn >= 0 && photoColumns.every((column) => column >= 0)
      && validIsoDate(row[dateColumn]) && reviewedVideoUrl(row[videoColumn])
      && photoColumns.every((column) => Boolean(String(row[column] || '').trim())))
    .map((row) => row[dateColumn]));
  compareSets('manifest-record-inventory', 'data/weigh-ins.csv', 'finalized record manifests', manifestJsonDates, finalizedFeedDates);
  for (const date of manifestJsonDates) {
    const manifest = parsedJson.get(`manifests/${date}.json`);
    const canonical = manifest?.record?.canonical_url;
    if (typeof canonical === 'string' && !dailyUrls.has(canonical)) {
      addError('manifest-inventory', `manifests/${date}.json`, `${canonical} is not a generated daily page`);
    }
  }
  const manifestDailyUrls = new Set([...manifestJsonDates].map((date) => parsedJson.get(`manifests/${date}.json`)?.record?.canonical_url).filter(Boolean));
  const feedSource = xmlSources.get('feed.xml');
  if (feedSource) {
    const feedUrls = [];
    const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(feedSource))) {
      for (const requiredTag of ['title', 'link', 'guid', 'pubDate', 'description']) {
        if (!new RegExp(`<${requiredTag}\\b[^>]*>[\\s\\S]*?<\\/${requiredTag}\\s*>`, 'i').test(itemMatch[1])) {
          addError('feed-item', 'feed.xml', `RSS item is missing <${requiredTag}>`, lineAt(feedSource, itemMatch.index));
        }
      }
      const link = itemMatch[1].match(/<link\b[^>]*>([\s\S]*?)<\/link\s*>/i)?.[1];
      if (link) feedUrls.push(xmlDecode(link.trim()));
    }
    const expectedFeedUrls = new Set([...manifestDailyUrls].sort().slice(-50));
    compareSets('feed-inventory', 'feed.xml', 'RSS item inventory', new Set(feedUrls), expectedFeedUrls);
    if (new Set(feedUrls).size !== feedUrls.length) addError('feed-duplicate', 'feed.xml', 'RSS feed contains duplicate item links');
  }
  for (const [sitemap, label] of [['sitemap-images.xml', 'image sitemap'], ['sitemap-videos.xml', 'video sitemap']]) {
    const source = xmlSources.get(sitemap);
    if (source) compareSets('media-sitemap', sitemap, label, new Set(sitemapPageLocs(source)), manifestDailyUrls);
  }
  const expectedResponsive = new Set();
  const expectedDailyPhotos = new Set();
  for (const date of manifestJsonDates) {
    const manifest = parsedJson.get(`manifests/${date}.json`);
    for (const photo of Object.values(manifest?.photos || {})) {
      const sourceReference = sameOriginReference(photo?.url || '');
      if (sourceReference?.pathname) expectedDailyPhotos.add(sourceReference.pathname.replace(/^\/+/, ''));
      for (const variant of Array.isArray(photo?.responsive) ? photo.responsive : []) {
        const reference = sameOriginReference(variant?.url || '');
        if (reference?.pathname) expectedResponsive.add(reference.pathname.replace(/^\/+/, ''));
      }
    }
  }
  const actualResponsive = new Set(normalizedFiles.filter((file) => file.startsWith('media/responsive/')));
  compareSets('responsive-inventory', 'media/responsive', 'responsive media inventory', actualResponsive, expectedResponsive);
  const actualDailyPhotos = new Set(normalizedFiles.filter((file) => /^photos\/\d{4}\/\d{2}\/\d{2}\/.+\.(?:jpe?g|png|webp)$/i.test(file)));
  compareSets('photo-inventory', 'photos', 'daily source photo inventory', actualDailyPhotos, expectedDailyPhotos);

  const violationDetailUrls = new Set(normalizedFiles
    .filter((file) => /^violations\/v-[a-f0-9]{12}\/index\.html$/.test(file))
    .map((file) => `${SITE_ORIGIN}/${file.slice(0, -'index.html'.length)}`));
  if (xmlSources.has('sitemap-violations.xml')) {
    compareSets(
      'violation-inventory',
      'sitemap-violations.xml',
      'violation sitemap',
      new Set(sitemapPageLocs(xmlSources.get('sitemap-violations.xml'))),
      violationDetailUrls,
    );
  }
  if (xmlSources.has('sitemap-pages.xml')) {
    const pageLocs = new Set(sitemapPageLocs(xmlSources.get('sitemap-pages.xml')));
    for (const file of normalizedFiles.filter((item) => /^(?:milestones\/\d+-lb|weeks\/week-\d+)\/index\.html$/.test(item))) {
      const url = `${SITE_ORIGIN}/${file.slice(0, -'index.html'.length)}`;
      if (!pageLocs.has(url)) addError('page-inventory', 'sitemap-pages.xml', `${url} is generated but absent from the pages sitemap`);
    }
  }

  const imageFiles = normalizedFiles.filter((relativePath) => /\.(?:jpe?g|png|webp)$/i.test(relativePath));
  for (const relativePath of imageFiles) {
    const buffer = await readFile(path.join(publicRoot, relativePath));
    const declared = /\.png$/i.test(relativePath) ? 'png' : /\.webp$/i.test(relativePath) ? 'webp' : 'jpeg';
    const actual = imageFormat(buffer);
    if (actual && actual !== declared) addError('image-format', relativePath, `file extension says ${declared.toUpperCase()} but its bytes are ${actual.toUpperCase()}`);
    const format = actual || declared;
    const result = imageMetadata(buffer, relativePath);
    if (result.malformed) addError('malformed-image', relativePath, result.malformed);
    if (!result.malformed) {
      try {
        const decoded = await sharp(buffer, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
        if (decoded.info.width !== result.width || decoded.info.height !== result.height) {
          addError(
            'image-dimensions', relativePath,
            `container reports ${result.width}x${result.height}, decoded pixels report ${decoded.info.width}x${decoded.info.height}`,
          );
        }
      } catch (error) {
        addError('malformed-image', relativePath, `image decoder rejected the file: ${error.message}`);
      }
    }
    if (format === 'webp' && (
      relativePath.startsWith('media/responsive/')
      || /^photos\/official\/micheal-ray-berry-official-front-\d+\.webp$/.test(relativePath)
    )) {
      const expectedWidth = Number.parseInt(relativePath.match(/-(\d+)\.webp$/)?.[1] || '', 10);
      if (Number.isInteger(expectedWidth) && result.width !== expectedWidth) {
        addError('image-dimensions', relativePath, `filename declares width ${expectedWidth}, image metadata reports ${result.width || 'none'}`);
      }
    }
    if (result.hasExif) addError('image-exif', relativePath, 'EXIF metadata is present; strip it before publishing');
    if (result.hasGps) addError('image-gps', relativePath, 'GPS/location metadata is present; strip it before publishing');
  }

  errors.sort((a, b) => (
    a.file.localeCompare(b.file)
    || (a.line ?? 0) - (b.line ?? 0)
    || a.code.localeCompare(b.code)
    || a.message.localeCompare(b.message)
  ));

  if (errors.length) {
    for (const error of errors) {
      const location = error.line ? `${error.file}:${error.line}` : error.file;
      console.error(`ERROR [${error.code}] ${location} — ${error.message}`);
    }
    console.error(
      `Audit failed: ${errors.length} issue${errors.length === 1 ? '' : 's'} across ${normalizedFiles.length} files `
      + `(${htmlFiles.length} HTML, ${javascriptFiles.length} JS, ${jsonFiles.length} JSON/webmanifest, ${csvFiles.length} CSV, ${xmlFiles.length} XML, ${imageFiles.length} checked images).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Audit passed: ${normalizedFiles.length} allowlisted files (${htmlFiles.length} HTML, ${javascriptFiles.length} JS, `
    + `${jsonFiles.length} JSON/webmanifest, ${csvFiles.length} CSV, ${xmlFiles.length} XML, ${imageFiles.length} JPEG/PNG/WebP), `
    + `${internalReferenceCount} internal targets, and ${cardReferenceCount} card references checked.`,
  );
  console.log('No template leaks, broken internal targets, forbidden output, malformed structured data, or EXIF/GPS metadata found.');
}

if (process.argv.includes('--check-bundle')) {
  try {
    const checkedModules = await assertAssistantBundleParity();
    console.log(`Assistant bundle matches its exhaustive ${checkedModules.length}-section manifest and all available modular sources.`);
  } catch (error) {
    console.error(`Assistant bundle check failed: ${error.stack || error.message}`);
    process.exitCode = 2;
  }
} else if (process.argv.includes('--self-test')) {
  try {
    await runSelfTests();
  } catch (error) {
    console.error(`Audit self-test failed: ${error.stack || error.message}`);
    process.exitCode = 2;
  }
} else {
  main().catch((error) => {
    console.error(`Audit crashed: ${error.stack || error.message}`);
    process.exitCode = 2;
  });
}
