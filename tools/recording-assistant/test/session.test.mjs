import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENTS } from '../src/constants.js';
import {
  seqTotal, segmentIndexAt, segmentRemaining, finishDecision,
  buildIntroLine, spokenWeight, dayInfo, createStrikeMonitor, busy, busyOrPosing,
} from '../src/session.js';
import { poseIssues, audioIssue, ISSUE } from '../src/monitor.js';

// ---- Sequence timing ----

test('sequence totals 92s across 6 segments', () => {
  assert.equal(SEGMENTS.length, 6);
  assert.equal(seqTotal(SEGMENTS), 92);
});

test('segmentIndexAt walks every boundary correctly', () => {
  assert.equal(segmentIndexAt(SEGMENTS, 0), 0);
  assert.equal(segmentIndexAt(SEGMENTS, 25.9), 0);
  assert.equal(segmentIndexAt(SEGMENTS, 26), 1);   // boundary belongs to the next segment
  assert.equal(segmentIndexAt(SEGMENTS, 36.9), 1);
  assert.equal(segmentIndexAt(SEGMENTS, 37), 2);
  assert.equal(segmentIndexAt(SEGMENTS, 48), 3);
  assert.equal(segmentIndexAt(SEGMENTS, 59), 4);
  assert.equal(segmentIndexAt(SEGMENTS, 70), 5);
  assert.equal(segmentIndexAt(SEGMENTS, 1000), 5); // clamps to the last segment
});

test('segmentRemaining counts down inside a segment', () => {
  assert.equal(segmentRemaining(SEGMENTS, 0, 0), 26);
  assert.equal(segmentRemaining(SEGMENTS, 0, 25.5), 1);
  assert.equal(segmentRemaining(SEGMENTS, 1, 26), 11);
  assert.equal(segmentRemaining(SEGMENTS, 5, 92), 0);
});

// ---- One continuous take ----

test('a take stopped early is discarded, not delivered', () => {
  assert.equal(finishDecision(30 * 1000, 92).accept, false);
  assert.equal(finishDecision(90 * 1000, 92).accept, false); // one second short of tolerance
  assert.equal(finishDecision(91 * 1000, 92).accept, true);  // within the 1s stop-latency tolerance
  assert.equal(finishDecision(92 * 1000, 92).accept, true);
});

test('abort before the first segment discards everything', () => {
  const d = finishDecision(500, 92);
  assert.equal(d.accept, false);
  assert.match(d.reason, /stopped at 0\.5s/);
});

// ---- UI guards ----

test('busy guards block start during countdown, recording, and posing', () => {
  assert.equal(busy({ recording: false, countdownSec: 0 }), false);
  assert.equal(busy({ recording: true, countdownSec: 0 }), true);
  assert.equal(busy({ recording: false, countdownSec: 3 }), true);
  assert.equal(busyOrPosing({ recording: false, countdownSec: 0, photoPhase: { label: 'REAR' } }), true);
  assert.equal(busyOrPosing({ recording: false, countdownSec: 0, photoPhase: null }), false);
});

// ---- Narration content ----

test('intro line carries day, date, and weight — and never the code', () => {
  const line = buildIntroLine({ dayNum: 15, spokenDate: 'August 3, 2026', weightSpoken: '331' });
  assert.match(line, /Day 15/);
  assert.match(line, /August 3, 2026/);
  assert.match(line, /331 pounds/);
  assert.match(line, /one continuous take/);
  // The verification code is burned into the frame, never spoken: the line
  // may explain that a code is shown, but no digits beyond day/date appear.
  assert.match(line, /verification code shown on screen/);
  assert.doesNotMatch(line.replace('August 3, 2026', ''), /\d{4}/);
});

test('intro line omits the weight sentence when no weight is entered', () => {
  const line = buildIntroLine({ dayNum: 3, spokenDate: 'July 22, 2026', weightSpoken: '' });
  assert.doesNotMatch(line, /Documented weight/);
});

test('spokenWeight says "335", not "335 point zero"', () => {
  assert.equal(spokenWeight(335), '335');
  assert.equal(spokenWeight(335.0), '335');
  assert.equal(spokenWeight(334.6), '334.6');
  assert.equal(spokenWeight(NaN), '');
});

// ---- Day arithmetic ----

test('dayInfo: project days and the pre-start window', () => {
  const d15 = dayInfo(new Date('2026-08-03T12:00:00'), '2026-07-20');
  assert.deepEqual([d15.dayNum, d15.dayLabel, d15.isoStr, d15.preStart], [15, 'DAY 15', '2026-08-03', false]);
  const d1 = dayInfo(new Date('2026-07-20T08:00:00'), '2026-07-20');
  assert.equal(d1.dayLabel, 'DAY 1');
  const pre = dayInfo(new Date('2026-07-18T08:00:00'), '2026-07-20');
  assert.deepEqual([pre.dayNum, pre.dayLabel, pre.preStart], [1, 'PRE-START', true]);
});

// ---- Three-warning invalidation ----

const SEC = 1000;
function tickRange(m, issues, from, to, step = 500) {
  let last = null;
  for (let t = from; t <= to; t += step) {
    const r = m.tick(issues, t);
    if (r) last = r;
  }
  return last;
}

test('a breach sustained past the grace period costs exactly one warning', () => {
  const m = createStrikeMonitor({});
  assert.equal(m.tick([ISSUE.HANDS_OFF_HEAD], 0), null);
  assert.equal(m.tick([ISSUE.HANDS_OFF_HEAD], 2 * SEC), null); // still inside grace
  const r = m.tick([ISSUE.HANDS_OFF_HEAD], 3 * SEC);
  assert.deepEqual(r, { warn: 1 });
  // the same breach does not multi-count
  assert.equal(m.tick([ISSUE.HANDS_OFF_HEAD], 4 * SEC), null);
});

test('returning to position clears the breach clock but never refunds warnings', () => {
  const m = createStrikeMonitor({});
  tickRange(m, [ISSUE.MOVEMENT], 0, 3 * SEC);
  assert.equal(m.strikes, 1);
  m.tick([], 4 * SEC); // recovered
  assert.equal(m.breachAt, null);
  assert.equal(m.strikes, 1);
  // a fresh breach needs its own grace period before warning again
  assert.equal(m.tick([ISSUE.MOVEMENT], 5 * SEC), null);
  assert.deepEqual(m.tick([ISSUE.MOVEMENT], 8 * SEC), { warn: 2 });
});

test('the third warning invalidates the session', () => {
  const m = createStrikeMonitor({});
  tickRange(m, [ISSUE.OUT_OF_FRAME], 0, 3 * SEC); m.tick([], 4 * SEC);
  tickRange(m, [ISSUE.OUT_OF_FRAME], 5 * SEC, 8 * SEC); m.tick([], 9 * SEC);
  const r = tickRange(m, [ISSUE.OUT_OF_FRAME], 10 * SEC, 13 * SEC);
  assert.deepEqual(r, { invalidate: 'three warnings (out of frame)' });
});

test('a single sustained breach invalidates outright at 12s', () => {
  const m = createStrikeMonitor({});
  const r = tickRange(m, [ISSUE.TURNED_AWAY], 0, 12.5 * SEC);
  assert.deepEqual(r, { invalidate: 'sustained breach (turned away)' });
});

test('an invalidated monitor stays invalidated', () => {
  const m = createStrikeMonitor({ sustainSec: 1 });
  tickRange(m, [ISSUE.NOISE], 0, 1.5 * SEC);
  assert.ok(m.invalidReason);
  assert.deepEqual(m.tick([], 60 * SEC), { invalidate: m.invalidReason });
});

// ---- Pose issue derivation (synthetic landmarks) ----

function goodPose() {
  // 33 landmarks; the ones the monitor reads are set explicitly.
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[0] = { x: 0.5, y: 0.10, visibility: 1 };   // nose
  lm[7] = { x: 0.46, y: 0.12, visibility: 1 };  // ears
  lm[8] = { x: 0.54, y: 0.12, visibility: 1 };
  lm[11] = { x: 0.42, y: 0.30, visibility: 1 }; // shoulders
  lm[12] = { x: 0.58, y: 0.30, visibility: 1 };
  lm[15] = { x: 0.45, y: 0.11, visibility: 1 }; // wrists at the ears
  lm[16] = { x: 0.55, y: 0.11, visibility: 1 };
  lm[23] = { x: 0.45, y: 0.55, visibility: 1 }; // hips
  lm[24] = { x: 0.55, y: 0.55, visibility: 1 };
  return lm;
}

test('compliant pose produces no issues', () => {
  assert.deepEqual(poseIssues(goodPose(), {}), []);
});

test('no landmarks → OUT OF FRAME', () => {
  assert.deepEqual(poseIssues(null, {}), [ISSUE.OUT_OF_FRAME]);
});

test('both shoulders invisible → OUT OF FRAME', () => {
  const lm = goodPose();
  lm[11].visibility = 0.2; lm[12].visibility = 0.2;
  assert.deepEqual(poseIssues(lm, {}), [ISSUE.OUT_OF_FRAME]);
});

test('nose invisible → TURNED AWAY', () => {
  const lm = goodPose();
  lm[0].visibility = 0.1;
  assert.deepEqual(poseIssues(lm, {}), [ISSUE.TURNED_AWAY]);
});

test('wrists dropped to the sides → HANDS OFF HEAD', () => {
  const lm = goodPose();
  lm[15] = { x: 0.35, y: 0.50, visibility: 1 };
  lm[16] = { x: 0.65, y: 0.50, visibility: 1 };
  assert.deepEqual(poseIssues(lm, {}), [ISSUE.HANDS_OFF_HEAD]);
});

test('drift across frames → EXCESSIVE MOVEMENT (EMA-smoothed)', () => {
  const track = {};
  const lm = goodPose();
  assert.deepEqual(poseIssues(lm, track), []); // first frame primes lastC
  let flagged = false;
  for (let i = 1; i <= 20; i++) {
    const moved = goodPose();
    const dx = 0.04 * i;
    for (const j of [23, 24]) moved[j] = { ...moved[j], x: moved[j].x + dx };
    if (poseIssues(moved, track).includes(ISSUE.MOVEMENT)) { flagged = true; break; }
  }
  assert.ok(flagged, 'sustained hip drift never tripped the movement check');
});

test('stillness never trips the movement check', () => {
  const track = {};
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(poseIssues(goodPose(), track), []);
  }
});

test('audio level: quiet room stays clear, sustained noise flags', () => {
  const t1 = {};
  for (let i = 0; i < 50; i++) assert.equal(audioIssue(0.01, t1), null);
  const t2 = {};
  let flagged = false;
  for (let i = 0; i < 100; i++) if (audioIssue(0.5, t2)) { flagged = true; break; }
  assert.ok(flagged);
});
