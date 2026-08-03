import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createR2Uploader } from '../src/upload.js';

class FakeXhr {
  static behave = { status: 200, error: false };
  constructor() { this.upload = {}; }
  open(method, url) { this.method = method; this.url = url; }
  send(body) {
    this.body = body;
    const b = FakeXhr.behave;
    queueMicrotask(() => {
      if (this.upload.onprogress) {
        this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
        this.upload.onprogress({ lengthComputable: true, loaded: 10, total: 10 });
      }
      if (b.error) return this.onerror();
      this.status = b.status;
      this.responseText = b.text || '';
      this.onload();
    });
  }
}

function makeUploader(signResponse) {
  const posted = [];
  const up = createR2Uploader({
    endpoint: 'https://script.example/exec',
    deviceKey: () => 'dev-key',
    isoStr: '2026-08-03',
    fetchFn: async (url, opts) => {
      posted.push(JSON.parse(opts.body));
      return { json: async () => signResponse };
    },
    XhrCtor: FakeXhr,
  });
  return { up, posted };
}

const blob = { size: 42, type: 'video/mp4' };

test('happy path: sign → PUT → public URL, with progress callbacks', async () => {
  FakeXhr.behave = { status: 200 };
  const { up, posted } = makeUploader({ ok: true, uploadUrl: 'https://acc.r2.cloudflarestorage.com/o?sig=1', publicUrl: 'https://video.michealrayberry.com/o.mp4' });
  const pcts = [];
  const url = await up(blob, (p) => pcts.push(p));
  assert.equal(url, 'https://video.michealrayberry.com/o.mp4');
  assert.deepEqual(pcts, [50, 100]);
  assert.deepEqual(posted[0], { action: 'r2sign', key: 'dev-key', date: '2026-08-03', kind: 'daily', mime: 'video/mp4' });
});

test('signing refusal surfaces the server reason', async () => {
  const { up } = makeUploader({ ok: false, error: 'unauthorized' });
  await assert.rejects(() => up(blob), /unauthorized/);
});

test('a rejected PUT surfaces the bucket status', async () => {
  FakeXhr.behave = { status: 403, text: 'SignatureDoesNotMatch' };
  const { up } = makeUploader({ ok: true, uploadUrl: 'https://acc.r2.cloudflarestorage.com/o', publicUrl: 'x' });
  await assert.rejects(() => up(blob), /R2 403 SignatureDoesNotMatch/);
});

test('a network drop mid-PUT points at the CORS policy', async () => {
  FakeXhr.behave = { error: true };
  const { up } = makeUploader({ ok: true, uploadUrl: 'https://acc.r2.cloudflarestorage.com/o', publicUrl: 'x' });
  await assert.rejects(() => up(blob), /CORS/);
});
