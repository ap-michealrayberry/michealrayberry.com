# Daily-record publishing pipeline

One pipeline, one source of truth. The spreadsheet is the *input*; the
normalized daily manifests in `manifests/` are the *authority*; every public
artifact is generated from the manifests and committed to GitHub, so the
repository and the deployed site can never silently disagree.

```
Google Sheet (public read-only CSV)
        │  scripts/sync-sheet.mjs        ← GitHub Actions "Sync daily record"
        ▼                                  (scheduled 22:15 ET + workflow_dispatch)
data/*.csv + data/sync-state.json          committed snapshots, source timestamp
        │  scripts/ingest.mjs             ← photo resolution, downloads, EXIF
        ▼                                  normalization, SHA-256, video checks
manifests/<date>.json  (schema v2)         one manifest per Project Day
        │  scripts/generate.mjs           ← deterministic, no network
        ▼
daily pages · /daily/ · daily/published.json · weeks · milestones ·
feed.xml · sitemaps · homepage record data
        │  scripts/validate.mjs           ← consistency proof; nonzero exit
        ▼                                  blocks the deploy
Cloudflare Pages build: npm ci && npm run build
```

## Rules the pipeline enforces

- **Header-name column parsing.** `data/weigh-ins.csv` must carry `date`,
  `weight_lb`, `note`, `photo_front`, `photo_left`, `photo_rear`,
  `photo_right`, `video` — absent or duplicated headers fail the run, as do
  duplicate rows for one Project Day (no guessing).
- **Photo resolution order** per position: manifest's own local file → repo
  photo matching exact day/date/position → the spreadsheet URL (downloaded
  in an explicit `--online` ingestion step; the response must really be an
  image, HTML login/error pages are rejected, the archival original is
  preserved under `photos/YYYY/MM/DD/`, SHA-256 recorded, responsive WebP
  variants generated). A Drive thumbnail URL is never a permanent image.
  If a remote photo cannot be ingested, the run stops naming the URLs.
- **Video verification.** HTTPS only; the sync run performs a byte-range GET
  and requires a `video/*` content type; self-hosted MP4s must answer byte
  ranges. Verified R2 URLs render in the HTML5 player — Drive previews are
  gone and are rejected by validation.
- **Partial records are published.** Every Project Day has a permanent page
  at its canonical URL. Partial pages show every verified filed item and
  name each missing component; they never claim absent media.
- **Evidence immutability.** Changing bytes under a published photo path
  fails ingestion and validation unless the change is explicitly listed in
  `data/approved-hash-changes.json` (`{"changes":[{"path","old","new"}]}`).
- **Time zone.** Project Day and deadline arithmetic run in
  `America/New_York` (10 PM ET deadline); UTC alone is never used.
- **Determinism.** All generated timestamps derive from
  `data/sync-state.json.as_of`; running `npm run generate` twice produces
  zero additional changes, and PR validation proves the committed output
  matches a fresh regeneration.
- **Failure blocks deploy.** `npm run build` exits nonzero on any publisher
  or validation failure; Cloudflare keeps the last good deployment online.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Offline: ingest from committed snapshots → generate → validate. Used by the Cloudflare build. |
| `npm run generate` | Ingest + generate only (deterministic; run twice to prove it). |
| `npm run validate-records` | Full consistency validation. Add `-- --remote` for live video checks. |
| `npm run sync` | Network: refresh sheet snapshots, ingest remote media, generate, validate with remote checks. Used by the sync workflow. |
| `npm run check-syntax` | `node --check` over every pipeline script. |

## Cloudflare Pages configuration (owner action)

- Build command: `npm ci && npm run build`
- Build output directory: `/` (repository root, unchanged)
- Remove any build setting or wrapper that ignores the publisher's exit code.
  The old publisher swallowed failures; the new one must be allowed to fail
  the build. A failed build leaves the previous deployment live.

## Repository settings (owner action)

- No secrets are required for the pipeline itself (the sheet is public
  read-only CSV; the built-in `GITHUB_TOKEN` opens sync PRs).
- Optional: `SYNC_TOKEN` — a fine-grained PAT (contents: read/write,
  pull-requests: read/write) if you want "Validate record" checks to run
  automatically on sync PRs; PRs opened with the default token do not
  trigger workflows (that is also the loop guard).
- Optional: `INDEXNOW_KEY` already lives as `indexnow-key.txt` (public by
  design of the IndexNow protocol).

## Rollback procedure

1. Revert the offending merge commit on `main`
   (`git revert -m 1 <merge-sha>`); Cloudflare redeploys the reverted tree.
2. Media rollback is automatic: originals under `photos/` are never
   overwritten (hash-guarded), so a revert restores exact prior bytes.
3. If a sync PR introduced bad data, close it and correct the spreadsheet;
   the next scheduled sync re-derives everything from the corrected sheet.
4. Manifest archaeology: prior v1 manifests are preserved under
   `manifests/archive/v1/`, and every status change is appended to each
   manifest's `history[]` — nothing is rewritten silently.
