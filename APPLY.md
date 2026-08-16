# Zip patch — Micheal Ray Berry public record (16 August 2026)

This zip is the current official-record preview: homepage, daily archive,
violation log, dashboard, inspection standard, uniform, agreement, updates,
and Day 1 / Day 3 / Day 4 photographs.

It is a self-contained React / Vite app. It is **not** a file-by-file overlay
on the existing Netlify static repo (`index.html` + `boot.js` + `support.js` +
`scripts/publish.mjs`). Do not dump this tree over `michealrayberry.com` on
GitHub or the live static site will stop serving.

## What this patch contains

```
src/data/record.ts          single source of truth (days, violations, updates)
src/data/agreement.ts       agreement text
src/routes/                 every public page
src/components/site-chrome.tsx
public/photos/2026/08/13/   Day 1 four-angle photographs
public/photos/2026/08/15/   Day 3 four-angle photographs
public/photos/2026/08/16/   Day 4 four-angle photographs
public/llms.txt             answer-engine record
public/sitemap.xml
public/og-image.png
```

## Record this zip freezes

- Declared start 340. First filed weigh-in 337.0 (Day 1). Last filed 336.9 (Day 4).
- Day 4 is a complete record (video + four photographs + weight).
- Open violations: **V-002**, **V-003**. V-001 is resolved and verified.
- V-001 AP verification: “Verified by the Accountability Partner”.
- Uniform amendment (15 August 2026): titanium collar.

## How to run this copy

```bash
npm install
npm run dev
```

Then open the local preview the tool prints. `npm run build` produces the
production bundle.

## How this relates to michealrayberry.com

The live site stays on the existing Netlify pipeline (Google Sheet +
`scripts/publish.mjs`). To put these **record facts** on the live site:

1. Confirm the public Weigh-ins / Violation Log / Updates sheet matches
   `src/data/record.ts` (especially V-001 verification, Day 4 complete,
   open count = 2).
2. Keep Day 4 photographs in `photos/2026/08/16/` on the static repo
   (same filenames as in `public/photos/` here).
3. Replace `llms.txt` on the static repo with `public/llms.txt` from this zip
   if you want the answer-engine note to match.

Do not commit this React tree into the static repo root.

## Commit message if you only copy photos + llms.txt

```
Publish Day 004 photos and align llms.txt with the record
```
