# michealrayberry.com

Official public record of the **Micheal Ray Berry Public Accountability Project** — 340 → 175 lbs, documented daily from 13 August 2026. Administered by the Accountability Partner.

Live site: https://michealrayberry.com

## How the record is published

This repo **is** the site. Netlify builds from the root.

1. The homepage (`index.html`) is a client-rendered record shell. It reads the public Google Sheet (Weigh-ins, Violation Log, Updates). Rows dated before `2026-08-13` are ignored.
2. `npm run build` runs `scripts/publish.mjs`, which generates static `/daily`, `/weeks`, `/milestones`, `/dashboard`, `/penalties`, `/partner`, sitemaps, and the RSS feed from the same sheet plus files in `photos/`.
3. `/dashboard`, `/penalties`, `/milestones`, `/uniform`, `/updates`, and `/partner` are real HTML pages. The homepage still hydrates those routes for the interactive record, but crawlers and no-JS readers get the static pages.
4. A day page is written only when that day has a video **and** all four angle photographs. Incomplete or missed days get a page only after the 10:00 PM ET deadline. The daily sitemap lists **only** days that have HTML. The `/daily/` index links those gap pages.
5. IndexNow is submitted for URLs the publisher actually changed.

`/scripts/*`, `package.json`, and `netlify.toml` are force-404 on the public host.

## Local

```bash
npm install
npm run generate
```

Do not commit a local generate. Those folders are in `.gitignore` and are produced on Netlify.

## Capture instrument

`/assistant/` is the recording tool. Filing requires the device key, checked server-side. The key is sent in the POST body only (never on the query string). Demo mode runs when the Apps Script exec URL is empty.

Apps Script `doPost` must handle `action: "challenge"` the same way it handles `attest` / `r2sign` / `packet`.

## What not to put in this git history

- Device keys, ElevenLabs keys, Apps Script exec URLs
- Pre-start calibration weigh-ins (keep those off the public Weigh-ins tab)
- Generated day pages from a laptop run

Every commit to `main` is the public history of this record.

Uploading through the GitHub website is fine. **Replace the default commit message** with what actually changed, e.g. `Publish Day 002 photos — front left rear right`. Leave `Add files via upload` and the check in `.github/workflows/record-commits.yml` fails. One job per upload — do not mix photos and code.
