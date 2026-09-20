## Packet validator + signed receipts (Sept 20)
- nightlyComplianceCheck is fail-closed: weight, FOUR distinct photos, video,
  and a VALID sealed attestation (seal re-derived) — each must have reached
  the record before 22:00 ET by server time (hidden 'Received' tab stamps
  first arrival per component). Any read error = not compliant.
- Receipts tab: one sealed row per day (component times, verdict, missing,
  AP decision, corrections, HMAC seal). verifyReceipt(date) re-derives it.
  Console Accept/Reject/Waive append to the receipt.
- Publisher: optional RECEIPTS_CSV env (published view of the Receipts tab)
  renders a "Packet receipt" block on each day page and adds it to the manifest.

## Photos: originals → R2, public copies → repo
- The assistant PUTs the four angle JPEGs to the private bucket (keys minted by
  /api/media-init alongside the video); Weigh-ins D–G receive 'originals/…'
  keys. githubMirrorPhotos (hourly, Code.gs) fetches those from R2 via
  r2Get_ (needs setCloudflareMedia + setR2Keys) — Drive URLs still work for
  older rows — and commits the copies to photos/YYYY/MM/DD/ as before, then
  repoints the cell to the public URL. The build reads repo files only.
  Drive relay stays as a redundant backup for now.

## AP console → ap.michealrayberry.com (Cloudflare Access)
The console left the public site. It lives in ap-site/ as a SEPARATE Pages
project (root directory ap-site), whole-host behind Cloudflare Access (one
allowed email, Google sign-in w/ MFA or email OTP). The console stores no
key: ap-site/functions/api/ap.js verifies the Access identity JWT and relays
to Apps Script with AP_KEY from encrypted secrets. Every action is stamped
(actor / IP / UA / op / args / result) on the sheet's AP Actions tab; guarded
ops need the confirmation sheet (relay enforces confirmed:true). /ap on the
public site 301s to the new host. Setup steps: ap-site/README.md.

## Video: Cloudflare Stream (player) + R2 (originals) + YouTube (mirror)
- Stream is the site's player wherever a row has stream_uid; the YouTube URL
  becomes an "Also on YouTube" link. R2 (private bucket mrb-evidence) holds the
  untouched original under r2_key; it is never served as a player.
- Pages env (Production): STREAM_CUSTOMER_CODE (customer-xxxx from Stream →
  Settings; the publisher needs it to build embed/HLS/thumbnail URLs),
  CF_ACCOUNT_ID, STREAM_API_TOKEN (Stream:Edit), R2_ACCOUNT_ID, R2_BUCKET,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (object write on mrb-evidence only).
- Assistant → POST /api/media-init (functions/api/media-init.js; device key
  verified via Apps Script action keycheck) → presigned R2 PUT + Stream
  direct-upload URL → both PUT from the phone → stream_uid/r2_key ride the
  packet finalize into Weigh-ins J/K. Drive backup continues as a third copy.
- Sheet columns: Weigh-ins J stream_uid, K r2_key; Violation Log J stream_uid.
  Code.gs patch: apps-script-patch-stream-r2.gs (keycheck route,
  handlePacketMediaFields, setCloudflareMedia/setR2Keys, backfill functions).
- Backfill Days 1–N: run backfillStreamFromDrive() repeatedly (one row per
  run), then backfillR2FromDrive() likewise. Turn on Stream auto-captions
  (Stream → Settings → Captions: English) — the build fetches /captions/en
  and publishes the transcript on each /video/ page + VideoObject.transcript.
- Cost: ~$5/mo Stream at current volume; R2 < $1.

# Micheal Ray Berry — michealrayberry.com

Static public record, built from the Google Sheet by `scripts/publish.mjs`
into `dist/`, hosted on **Cloudflare Pages**. DNS at Cloudflare; registrar
Porkbun; email via Porkbun; the record brain is the Google Sheet + Apps Script.

## Cloudflare Pages — one-time setup (AP account)

1. **Add the domain**: Cloudflare → Add a domain → michealrayberry.com → Free.
   Or, from Porkbun: Domain → "Your Cloudflare" → Connect (copies the zone).
   Verify the imported records: A/CNAME for the site, MX + SPF for Porkbun
   mail. Nameservers move to Cloudflare's two.
2. **Turnstile**: Cloudflare → Turnstile → Add widget → hostname
   michealrayberry.com, Managed → copy Site key + Secret key.
3. **Pages project**: Workers & Pages → Create → Pages → Connect to Git →
   this repo, branch `main`. Build command `npm run build`. Build output
   directory `dist`. Root directory blank. Do NOT add a
   `wrangler.toml` — when present, Pages reads build config from it and
   drops the dashboard environment variables (feed URLs), failing the build.
4. **Variables & Secrets (Production)** — same names as on Netlify plus four:
   NODE_VERSION=24 · SITE_ORIGIN=https://michealrayberry.com ·
   WEIGHINS_CSV, VIOLATION_CSV, ATTESTATION_CSV, CONFIRMATIONS_CSV,
   SUPERVISION_CSV, UPDATES_CSV, SITE_STATE_CSV · ATTESTATION_SEAL_SECRET
   (secret) · **TURNSTILE_SITE_KEY** · **TURNSTILE_SECRET** (secret) ·
   **OBSERVER_SECRET** (secret — same value as `setObserverSecret()` in
   Code.gs) · **APPS_SCRIPT_URL** (the /exec URL).
5. **Deploy** → green → check the `*.pages.dev` URL: home, /daily/, one day,
   /report/ (Turnstile widget renders), /assistant/ opens in demo mode.
6. **Custom domains**: Pages → Custom domains → add michealrayberry.com and
   www.michealrayberry.com (Cloudflare writes the DNS records itself;
   remove any leftover Netlify A/CNAME).
7. **Deploy hook**: Pages → Settings → Builds → Deploy hooks → Add (main) →
   copy URL → Code.gs `setBuildHook('<url>')` → `triggerDeploy()` logs OK.
8. **Typo domain**: add michaelrayberry.com to Cloudflare the same way, then
   Rules → Redirect Rules → dynamic 301 to
   `concat("https://michealrayberry.com", http.request.uri.path)`.
9. **Verify**, then delete the Netlify site.

## Report a Record Issue (/report/, formerly /observer/)
`functions/report.js` → `functions/observer.js` (Pages Function, POST /report) → honeypot →
Turnstile siteverify → JSON (type, record_ref, message, source_url, name, email) to Apps Script action `observer` with
OBSERVER_SECRET → Observer tab + mail to ap@. Nothing publishes from it.
The form falls back to Cloudflare's always-pass Turnstile test key until
TURNSTILE_SITE_KEY is set.

## Rollback

For an immediate website rollback, open the project in Cloudflare Pages → the project → **Deployments** → the last good production deployment → **Rollback to this deployment**. Then open the merged GitHub pull request, choose
**Revert**, and merge the resulting revert pull request so future deployments
use the previous code. There is no database or Apps Script rollback.

Official instructions: [GitHub uploads](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository),
[GitHub pull-request reverts](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/reverting-a-pull-request),
[Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/).

## What changes

- Dashboard photographs receive actual image URLs. The weight chart scales
  to recorded values and shows matching axis labels.
- Public pages have consistent canonical links, functioning navigation,
  keyboard skip links, visible focus, reduced-motion support, and shared
  mobile layout fixes. Old `/penalties` and `/reference` links still work.
- Official photos have responsive sizes. Published photo copies are stripped
  of embedded metadata. Existing dated photo URLs remain available.
- Report-card generation fixes undefined values and correctly displays gains
  above the declared start. Missing report cards now fail the build.
- A corrected entry stays unresolved until the existing AP record marks it
  resolved. The home page only says all packet files are present when the
  recorded weight, video URL, and all four local photographs are present.
  This is a file-presence display, not a new server-side acceptance protocol.
- Public counters, the OBS overlay, and file comparisons read filtered files
  produced by the existing build. The public pages no longer read entire
  workbook tabs directly. Source code, operations notes, extra sheet columns,
  supervision exception notes, and attestation seals are not deployed.
- `/verify/` compares hashes against legacy accepted `VALID` log entries,
  without requiring a new seal format or secret. It computes hashes locally
  and describes a match accurately as a byte comparison.
- Root cache cleanup preserves the assistant's service worker and offline
  cache. The missing File screen stylesheet is included.
- The supervision page distinguishes a scheduled window from a confirmed
  broadcast. The player and OBS integration remain available.

## Publishing and data freshness

The normal build still reads the existing Weigh-ins, Violation Log,
Attestation, Site State, Supervision, and Updates feeds. Existing optional URL
overrides still work. The first two feeds are required; the other four retain
their existing optional behavior. There is no new Confirmations feed.

Public values are snapshots of the most recent successful deployment.
The public counter script checks for a newer snapshot every five minutes;
a sheet edit appears after the next successful build. Existing scheduled
builds and AP Publish/build hooks continue to be the update mechanism.

A filtered website export does not change the underlying Google workbook's
sharing permissions or remove values from older GitHub commits and previous
deployments. This update does not claim to repair historical exposure or
change the existing assistant's direct backend access.

The repository's current project settings are preserved: the sheet-driven
start date (fallback August 31, 2026), declared 340 lb start, and 200 lb goal.
This code update does not execute or amend the accountability agreement.

## Developer checks

Use Node 24. Set NODE_VERSION=24 in the Pages environment.

```sh
npm ci
npm test
npm run build
```

`npm test` runs a complete isolated build with the current workbook columns,
a legacy VALID attestation, an INVALID row, private extra columns, and an AP
review still pending. It checks that private fields stay out of the website,
legacy data works, the photo links and hashes match, and a failed build leaves
the last completed output intact.

`npm run build` checks syntax, fetches the existing feeds, generates pages,
stages public assets in `dist`, and checks internal targets, image metadata,
and manifest hashes. No new environment variables are required.

IndexNow submission remains available as `npm run indexnow` after production
publication; it is no longer sent while a build is still in progress.

The package was built against the existing Google Sheets feeds. It has not
been published to GitHub or Cloudflare Pages. Real recording, Google permissions,
and observer form submissions have not been exercised during this update.

Automated builds against the existing feeds passed internal-link, photo-metadata,
and published-manifest checks. Desktop/mobile visual browser QA was not completed
because the browser download was unavailable.
The deploy-preview check in step 3 remains part of the installation review.
