import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs script, no type declarations
import { etTimestamp, mapTables, normalizeDate, parseCsv, publicViolationId, verifiedViolation } from '../../scripts/import-sheets.mjs';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const marker = (date: string, verifiedOn: string, text: string) => `APV1|${verifiedOn}|${sha(`violation-v1\n${date}\n${text}`)}`;

describe('import-sheets', () => {
  it('parses quoted CSV with commas, quotes and newlines', () => {
    expect(parseCsv('"a","b"\n"x, y","say ""hi""\nthere"')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });

  it('reads Sheets dates and Eastern timestamps', () => {
    expect(normalizeDate('9/4/2026')).toBe('2026-09-04');
    expect(normalizeDate('Tue Sep 22 2026 00:00:00 GMT-0400 (Eastern Daylight Time)')).toBe('2026-09-22');
    expect(etTimestamp('8/31/2026 18:49:35')).toBe('2026-08-31T22:49:35.000Z');
    expect(etTimestamp('2026-09-05 21:44')).toBe('2026-09-06T01:44:00.000Z');
    expect(etTimestamp('12/1/2026 9:00:00')).toBe('2026-12-01T14:00:00.000Z');
  });

  it('keeps the public violation id that publish.mjs derives', () => {
    const text = 'Missed 10 PM ET deadline';
    const m = marker('2026-10-04', '2026-10-05', text);
    const v = verifiedViolation(m, '2026-10-04', text, '2026-10-06');
    expect(v).toEqual({ verifiedAt: '2026-10-05', digest: m.split('|')[2] });
    expect(publicViolationId(v.digest)).toBe(`V-${sha(`public-violation-id-v1\n${v.digest}`).slice(0, 12).toUpperCase()}`);
    expect(verifiedViolation(m, '2026-10-04', `${text}!`, '2026-10-06')).toBeNull(); // edited wording
    expect(verifiedViolation(m, '2026-10-04', text, '2026-10-04')).toBeNull(); // verified in the future
  });

  it('imports unverified rows as private flags and verified rows with public ids', () => {
    const text = 'Missed 10 PM ET deadline';
    const { tables } = mapTables({
      'Violation Log': { rows: [
        { date: '2026-10-04', violation: text, status: 'Unresolved', event_verification: marker('2026-10-04', '2026-10-05', text) },
        { date: '2026-10-04', violation: 'auto flag', status: 'Unresolved', event_verification: '' },
        { date: '2026-10-05', violation: 'dismissed flag', status: 'Rejected · not a violation', event_verification: '' },
      ] },
    }, '2026-10-06');
    expect(tables.violations.map((v: { status: string; public_id: string | null }) => [v.status, !!v.public_id]))
      .toEqual([['open', true], ['flagged', false], ['rejected', false]]);
  });

  it('drops start_date, test-phase and legacy gate keys from Site State', () => {
    const { tables, notes } = mapTables({
      'Site State': { rows: [
        { key: 'start_date', value: '2026-10-11' },
        { key: 'test_start_date', value: '2026-10-03' },
        { key: 'mrb_signature_verified_at', value: '2026-09-20T22:45:56.886Z' },
        { key: 'wait_still_date', value: 'Tue Sep 22 2026 00:00:00 GMT-0400 (Eastern Daylight Time)' },
        { key: 'agreement_edition', value: '2' },
      ] },
    }, '2026-10-06');
    expect(tables.site_state).toEqual([
      { key: 'wait_still_date', value: '2026-09-22' },
      { key: 'agreement_edition', value: '2' },
    ]);
    expect(notes).toHaveLength(3);
  });
});
