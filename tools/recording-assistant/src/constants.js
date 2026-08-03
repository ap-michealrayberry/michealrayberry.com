/* Shared constants for the recording assistant.
   SEGMENTS[0].speak is assembled at record time (buildIntroLine in session.js)
   because it carries the day, date, and weight. */

export const START_DATE = '2026-07-20';

/* Guided inspection sequence. Each segment names the angle and states what
   that angle exists to verify, so the recording is self-documenting: anyone
   watching it later can hear what was required, not just see a man turning.
   Durations are generous enough that the line finishes before the turn is
   called — the device voice is slower than ElevenLabs, and the script has to
   work on either. */
export const SEGMENTS = [
  { label: 'INSPECTION POSITION', tag: 'FRONT VIEW · HANDS BEHIND HEAD', dur: 26, speak: '' },
  { label: 'LEFT SIDE', tag: 'VIEW 2 OF 4', dur: 11,
    speak: 'Turn to your left. Hold the position. This view records the left profile.' },
  { label: 'REAR', tag: 'VIEW 3 OF 4', dur: 11,
    speak: 'Turn to the rear. Hold the position. This view records the back, shoulders to heels.' },
  { label: 'RIGHT SIDE', tag: 'VIEW 4 OF 4', dur: 11,
    speak: 'Turn to your right. Hold the position. This view records the right profile.' },
  { label: 'FRONT', tag: 'CLOSING VIEW', dur: 11,
    speak: 'Return to the front. Face the camera. Hands behind the head. This closing view confirms identity against the opening frame.' },
  { label: 'COMPLETE', tag: 'DAILY INSPECTION', dur: 22,
    speak: 'All four required views are recorded. This inspection documents the result exactly as it is, with no adjustment and no commentary. The remaining requirements of the Daily Compliance Packet are due by ten PM Eastern: the four accountability photographs, the weight entry, and the record update. Nothing is complete until the record accepts all of them. Up, down, or flat, it gets posted. Daily Inspection complete.' },
];

// Photo phase after the video: posed, sharp stills — subject holds still per angle.
export const PHOTO_SEGS = [
  { label: 'FRONT', say: 'Now the photos. Front view. Hold still.', wait: 6 },
  { label: 'LEFT SIDE', say: 'Turn to your left. Hold still.', wait: 6 },
  { label: 'REAR', say: 'Turn to the rear. Hold still.', wait: 6 },
  { label: 'RIGHT SIDE', say: 'Turn to your right. Hold still.', wait: 6 },
];

export const TITLE_SEC = 2.5; // opening title card (also becomes the feed thumbnail)

export const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1BKNAGZEchYs2P5ZoWql6Ct_4GTyAKJxUqEsXVsJyeDM/gviz/tq?tqx=out:csv';

// AP's Apps Script web app — issues one-time challenge codes and records
// capture attestations (SHA-256 fingerprints) with Google server time.
export const ATTEST_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyJ7PV4NAmK2WcP-pBMLW78orrw_i7KndnKEkWLT_Xd0GtyeRztQpOxd2oSaitEHJM7/exec';

// From 2026-07-30 the official weight is SCALE-SYNCED (Withings → Google
// Health → record) — no manual logging.
export const WEIGHT_AUTO_START = '2026-07-30';

// Recording canvas: 1080p portrait — lighter to composite+encode in realtime
// (2.5K caused frame drops); stills stay full-res.
export const VIEW_W = 1080;
export const VIEW_H = 1920;
export const HUD_W = 720;
export const HUD_H = 1280;

export const EL_DEFAULT_VOICE = 'pNInz6obpgDQGcFmaJgB';
export const EL_TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech/';

// MediaPipe (on-device food check for the meal photo). The vision bundle is a
// module script from cdn.jsdelivr.net; its glue also loads WASM *as script*
// from storage.googleapis.com and spawns blob: workers — all three must be
// permitted by script-src / worker-src (see the CSP conformance test).
export const MEDIAPIPE_VISION_MJS = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
export const MEDIAPIPE_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
export const MEDIAPIPE_FOOD_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite';
export const MEDIAPIPE_POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const FOOD_RE = /pizza|plate|soup|bowl|burrito|hotdog|hot ?dog|sandwich|salad|broccoli|carbonara|meat|loaf|potato|mushroom|pretzel|bagel|burger|french|fries|guacamole|ice ?cream|espresso|cup|banana|apple|orange|lemon|strawberry|pineapple|fig|pomegranate|corn|cucumber|pepper|squash|cauliflower|cabbage|artichoke|spaghetti|noodle|rice|omelet|pancake|waffle|dough|pie|cake|chocolate|trifle|eggnog|menu|restaurant|dining|frying ?pan|pot,|^pot$|wok|tray|dutch oven|lemon|zucchini|eggplant|acorn squash|butternut/i;
