# Edition 2 deploy set — fresh start, Day 1 = August 31, 2026

Supersedes push-2026-08-29/ (all of its fixes are included here).
Replace these files in ap-michealrayberry/michealrayberry.com@main:

- index.html, boot.js, llms.txt, manifest.webmanifest, _redirects, .gitignore, 404.html
- scripts/publish.mjs
- assistant/index.html, assistant/app.js,
  assistant/js/05-api.js, assistant/js/12-scripts.js,
  assistant/js/14-upload-queue.js, assistant/js/18-app.js,
  assistant/file/file.js

Also DELETE voice-pack.json from the repo root.

## ⚠ Gate — do these BEFORE pushing (one-way door)

1. **Edition 2 of the agreement must be co-signed** by Micheal and the AP.
   The site names the project a voluntary adult accountability
   arrangement on every page; nothing here should be public before both
   signatures exist. (Full agreement text is intentionally offline on the
   site until then — the /agreement page says so.)
2. **Consent Confirmation re-recorded** against Edition 2, filed via the
   assistant (Confirmations tab).
3. **AP re-consent**: the AP is publicly administering an adult-framed
   record; they must see this set and opt in.

## Deploy order

1. Paste apps-script/Code.gs into Apps Script, deploy new version
   (same URL). Assistant now POSTs challenge/ping; GET stays as fallback.
2. Sheet → Site State: set `start_date` = 2026-08-31. Leave
   `prior_attempt_note` UNSET — the Aug 13–29 run is reframed as the
   system test; nothing before Day 1 is on the record. Also clear or
   annotate the pre-Aug-31 Violation Log rows (declared during testing
   under Edition 1); any left render as "System test".
3. Push the files above; delete voice-pack.json. Build runs the publisher;
   a failed publish now fails the deploy (last good deploy stays live).
4. Post an Updates entry: Edition 2 executed, fresh start Aug 31.
5. The 336.7 lb figure now appears only in system-test contexts; the
   record's first weigh-in is Day 1, August 31.

## What Edition 2 changes on the site

- Entry NOTICE banner removed (user, Aug 30); its sentence lives in the
  footer instead: "A voluntary accountability arrangement between adults,
  documented with written consent and defined limits." ("adult" kept only
  as "between adults" — states capacity, not adult content)
- Status strip: "Under agreement · Savannah, Georgia"
- Home: "Micheal Ray Berry is under public accountability" hero; unresolved
  failures counter FIRST (red), before day/weight; pre-Day-1 run reframed as system test
- Uniform: collar REMOVED entirely (user directive Aug 31) — uniform is
  footed black unitard + no footwear only. Standalone "No footwear" requirement card
  removed per user — footed/no-shoes detail lives in the unitard
  description and attire rows only.
- /agreement: Edition 2 summary + Consented / Hard-limits grid; full text
  returns when co-signed
- Violation pages: noindex (public, not promoted); SPA notice banner reads
  FAILED — CORRECTION REQUIRED
- Metadata/JSON-LD/llms.txt: honest adult framing, rating=adult meta
- Start date sheet-driven everywhere (fallback now 2026-08-31); assistant
  week numbering moved to Aug 31

## Carried over from push-2026-08-29 (already in these files)

Sheet-driven start date; Google-Health pipeline removed (Withings only);
publisher: jsonLd escaping, ET dates, 30 s timeouts, fail-on-error builds,
restart-safe zero-records guard, cornerTimePage demo crash fix, /violations/
index, week-numbering fixes, gap-day links; assistant: POST challenge/ping,
upload-queue lock/backoff/seal idempotency, filedUrl fix; boot.js escaping;
336.7 Day-1 correction; full contract text offline.

## §8.2 amendment — corrective postings are PUBLIC (user directive Aug 30)

"Exposure is accountability" ruling: corrective sessions are posted PUBLICLY
to @michealrayberry (not unlisted) and embedded beside the entry. Edition 2
full text must say "posted publicly"; the earlier unlisted amendment is
superseded. Applied to: consent script, File tool YT description, llms.txt.
Also removed sitewide: rating=adult meta, violation-page noindex — the
whole record indexes fully.

## §4.1 amendment — no footwear (user directive Aug 30)

Edition 2 uniform: plain black FOOTED unitard, NO shoes on any
official recording ("one unbroken line, indoors, as kept"). §4.2 correction
uniform likewise pink, no footwear. System-test photos show shoes;
the visible break marks the edition change. Applied to: uniform page,
positions attire/camera rows, corner-time standard, corrective voice
script, assistant preflight confirm row, llms.txt.

## §10.2c — Republication by the Accountability Partner (user directive Aug 30)

"10.2c Republication on the Accountability Partner's own platforms.
Notwithstanding the purpose limits of §10.2a, Micheal grants the
Accountability Partner the right to republish PUBLIC Project content —
material already published on the official record or the official channel —
on platforms the Partner operates or controls, with or without
attribution, for the Project's duration and permanently for content
published while it was in force.
This right covers only content already public on the record: it never
extends to verification photographs, unpublished takes, drafts, personal
data beyond what the record itself carries, or any material excluded by
§10.4 (no nudity, full coverage in the uniform — the content republished
is the same SFW content the record publishes). Republication elsewhere does not alter
the record: michealrayberry.com remains the only official record and its
register stays as published. §8.6 (safety takedown) continues to bind the
Partner for dangerous third-party reuse; it does not restrict republication
authorized by this section."

Consent script updated to state this on camera. The record itself still
never names or links the Partner's platforms (register, not secrecy).

## Structure Notice — Evening Accountability Stream (§3.1, to co-sign)

Binds only once posted to Updates AND co-signed (§3.1). Full text:

1. Every Monday, 6:00–10:00 PM ET, a live public stream on the official
   channel: one fixed camera (kitchen/dining framing only — no door, no
   windows, no screens), full project uniform throughout, microphone off.
   Nothing is performed to the camera; the window documents presence, the
   home-prepared evening meal, and water only.
2. The weekly review runs live on the stream, including any corner period
   it requires. The Daily Compliance Packet is filed within the window.
3. Each weekly review showing no net loss adds one night, from the
   Sunday–Thursday set (work-night evenings), to a maximum of five.
   Each week with a net loss removes one added night. Reaching a
   milestone (320/300/275/250/225/200) resets the requirement to
   Monday only.
   The requirement never falls below one night. Added nights carry the
   same rules but not a second weekly review.
4. A missed or cut stream is a Violation Event under §7 (documented
   technical failure per §9 excepted).
5. The stream archive is linked beside that week's entry on the record.

## Live endpoints (deployed Aug 31)

- Apps Script /exec: https://script.google.com/macros/s/AKfycbziCyE3mnmUGZypHRiu1A6wK1n2EIRj2_U3czGc3JQS4L3ZXMxRJCINyMFDYC5bZ9vQ/exec
  (prefilled as the default in assistant/app.js + file/file.js — the setup
  panel only needs the device key; a pasted URL still overrides)
- Public photos folder: https://drive.google.com/drive/folders/1bp6fbEgReD_si5tKCigqYFgbK29mTVQl
  (shared with Micheal as Editor; per-kind video subfolders are created on
  first upload)
- Record spreadsheet: 1sEL0SWIh4NnNji4XUAVVG4pQSZe7a0y3vDmvvLNV6wE (wired into index.html, publish.mjs, Code.gs)

## §14 consent inventory — draft language (user, Aug 30)

REWORDED Aug 31 (user): "the reputational exposure inherent in real-name
documentation of his body, missed requirements, rejected submissions,
corrective recordings, failed attempts, and any ending without verified
completion." The word "humiliation" and the separate "Acknowledged, not
consented — professional, social, or otherwise" item are REMOVED from the
site; the agreement full text should match. Weekly Position Training
(§3.3) and the KNEEL position are REMOVED entirely (Aug 31).

## §5.4 Weekly Review corner period — draft clause (user, Aug 30)

"5.4 Weekly Review; no-loss corner period. One Weekly Review is recorded
each calendar week: the week's figures are read from the Official Record
to camera. If the week's filed weights show no net loss, the Review
concludes with a fifteen-minute corner period in the recording, held to the
§8 corner standard. The period is fixed at fifteen minutes, is not a
Violation Event, does not escalate, and carries no filing beyond the
Review itself. §6.4/§9 medical override applies. Weight remains
incapable of constituting a Violation Event."

## §4.2 Correction Uniform — draft clause for Edition 2 full text

"4.2 Correction Uniform. Corrective sessions under §8 are recorded in the
correction uniform: a plain pink unitard of the same cut as §4.1, no footwear. The correction uniform is worn for corrective
sessions only; all daily and milestone documentation remains in the §4.1
black uniform so the photographic record stays comparable frame to frame.
Absence of any element of the correction uniform from a corrective recording
fails the verification standard under §8.2."

Site already reflects both: agreement summary bullet, Edition 2 consented
list, /positions/ training section, uniform page §4.2 block, /corner-time
uniform standard, penalties-view card. Follow-ups: Training tab in the sheet
(date, video, grade); assistant corrective preflight must confirm the PINK
unitard (currently confirms black) and the AP verifies pink until then.

## Career-safe sweep 2 (Aug 30, later — user directive)

"Submissive" removed sitewide; FetLife link and sameAs references removed
entirely; collar REMOVED entirely (Aug 31 — superseding the earlier
titanium-collar rulings). Voice scripts say only "full project uniform
clearly visible" — the uniform is defined once on /uniform (unitard +
no footwear) and scripts don't enumerate it. Preflight row: "footed
unitard · no shoes". Consent inventory drops "submissive status". Status
strip drops "Collared". Local AP section reworded to written-authority
register.

## Follow-ups (not in this set)

- First-principles sweep applied Aug 30: pre-Day-1 violation rows label as
  "System test" (no negative days, archived-day link gating), weight-loss → accountability phrasing in SEO/
  alt/JSON-LD, honest adult-framing FAQ answer.

- Day statuses "Presented / Accepted / Rejected / Correction Required" need
  a sheet-side status model — currently documented/incomplete/gap.
- Positions page: add the INSPECTION position + re-shoot standard photos in
  Edition 2 uniform on Day 1.
- New OG image (still shows system-test framing).
- Google Search Console recrawl after deploy.
