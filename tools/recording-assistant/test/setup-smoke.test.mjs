/* Setup smoke test: mount the BUILT element (the artifact that actually
   ships) in jsdom with the media APIs stubbed, and assert the synchronous
   setup completes — the day field holds today's date, the weight field
   prefills from the record, and the draw loop survives frames without
   throwing. "Two input fields failing to prefill" is the exact symptom every
   one of this file's historical bugs surfaced as; this is the cheap assertion
   for it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createRecordingCtx } from './lib/fakectx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const builtFile = path.join(here, '..', '..', '..', 'mrb', 'inspection', 'recording-assistant.js');
const bundle = readFileSync(builtFile, 'utf8');

// Same day arithmetic as the element (mirrored here on purpose: the test must
// not import the module under test to compute its expectations).
const now = new Date();
const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
const dayNum = Math.max(1, Math.floor((now - new Date('2026-07-20T00:00:00')) / 864e5) + 1);
const dayLabel = Math.floor((now - new Date('2026-07-20T00:00:00')) / 864e5) + 1 < 1 ? 'PRE-START' : 'DAY ' + dayNum;

const TRACKER = [
  '"Date","Weight","Delta","Photos","Notes","X","Y","Video"',
  '"' + iso + '","331.8","","posted","","","",""',
].join('\n');
const HEALTH = [
  '"Date","a","b","c","d","e","f","Weight"',
  '"' + iso + '","","","","","","","330.9"',
].join('\n');

function textResponse(t) { return Promise.resolve({ ok: true, text: () => Promise.resolve(t), json: () => Promise.resolve({}) }); }
function jsonResponse(o) { return Promise.resolve({ ok: true, json: () => Promise.resolve(o), text: () => Promise.resolve('') }); }

function mount() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://michealrayberry.com/mrb/inspection/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));

  const ctxs = new WeakMap();
  window.HTMLCanvasElement.prototype.getContext = function () {
    if (!ctxs.has(this)) ctxs.set(this, createRecordingCtx(this.width, this.height));
    return ctxs.get(this);
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,eA==';
  window.HTMLCanvasElement.prototype.captureStream = () => ({ addTrack() {}, getAudioTracks: () => [] });

  window.fetch = (url) => {
    url = String(url);
    if (url.includes('sheet=Health')) return textResponse(HEALTH);
    if (url.includes('sheet=Meal')) return textResponse(TRACKER); // gviz wrong-tab fallback → no plan
    if (url.includes('docs.google.com')) return textResponse(TRACKER);
    if (url.includes('action=challenge')) return jsonResponse({ ok: true, code: '4821' });
    return textResponse('');
  };
  window.speechSynthesis = { cancel() {}, speak() {} };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() {}
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [] } }; }
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {}, type: '' }; }
    createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createMediaElementSource() { return { connect() {} }; }
    createMediaStreamSource() { return { connect() {} }; }
  };
  window.MediaRecorder = class {
    static isTypeSupported() { return false; }
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  };
  // navigator.mediaDevices stays undefined: the camera must FAIL here, and
  // setup must keep going anyway.

  window.eval(bundle);
  const el = window.document.createElement('recording-assistant');
  window.document.body.appendChild(el);
  const $ = (sel) => el.querySelector(sel);
  return { window, el, $, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('mounting completes setup even with no camera: date and weight prefill', async () => {
  const { window, $, errors } = mount();
  try {
    await sleep(120); // let the fetch chains settle

    // Day field: today's ISO date and project day.
    assert.equal($('.ra-day').value, iso + ' · ' + dayLabel);

    // Weight: the scale-synced Health value wins and locks the field.
    assert.equal($('.ra-w').value, '330.9');
    assert.equal($('.ra-w').readOnly, true);
    assert.equal($('.ra-w').closest('.ra-field').querySelector('label').textContent, "Today's Weight (scale-synced)");

    // The camera failure was reported, not thrown.
    assert.match($('.ra-note').textContent, /Camera failed/);

    // Checklist rendered from the tracker row.
    assert.match($('.ra-ck-w').textContent, /^✓ Weight/);
    assert.match($('.ra-ck-p').textContent, /^✓ Daily photos/);
    assert.match($('.ra-ck-v').textContent, /^○ Inspection video/);

    // No ElevenLabs key on this device → the voice settings fold open.
    assert.equal($('.ra-voice').open, true);

    assert.deepEqual(errors, []);
  } finally {
    window.close();
  }
});

test('rehearsal runs the state machine and the draw loop without a camera', async () => {
  const { window, $, errors } = mount();
  try {
    await sleep(50);
    $('.ra-cd').value = '3'; // shortest countdown
    $('.ra-rehearse').click();
    await sleep(200);
    assert.ok($('.ra-start').classList.contains('ra-hide'), 'start hides during the countdown');

    await sleep(3300); // countdown runs out → beginRecording (rehearse: nothing recorded)
    assert.ok($('.ra-recdot').classList.contains('on'), 'REC indicator on');
    assert.ok(!$('.ra-stopbtn').classList.contains('ra-hide'), 'safety stop is available');

    // Let the rAF loop draw a few frames on the fake contexts.
    await sleep(150);
    const viewLog = $('.ra-view').getContext('2d').__log;
    assert.ok(viewLog.some((e) => e[0] === 'fillText' && /REHEARSAL — NO CAMERA/.test(e[1])),
      'rehearsal backdrop drawn');
    assert.ok(viewLog.some((e) => e[0] === 'fillText' && String(e[1]).includes('MICHEAL RAY BERRY')),
      'overlay bands drawn');
    const hudLog = $('.ra-hud').getContext('2d').__log;
    assert.ok(hudLog.some((e) => e[0] === 'fillText' && String(e[1]).includes('INSPECTION POSITION')),
      'HUD shows the running segment');

    // Safety stop: always available, ends the take cleanly.
    $('.ra-stopbtn').click();
    await sleep(50);
    assert.ok(!$('.ra-recdot').classList.contains('on'), 'REC indicator off after stop');
    assert.ok($('.ra-stopbtn').classList.contains('ra-hide'));

    assert.deepEqual(errors, [], 'no exception may escape the draw loop or the timers');
  } finally {
    window.close();
  }
});
