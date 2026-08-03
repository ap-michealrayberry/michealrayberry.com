/* Sheet synchronization (network step, run by the scheduled GitHub Actions
   workflow — never by the Cloudflare build). Fetches the public read-only
   CSV tabs, verifies each tab really is the tab asked for (gviz silently
   falls back to the first sheet when a tab name is wrong), and rewrites the
   committed snapshots under data/ with the fetch timestamp recorded in
   data/sync-state.json. No credentials are used or stored. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, parseCSV, fail } from './lib/common.mjs';
import { REQUIRED_HEADERS, parseWeighIns } from './lib/sheet.mjs';

const SHEET_ID = process.env.SHEET_ID || '1BKNAGZEchYs2P5ZoWql6Ct_4GTyAKJxUqEsXVsJyeDM';
const BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

async function fetchTab(name) {
  const url = `${BASE}&sheet=${encodeURIComponent(name)}`;
  const response = await fetch(url, { headers: { 'user-agent': 'MRB-Record-Publisher/2.0' } });
  if (!response.ok) throw fail(`sheet tab "${name}" fetch failed: ${response.status} ${response.statusText}`);
  const text = await response.text();
  if (/<html|<!doctype/i.test(text.slice(0, 200))) throw fail(`sheet tab "${name}" returned HTML — is the sheet shared as "Anyone with the link: Viewer"?`);
  return text;
}

function assertHeaders(csvText, required, tab) {
  const head = (parseCSV(csvText)[0] || []).map((h) => String(h).trim().toLowerCase());
  for (const name of required) {
    if (!head.includes(name)) throw fail(`tab "${tab}": header "${name}" absent (gviz may have fallen back to another sheet). Headers: ${head.join(', ')}`);
  }
}

async function main() {
  const weighIns = await fetchTab('Weigh-ins');
  assertHeaders(weighIns, REQUIRED_HEADERS, 'Weigh-ins');
  parseWeighIns(weighIns, 'Weigh-ins (fetched)'); // full parse = fail fast on dupes/garbage
  await fs.writeFile(path.join(DATA_DIR, 'weigh-ins.csv'), weighIns);

  const violations = await fetchTab('Violation Log');
  assertHeaders(violations, ['date', 'violation', 'status'], 'Violation Log');
  await fs.writeFile(path.join(DATA_DIR, 'violations.csv'), violations);

  const attestations = await fetchTab('Attestation');
  assertHeaders(attestations, ['date', 'event', 'code', 'kind', 'status'], 'Attestation');
  await fs.writeFile(path.join(DATA_DIR, 'attestations.csv'), attestations);

  const now = new Date().toISOString();
  const prior = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'sync-state.json'), 'utf8').catch(() => '{}'));
  await fs.writeFile(path.join(DATA_DIR, 'sync-state.json'), JSON.stringify({
    ...prior,
    sheet_id: SHEET_ID,
    source: 'Google Sheets — MRB Accountability record spreadsheet (public read-only CSV)',
    fetched_at: now,
    as_of: now,
    method: 'scripts/sync-sheet.mjs over HTTPS (scheduled sync workflow)',
  }, null, 2) + '\n');
  console.log(`Sheet snapshots refreshed at ${now}.`);
}

main().catch((error) => {
  console.error(error.isPipelineError ? `Sheet sync failed: ${error.message}` : error);
  process.exit(1);
});
