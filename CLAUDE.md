# CLAUDE.md — michealrayberry.com (Public Accountability Project)

You are operating the official public record of Micheal Ray Berry's Public
Accountability Project (340 → 175 lbs, Day 1 = July 20, 2026). The record's
credibility is the product. Never weaken verification, never soften the record.

## Who runs what
- The **Accountability Partner (AP)** administers everything (§13): site, sheet,
  script, keys, YouTube. Micheal must NOT be able to edit or soften the record.
- All accounts consolidate under **ap@michealrayberry.com** (Google Workspace).
  Full handover per `apps-script/HANDOVER.md` — read it before touching accounts.
- Public contact: ap@michealrayberry.com. Platforms: this site + YouTube
  (@michealrayberry) only.

## Architecture
- **Static site** on Netlify, auto-deployed from GitHub
  `michealrayberry/michealrayberry.com` (main). No build step — files at repo
  root ARE the site. DNS at Wix registrar: A → 75.2.60.5, www CNAME →
  hilarious-seahorse-b93845.netlify.app. MX/TXT = Google Workspace mail — never touch.
- **Data** lives in one Google Sheet (id in Code.gs `SHEET_ID`); the site reads
  it live via gviz CSV (`tqx=out:csv` + gid or sheet name). State changes
  (violations, modes) need NO site deploy.
- **Apps Script web app** (`apps-script/Code.gs`, deployed as /exec) is the ONLY
  write path: challenge codes, attestations, photo filing, health sync, AP
  portal actions, Home Assistant events, location log. Deploy via clasp or the
  editor: paste → Deploy → Manage deployments → edit → New version (KEEP the
  same /exec URL — it is baked into the site files).
- **Triggers** (re-run `setup()` after structural changes): importPhotos 10min,
  githubMirrorPhotos 15min, fitbitSync hourly, nightlyComplianceCheck 22:00 ET,
  abandonmentCheck 23:00 ET, assignWeeklyMeals Sun 17:00, backupRecord weekly.
- **Keys** in Script Properties: PACKET_KEY (Micheal's device), AP_KEY (portal),
  GH_TOKEN (photo mirror commits — watch expiry), NETLIFY_HOOK, Health OAuth
  creds. Setters: setPacketKey / setApKey / setGithubToken / setNetlifyBuildHook.

## Repo layout (also the site)
- `index.html` — the whole public site (SPA: home/about/record/agreement/log/
  updates + violation/abandonment/completion modes). Source of truth for edits.
- `recording-assistant.js` — capture tool: daily inspection (4 angles + video),
  meal photo w/ on-device food check, violation portrait, corrective session,
  location check-in + live beacon. All captures: one-time challenge code
  (spoken + burned into overlay) + SHA-256 attestation w/ server time.
- `ap/index.html` — AP Portal (AP_KEY-gated): packet review, violations,
  grading, corrective log, abandonment (§11), completion (§6.3), updates,
  meal planner, smart home webhooks, location card, handover runbook.
- `verify/index.html` — public hash checker against the Attestation tab.
- `protocol/index.html` — daily control points, live status from attestations.
- `photos/` — mirrored daily photos (committed by the script, don't hand-edit).
- `_redirects` (incl. /annex + /fagspose → / 301; typo domain
  michaelrayberry.com → canonical), `_headers`, `sw.js` (bump CACHE version on
  asset changes; never caches /ap), `manifest.webmanifest`, `sitemap.xml`.

## Hard rules (contract-driven — verify against the signed agreement)
- **§8 privacy:** public record shows ONLY violation date/nature +
  resolved/unresolved. NEVER amounts, tiers, due dates, paid status.
  Consequences are private. Corrective sessions: private, recorded, to AP only.
- **§11 abandonment:** 30 missed days → auto PRESUMED (site banner) →
  AP-confirmed PERMANENT takeover. §9 medical exception is why confirm is manual.
- **§6.3 completion:** 175 held 28 days + official weigh-in → AP declares →
  permanent completion archive.
- Milestones: 300/275/250/225/200/175 (weigh-in + video each).
- Daily Compliance Packet by 22:00 ET; multiple same-day misses = ONE violation.
- Uniform: black unitard + plain black shoes. No name tag.
- The site is SFW. No adult content or links to adult platforms.
- When contract and site conflict: STOP and ask which wins. Never silently drift.

## Known gotchas (each cost a real bug)
- **Anchored status regex:** 'Unresolved' contains 'resolved'. Always
  `/^\s*(satisfied|resolved)/i` — never an unanchored test. This bug appeared
  THREE times (portal, violation mode, penalty log).
- **gviz sheet names:** a wrong `&sheet=Name` silently serves the FIRST tab.
  Site reads use gids for human-made tabs (Weigh-ins 1146060827, Penalty Log
  1365599185, Updates 742923954, Journal 482638063, Amendments 413137433);
  script-created tabs (Attestation, Health, Site State) are safe by name.
- **Sheet must be link-viewable** or every public CSV read comes back empty.
- **Google Health API:** weight/calories are rollup-only types — use
  `dataPoints:dailyRollUp` (weight.weightGramsAvg grams; total-calories kcal).
  Point filters 400 on these types. Steps etc. use the list endpoint. Weight
  autolog: manual rows before 2026-07-30, Health rows from that date.
- **Recording:** capture canvas 1080×1920 @9Mbps (2.5K stuttered); stills bump
  the camera to 4K and take a 3-shot sharpest-wins burst.
- **/exec URL is baked into site files** (ATTEST_ENDPOINT etc.) — changing the
  deployment id means rebuilding + committing the site. Prefer "New version" on
  the existing deployment.
- **sw.js caching:** bump `CACHE` version when shipping asset changes or phones
  keep the old tool.
- Home Assistant bridge = environment/media/privileges ONLY. Never wire any
  device that restrains or confines a person; physical-safety devices stay a
  live human decision with manual release.

## Style
- Design system: IBM Plex Mono / Plex Sans Condensed / Plex Sans; paper #FAFAF7,
  ink #141412, signal red #B3261E, green #1B6E3C. Flat borders, no rounded
  corners, uppercase condensed headings, mono labels w/ letter-spacing.
- Voice: cold, factual, first-person for Micheal's copy; directive for AP copy.
  No theatrics, no euphemism, no emoji.
