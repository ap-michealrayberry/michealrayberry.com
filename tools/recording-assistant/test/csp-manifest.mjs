/* Every external origin the recording assistant touches, and the CSP
   directive that governs that touch. The conformance test asserts each of
   these against _headers, and separately asserts that every https:// literal
   in src/ is accounted for here — so a new origin cannot be added to the code
   without deciding its directive, and an origin cannot be dropped from the
   CSP while the code still needs it. */

import {
  SHEET_CSV, ATTEST_ENDPOINT, EL_TTS_BASE,
  MEDIAPIPE_VISION_MJS, MEDIAPIPE_WASM_ROOT, MEDIAPIPE_FOOD_MODEL, MEDIAPIPE_POSE_MODEL,
} from '../src/constants.js';

export const NETWORK_NEEDS = [
  { url: SHEET_CSV, directive: 'connect-src',
    why: 'tracker CSV (checklist, weight prefill, meal plan) — fetch' },
  { url: ATTEST_ENDPOINT, directive: 'connect-src',
    why: 'challenge codes, attestation, packet filing, R2 signing — fetch' },
  { url: 'https://script.googleusercontent.com/', directive: 'connect-src',
    why: 'Apps Script answers POSTs via a 302 to this host; blocking it kills every endpoint call' },
  { url: EL_TTS_BASE, directive: 'connect-src',
    why: 'ElevenLabs narration — fetch' },
  { url: MEDIAPIPE_VISION_MJS, directive: 'script-src',
    why: 'MediaPipe vision bundle — dynamic import() loads it as a script' },
  { url: MEDIAPIPE_WASM_ROOT + '/vision_wasm_internal.js', directive: 'script-src',
    why: 'MediaPipe WASM glue is loaded AS SCRIPT from the wasm root' },
  { url: MEDIAPIPE_WASM_ROOT + '/vision_wasm_internal.wasm', directive: 'connect-src',
    why: 'MediaPipe WASM binary — fetched' },
  { url: MEDIAPIPE_FOOD_MODEL, directive: 'connect-src',
    why: 'food classifier model — fetched' },
  /* The pose model is used by the corrective tool, which lives behind the
     same _headers block; it also serves as the canary for the documented
     incident: storage.googleapis.com looked like "just a model host" but
     MediaPipe loads glue from it as script too. Both directives stay pinned. */
  { url: MEDIAPIPE_POSE_MODEL, directive: 'connect-src',
    why: 'pose landmarker model — fetched (corrective tool, same CSP)' },
  { url: MEDIAPIPE_FOOD_MODEL, directive: 'script-src',
    why: 'MediaPipe serves WASM glue as script from storage.googleapis.com (the bug-2 incident: removing it broke setup with no pointer at the header)' },
  { url: 'blob:https://michealrayberry.com/x', directive: 'script-src',
    why: 'MediaPipe compiles its worker/glue from blob: URLs' },
  { url: 'blob:https://michealrayberry.com/x', directive: 'worker-src',
    why: 'MediaPipe spawns workers from blob: URLs' },
  { url: 'https://x.r2.cloudflarestorage.com/', directive: 'connect-src',
    why: 'presigned PUT of the inspection video goes straight to the bucket (XHR)' },
  { url: 'blob:https://michealrayberry.com/x', directive: 'media-src',
    why: 'session review replays the recording from a blob: URL' },
  { url: 'data:image/jpeg;base64,x', directive: 'connect-src',
    why: 'attestation re-fetches captured stills from data: URLs to hash them' },
  { url: 'blob:https://michealrayberry.com/x', directive: 'connect-src',
    why: 'attestation fetches the finished video blob to hash it' },
];

/* https:// literals in src/ that are NOT network fetches from the element:
   links in the template, comment references, and the endpoint host itself
   (already covered above via ATTEST_ENDPOINT). */
export const NON_FETCH_LITERALS = [
  'https://michealrayberry.com', // template links + description text + upload CORS hint
  'https://api.elevenlabs.io',   // covered via EL_TTS_BASE (same origin, path built at call time)
  'https://cdn.jsdelivr.net',    // covered via MEDIAPIPE_* constants
  'https://storage.googleapis.com',
  'https://docs.google.com',
  'https://script.google.com',
];
