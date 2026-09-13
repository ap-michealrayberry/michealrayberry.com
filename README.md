## Hosting: Netlify (Cloudflare Pages move ON HOLD — Sept 13)
- Netlify deploys straight from the GitHub repo (main). netlify.toml:
  npm run build · publish "." · Node 20 · SITE_ORIGIN.
- Build hook: Site configuration → Build & deploy → Build hooks → Add (main)
  → Code.gs setBuildHook(url). Photo commits carry [skip ci].
- Typo domain michaelrayberry.com: Netlify domain alias + host-based 301!
  rules at the top of _redirects.
- DNS stays where it is (A → 75.2.60.5, www CNAME → the Netlify site).

## OBS overlay (Evening Supervision) — /live/overlay.html
- OBS → Sources → + → Browser. URL https://michealrayberry.com/live/overlay.html
  Width 1920 · Height 1080 · FPS 30 · tick "Shutdown source when not visible".
  Optional params: ?start=18:00&end=22:00, ?demo=1, ?state=live|scheduled|
  interrupted (preview only), ?rules=0 (hide the rule band), ?every=12
  (seconds per rule).
- Bottom bar (full width): record figures (Day · Weight · Goal · Open) |
  one rule at a time, cross-fading every 12 s through the ten published
  Evening Supervision rules | michealrayberry.com/live. No scrolling ticker
  (unreadable on Shorts/phones); one line, then the next.
- Layout: identity (top-left: MICHEAL RAY BERRY · UNDER PUBLIC
  ACCOUNTABILITY) over the status box; clock top-right; stamp bottom-left
  (Day · weight · goal · open violations); URL bottom-right. Centre clear.
- Status is tied to OBS, not the clock: gray "Supervision scheduled" until
  OBS reports the stream active → red pulsing "Under supervision — Live"
  with elapsed session time (+ closes-in) → amber "Feed interrupted" if the
  stream drops inside the window → full-frame "SESSION CLOSED" at 10 PM.
  Never shows red outside an actual broadcast.
- Figures read the public sheet every 5 min; day number from Aug 31.
  Noindex via _headers; not linked from the site.
- OBS scene recipe: Scene "Evening Supervision" = Video Capture Device
  (camera, 1920×1080, fixed) + this Browser source on top. Mic: Settings →
  Audio → Mic/Aux = Disabled (hard off). Stream: YouTube, key from the
  channel's Live Control Room; Recording: also record locally as backup.

## Observer submissions (/observer/) — Netlify Forms
- forms.html at repo root is the detection twin; Netlify registers "observer"
  from it (served as 404 via _redirects).
- Netlify → Site → Forms → Form notifications → Email → ap@michealrayberry.com.
  Optional: Akismet spam filtering under Forms settings.
- Submissions never publish; the AP quotes only when "quotable" was checked.
- PARKED for the Cloudflare move: functions/observer.js stays in the repo,
  inert on Netlify. To switch: form action="/observer", Turnstile widget +
  CSP origins, env TURNSTILE_SITE_KEY / TURNSTILE_SECRET / OBSERVER_SECRET /
  APPS_SCRIPT_URL; Code.gs already has the Observer tab + 'observer' action.
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

## §4.1 uniform wording (Sept 13 — COLLAR REMOVED AGAIN, final)

Sept 13 user ruling: "remove collar entirely" — the uniform is a plain black
unitard only; §4.1 at co-signing: "a plain black unitard". The Sept 12 restore
below is history.

Sept 12 (superseded): the plain collar returned to §4.1 for every official
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
is the same content the record publishes). Republication elsewhere does not alter
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
> by 10:20 PM. Full project uniform; camera fixed and
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

## §4.2 Correction Uniform — RESTORED (Sept 12, user text; collar dropped Sept 13)

Pink unitard for recorded corrective sessions; uniform page
Requirement 3, corrections standard row, corrective preflight row. Amend
§4.2 at co-signing. (The Sept 1 removal below is history.)

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
