# File addition — patch for michealrayberry.com

The Recording Assistant is not rewritten. This adds `/assistant/file/` beside it.

## Copy these paths into the repo

```
assistant/file/index.html
assistant/file/file.js
assistant/file/file.css
```

## Optional hook (does not change recording)

In `assistant/index.html`, after the Demonstration session card, insert the hunk in `assistant-index.hunk.html`.

That is one link. Sessions, camera, overlay, and upload stay as they are.

## Rules the addition enforces

- Daily file: **today only**, **before 10:00 PM ET**
- No past day, no future day
- After 10 PM: daily file is closed; a **failure for today** may still be opened
- A second daily take on the same open day **replaces** the first (video, recaptured photos, YouTube link)

## Tonight’s YouTube copy (Day 003 · 2026-08-15)

Use the files in `packets/` if you are posting the take that already exists:

- `packets/2026-08-15-day-003-youtube-title.txt`
- `packets/2026-08-15-day-003-youtube-description.txt`
