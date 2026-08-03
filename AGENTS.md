# AGENTS.md

## Cursor Cloud specific instructions

This repo (`mrb-seo-publisher`) is a **static website + Node build/test tooling** for the
Micheal Ray Berry Public Accountability Project. There is **no backend server in this repo** and
**no `npm run dev` / long-running dev server** — the app is plain static files (HTML/CSS/JS). All
"live" behavior calls external SaaS (Google Apps Script, Google Sheets CSV exports, Cloudflare R2)
that lives outside the repo.

### Services / how to run them

- **Static site (the app):** serve the repo root with any static server, e.g.
  `python3 -m http.server 8080` (from `/workspace`) or `npx serve -p 3000`. Then browse
  `http://localhost:8080/` (home), `/verify/` (client-side SHA-256 file verifier), `/ap/` (AP
  console — append `?preview=1` for a keyless sample-data demo), `/mrb/` (participant portal),
  `/daily/` (prebuilt daily record pages).
  - Caveat: `python3 -m http.server` does **not** apply the `_redirects`/`_headers` rules, so SPA
    routes like `/dashboard` or `/milestones` won't resolve. For production-like routing use
    `netlify dev`. Direct paths that exist on disk (including `/verify/`, `/ap/`, `/mrb/`) work fine.
  - Interactive `<x-dc>` pages load React/Babel and other assets from public CDNs, and the home/
    verify pages fetch live data from the public Google Sheet. These require network egress; with no
    network the verify tool shows "CHECK FAILED" and dc-runtime pages won't hydrate.

- **Recording Assistant (browser web component):** `mrb/inspection/recording-assistant.js` is a
  **built file — do not edit it directly.** Edit the modules in `tools/recording-assistant/src/` and
  rebuild with `npm run build:ra` (esbuild → single IIFE). See `tools/recording-assistant/README.md`.

### Lint / test / build

- `npm test` — builds the Recording Assistant first, then runs the full Node test harness
  (`node --test`, 91 tests). This **includes** the lint gate (`lint.test.mjs`, ESLint no-undef) and
  the CSP, selector-integrity, overlay-snapshot, and jsdom smoke tests. This is the pre-push gate.
- `npm run build:ra` — build only. CI also enforces `git diff --exit-code
  mrb/inspection/recording-assistant.js`, so **always run `npm run build:ra` and commit the rebuilt
  output** whenever you change anything under `tools/recording-assistant/src/`, or CI will fail.
- **Font requirement (non-obvious):** the overlay PNG **golden snapshot** tests render text with
  `@napi-rs/canvas` and need the IBM Plex fonts installed system-wide, or they diff against the
  goldens and fail. Install once per fresh machine with `sudo apt-get update && sudo apt-get install
  -y fonts-ibm-plex` (this is what CI does). This is intentionally kept out of the startup update
  script to keep startup minimal; run it manually before `npm test` if goldens fail.
  - To intentionally regenerate goldens after a deliberate overlay change: `RA_UPDATE=1 npm test`,
    then review the image diff.

### Publisher (build step, not a service)

- `node scripts/publish.mjs` regenerates `daily/*` pages, sitemaps, RSS, and responsive images from
  the public Google Sheet (+ `photos/`). It is a one-shot build, not a long-running server, and
  needs network access to the sheet.
