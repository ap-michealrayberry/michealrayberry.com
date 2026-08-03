import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist, parseWeightPrefill, parseHealthWeight, parseMealPlan, minutesToDeadline } from '../src/record.js';

/* These parsers feed the two prefilled fields whose failure was the visible
   symptom of the CSP incident ("two input fields failing to prefill") — the
   cheap, exact assertions live here; the mounted-element version is in
   setup-smoke.test.mjs. */

const TRACKER = [
  '"Date","Weight","Delta","Photos","Notes","X","Y","Video"',
  '"2026-08-01","333.2","","posted","","","","https://video.example/1"',
  '"2026-08-02","332.4","","posted","","","",""',
  '"2026-08-03","331.8","","","","","",""',
].join('\n');

test('checklist reflects exactly what the record already holds', () => {
  assert.deepEqual(parseChecklist(TRACKER, '2026-08-01'), { weight: true, photos: true, video: true });
  assert.deepEqual(parseChecklist(TRACKER, '2026-08-02'), { weight: true, photos: true, video: false });
  assert.deepEqual(parseChecklist(TRACKER, '2026-08-03'), { weight: true, photos: false, video: false });
  // a day with no row at all: nothing on the record
  assert.deepEqual(parseChecklist(TRACKER, '2026-08-04'), { weight: false, photos: false, video: false });
});

test("weight prefill: today's logged weight wins, else the most recent", () => {
  assert.deepEqual(parseWeightPrefill(TRACKER, '2026-08-03'), { todayWeight: 331.8, lastLogged: 331.8 });
  assert.deepEqual(parseWeightPrefill(TRACKER, '2026-08-04'), { todayWeight: null, lastLogged: 331.8 });
});

test('health tab: scale-synced weight for today, or null when not synced', () => {
  const HEALTH = [
    '"Date","a","b","c","d","e","f","Weight"',
    '"2026-08-02","","","","","","","332.4"',
    '"2026-08-03","","","","","","","331.4"',
  ].join('\n');
  assert.equal(parseHealthWeight(HEALTH, '2026-08-03'), 331.4);
  assert.equal(parseHealthWeight(HEALTH, '2026-08-04'), null);
});

test('meal plan: assigned meal for today, tolerant of the gviz fallback tab', () => {
  const PLAN = [
    '"Date","Meal","Labels"',
    '"2026-08-03","Grilled chicken salad","salad,chicken"',
  ].join('\n');
  assert.deepEqual(parseMealPlan(PLAN, '2026-08-03'),
    { meal: 'Grilled chicken salad', labels: ['salad', 'chicken'] });
  assert.equal(parseMealPlan(PLAN, '2026-08-04'), null);
  // gviz silently serves another tab when the sheet is missing — header check catches it
  assert.equal(parseMealPlan(TRACKER, '2026-08-03'), null);
});

test('deadline clock: minutes to 22:00 America/New_York', () => {
  // 2026-08-03 is EDT (UTC-4): 21:00 ET == 01:00 UTC next day
  assert.equal(minutesToDeadline(new Date('2026-08-04T01:00:00Z')), 60);
  assert.equal(minutesToDeadline(new Date('2026-08-04T02:00:00Z')), 0);
  assert.ok(minutesToDeadline(new Date('2026-08-04T03:00:00Z')) < 0);
});
