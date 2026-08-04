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
sync PR  →  human review  →  merge to main
        │  Cloudflare Pages build: npm ci && npm run build   (deploys the site)
        ▼
GitHub Actions "Publish SEO record"        ← push to main (relevant paths)
        │  scripts/collect-changed-urls.mjs  changed public URLs from the merge
        ▼                                     diff → .seo-changed-urls.json (artifact)
        │  scripts/check-deployment.mjs       wait until production serves the
        ▼                                     merged content (cache-bust + marker)
        │  scripts/submit-indexnow.mjs        notify IndexNow; failure fails the
        ▼                                     run but leaves the site online
IndexNow  →  search engines recrawl the changed URLs
```

Two workflows, one direction. **Sync** (scheduled) only ever opens a
pull request — a human merges it. **Publish SEO record** runs *after* that
merge reaches `main`; it never generates or pushes a record, so an unreviewed
change can never publish itself, and search engines are only told about content
that is already live.

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

## Post-merge SEO publication (`Publish SEO record`)

The `publish-seo.yml` workflow runs on every push to `main` that touches a
publishing-relevant path, and via **Actions → Publish SEO record → Run
workflow** (`workflow_dispatch`). Its stages, in order:

1. **Checkout full history** (`fetch-depth: 0`) — the changed-URL calculation
   needs the before/after commits.
2. **Validate the merged tree** — `npm run check-syntax` and `npm run build`
   (ingest → generate → validate). An internally inconsistent record stops the
   run; there is no `continue-on-error`.
3. **Derive changed URLs** — `scripts/collect-changed-urls.mjs --base <before>
   --head <sha>` maps the merge diff to public URLs and writes
   `.seo-changed-urls.json`. `workflow_dispatch` (and first pushes) fall back to
   `HEAD~1` as the base.
4. **Upload the URL list** as the `seo-changed-urls` artifact for auditability.
5. **Wait for deployment** — `scripts/check-deployment.mjs` polls production
   with cache-busting queries until the latest canonical daily page returns 200
   **and its body contains its own canonical URL** (the marker), and
   `sitemap.xml` returns 200. A previous production version returns 200 without
   the marker, so it is never mistaken for a successful deploy. Bounded retries;
   a clear failure if the deploy can't be verified.
6. **Submit to IndexNow** — `scripts/submit-indexnow.mjs --input
   .seo-changed-urls.json`, only after deployment is verified.
7. **Publication summary** — commit, base, changed-URL count, deployment/IndexNow
   outcomes, and the submitted URLs are written to the job summary.

When the merge changed no public URLs (`.seo-changed-urls.json` is empty), the
deployment-wait and IndexNow steps are skipped and the run succeeds as a no-op.

### How changed URLs are derived

`git diff -M --name-status <base> <head>` → `scripts/lib/url-map.mjs` maps each
path: a daily page → its canonical URL; a manifest → its day page, `/daily/`,
`/feed.xml`, the daily/image/video sitemaps, its weekly page, and the milestone
pages; an original photo → its owning day page, `sitemap-images.xml`, the photo
URL, and (for the front/thumbnail) `sitemap-videos.xml`; a responsive variant →
its owning day page and `sitemap-images.xml`; sitemaps/feed → themselves;
`index.html` → the homepage. Deletions and renames map to the former URL so the
removal is recrawled. Private surfaces (`/ap`, `/mrb`, `/verify`) are never
emitted. The result is sorted, de-duplicated, and same-origin only.

The generator still writes `.indexnow-urls.json` for local debugging, but it is
git-ignored and reset to `[]` by any deterministic rebuild — production must not
depend on it. The diff-based `.seo-changed-urls.json` is authoritative.

### When IndexNow fails

`scripts/submit-indexnow.mjs` exits nonzero on an invalid/unreachable key, a
network error, a malformed URL list, or a rejected submission — so the workflow
fails visibly. The site stays online (it was already deployed). **Re-run** the
failed run from the Actions tab (idempotent — resubmitting the same URLs is
safe), or trigger `Publish SEO record` manually. Inspect the exact URL set by
downloading the `seo-changed-urls` artifact from the run.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Offline: ingest from committed snapshots → generate → validate. Used by the Cloudflare build. |
| `npm run generate` | Ingest + generate only (deterministic; run twice to prove it). |
| `npm run validate-records` | Full consistency validation. Add `-- --remote` for live video checks. |
| `npm run sync` | Network: refresh sheet snapshots, ingest remote media, generate, validate with remote checks. Used by the sync workflow. |
| `npm run check-syntax` | `node --check` over every pipeline script. |
| `npm run seo:collect -- --base <sha> --head <sha>` | Write `.seo-changed-urls.json` from a Git diff. |
| `npm run seo:verify-deploy -- --marker-url <url>` | Poll production until it serves the merged content. |
| `npm run seo:submit -- --input .seo-changed-urls.json [--dry-run]` | Submit URLs to IndexNow (`--dry-run` prints, never posts). |
| `npm run seo:test` | SEO unit tests (mock HTTP; no network). Also part of `npm test`. |

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
- Optional: `INDEXNOW_KEY` — used by the SEO workflow if set; otherwise the
  committed `indexnow-key.txt` is used. The key file is public by design of the
  IndexNow protocol (the API verifies it at `/indexnow-key.txt`).
- Optional (not required): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_PAGES_PROJECT` — only if you later replace the cache-busted
  deployment polling with the Cloudflare Pages deployment API. The default
  polling needs no Cloudflare token.

### GitHub Actions permissions

- **Sync daily record** needs `contents: write` and `pull-requests: write`
  (it pushes a `sync/record-*` branch and opens a PR — never to `main`).
- **Publish SEO record** needs only `contents: read` (plus `actions: write`
  for the artifact upload). It never writes to the repository.

### Cloudflare Pages must fail on a failing build

The build command is `npm ci && npm run build`; output directory `/`. `npm run
build` exits nonzero on any publisher/validation failure. Do not wrap it in
anything that ignores the exit code — a failed build must leave the previous
deployment live rather than shipping a broken record.

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

## Repairing a failed deployment without rewriting evidence

If a deploy verification or IndexNow run fails, fix the *pipeline*, never the
*evidence*:

1. **Do not** regenerate, recompress, or re-hash historical photographs to make
   validation pass. Original bytes must keep matching the manifest hashes.
2. If an attested original is missing from its manifest path, restore the exact
   bytes from Git history (e.g. `git cat-file -p <blob> > <manifest path>`) and
   confirm `sha256sum` matches the manifest — do not substitute another image.
   Evidence continuity is enforced on (date, position), so a renamed or
   different-bytes replacement is rejected even under an accepted filename.
3. A genuinely intended byte change requires an explicit, owner-authorized entry
   in `data/approved-hash-changes.json` (`{ path, old, new }`); it is then
   recorded in the manifest `history[]`. Never add an approval to silence a
   failure without owner authorization.
4. Once the record validates, re-run `Publish SEO record` (or push the fix to
   `main`); deployment verification and IndexNow resubmission are idempotent.
