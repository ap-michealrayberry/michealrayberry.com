/* Derive the set of public URLs to submit to IndexNow from a Git diff between
   two commits — the reliable, auditable alternative to the mutable
   .indexnow-urls.json queue (which a later deterministic rebuild can erase).

   Usage:
     node scripts/collect-changed-urls.mjs --base <sha> --head <sha> \
       [--output .seo-changed-urls.json]

   Output: a sorted, unique JSON array of absolute SITE_ORIGIN URLs. Added,
   modified, renamed, copied, and deleted files are all mapped; deletions map to
   the former public URL so search engines recrawl the removal. Private surfaces
   (/ap, /mrb, /verify) are never emitted. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './lib/common.mjs';
import { loadManifests } from './lib/manifest.mjs';
import { collectUrls } from './lib/url-map.mjs';

const run = promisify(execFile);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* Parse `git diff -M --name-status` (tab-separated). Renames/copies carry two
   paths; a rename also submits the old (now-removed) URL. */
export function parseNameStatus(text) {
  const changed = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    if ((code === 'R' || code === 'C') && parts.length >= 3) {
      if (code === 'R') changed.push({ status: 'D', path: parts[1] }); // old path removed
      changed.push({ status: code, path: parts[2] });
    } else if (parts[1]) {
      changed.push({ status: code, path: parts[1] });
    }
  }
  return changed;
}

async function gitDiff(base, head) {
  const { stdout } = await run('git', ['diff', '-M', '--name-status', base, head], {
    cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function main() {
  const base = arg('base');
  const head = arg('head') || 'HEAD';
  const output = arg('output', '.seo-changed-urls.json');
  if (!base) { console.error('error: --base <sha> is required'); process.exit(1); }

  const changed = parseNameStatus(await gitDiff(base, head));
  const manifests = await loadManifests().catch(() => []);
  const manifestsByDate = new Map(manifests.map((m) => [m.date, m]));
  const urls = collectUrls(changed, { manifestsByDate });

  await fs.writeFile(output, JSON.stringify(urls, null, 2) + '\n');

  console.log(`base: ${base}`);
  console.log(`head: ${head}`);
  console.log(`changed files: ${changed.length}`);
  console.log(`mapped public URLs: ${urls.length}`);
  for (const u of urls) console.log(`  ${u}`);
  console.log(`wrote ${output}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
