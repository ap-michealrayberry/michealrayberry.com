# Recording Assistant — architecture, API contract, and acceptance tests

The Recording Assistant is the project's contractual capture instrument (§4.4).
It is the Participant's only tool: it runs on the public site, is used on his
phone, and files everything automatically with no manual steps. This document
is the build reference. The signed agreement and Amendment No. 5 win over this
document; this document wins over the reference code that was ported.

Ported from the handoff on branch `ap-michealrayberry-patch-2`
(`RECORDING-ASSISTANT-SPEC.md`, `reference/recording-assistant.js`,
`reference/Violation Acknowledgment.dc.html`, `reference/Code.gs`,
`reference/voice-pack.json`) — behavior, not code.

## Module structure

Client (`/recording-assistant/`, private, `noindex`):

- `index.html` — the participant page (participant-only, not linked publicly).
- `app.js` — the `<recording-assistant>` custom element: session core, canvas
  overlay engine, per-mode capture flows, attestation, safety stop.
- `upload-queue.js` — `RAUploadQueue`, the IndexedDB-backed resumable upload
  queue (parts + state survive a reload until the server confirms).

Server (Netlify Functions, `netlify/functions/`):

- `recording-session.mts` — `GET /api/recording/context`, `POST /api/recording/session`.
- `recording-attest.mts` — `POST /api/recording/attest`, `/event`, `/location`.
- `recording-upload.mts` — `PUT`/`GET /api/recording/upload`, `POST /api/recording/upload/complete`.
- `recording-verify-background.mts` — the verification pipeline (hard gates → AI review → routing).
- `capture-media.mts` — `GET /media/captures/:session/:kind`, public verified media only.
- `ap-capture-review.mts` — `GET`/`POST /api/ap/capture-review`, AP review + override.
- `netlify/lib/recording.mts` — shared constants, auth, session/registry helpers.

Data: migration `0010_recording-assistant-capture-sessions` adds
`private_record.capture_sessions`, `private_record.capture_components`,
`private_record.capture_verification_events` (append-only), and the public-safe
`public_record.public_capture_log` view.

## Which pieces run where

- **Client:** camera, canvas compositing + burned-in overlay, guided sequences,
  voice prompts (ElevenLabs → browser TTS), SHA-256 of the final file, the
  resumable upload queue, and the safety stop.
- **Server:** challenge-code issuance and single-use/expiry enforcement, the
  compliance-time stamp, hash verification, hard gates, AI review, publication
  routing, and all record writes. The client never chooses a publication
  destination.

## Authentication

- **`PACKET_KEY`** (header `x-packet-key`) — capture-only. It can create capture
  records and act on a session whose one-time `upload_token` the caller also
  holds. It can never read other records, modify history, or delete. Held in
  the participant's browser `localStorage` only.
- **`AP_KEY`** (header `x-ap-key`) — the AP review/override surface. Fails
  closed when unset.
- Per-session `upload_token` — a 32-byte secret returned once at session issue;
  only its SHA-256 is stored. Every attest/upload/event call must present both
  `PACKET_KEY` and the matching token, so a leaked `PACKET_KEY` alone cannot
  touch an existing session's media.

## Amendment No. 5 gating

`violation-portrait` and `violation-resolution` ship dark until Amendment No. 5
is active. "Active" is read live from the governing-document registry: the
document is `confirmed_signed` **and** there is no open blocking reconciliation
issue. If the AP marks the document unconfirmed or reopens a conflict, those
modes go dark on the next `context`/`session` call with no deploy. As registered
in migration 0008, Amendment No. 5 is `confirmed_signed`, so the modes are live.

## Session API contract

All request/response bodies are JSON. `x-packet-key` is required on every
recording endpoint. Errors are `{ "ok": false, "error": "<code>" }`.

### `GET /api/recording/context`
Read-only snapshot for the mode picker.
```
→ { ok, server_time, project_date, project_day, uniform: "penalty-pink"|"standard-black",
    amendment5: { active, execution_status, open_blocking_issues },
    modes: { <mode>: boolean },
    active_consequence: { violation_number, project_date, failed_requirement, level,
                          corner_time_minutes, penalty_uniform_required,
                          completion_deadline, private_corrective_required } | null,
    daily_checklist: { weight, photos, video, deadline_local } }
```

### `POST /api/recording/session`
Issue a session: one challenge code, server time, per-session upload token, and
the mode's requirements read from the live record.
```
← { mode, client_meta?, level_minutes? }
→ { ok, session_id, challenge_code, code_expires_at, server_time, upload_token,
    upload_part_bytes, project_date, project_day,
    requirements: { uniform, capture, ...mode-specific (angles, corner_time_minutes,
                    acknowledgment_seconds, script[], violation_number, level, framing) },
    components: [ { kind, scope: "public"|"private-ap" } ] }
```
The challenge code expires 10 minutes to first frame and is single-use. The
acknowledgment `script` is generated from the violation record — never free-typed.

### `POST /api/recording/event`
Session-state transitions. `{ session_id, upload_token, event }`.
- `recording-started` — consumes the code (rejects if expired/already used), moves to `recording`.
- `take-incomplete` — pause/stop/app-switch ended the take; the partial is filed as incomplete evidence.
- `safety-stop` — `{ reason }`; ends immediately, marks `safety-stop-pending-review`, opens an AP safety review, never declares a violation.

### `POST /api/recording/attest`
`{ session_id, upload_token, component_kind, sha256, bytes, duration_seconds?, client_meta? }`
→ `{ ok, attested_at }`. The server `attested_at` is the compliance time.
Idempotent for an identical hash; a `verified` component rejects re-attestation.

### `PUT /api/recording/upload?session=&component=&part=&of=`
Body is one ≤5 MB part; header `x-session-token` carries the upload token.
Existing parts are never overwritten (a duplicate is a no-op). `GET` with the
same query returns `{ received_parts }` so a reload resumes without re-sending.

### `POST /api/recording/upload/complete`
`{ session_id, upload_token, component_kind, total_parts }`. Verifies every part
landed, marks the component `uploaded`, and triggers the background verifier.
A packet/component is FILED only when bytes land; compliance time still counts
from the attestation stamp.

### `POST /api/recording/location`
`{ session_id, upload_token, lat, lng, accuracy, label }` → private AP evidence
only, never public.

### `GET /media/captures/:session/:kind`
Streams a verified, public-scope component. Anything private-scope or not yet
verified returns 404 — private media is structurally unreachable here because
the function reads only the public blob store.

### `GET`/`POST /api/ap/capture-review` (AP_KEY)
`GET` returns sessions, components, and the verification-event log. `POST`
`{ session_id, component_kind, outcome: "pass"|"fail", reason }` records an
append-only `ap-override` event and sets the resulting status. Every override is
logged with decision, date, reason, and resulting status (§3.6).

## Verification pipeline (§4)

Order, per component, in `recording-verify-background`:

1. **Hard gates (fail = return for correction, defect named):** received hash ==
   attested hash; challenge code activated within its window; duration meets the
   requirement (corner time by level, ack ≥ the statement window, inspection ≥
   the guided sequence).
2. **AI review (Claude, `claude-opus-5` by default):** the overlay code legible
   and matching; correct uniform (opaque full coverage — black standard / pink
   penalty); pose and required angles present; framing (full body + corner for
   corner time, face visible for identity); scale readable and consistent with
   the logged weight. Videos are reviewed from the burned-in frame strip
   (≤16 sampled frames); stills are reviewed directly. Output is a strict
   JSON-schema verdict.
3. **On AI/API failure → flagged for AP review, never a silent pass.**

A failed technical check never raises the consequence level or creates a new
violation (§3.4). Every result is logged permanently with model, prompt version,
and evidence pointers; the AP can override any result.

## Safety and privacy invariants

- Safety stop is visible during every take, ends it immediately, never declares
  a violation, and always opens an AP safety review (§5.2).
- Corner-time duration is hard-capped at 30 minutes in `lib/recording.mts`; the
  §5.1 prohibited list is required by no mode.
- Corrective-session and location components are `private-ap` scope: they go to
  a separate blob store that no public function reads, so they are unreachable
  from any public URL (Amendment No. 4; §1.5).
- Meal photos are `private-ap`: the unverified Sheet row that once labeled them
  "Amendment No. 1 — Evening Meal Photograph" was removed, so no signed rule
  authorizes publishing them.
- Server time only for deadlines; the device clock is never trusted.

## Configuration (secret store only — never committed)

- `PACKET_KEY` — capture key issued to the participant's browser.
- `AP_KEY` — AP review/override key (already used by `ap-violation-decisions`).
- `ANTHROPIC_API_KEY` — the AI verification layer.
- `RA_VERIFY_MODEL` — optional model override (default `claude-opus-5`).
- ElevenLabs key — optional, browser-local only (never sent to the backend);
  browser speech synthesis is the fallback.

Media is stored in Netlify Blobs: `public-captures` (published after
verification) and `private-captures` (AP-only). Provisioned automatically by
`@netlify/blobs`.

## Acceptance tests (spec §7)

Run on a real phone; record the result and date next to each item.

- [ ] Full daily packet end-to-end: session → capture → attest → auto-upload → published, zero manual steps.
- [ ] Violation resolution: one code, two files (acknowledgment + corner time), both published in full, statuses flip to Verified.
- [ ] Kill the page mid-upload → reload → upload resumes and completes.
- [ ] Airplane mode after capture → restore → queued upload lands, filed against the original attestation time.
- [ ] Deliberately bad submission (wrong code / short duration / black unitard during a penalty period) → AI names the exact defect, allows a corrected retake, no level increase.
- [ ] Safety stop mid-corner-time → no violation, AP review item created.
- [ ] Attestation hash matches an independent `shasum -a 256` of the downloaded file.
- [ ] Corrective-session file is unreachable from any public URL (probe `/media/captures/<id>/corrective-session-video` → 404).
- [ ] Expired/reused challenge code rejected.
- [ ] `PACKET_KEY` cannot modify or delete any existing record (probe it).
