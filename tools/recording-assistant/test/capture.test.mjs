import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickMimeType, sharpnessScore, framingStatus, FRAME_W, FRAME_H,
  videoFileName, photoFileName, mealFileName, xCardFileName, photoSlug,
} from '../src/capture.js';

test('codec preference: mp4 first, then vp8, vp9, bare webm, else none', () => {
  assert.equal(pickMimeType(() => true), 'video/mp4');
  assert.equal(pickMimeType((t) => t !== 'video/mp4'), 'video/webm;codecs=vp8,opus');
  assert.equal(pickMimeType((t) => t === 'video/webm'), 'video/webm');
  assert.equal(pickMimeType(() => false), '');
});

function rgba(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    const i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
}

test('sharpness: a checkerboard scores far above a flat field', () => {
  const sw = 120, sh = 160;
  const sharp = sharpnessScore(rgba(sw, sh, (x, y) => ((x + y) % 2 ? 255 : 0)), sw, sh);
  const flat = sharpnessScore(rgba(sw, sh, () => 128), sw, sh);
  assert.ok(sharp > flat * 100, 'sharp=' + sharp + ' flat=' + flat);
});

test('framing: edge energy inside the guide → FRAMED; empty frame → ADJUST', () => {
  // body: high-frequency texture in the centre columns of the guide rows
  const body = framingStatus(rgba(FRAME_W, FRAME_H,
    (x, y) => (x >= 26 && x < 64 && y >= 10 && y < 150 ? ((x + y) % 2 ? 255 : 0) : 200)));
  assert.equal(body.ok, true);
  assert.match(body.msg, /FRAMED/);
  const empty = framingStatus(rgba(FRAME_W, FRAME_H, () => 200));
  assert.equal(empty.ok, false);
  assert.match(empty.msg, /ADJUST/);
});

const day = { isoStr: '2026-08-03', dayNum: 15, preStart: false };
const pre = { isoStr: '2026-07-18', dayNum: 1, preStart: true };

test('artifact names are self-identifying about their project day', () => {
  assert.equal(videoFileName(day, 'mp4'), 'micheal-ray-berry-daily-inspection-2026-08-03-day-015.mp4');
  assert.equal(videoFileName(pre, 'webm'), 'micheal-ray-berry-daily-inspection-2026-07-18-pre-start.webm');
  assert.equal(photoFileName(day, 'front'), 'micheal-ray-berry-daily-photo-2026-08-03-front.jpg');
  assert.equal(mealFileName(day), 'micheal-ray-berry-evening-meal-2026-08-03-day-015.jpg');
  assert.equal(xCardFileName(day), 'micheal-ray-berry-x-card-2026-08-03-day-015.jpg');
});

test('photo slugs drop the " side" suffix only', () => {
  assert.equal(photoSlug('FRONT'), 'front');
  assert.equal(photoSlug('LEFT SIDE'), 'left');
  assert.equal(photoSlug('RIGHT SIDE'), 'right');
  assert.equal(photoSlug('REAR'), 'rear');
});
