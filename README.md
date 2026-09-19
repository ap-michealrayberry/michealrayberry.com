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
   directory `dist`. Root directory blank. (`wrangler.toml` also declares
   `pages_build_output_dir = "dist"`.)
4. **Variables & Secrets (Production)** — same names as on Netlify plus four:
   NODE_VERSION=24 · SITE_ORIGIN=https://michealrayberry.com ·
   WEIGHINS_CSV, VIOLATION_CSV, ATTESTATION_CSV, CONFIRMATIONS_CSV,
   SUPERVISION_CSV, UPDATES_CSV, SITE_STATE_CSV · ATTESTATION_SEAL_SECRET
   (secret) · **TURNSTILE_SITE_KEY** · **TURNSTILE_SECRET** (secret) ·
   **OBSERVER_SECRET** (secret — same value as `setObserverSecret()` in
   Code.gs) · **APPS_SCRIPT_URL** (the /exec URL).
5. **Deploy** → green → check the `*.pages.dev` URL: home, /daily/, one day,
   /observer/ (Turnstile widget renders), /assistant/ opens in demo mode.
6. **Custom domains**: Pages → Custom domains → add michealrayberry.com and
   www.michealrayberry.com (Cloudflare writes the DNS records itself;
   remove any leftover Netlify A/CNAME).
7. **Deploy hook**: Pages → Settings → Builds → Deploy hooks → Add (main) →
   copy URL → Code.gs `setBuildHook('<url>')` → `triggerDeploy()` logs OK.
8. **Typo domain**: add michaelrayberry.com to Cloudflare the same way, then
   Rules → Redirect Rules → dynamic 301 to
   `concat("https://michealrayberry.com", http.request.uri.path)`.
9. **Verify**, then delete the Netlify site.

## Observer submissions
`functions/observer.js` (Pages Function, POST /observer) → honeypot →
Turnstile siteverify → JSON to Apps Script action `observer` with
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
