# Micheal Ray Berry — compatible website update

This is the smaller update for the existing GitHub → Netlify website.
It replaces the earlier full-site-sweep proposal. It does not require an
Apps Script deployment, spreadsheet migration, new data service, new feed URLs,
or new signing keys. The existing Apps Script and recording/filing JavaScript
are unchanged from GitHub main at `58fa9dcf1493a8129efc0647069a111420872020`.

## Install in four steps

1. Extract `michealrayberry-simple-update.zip`. Open its `UPLOAD` folder.
2. In GitHub, open `ap-michealrayberry/michealrayberry.com`. Create a branch
   called `simple-site-update` from `main`. Choose **Add file → Upload files**.
   Upload everything **inside UPLOAD** to the repository root and commit it to
   that branch. `package.json` and `netlify.toml` must be at the top level.
   Upload the files, not the ZIP and not an enclosing UPLOAD folder.
3. Open a pull request into `main`. Review the Netlify deploy preview when it
   is available: homepage, Dashboard, Daily Record, one dated entry, Share,
   Supervision, and the assistant/File screen. Check at phone width too.
   Use demonstration mode for the assistant check; do not file a test record.
   If your project does not create previews, run `npm ci`, `npm test`, and
   `npm run build` in a checkout with Node 24 before merging.
4. Merge the pull request. The existing Netlify integration builds and
   publishes automatically. Confirm the production deploy succeeds and check
   the homepage and Dashboard. If the build fails, Netlify retains the last
   successful deployment; inspect the build log before retrying.

There are no manual deletions. The included Netlify configuration automatically
publishes the generated `dist` folder. Old source files can remain in GitHub;
they are excluded from the deployed website. Keep existing environment
variables, Apps Script properties, Google permissions, device keys, and build
hooks as they are. Do not run `setup()` for this update.

This package uses the code baseline above and preserves later daily photo uploads. If the earlier full-sweep
backend was separately installed, do not use this package as a backend rollback.

## Rollback

For an immediate website rollback, open the project in Netlify → **Deploys**,
select the successful production deploy immediately before this update, and
choose **Publish Deploy**. Then open the merged GitHub pull request, choose
**Revert**, and merge the resulting revert pull request so future deployments
use the previous code. There is no database or Apps Script rollback.

Official instructions: [GitHub uploads](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository),
[GitHub pull-request reverts](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/reverting-a-pull-request),
[Netlify rollbacks](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#rollbacks).

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

Use Node 24. Netlify selects it automatically from `netlify.toml`.

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
been published to GitHub or Netlify. Real recording, Google permissions,
and observer form submissions have not been exercised during this update.

Automated builds against the existing feeds passed internal-link, photo-metadata,
and published-manifest checks. Desktop/mobile visual browser QA was not completed
because the browser download was unavailable.
The deploy-preview check in step 3 remains part of the installation review.
