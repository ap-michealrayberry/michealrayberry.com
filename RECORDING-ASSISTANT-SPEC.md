# Recording Assistant — Full Specification (rebuild)

The Recording Assistant is the project's contractual capture instrument (§4.4).
Micheal's ONLY tool. Everything it produces must be verifiable end-to-end with
zero manual filing. Reference implementation: `reference-site/recording-assistant.js`
(port behavior, not code). Amendment No. 5 PDF governs overlay/publication rules.

## 1 · Capture modes
Every mode is a guided, scripted sequence with voice prompts (TTS; ElevenLabs
key optional, browser speechSynthesis fallback) and a visible step tracker.

1. **Daily Inspection** — 4 angles (front, left, rear, right, closing front),
   standing, hands behind head; one continuous video 20–60s + the four daily
   photos in the same session. Auto-advance per angle on voice cue.
2. **Weigh-in capture** — scale readout photo/video; paired with the Health
   sync (autolog remains primary; capture is the visual proof for milestones).
3. **Milestone / Official Weigh-in** — §5.1: on camera, same scale, full
   documentation standard; prompts for milestone video statement.
4. **Meal photo** — with on-device food-presence check before accept.
5. **Violation portrait** — standardized framing (3:4, head-top), pink Penalty
   Uniform when an escalated consequence is open; auto-publishes to the
   violation entry.
6. **Violation resolution session** (Amendment 5 §1.4) — ONE challenge code,
   TWO files, back-to-back with no exit between:
   a. Acknowledgment video (20–30s, teleprompter): name, violation number,
      requirement missed, date + deadline, assigned Consequence Level, the
      public consequence required, resolution steps. Script generated from the
      violation record — never free-typed.
   b. Corner time: 15/20/30 continuous minutes by level; full body + corner in
      frame; countdown timer; tone at completion.
7. **Corrective session** (Amendment 4 — private): recorded, attested,
   delivered to AP storage only; never enters any public publish queue.
8. **Location check-in + live beacon** — attested position for AP card.

## 2 · Session protocol (all modes)
1. Tool requests session from backend with PACKET_KEY + mode + subject id
   (e.g. violation number). Backend returns: one-time challenge code, server
   timestamp, session id, per-file one-time upload URLs, and the mode's
   requirements (duration, uniform, angles) read from the live record.
2. Challenge code is SPOKEN aloud by the participant on camera at start AND
   burned into every frame's overlay. Codes expire (10 min to first frame),
   are single-use, and are logged with issue time.
3. Overlay (canvas composite, burned in, not a UI layer): name · project
   title · mode label · session date · violation number + assigned level +
   required duration (when applicable) · challenge code · elapsed clock ·
   michealrayberry.com footer. Per Amendment 5 §1.2.
4. Capture specs: video canvas 1080×1920 @ 9 Mbps (2.5K stutters — do not
   raise); stills bump camera to 4K, 3-shot sharpest-wins burst.
5. Continuity: recording is one take; pause/stop/app-switch/track-mute ends
   the take as INCOMPLETE (except safety stop, §6). MediaRecorder chunks
   every 1s so a crash loses ≤1s and the partial is still attestable as
   incomplete evidence.

## 3 · Attestation + auto-upload (zero manual steps)
1. SHA-256 computed client-side as chunks finalize (incremental hash — no
   full-file rehash at end).
2. On take end: attestation POST {session id, mode, hash, duration, byte
   length, client meta} — backend stamps SERVER time; that stamp is the
   compliance time.
3. Upload immediately after attestation via the pre-issued one-time URL:
   chunked/resumable (5 MB parts), automatic retry with backoff, survives
   page reload (parts + state in IndexedDB until confirmed). Upload-only
   credentials: can never read, overwrite, or delete anything.
4. Backend verifies received hash == attested hash before accepting; mismatch
   → reject + flag, never silent.
5. Packet/component is FILED only when bytes land; capture time still counts
   from the attestation stamp (slow connection ≠ false miss, but no bytes =
   not filed).
6. Publication routing is server-side by mode: public modes → media store +
   record pages; corrective sessions → private AP storage. The client never
   chooses the destination.

## 4 · Automated verification (AI layer, on the server)
Hard gates first (fail = return for correction, name the defect):
- challenge code valid/unexpired/matches session; hash matches; duration
  meets requirement; file continuous (container timestamps monotonic).
AI review second (Claude API; on API failure → flag for AP review, never pass):
- code legible in frame and matches; correct uniform (black standard / pink
  penalty — full coverage, opaque); pose + all required angles present;
  framing (full body + corner for corner time; face visible for identity);
  scale readable and consistent with logged weight (weigh-ins).
Results: pass → component Verified + publish; fail → specific defect named,
corrected submission permitted; §3.4: a failed technical check never raises
the level or creates a new violation. Every result is logged permanently with
model, prompt version, and evidence pointers. AP can override any result
(§3.6 — override logged: decision, date, general reason, resulting status).

## 5 · Robustness requirements
- Works on the phone browser (installed PWA) offline-tolerant: session must be
  fetched online, but a completed capture queues and uploads when connectivity
  returns (attestation hash was computed at capture; backend accepts late
  bytes against the earlier attestation stamp).
- Storage guard: check free space + estimated file size before starting a
  30-min take; warn early.
- Battery/thermal: warn below 20% before long takes.
- Camera/mic permission failures produce instructions, not dead buttons.
- Every timer uses server-offset time (fetch server time at session start,
  apply offset) — device clock is never trusted for deadlines.
- Wake lock during capture; screen dim ≠ stopped take.
- All state transitions idempotent: reload at any point resumes or cleanly
  restarts without double-filing (session id dedupes server-side).

## 6 · Safety (contract-mandated, cannot be built away)
- SAFETY STOP button visible during every take: ends recording immediately,
  marks session "safety stop — pending AP review", never auto-declares a
  violation (Amendment 5 §5.2).
- Corner-time screen shows the §5.2 stop conditions before start.
- §9 review link reachable from every screen of the tool.
- No mode may require anything in the §5.1 prohibited list; duration caps
  hard-coded at 30 min for corner time.

## 7 · Acceptance tests
- [ ] Full daily packet end-to-end on a real phone: session → capture →
      attest → auto-upload → published, zero manual steps
- [ ] Violation resolution session: one code, two files, ack published +
      corner time published in full, statuses flip to Verified
- [ ] Kill the page mid-upload → reload → upload resumes and completes
- [ ] Airplane mode after capture → restore → queued upload lands, filed
      against original attestation time
- [ ] Deliberately bad submission (wrong code / short duration / black
      unitard during penalty period) → AI names the exact defect, allows
      corrected retake, no level increase
- [ ] Safety stop mid-corner-time → no violation, AP review item created
- [ ] Attestation hash matches an independent `shasum -a 256` of the
      downloaded file; /verify confirms it
- [ ] Corrective session file is unreachable from any public URL
- [ ] Expired/reused challenge code rejected
- [ ] PACKET_KEY cannot modify or delete any existing record (probe it)
