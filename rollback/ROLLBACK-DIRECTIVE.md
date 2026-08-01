# ROLLBACK DIRECTIVE — return to the Sheets system

Decision (Micheal + AP, 2026-08-01): the Netlify Database rebuild is CANCELLED.
The project returns to the proven simple stack: one static site + Google Sheet
as database + Apps Script /exec as the only write path.

## For Claude Code — do this, nothing else
1. STOP all rebuild work. Merge nothing further from rebuild branches
   (including ap-michealrayberry-patch-3 and any unmerged functions work).
2. Restore main to the simple stack:
   - index.html = the patched single-file site (provided: reference-site/
     index.html from this package — includes the Amendment 5 as-amended copy)
   - Keep: _redirects, _headers, 404.html, robots.txt, sw.js (cache v3),
     manifest.webmanifest, favicon.png, og-image.png, support.js,
     recording-assistant.js, Violation Acknowledgment tool, ap/, verify/
   - Remove from main: netlify/ (database, functions, migrations), progress/,
     daily-records/, violations/, docs/ rebuild docs, package.json build
     tooling, netlify.toml build command (restore to plain static publish),
     recordingassistant.patch
3. DO NOT touch Action-owned paths: photos/, images/, daily/, manifests/,
   media/responsive/, sitemap*.xml, indexnow-key.txt, AP-BRIEFING.md,
   .github/ (workflows + seo-publisher). The Action keeps running as-is.
4. Fix the redirects the rebuild added for pages being removed:
   /dashboard, /data, /weigh-ins → / (not /progress/). /daily stays 301 → /
   only if daily/index.html does not exist; otherwise remove that line.
5. If any data was already migrated INTO Netlify Database, export it and give
   the AP a diff against the Sheet; the Sheet remains the system of record.
   Then decommission the database.
6. One PR, titled "Rollback: restore Sheets-based system", description
   linking this directive. After merge, verify michealrayberry.com serves the
   restored site and live Sheet data renders.

## What is intentionally KEPT from the rebuild era
- Nothing on main. The hardened Recording Assistant (patch-3) is parked on its
  branch — not deleted — in case the AP later wants option 2 (hybrid).
- The repo stays PR-based if the AP prefers; direct commits are also fine now
  that the stack is one file again.

## System of record after rollback
- Google Sheet (all tabs) — data + site state, edited by the AP, no deploys
- Apps Script Code.gs v16.x — writes, triggers, alerts (unchanged, still live)
- GitHub main → Netlify — static hosting only
- Amendment No. 5 remains signed and in force — its site copy is already in
  the restored index.html; enforcement workflow runs through the Sheet
  (Penalty Log columns) and the existing tools as before
