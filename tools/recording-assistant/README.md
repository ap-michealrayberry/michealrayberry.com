# Recording Assistant — source, build, and test harness

`mrb/inspection/recording-assistant.js` is a **built file**. Do not edit it
directly — edit the modules here and rebuild:

```
npm install        # once
npm run build:ra   # rebuild mrb/inspection/recording-assistant.js
npm test           # build + the full harness (also the pre-push gate)
```

The public contract is unchanged: the output is one self-contained classic
script defining `<recording-assistant>`, loadable with a plain `<script src>`
and mountable as a tag. The host page (`mrb/inspection/index.html`) did not
change. The only runtime `import()` is MediaPipe's CDN bundle, which is valid
in classic scripts and is left external by the build.

## Module map

| Module | Responsibility |
| --- | --- |
| `src/constants.js` | Segments, endpoints, sizes, model URLs — every tunable in one place. |
| `src/ui.js` | The template and CSS, exported as strings so the selector check can read them. Byte-identical to the pre-refactor markup. |
| `src/overlay.js` | Canvas compositor: every burned-in band (name, day, date, weight, verification code, monitor status), the title card, the still/meal/violation stamps, the X card. Pure `(ctx, state)`. |
| `src/hud.js` | Preview-only HUD (never recorded): segment progress, framing guide. Pure. |
| `src/session.js` | Sequence timing, the one-continuous-take finish decision, day arithmetic, the intro line, and the three-warning invalidation monitor. Pure. |
| `src/monitor.js` | Pose-landmark → issue derivation (in frame, hands behind head, facing, stillness) and the audio-level check. Pure math over landmarks. |
| `src/voice.js` | Narration: ElevenLabs with cache + prefetch, device-voice fallback, never-overlap sequencing. Environment injected. |
| `src/capture.js` | Codec choice, sharpness scoring, framing heuristic, artifact file names. |
| `src/upload.js` | Presigned-PUT upload to R2. |
| `src/record.js` | Endpoint client (challenge / attest / packet) + CSV parsers for the tracker. |
| `src/main.js` | The element: DOM and media wiring only. |

## The checks

| Test | Catches |
| --- | --- |
| `selector-integrity.test.mjs` | JS querying classes the template no longer has (bug 1), listeners on removed markup (bug 3), orphaned markup and CSS. |
| `lint.test.mjs` (no-undef) | Identifiers that survived the edit that removed their declaration — the `MODE` regression class. |
| `csp.test.mjs` + `csp-manifest.mjs` | An origin dropped from `_headers` while the code still needs it (bug 2), a new URL added to the code without deciding its directive, and the "comment inside a path block" Cloudflare trap. |
| `setup-smoke.test.mjs` | Mounts the **built** file in jsdom: date + weight prefill (the exact symptom users report), graceful camera failure, the rehearsal state machine, the safety stop, and that no exception escapes the draw loop. |
| `overlay-snapshot.test.mjs` | The overlays as evidence: strict draw-command JSON snapshots plus rendered PNG goldens, and semantic guarantees (the verification code, the timer, name/day/date/weight are present). Regenerate after an intended change: `RA_UPDATE=1 npm test`, then review the image diff. |
| `session.test.mjs`, `parsers.test.mjs`, `capture.test.mjs`, `voice.test.mjs`, `upload.test.mjs` | The extracted logic, including every strike-monitor transition (warning, recovery, third-strike and sustained-breach invalidation — invalidation discards, never trims). |
| `regressions.test.mjs` | Each historical bug demonstrated failing against the pre-fix code (`test/fixtures/pre-refactor-recording-assistant.js` is the deployed file as of git `ea97b03`, byte-for-byte). |

## What the refactor found and changed

Behavior was ported verbatim (the template and CSS are byte-identical; every
user-facing message was inventory-checked), with these exceptions — each one a
defect the new checks now pin:

1. **`MODE` ReferenceError (fixed).** The edit that removed corrective mode
   deleted `const MODE = …` but left two references (`drawHud`,
   `checkFraming`). With a live camera the first HUD frame threw and the draw
   loop died. The references are gone; `lint.test.mjs` proves `no-undef`
   catches the original.
2. **The safety stop was dead (fixed).** The "■ Stop" button was shown while
   recording but no listener was ever attached, in any committed version.
   "Safety stop is always available" is contractual; it now calls
   `stopRecording()`, and the smoke test asserts it. A stopped take is still
   discarded by the finish decision — one continuous take.
3. **Dead corrective-session block (removed).** ~150 lines of corrective
   machinery were unreachable (`corrective` could never become non-null) and
   queried four selectors with no markup (`.ra-corrnote`, `.ra-cstart`,
   `.ra-cstop`, `.ra-cdl`). Corrective sessions are owned by
   `/mrb/corrective/`. The reusable parts survived as tested modules:
   the strike monitor in `session.js`, pose checks in `monitor.js`.
4. **Violation portrait is not wired (left as-is, documented).** The template
   shows "Capture Violation Portrait" but no committed version ever attached
   its listener, and the filing semantics ("filed privately … not published")
   depend on server behavior this repo can't verify — wiring it to the packet
   endpoint could publish a private artifact. The stamp is implemented and
   tested (`overlay.stampViolationPortrait`); the button's classes sit on the
   selector test's explicit allowlist so the incompleteness stays visible.
   Wiring it needs one decision from the AP: which action files privately.

## Device caveats (not testable here)

Real-phone behaviors still need on-device verification after any change:
screen-lock/backgrounding during a long take (wake lock is requested and
re-requested on visibility change), MediaPipe GPU→CPU fallback on mobile
Safari, memory on long takes, and upload resumption on a dropped connection —
the R2 PUT currently restarts rather than resumes; the failure path hands the
user the download instead.
