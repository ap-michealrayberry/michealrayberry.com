# Source-of-record cutover

## Authority

Netlify Database is the operational source of record. Google Sheets is a read-only migration and historical reference. Signed governing documents remain the authority for rules.

## Public read paths

Changing public facts must come from these APIs:

- `/api/public/progress`
- `/api/public/daily-records`
- `/api/public/violations`
- `/api/public/status`

Canonical human-readable pages are `/progress/`, `/daily-records/`, `/daily/`, `/violations/`, and `/project-status/`.

## Prohibited production behavior

- The homepage must not present a second Sheets-backed weigh-in ledger.
- The verification interface must not treat Sheets as current authority.
- The Recording Assistant must not use Sheets to determine current project facts.
- The SEO publisher must not regenerate current daily records from Google Sheets.
- A failed data fetch must fail closed and must never silently delete a previously published day.
- Redirect-only aliases and API endpoints must not be represented as canonical content pages in the static sitemap.

## Publication integrity

Every published day, including a documentation failure, must be present in:

1. `daily/published.json`
2. `daily/index.html`
3. `sitemap-daily.xml`
4. a manifest JSON file
5. a SHA-256 checksum file

Day 11 and Day 12 were restored to these registries on 2026-08-01. Their manifests intentionally describe the absence of required media rather than fabricating evidence.

## Remaining cutover work

Before this PR leaves draft status:

- replace the homepage Dashboard action with `/progress/`
- replace remaining live `gviz` reads with Netlify public APIs
- retire the scheduled Sheets-driven SEO publisher or rewrite it to use Netlify APIs
- resolve the Apps Script deployment ID before retaining any write path
- update `AP-BRIEFING.md` and retire the unimplemented Astro ADR
- standardize public contact language on `ap@michealrayberry.com`

These are release blockers, not optional cleanup.
