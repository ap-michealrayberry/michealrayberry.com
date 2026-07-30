# michealrayberry.com — deploy folder

Static site for the Public Accountability Project, served by Netlify from the
GitHub repo. Live data comes from Google Sheets / Apps Script / YouTube / Drive
(state changes like violations or abandonment need NO deploy — the site reads
the sheets directly; deploys only ship code/content changes).

Files:
- index.html — the site (unbundled; loads support.js + recording-assistant.js)
- support.js, recording-assistant.js, voice-pack.json — runtime + tools
  (recording-assistant: daily inspection, meal photo, violation portrait,
  corrective session — all server-attested)
- Public Training Session.dc.html, Violation Acknowledgment.dc.html — embedded tools
- ap/ — AP Portal (key-gated operator console; noindex, never cached)
- manifest.webmanifest, sw.js — install-as-app + offline shell
- _redirects — real URLs (/record, /agreement, …); /annex + /fagspose → / (301)
- _headers — security + cache headers
- 404.html, robots.txt, sitemap.xml, favicon.png, og-image.png

Not in this folder but in the repo: photos/ (mirrored daily photos) and
images/ (site imagery incl. violation-portrait.jpg) — committed by Apps Script.

Deploy: commit ALL of these files to the repo root (github.com/michealrayberry/
michealrayberry.com, main branch). Netlify auto-deploys.

Administered by the Accountability Partner (§13).
