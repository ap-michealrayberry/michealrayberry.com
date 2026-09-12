# Edition 2 deploy set — fresh start, Day 1 = August 31, 2026

Supersedes push-2026-08-29/ (all of its fixes are included here).
Replace these files in ap-michealrayberry/michealrayberry.com@main:

- site.template.html (the former index.html — SOURCE ONLY, served as 404),
  scripts/static-site.mjs (renders it to static HTML at build), record.js,
  unsw.js, live.js, boot.js, llms.txt, manifest.webmanifest, _redirects,
  .gitignore, 404.html
- DELETE index.html from the repo — the build now generates it (and
  dashboard/, penalties/, milestones/, uniform/, updates/, about/,
  agreement/ index.html files) from site.template.html with the record
  filled in. Zero {{ }} placeholders in served HTML; JS only enhances
  (record.js refreshes counters, live.js runs the supervision console,
  unsw.js unregisters the old service worker).
- assistant/file/index.html (Supervision mode button + panel)
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
- Uniform: collar REMOVED (Aug 31); footed/no-footwear wording REMOVED
  (Sept 1) — the uniform is stated simply as a plain black unitard.
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

## §4.1 uniform wording (revised Sept 12 — COLLAR RESTORED)

Sept 12 user ruling: the plain collar returns to §4.1 for every official
recording (uniform page Requirement 2, positions attire, corrections
standard, About, llms, preflight row "black unitard · collar"). Amend §4.1
at co-signing: "a plain black unitard and a plain collar".

Earlier (Sept 1) the uniform was stated everywhere as "a plain black unitard" — the
footed/no-footwear enumeration was removed as unnecessary. Applied to:
uniform page, positions attire/camera rows, corner-time standard, corrective voice
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

## §3.4 Evening Supervision — ADDED Sept 12 (user ruling; needs co-signature)

Draft clause for the agreement (site, Code.gs, File tool, /live all built):

> §3.4 Evening Supervision. On the evening preceding each scheduled
> workday — ordinarily Sunday through Thursday — Micheal Ray Berry
> completes a fixed-camera Evening Supervision session, 6:00–10:00 PM
> Eastern, broadcast live on the Official Platform and filed to the record
> by 10:20 PM. Full project uniform including the collar; camera fixed and
> not repositioned; normal evening activity continues; water only; dinner
> a healthy home-cooked meal with yogurt for dessert, nothing outside it;
> monitored areas orderly before the session; the Daily Compliance Packet
> remains due within the window; bathrooms, changing, work information,
> private communications, and non-consenting visitors stay off camera.
> Authorized exceptions, each entered on the record with its reason by the
> Accountability Partner: work-schedule conflict, travel, illness,
> emergency, a non-consenting person present, technical failure outside
> reasonable control. Discomfort, tiredness, preference for privacy, or a
> wish to order food are not exceptions. A session not filed by 10:20 PM is
> MISSED; a MISSED session is a Violation Event under §7, declared
> automatically, answered under §8; completing a later session never
> erases it. Effective Sunday, 13 September 2026, upon co-signature.

Machinery: Sheet tab **Supervision** (date · required · status · start ·
end · stream_url · note; auto-created on first use — run setup() after
pasting Code.gs for the 22:20 trigger). File tool → Supervision mode files
the YouTube archive link (ytfiled kind 'supervision' → COMPLETED).
supervisionNightlyCheck at 22:20 ET rules MISSED + Violation Log row.
AP: MRB menu → "Supervision · mark tonight EXCEPTION". /live is the
console (live.js computes LIVE/OFFLINE, schedule, countdown; publisher
renders the record). Homepage shows a live bar when a session is on.
OBS → YouTube Live (channel UCi_0KqZjgbRUuLVAM5CmStQ); enable Live in
YouTube Studio ≥24 h before Sept 13.

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

## §5.4 Weekly Review — corner period REMOVED (Sept 7)

The no-loss corner period is struck. The Weekly Review is the week's
figures read from the Official Record to camera, plus the assessment.
No consequence attaches to a week without loss. (Never co-signed.)

## §4.2 Correction Uniform — REMOVED (Sept 1)

All sessions are recorded in the §4.1 black uniform; strike §4.2 from the
signed agreement at co-signing. The corrective preflight confirms the black
uniform, which is now the standard for every session.

## Career-safe sweep 2 (Aug 30, later — user directive)

"Submissive" removed sitewide; FetLife link and sameAs references removed
entirely; collar REMOVED entirely (Aug 31 — superseding the earlier
titanium-collar rulings). Voice scripts say only "full project uniform
clearly visible" — the uniform is defined once on /uniform (unitard +
no footwear) and scripts don't enumerate it. Preflight row: "black unitard". Consent inventory drops "submissive status". Status
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
