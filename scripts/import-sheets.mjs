#!/usr/bin/env node
/* One-off import of the Google Sheets record into D1 (migration step 1).

   Reads each tab as CSV — from --dir <folder> (files named like Weigh-ins.csv or
   Violation_Log.csv) or from the feed URL in the matching env var — and writes
   an SQL file of INSERTs plus one chained `events` row per table:

     node scripts/import-sheets.mjs --out import.sql [--dir sheets/]
     npx wrangler d1 execute mrb-record --local  --file import.sql   # check first
     npx wrangler d1 execute mrb-record --remote --file import.sql

   Run against an empty database only: the first statement inserts the genesis
   event, so a second run fails before writing anything else.

   Rows dated before Day 1 are imported as private history. The rules module
   never applies them (contract §1: nothing applies before activation). The
   legacy agreement-gate keys are not carried over; the AP records the Edition 2
   execution dates (§1, §13) before enforcement can start. */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { canonicalJson, eventHash, GENESIS } from '../src/events.ts';
import { etDate } from '../src/rules.ts';
import { TABS, header, insert, mapTables, parseCsv, sha256 } from '../src/import/sheets.js';

// -------------------------------------------------------------- main

async function loadTab(name, spec, dir) {
  let csv = null;
  if (dir) {
    for (const file of [`${name}.csv`, `${name.replace(/ /g, '_')}.csv`]) {
      if (existsSync(join(dir, file))) { csv = await readFile(join(dir, file), 'utf8'); break; }
    }
  }
  if (csv === null && process.env[spec.env]) {
    const res = await fetch(process.env[spec.env]);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    csv = await res.text();
  }
  if (csv === null) {
    if (spec.required) throw new Error(`${name}: no CSV (set ${spec.env} or put the file in --dir)`);
    return { missing: true };
  }
  const parsed = parseCsv(csv);
  const head = (parsed[0] || []).map(header);
  const matches = spec.columns.every((c, i) => head[i] === c);
  if (!matches) {
    // A gviz URL for a tab that does not exist returns the first tab instead.
    if (!spec.required) return { missing: true, reason: `header is ${head.slice(0, 4).join(',')}…` };
    throw new Error(`${name}: expected columns ${spec.columns.join(', ')}; got ${head.join(', ')}`);
  }
  const rows = parsed.slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  return { rows, sha256: sha256(csv) };
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, dir: { type: 'string' } } });
  if (!values.out) throw new Error('usage: node scripts/import-sheets.mjs --out import.sql [--dir sheets/]');
  const today = etDate(new Date());

  const tabs = {};
  for (const [name, spec] of Object.entries(TABS)) {
    tabs[name] = await loadTab(name, spec, values.dir);
    if (tabs[name].missing) console.warn(`${name}: not found, imported as empty${tabs[name].reason ? ` (${tabs[name].reason})` : ''}`);
  }
  const { tables, notes } = mapTables(tabs, today);
  for (const n of notes) console.warn(n);

  const sources = Object.fromEntries(Object.entries(tabs).filter(([, t]) => !t.missing).map(([n, t]) => [n, t.sha256]));
  const lines = [];
  let prev = GENESIS;
  const at = new Date().toISOString();
  const event = async (action, subject, payload) => {
    const row = { at, actor: 'system', action, subject, payload };
    const hash = await eventHash(prev, row);
    lines.push(insert('events', { at, actor: 'system', action, subject, payload: canonicalJson(payload), prev_hash: prev, hash }));
    prev = hash;
  };

  // Genesis first: on a non-empty database this fails before anything else is written.
  await event('import.start', null, { from: 'google-sheets', today, sources });
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) lines.push(insert(table, row));
    await event('import.table', table, { rows: rows.length });
    console.log(`${table}: ${rows.length}`);
  }
  await event('import.done', null, { tables: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])) });

  await writeFile(values.out, `${lines.join('\n')}\n`);
  console.log(`wrote ${lines.length} statements to ${values.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
