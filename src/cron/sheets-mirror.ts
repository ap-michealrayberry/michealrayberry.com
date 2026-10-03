/* Temporary Sheets → D1 mirror (migration steps 2–3).

   Until filing moves to the Worker, Apps Script still writes the Google Sheets.
   Every few minutes this reads the seven published feeds and replaces the
   mirrored tables in D1 in one atomic batch, then rebuilds the site if
   anything changed. Site State keys are upserted, never deleted, so dates the
   AP records in D1 survive. Remove once filing and rulings write D1 directly. */
// @ts-expect-error -- plain JS module shared with scripts/import-sheets.mjs
import { TABS, header, mapTables, parseCsv, sha256 } from '../import/sheets.js';
import { appendEvent } from '../events';
import { etDate } from '../rules';

const FEEDS: Record<string, string> = {
  'Weigh-ins': 'WEIGHINS_CSV',
  'Violation Log': 'VIOLATION_CSV',
  'Attestation': 'ATTESTATION_CSV',
  'Site State': 'SITE_STATE_CSV',
  'Confirmations': 'CONFIRMATIONS_CSV',
  'Supervision': 'SUPERVISION_CSV',
  'Updates': 'UPDATES_CSV',
};
// Tables fully replaced from the feeds (site_state is upserted instead).
const REPLACED = ['days', 'attestations', 'violations', 'confirmations', 'supervision', 'updates'];

type Row = Record<string, unknown>;

function insertStatement(db: D1Database, table: string, row: Row): D1PreparedStatement {
  const cols = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

export interface MirrorResult { changed: boolean; counts?: Record<string, number> }

export async function mirrorSheets(env: Env, now = new Date()): Promise<MirrorResult> {
  const urls = JSON.parse(env.SHEETS_FEEDS || '{}') as Record<string, string>;
  const tabs: Record<string, { rows: Row[] }> = {};
  const texts: string[] = [];
  for (const [name, envName] of Object.entries(FEEDS)) {
    const url = urls[envName];
    if (!url) throw new Error(`Sheets mirror: ${envName} is not configured`);
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Sheets mirror: ${name} HTTP ${res.status}`);
    const csv = await res.text();
    const parsed: string[][] = parseCsv(csv);
    const head: string[] = (parsed[0] || []).map(header);
    const spec = TABS[name] as { columns: string[] };
    if (!spec.columns.every((c: string, i: number) => head[i] === c)) {
      throw new Error(`Sheets mirror: ${name} header changed (${head.slice(0, 6).join(',')}…); not mirrored`);
    }
    tabs[name] = {
      rows: parsed.slice(1)
        .filter((r) => r.some((v) => String(v).trim() !== ''))
        .map((r) => Object.fromEntries(head.map((h: string, i: number) => [h, r[i] ?? '']))),
    };
    texts.push(csv);
  }

  const digest = sha256(texts.join('\u0000'));
  if ((await env.CACHE.get('mirror:sheets')) === digest) return { changed: false };

  const { tables } = mapTables(tabs, etDate(now)) as { tables: Record<string, Row[]> };
  const db = env.DB;
  const statements: D1PreparedStatement[] = [];
  for (const table of REPLACED) {
    statements.push(db.prepare(`DELETE FROM ${table}`));
    for (const row of tables[table]) statements.push(insertStatement(db, table, row));
  }
  for (const { key, value } of tables.site_state as { key: string; value: string }[]) {
    statements.push(db.prepare('INSERT INTO site_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value));
  }
  await db.batch(statements);

  const counts = Object.fromEntries([...REPLACED, 'site_state'].map((t) => [t, tables[t].length]));
  await appendEvent(db, { actor: 'system', action: 'sheets.mirror', subject: null, payload: { digest, counts } });
  await env.CACHE.put('mirror:sheets', digest);
  return { changed: true, counts };
}
