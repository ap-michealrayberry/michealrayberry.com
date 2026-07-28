# michealrayberry.com — deploy folder

Static site for the Public Accountability Project, served by Netlify from the
GitHub repo. Live data comes from Google Sheets / Apps Script / YouTube / Drive.

Files:
- index.html — the site (unbundled; loads support.js + recording-assistant.js)
- support.js, recording-assistant.js, voice-pack.json — runtime + tools
- Public Training Session.dc.html, Violation Acknowledgment.dc.html — embedded tools
- _redirects — real URLs (/record, /agreement, ...) served by index.html
- _headers — security + cache headers
- 404.html, robots.txt, sitemap.xml

Deploy: commit ALL of these files to the repo root (github.com/michealrayberry/michealrayberry.com,
main branch). Netlify auto-deploys. To update: replace the changed files and commit.

Administered by the Accountability Partner (§13).
