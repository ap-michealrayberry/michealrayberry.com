import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let uuidCounter = 0;
const scriptProperties = new Map([['SEAL_SECRET', 'test-only-seal-secret']]);
const context = {
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest(_algorithm, input) {
      return [...createHash('sha256').update(String(input)).digest()]
        .map((byte) => (byte > 127 ? byte - 256 : byte));
    },
    computeHmacSha256Signature(input, secret) {
      return [...createHmac('sha256', String(secret)).update(String(input)).digest()]
        .map((byte) => (byte > 127 ? byte - 256 : byte));
    },
    getUuid() {
      uuidCounter += 1;
      return `${String(uuidCounter).padStart(8, 'a')}-bbbb-cccc-dddd-eeeeeeeeeeee`;
    },
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return scriptProperties.get(key) || null; },
        setProperty(key, value) { scriptProperties.set(key, String(value)); },
      };
    },
  },
};

vm.createContext(context);
vm.runInContext(await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context, {
  filename: 'apps-script/Code.gs',
});

const gate = { active: true, effectiveDate: '2026-09-01', today: '2026-09-13' };
const event = context.violationEventMarker('2026-09-02', 'Test event', '2026-09-02');
const requestId = 'request-1234567890';
const assignmentId = context.correctiveAssignmentIdForRequest(event, requestId);

assert.match(assignmentId, /^C-[A-F0-9]{24}$/);
assert.equal(assignmentId, context.correctiveAssignmentIdForRequest(event, requestId));
assert.notEqual(assignmentId, context.correctiveAssignmentIdForRequest(event, 'request-1234567891'));
const initialAttempt = context.correctiveAttemptId(assignmentId, null);
assert.match(initialAttempt, /^A-[A-F0-9]{24}$/);
assert.equal(initialAttempt, context.correctiveAttemptId(assignmentId, null));

const row = [
  '2026-09-02',
  'Test event',
  'Submitted',
  '2026-09-12',
  '',
  '',
  '',
  'https://youtu.be/ABCDEFGHIJK',
  event,
];
const firstMarker = context.newCorrectiveRejectionMarker(
  event,
  assignmentId,
  gate.today,
  row[7],
  null,
);
row[5] = firstMarker;
row[7] = '';
const first = context.verifiedCorrectiveRejectionDetails(row, gate);
assert.ok(first);
assert.equal(first.assignmentId, assignmentId);
assert.equal(first.urlHashes.length, 1);
const firstRetryAttempt = context.correctiveAttemptId(assignmentId, first);
assert.match(firstRetryAttempt, /^A-[A-F0-9]{24}$/);
assert.notEqual(firstRetryAttempt, initialAttempt, 'first protected rejection must advance the attempt identity');
assert.equal(firstRetryAttempt, context.correctiveAttemptId(assignmentId, first));
assert.equal(
  context.correctiveRecordingUrlHash('https://youtu.be/ABCDEFGHIJK'),
  context.correctiveRecordingUrlHash('https://www.youtube.com/watch?v=ABCDEFGHIJK'),
  'equivalent YouTube URL spellings must have one recording identity',
);
assert.throws(
  () => context.newCorrectiveRejectionMarker(
    event,
    assignmentId,
    gate.today,
    'https://www.youtube.com/watch?v=ABCDEFGHIJK',
    first,
  ),
  /already rejected/,
);

row[5] = context.newCorrectiveRejectionMarker(
  event,
  assignmentId,
  gate.today,
  'https://youtu.be/ZYXWVUTSRQP',
  first,
);
const second = context.verifiedCorrectiveRejectionDetails(row, gate);
assert.ok(second);
assert.equal(second.urlHashes.length, 2);
const secondRetryAttempt = context.correctiveAttemptId(assignmentId, second);
assert.notEqual(secondRetryAttempt, firstRetryAttempt, 'every protected rejection generation must advance the attempt identity');

const challengeContext = context.correctiveChallengeContextMarker(
  `V-${event.split('|')[2].slice(0, 12).toUpperCase()}`,
  assignmentId,
  secondRetryAttempt,
);
assert.equal(
  challengeContext,
  `CTX3|V-${event.split('|')[2].slice(0, 12).toUpperCase()}|${assignmentId}|${secondRetryAttempt}`,
);
assert.deepEqual(
  { ...context.correctiveChallengeContext(['', '', '', '', '', '', '', challengeContext]) },
  {
    ref: `V-${event.split('|')[2].slice(0, 12).toUpperCase()}`,
    assignmentId,
    attemptId: secondRetryAttempt,
  },
);

const filingRecord = {
  ref: `V-${event.split('|')[2].slice(0, 12).toUpperCase()}`,
  assignmentId,
  attemptId: secondRetryAttempt,
  date: gate.today,
  urlHash: context.correctiveRecordingUrlHash('https://youtu.be/LMNOPQRSTUV'),
  attestationSeal: 'a'.repeat(64),
};
const filingSignature = context.correctiveFilingEvidenceSignature(filingRecord);
assert.match(filingSignature, /^[a-f0-9]{64}$/);
assert.notEqual(
  filingSignature,
  context.correctiveFilingEvidenceSignature({ ...filingRecord, attemptId: firstRetryAttempt }),
  'server filing evidence must bind the exact attempt identity',
);
assert.equal(
  context.correctiveCompletionStatus(event, secondRetryAttempt),
  `Completed · ${event} · ${secondRetryAttempt}`,
);

const tampered = row.slice();
tampered[5] = `${row[5].slice(0, -1)}${row[5].endsWith('a') ? 'b' : 'a'}`;
assert.equal(context.verifiedCorrectiveRejectionDetails(tampered, gate), null);

// A server-sealed due-date capture can be delivered after midnight; a new
// capture, a stale attempt, or caller-provided future date cannot reopen it.
const source = ['2026-09-02', 'Test event', 'Unresolved', '', '', '', '', '', event];
const corrective = ['2026-09-02', 'Test assignment', '2026-09-12', 'Assigned · ' + event, '', assignmentId];
context.violationLogSheet = () => ({
  getDataRange: () => ({ getValues: () => [context.TABS['Violation Log'], source] }),
});
context.correctiveSheet = () => ({
  getDataRange: () => ({ getValues: () => [context.TABS['Corrective Log'], corrective] }),
});
const ref = 'V-' + context.publicViolationToken(event);
assert.throws(() => context.correctiveTargetForRef(ref, gate, assignmentId, initialAttempt), /window is closed/);
assert.equal(
  context.correctiveTargetForRef(ref, gate, assignmentId, initialAttempt, '2026-09-12').attemptId,
  initialAttempt,
);
assert.throws(() => context.correctiveTargetForRef(ref, gate, assignmentId, initialAttempt, '2026-09-14'), /future/);
assert.throws(() => context.correctiveTargetForRef(ref, gate, assignmentId, initialAttempt, '2026-09-01'), /predates/);
source[5] = firstMarker;
assert.throws(() => context.correctiveTargetForRef(ref, gate, assignmentId, initialAttempt, '2026-09-12'), /stale/);
assert.throws(() => context.correctiveTargetForRef(ref, gate, assignmentId, firstRetryAttempt, '2026-09-12'), /predates/);
assert.equal(context.correctiveTargetForRef(ref, gate, assignmentId, firstRetryAttempt).attemptId, firstRetryAttempt);

console.log('Apps Script identity and protected corrective-rejection tests passed.');
