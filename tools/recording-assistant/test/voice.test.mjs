import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoice } from '../src/voice.js';

function makeEnv(overrides = {}) {
  const calls = { fetches: [], spoken: [], played: [], cancels: 0, wired: [] };
  const env = {
    getKey: () => '',
    getVoiceId: () => '',
    fetchFn: async (url, opts) => {
      calls.fetches.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, blob: async () => ({ fake: 'blob' }) };
    },
    createObjectURL: (b) => 'blob:fake-' + calls.fetches.length,
    createAudio: (url) => {
      const a = { url, paused: false, pause() { this.paused = true; }, async play() { calls.played.push(url); } };
      return a;
    },
    wireAudio: (el) => calls.wired.push(el.url),
    speech: () => ({ cancel: () => calls.cancels++, speak: (u) => calls.spoken.push(u.text) }),
    Utterance: class { constructor(text) { this.text = text; } },
    ...overrides,
  };
  return { env, calls };
}

test('no API key → device voice speaks, nothing is fetched', async () => {
  const { env, calls } = makeEnv();
  const v = createVoice(env);
  await v.say('Turn to your left.');
  assert.deepEqual(calls.spoken, ['Turn to your left.']);
  assert.equal(calls.fetches.length, 0);
});

test('with a key → ElevenLabs audio plays, wired into the audio graph, cached per line', async () => {
  const { env, calls } = makeEnv({ getKey: () => 'k' });
  const v = createVoice(env);
  await v.say('Hold the position.');
  await v.say('Hold the position.');
  assert.equal(calls.fetches.length, 1, 'second say must come from the cache');
  assert.equal(calls.played.length, 2);
  assert.equal(calls.wired.length, 2);
  assert.equal(calls.spoken.length, 0, 'device voice must not double-speak');
  assert.equal(calls.fetches[0].body.text, 'Hold the position.');
});

test('a TTS failure falls back to the device voice', async () => {
  const { env, calls } = makeEnv({
    getKey: () => 'k',
    fetchFn: async () => ({ ok: false, status: 401 }),
  });
  const v = createVoice(env);
  await v.say('Turn to the rear.');
  assert.deepEqual(calls.spoken, ['Turn to the rear.']);
});

test('a newer line supersedes one still fetching — lines never overlap', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { env, calls } = makeEnv({ getKey: () => 'k' });
  const slowFetch = env.fetchFn;
  env.fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.text === 'slow line') await gate;
    return slowFetch(url, opts);
  };
  const v = createVoice(env);
  const p1 = v.say('slow line');
  await v.say('fast line');
  release();
  await p1;
  assert.deepEqual(calls.played, ['blob:fake-1'], 'the superseded line must not play after the newer one');
});

test('prefetch warms every line before the countdown; the cache holds across calls', async () => {
  const { env, calls } = makeEnv({ getKey: () => 'k' });
  const v = createVoice(env);
  await v.prefetchTexts(['a', 'b', '', 'c']);
  assert.equal(calls.fetches.length, 3, 'blank lines are not fetched');
  await v.prefetchTexts(['a', 'b', 'c']);
  assert.equal(calls.fetches.length, 3, 'already-warmed lines are not re-fetched');
  await v.say('a');
  assert.equal(calls.fetches.length, 3, 'say() plays from the warmed cache — nothing is fetched mid-recording');
});

test('prefetch without a key is a no-op', async () => {
  const { env, calls } = makeEnv();
  const v = createVoice(env);
  await v.prefetchTexts(['a', 'b']);
  assert.equal(calls.fetches.length, 0);
});
