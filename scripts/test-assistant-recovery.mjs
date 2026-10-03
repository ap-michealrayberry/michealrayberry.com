import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
};
const browser = { window: { MRB: {} }, localStorage };
vm.createContext(browser);
const queueSource = await readFile(new URL('../assistant/js/14-upload-queue.js', import.meta.url), 'utf8');
vm.runInContext(queueSource, browser);
const queue = browser.window.MRB.queue;
const first = {
  kind: 'corrective', date: '2026-09-12', vRef: 'V-001122334455',
  assignmentId: 'C-' + '1'.repeat(24), attemptId: 'A-' + '2'.repeat(24),
  seal: 'a'.repeat(64), video_sha256: 'b'.repeat(64), code: '1234',
};
const second = { ...first, seal: 'c'.repeat(64), video_sha256: 'd'.repeat(64), code: '5678' };
assert.equal(queue.rememberFilingSeal(first), true);
assert.equal(queue.rememberFilingSeal(second), true);
const bucket = JSON.parse(storage.get('mrb_attestation_seals_v1'))[queue.filingSealKey(first)];
assert.equal(bucket.captures[first.seal].videoHash, first.video_sha256);
assert.equal(bucket.captures[second.seal].videoHash, second.video_sha256);
assert.equal(Object.keys(bucket.captures).length, 2, 'multiple takes must retain separate recoverable receipts');
browser.localStorage = { getItem() { throw new Error('storage unavailable'); } };
assert.equal(queue.rememberFilingSeal(first), false, 'storage failure must be reported, not treated as persistence');

// Exercise fallback receipt selection without starting page/network handlers.
const fallback = {
  localStorage,
  document: { readyState: 'loading', addEventListener() {} },
};
vm.createContext(fallback);
const fileSource = await readFile(new URL('../assistant/file/file.js', import.meta.url), 'utf8');
vm.runInContext(fileSource.replace(
  '  if (document.readyState === "loading") {',
  '  globalThis.recoveryTest = { correctiveCaptureReceipts: correctiveCaptureReceipts, saveCorrectiveDraft: saveCorrectiveDraft };\n  if (document.readyState === "loading") {',
), fallback);
const receipts = await fallback.recoveryTest.correctiveCaptureReceipts(first.vRef, first.assignmentId, first.attemptId);
assert.equal(receipts.length, 2);
assert.ok(receipts.every((receipt) => receipt.date === first.date), 'receipt recovery must preserve the sealed capture date');
assert.equal((await fallback.recoveryTest.correctiveCaptureReceipts(first.vRef, first.assignmentId, 'A-' + '3'.repeat(24))).length, 0);

// localStorage loss must still recover an exact IndexedDB receipt.
fallback.localStorage = { getItem() { throw new Error('storage unavailable'); } };
fallback.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => true }, close() {},
        transaction() {
          return { objectStore() { return { getAll() {
            const records = {};
            queueMicrotask(() => { records.result = [first]; records.onsuccess(); });
            return records;
          } }; } };
        },
      };
      request.onsuccess();
    });
    return request;
  },
};
const recovered = await fallback.recoveryTest.correctiveCaptureReceipts(first.vRef, first.assignmentId, first.attemptId);
assert.equal(recovered.length, 1);
assert.equal(recovered[0].seal, first.seal);
assert.equal(fallback.recoveryTest.saveCorrectiveDraft(first.vRef, first.assignmentId, first.attemptId, {}), false);
console.log('Assistant recovery passed: distinct captures, storage failure, IndexedDB fallback, and original capture dates.');
