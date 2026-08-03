/* Narration. ElevenLabs when a key is present, device speechSynthesis
   fallback otherwise. The caller supplies the environment (storage access,
   fetch, audio wiring) so the sequencing rules — never overlap lines, never
   let a stale fetch speak over a newer line — are testable.

   env: {
     getKey():   ElevenLabs key or '' (device voice fallback)
     getVoiceId(): voice ID or '' (Adam)
     fetchFn:    fetch-compatible
     createObjectURL(blob): blob → url
     createAudio(url): Audio-compatible { play(), pause() }
     wireAudio(audioEl): route the element into the recording's audio graph
     speech():   speechSynthesis-compatible { cancel(), speak(u) }
     Utterance:  SpeechSynthesisUtterance-compatible constructor
   } */

import { EL_DEFAULT_VOICE, EL_TTS_BASE } from './constants.js';

export function createVoice(env) {
  const _elCache = {};
  let _elAudio = null;
  let _sayGen = 0;

  function ttsRequest(text, key, voice) {
    return env.fetchFn(EL_TTS_BASE + voice + '?output_format=mp3_44100_64', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
    });
  }

  async function say(text) {
    if (!text) return;
    const mySay = ++_sayGen;
    // Hard-stop anything still talking — lines must never overlap.
    if (_elAudio) { try { _elAudio.pause(); } catch (e) {} _elAudio = null; }
    try { env.speech().cancel(); } catch (e) {}
    const key = env.getKey();
    const voice = env.getVoiceId() || EL_DEFAULT_VOICE;
    if (key) {
      try {
        if (!_elCache[text]) {
          const r = await ttsRequest(text, key, voice);
          if (!r.ok) throw new Error(r.status);
          _elCache[text] = env.createObjectURL(await r.blob());
        }
        if (mySay !== _sayGen) return; // a newer line superseded this one while it was fetching
        if (_elAudio) { try { _elAudio.pause(); } catch (e) {} }
        _elAudio = env.createAudio(_elCache[text]);
        try { env.wireAudio(_elAudio); } catch (e) {}
        await _elAudio.play();
        return;
      } catch (e) { /* fall through to device voice */ }
    }
    if (mySay !== _sayGen) return;
    try {
      env.speech().cancel();
      const u = new env.Utterance(text);
      u.rate = 1.05;
      env.speech().speak(u);
    } catch (e) {}
  }

  // Warm the voice cache for every scripted line so playback starts instantly.
  // Returns a promise — start waits for it so the ENTIRE script is downloaded
  // before the countdown begins; nothing is fetched mid-recording.
  async function prefetchTexts(texts) {
    const key = env.getKey();
    if (!key) return;
    const voice = env.getVoiceId() || EL_DEFAULT_VOICE;
    for (const text of texts.filter((t) => t && !_elCache[t])) {
      try {
        const r = await ttsRequest(text, key, voice);
        if (r.ok) _elCache[text] = env.createObjectURL(await r.blob());
      } catch (e) {}
    }
  }

  return { say, prefetchTexts };
}
