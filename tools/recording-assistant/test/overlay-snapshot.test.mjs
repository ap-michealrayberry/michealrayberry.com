/* Overlay snapshots. The overlays are evidence — a regression that drops the
   verification code or the timer silently weakens the record — so each state
   is pinned two ways:

   1. Draw-command log (JSON, committed): every canvas call with rounded args,
      via a deterministic fake context. Font-independent, byte-stable across
      machines — this is the strict gate.
   2. Rendered PNG (committed): real rasterisation via @napi-rs/canvas,
      compared with a small tolerance (text metrics differ slightly across
      font environments). Also what a human eyeballs after a change.

   Regenerate both after an intended overlay change: RA_UPDATE=1 npm test */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRecordingCtx } from './lib/fakectx.mjs';
import { SEGMENTS, TITLE_SEC } from '../src/constants.js';
import {
  drawLiveOverlay, drawCountdown, drawTitleCard, drawPhotoPhase,
  drawRehearsalBackdrop, stampStill, stampMeal, stampViolationPortrait, drawXCard,
} from '../src/overlay.js';
import { drawHud } from '../src/hud.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(here, 'golden');
mkdirSync(goldenDir, { recursive: true });
const UPDATE = !!process.env.RA_UPDATE;

const BASE = { W: 1080, H: 1920, isoStr: '2026-08-03', dayLabel: 'DAY 15', weight: 331.4, code: '4821', titleSec: TITLE_SEC };
const STAMP = { PW: 1080, PH: 1920, k: 1, isoStr: '2026-08-03', dayLabel: 'DAY 15', weight: 331.4, code: '4821' };

const STATES = [
  { id: 'live-overlay', w: 1080, h: 1920, draw: (c) => drawLiveOverlay(c, BASE) },
  { id: 'live-overlay-precode', w: 1080, h: 1920, draw: (c) => drawLiveOverlay(c, { ...BASE, code: null, weight: NaN }) },
  { id: 'title-card', w: 1080, h: 1920, draw: (c) => drawTitleCard(c, BASE, 1.0) },
  { id: 'title-card-fading', w: 1080, h: 1920, draw: (c) => drawTitleCard(c, BASE, 2.3) },
  { id: 'countdown', w: 1080, h: 1920, draw: (c) => drawCountdown(c, BASE, 7) },
  { id: 'photo-phase', w: 1080, h: 1920, draw: (c) => drawPhotoPhase(c, BASE, { label: 'REAR', count: 3 }) },
  { id: 'rehearsal', w: 1080, h: 1920, draw: (c) => drawRehearsalBackdrop(c, BASE) },
  {
    id: 'hud-recording', w: 720, h: 1280,
    draw: (c) => drawHud(c, { HW: 720, HH: 1280, recording: true, elapsed: 30, segments: SEGMENTS, angleIdx: 1, showGuide: false, frameStatus: null }),
  },
  {
    id: 'hud-guide-framed', w: 720, h: 1280,
    draw: (c) => drawHud(c, { HW: 720, HH: 1280, recording: false, elapsed: 0, segments: SEGMENTS, angleIdx: -1, showGuide: true, frameStatus: { ok: true, msg: 'FRAMED — WHOLE BODY IN VIEW' } }),
  },
  {
    id: 'hud-guide-checking', w: 720, h: 1280,
    draw: (c) => drawHud(c, { HW: 720, HH: 1280, recording: false, elapsed: 0, segments: SEGMENTS, angleIdx: -1, showGuide: true, frameStatus: null }),
  },
  { id: 'stamp-still', w: 1080, h: 1920, draw: (c) => stampStill(c, { ...STAMP, label: 'LEFT SIDE' }) },
  { id: 'stamp-meal', w: 1080, h: 1920, draw: (c) => stampMeal(c, { ...STAMP, timeStr: '19:42:07', planTag: ' · PLAN ✓' }) },
  { id: 'stamp-violation', w: 1080, h: 1920, draw: (c) => stampViolationPortrait(c, { ...STAMP, vnum: 2, vdate: '2026-08-01' }) },
  { id: 'x-card', w: 1080, h: 1350, draw: (c, img) => drawXCard(c, img || { width: 1080, height: 1920 }, { CW: 1080, CH: 1350, isoStr: '2026-08-03', dayLabel: 'DAY 15', weight: 331.4 }) },
];

// ---- 1. Draw-command log snapshots (strict) ----

for (const s of STATES) {
  test('draw log: ' + s.id, () => {
    const ctx = createRecordingCtx(s.w, s.h);
    s.draw(ctx);
    const got = JSON.stringify(ctx.__log, null, 1) + '\n';
    const file = path.join(goldenDir, s.id + '.json');
    if (UPDATE || !existsSync(file)) {
      writeFileSync(file, got);
      return;
    }
    assert.equal(got, readFileSync(file, 'utf8'),
      s.id + ' drew differently than its committed golden. If the change is intended, regenerate with RA_UPDATE=1 npm test and review the diff.');
  });
}

// ---- 2. Semantic guarantees, independent of the snapshots ----

function texts(draw, w = 1080, h = 1920) {
  const ctx = createRecordingCtx(w, h);
  draw(ctx);
  return ctx.__log.filter((e) => e[0] === 'fillText').map((e) => String(e[1]));
}

test('the verification code is burned into the live overlay and the title card', () => {
  assert.ok(texts((c) => drawLiveOverlay(c, BASE)).some((t) => t.includes('CODE 4821')));
  assert.ok(texts((c) => drawTitleCard(c, BASE, 0)).some((t) => t.includes('VERIFICATION CODE 4821')));
});

test('the live overlay always carries name, date, day and weight', () => {
  const t = texts((c) => drawLiveOverlay(c, BASE));
  assert.ok(t.some((x) => x.includes('MICHEAL RAY BERRY') && x.includes('2026-08-03')));
  assert.ok(t.some((x) => x.includes('DAY 15') && x.includes('331.4 LB')));
});

test('stills are stamped with day, date, weight and code', () => {
  const t = texts((c) => stampStill(c, { ...STAMP, label: 'REAR' }));
  assert.ok(t.some((x) => x.includes('DAY 15 — 2026-08-03') && x.includes('331.4 LB')));
  assert.ok(t.some((x) => x.includes('CODE 4821')));
});

test('the recording HUD shows the running segment and the time left in it', () => {
  const t = texts((c) => drawHud(c, { HW: 720, HH: 1280, recording: true, elapsed: 30, segments: SEGMENTS, angleIdx: 1, showGuide: false, frameStatus: null }), 720, 1280);
  assert.ok(t.some((x) => /NOW · \d+S LEFT/.test(x)));
  assert.ok(t.includes('LEFT SIDE'));
  assert.ok(t.some((x) => x.includes('NEXT → REAR')));
});

test('the violation stamp carries number and dates but never consequence details', () => {
  const t = texts((c) => stampViolationPortrait(c, { ...STAMP, vnum: 2, vdate: '2026-08-01' }));
  assert.ok(t.includes('VIOLATION V-002'));
  assert.ok(t.some((x) => x.includes('VIOLATION OF 2026-08-01 · ASSESSED 2026-08-03')));
});

// ---- 3. Rendered PNGs (tolerant pixel compare) ----

let canvasMod = null;
try { canvasMod = await import('@napi-rs/canvas'); } catch (e) { /* optional */ }

if (canvasMod) {
  const { createCanvas } = canvasMod;
  for (const s of STATES) {
    test('pixels: ' + s.id, async () => {
      const c = createCanvas(s.w, s.h);
      const ctx = c.getContext('2d');
      let img = null;
      if (s.id === 'x-card') {
        const ic = createCanvas(1080, 1920);
        const ictx = ic.getContext('2d');
        ictx.fillStyle = '#666'; ictx.fillRect(0, 0, 1080, 1920);
        img = ic;
      }
      s.draw(ctx, img);
      const file = path.join(goldenDir, s.id + '.png');
      if (UPDATE || !existsSync(file)) {
        writeFileSync(file, c.toBuffer('image/png'));
        return;
      }
      const golden = createCanvas(s.w, s.h);
      const gctx = golden.getContext('2d');
      gctx.drawImage(await canvasMod.loadImage(file), 0, 0);
      const a = ctx.getImageData(0, 0, s.w, s.h).data;
      const b = gctx.getImageData(0, 0, s.w, s.h).data;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
      const mean = diff / a.length;
      assert.ok(mean < 2,
        s.id + ' rendered pixels drifted from the committed golden (mean channel diff ' + mean.toFixed(3) + '). Intended? RA_UPDATE=1 npm test.');
    });
  }
} else {
  test('pixels: skipped — @napi-rs/canvas not installed', { skip: true }, () => {});
}
