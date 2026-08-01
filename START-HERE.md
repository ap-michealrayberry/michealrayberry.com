# START HERE — Recording Assistant build (scoped handoff)

You are building ONLY the Recording Assistant: the contractual capture
instrument for michealrayberry.com (Public Accountability Project). It runs on
the public site, is used exclusively by the Participant (Micheal Ray Berry) on
his phone, and files everything automatically — he has no other tool and no
admin access.

## Read in this order
1. `RECORDING-ASSISTANT-SPEC.md` — the complete specification: 8 capture
   modes, session protocol, attestation + auto-upload, AI verification,
   robustness, safety, acceptance tests. This is the controlling document.
2. `contract/Amendment No. 5 - Escalated Public Consequences.pdf` — governs
   the violation resolution session (§1), overlay contents (§1.2), Penalty
   Uniform rules (§2), verification/override (§3), and safety stops (§5).
   Read all 10 pages.
3. `reference/recording-assistant.js` — the current production tool. Port its
   behavior (guided sequences, canvas overlay compositing, challenge-code
   flow, capture specs), not its code.
4. `reference/Violation Acknowledgment.dc.html` — current acknowledgment tool
   with the spoken-statement teleprompter mode and generated script; fold this
   into the resolution session per spec §1.6.
5. `reference/voice-pack.json` — the voice prompt lines for guided sequences.
6. `reference/Code.gs` — the server side the tool talks to today: challenge
   code issuance, attestation logging, photo filing. Your backend endpoints
   must reproduce these behaviors (see spec §2–3); if the backend is being
   rebuilt separately, define the API contract and stub it cleanly.

## Order of work
1. Plan: propose the module structure, the session API contract (request/
   response shapes for session issue, attestation, upload, verification
   result), and which pieces run client vs server. Get approval first.
2. Session + overlay engine (spec §2) — the shared core every mode uses.
3. Modes in this order: Daily Inspection → Violation resolution session
   (acknowledgment + corner time) → Violation portrait → Weigh-in/Milestone →
   Meal photo → Corrective session → Location.
4. Attestation + resumable auto-upload (spec §3).
5. Automated verification pipeline (spec §4) — hard gates, then AI review;
   AI failure falls back to AP review, never a silent pass.
6. Robustness + safety passes (spec §5–6).
7. Run every acceptance test in spec §7 on a real phone; document results.

## Hard rules
- The signed agreement and Amendment No. 5 win over the spec; the spec wins
  over reference code. Conflicts: STOP and ask.
- One-take integrity: no editing, no re-encoding that changes the attested
  file, no client-side choice of publication destination.
- Corrective-session files must be unreachable from any public URL.
- Safety stop (§5.2) ends any take without penalty and cannot be removed;
  corner-time duration is hard-capped at 30 minutes; nothing in the §5.1
  prohibited list may be required by any mode.
- PACKET_KEY is capture-only: it can create records, never read others,
  modify, or delete.
- Server time only for all deadline logic; the device clock is never trusted.

## Ask the user (don't guess)
- Where the backend lives (existing Apps Script /exec vs the new rebuild's
  API) and its base URL
- Media storage target for uploads (and its credentials — secret store only)
- Anthropic API key for the AI verification layer
- Whether Amendment No. 5 is signed — the resolution session and Penalty
  Uniform prompts ship dark behind a flag until it is
- ElevenLabs voice key (optional; browser TTS is the fallback)
