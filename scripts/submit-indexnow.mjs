import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://michealrayberry.com').replace(/\/$/, '');
const file = path.join(ROOT, '.indexnow-urls.json');
const keyFile = path.join(ROOT, 'indexnow-key.txt');

async function main() {
  let urls = [];
  try { urls = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return; }
  if (!Array.isArray(urls) || urls.length === 0) {
    console.log('No changed URLs to submit.');
    return;
  }
  const key = (process.env.INDEXNOW_KEY || await fs.readFile(keyFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new Error('Invalid IndexNow key.');
  const origin = new URL(SITE_ORIGIN);
  urls = [...new Set(urls)].filter((u) => {
    try { return new URL(u).host === origin.host; } catch { return false; }
  });
  for (let i = 0; i < urls.length; i += 10000) {
    const urlList = urls.slice(i, i + 10000);
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: origin.host,
        key,
        keyLocation: `${SITE_ORIGIN}/indexnow-key.txt`,
        urlList,
      }),
    });
    if (!response.ok && response.status !== 202) {
      throw new Error(`IndexNow submission failed: ${response.status} ${await response.text()}`);
    }
    console.log(`IndexNow accepted ${urlList.length} changed URLs (${response.status}).`);
  }
}

main().catch((error) => {
  console.error('IndexNow submission failed (site still deploys):', error);
});
