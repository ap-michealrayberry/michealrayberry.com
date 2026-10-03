/* Temporary Sheets → D1 mirror (migration steps 2–4).

   Filing now writes D1 directly (step 3); Apps Script still owns the scale
   sync, violation rulings, supervision and updates until steps 4–5. Every few
   minutes this reads the published feeds and, in one atomic batch:
   - merges the scale weight and note into days (never touches filed media);
   - upserts violations by a stable per-row key, keeping D1 ids (and every
     corrective or correction request that points at them);
   - replaces supervision and updates; upserts Site State (D1-only keys survive).
   Attestations and confirmations are no longer mirrored: D1 is their record. */
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
// Tables still fully replaced from the feeds.
const REPLACED = ['supervision', 'updates'];

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
  // Scale weight and note only (Apps Script's Withings sync); filed media is the Worker's.
  for (const d of tables.days as { date: string; weight_lb: number | null; note: string | null }[]) {
    statements.push(db.prepare('INSERT INTO days (date, weight_lb, note) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET weight_lb = excluded.weight_lb, note = excluded.note')
      .bind(d.date, d.weight_lb, d.note));
  }
  // Violations keyed by date, wording and occurrence, so D1 ids stay stable.
  const seen = new Map<string, number>();
  const keys: string[] = [];
  for (const v of tables.violations as Row[]) {
    const base = `${v.date}\n${v.violation}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = sha256(`${base}\n${n}`);
    keys.push(key);
    const cols = Object.keys(v);
    statements.push(db.prepare(
      `INSERT INTO violations (${cols.join(', ')}, sheet_key) VALUES (${cols.map(() => '?').join(', ')}, ?)
       ON CONFLICT(sheet_key) DO UPDATE SET ${cols.filter((c) => c !== 'date' && c !== 'violation').map((c) => `${c} = excluded.${c}`).join(', ')}`,
    ).bind(...cols.map((c) => (v[c] === undefined ? null : v[c])), key));
  }
  for (const { key, value } of tables.site_state as { key: string; value: string }[]) {
    statements.push(db.prepare('INSERT INTO site_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value));
  }
  // Rows gone from the sheet (and the unkeyed rows of the first import) go, unless something on the
  // record points at them. Until step 4 every violation in D1 comes from the sheet; step 4 ends this.
  statements.push(db.prepare(
    `DELETE FROM violations WHERE (sheet_key IS NULL OR sheet_key NOT IN (SELECT value FROM json_each(?)))
     AND id NOT IN (SELECT violation_id FROM correctives) AND id NOT IN (SELECT violation_id FROM correction_requests)
     AND id NOT IN (SELECT violation_id FROM corrective_filings)`,
  ).bind(JSON.stringify(keys)));
  await db.batch(statements);

  const counts = Object.fromEntries([...REPLACED, 'days', 'violations', 'site_state'].map((t) => [t, tables[t].length]));
  await appendEvent(db, { actor: 'system', action: 'sheets.mirror', subject: null, payload: { digest, counts } });
  await env.CACHE.put('mirror:sheets', digest);
  return { changed: true, counts };
}
