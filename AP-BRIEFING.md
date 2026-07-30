# AP session briefing — current state

Read `CLAUDE.md` first; it holds the durable rules. This file holds the parts
that change: what was just built, what was decided, and what is blocked.
Prune it as items close. Last updated 2026-07-30.

## Who is operating this

Micheal currently holds BOTH roles — his personal account and
`ap@michealrayberry.com` — as caretaker. The plan is to build a fully working
system and hand it to a real AP later. Until that handover happens, the site's
claims that Micheal "cannot soften, edit or take down" the record describe an
intent, not an enforced constraint. Treat closing that gap as the project's
real milestone, ahead of any feature.

AP-administered work (Apps Script, sheet schema, keys, portal, repo, Netlify)
belongs in an `ap@` session. Micheal's own session keeps only what §10.1b
leaves him: submitting packets and journal entries, plus his YouTube channel
under §10.2.

## What shipped (main @ 1241aa7)

A daily SEO publishing pipeline, `.github/seo-publisher/` + the
`publish-daily-seo.yml` workflow. It runs every 15 minutes and on pushes to
`photos/**`. Details are in CLAUDE.md's SEO pipeline section. Highlights:

- Permanent per-day pages, an archive hub at `/daily/`, responsive WebP
  variants, per-photo SHA-256 manifests, four sitemaps behind a sitemap index,
  and IndexNow submission.
- Missed days publish too, sourced from the AP Violation Log, so the archive
  has no gaps. §8 limits those pages to date, nature, resolved/unresolved.
- The homepage links `/daily/` statically and links log rows to their permanent
  pages via `daily/published.json`.
- Entity graph unified: the homepage now defines `/#website` and
  `/#micheal-ray-berry`, which every generated page references by `@id`.

Repo settings already done: Actions workflow permissions = Read and write.

## Decisions on record

- **Missed days** publish from the AP Violation Log, never inferred from
  missing photos — a §9 medical exception is an excused day, and only the AP
  can tell the two apart.
- **§8 stands.** "Fully public" means the violation record and enforcement
  status, NOT consequence details. Those stay confidential. No code publishes
  amounts, tiers, deadlines or paid status.
- **§11 abandonment auto-confirms** — no AP click. But §11 as signed requires
  written notice and a seven-day opportunity to resume BEFORE the project ends,
  so the correct timing is notice on day 30, automatic confirmation on day 37,
  cleared by any complete packet inside the window. The site already displays
  this. `abandonmentCheck` in Apps Script does NOT yet implement it.

## Blocked / open — highest value first

1. **`apps-script/` is not in this repo.** `nightlyComplianceCheck`,
   `abandonmentCheck`, penalty writing and attestation all live in a Google
   editor under `ap@`. Nothing about enforcement can be built, reviewed or
   tested until it is version-controlled. It is also the single biggest
   handover blocker: today handover means "here is a Google account", instead
   of "here is a repo". Get it in with
   `clasp clone <SCRIPT_ID> --rootDir apps-script` from the `ap@` account.
   Scan for hardcoded keys before the first commit — this repo is PUBLIC.
   Note: `script.googleapis.com` is reachable from the sandbox, so a
   `projects.getContent` pull also works given a read-only token.

2. **Deployment ID mismatch — UNRESOLVED.** Three files pin the /exec endpoint:
   `index.html` (`SUBSCRIBE_ENDPOINT`), `recording-assistant.js`
   (`ATTEST_ENDPOINT`), `ap/index.html` (`EP`). All three use
   `AKfycbybendih-Xezd…`. Micheal supplied `AKfycbz9drhPe0Jn…` as the current
   deployment. Do NOT change these on a guess: this is the only write path, and
   pointing it at a dead deployment silently stops capture, which manufactures
   violations. Confirm which deployment is live first, then change all three
   together and bump `sw.js` CACHE.

3. **Inspection videos are owned by `michealrayberry@gmail.com`** and exist
   nowhere else — no repo copy, manifests point at `drive.google.com`. The
   folder is AP-owned but Drive ownership is per-file. Micheal can currently
   delete the entire video record, which contradicts §10.3 and the site's own
   claims. Fix: host on YouTube (also fixes video indexing — Google cannot
   index Drive-hosted video) and change capture to upload as `ap@` so new
   files are AP-owned from birth.

4. **`NETLIFY_BUILD_HOOK` is not set** as an Actions secret. The value already
   exists in Script Properties as `NETLIFY_HOOK` (`setNetlifyBuildHook`).
   Without it the workflow waits on Netlify auto-deploy and polls up to 5 min.

5. **Handover artifacts.** `apps-script/HANDOVER.md` is referenced by CLAUDE.md
   but absent here. Needed: credential inventory, key ROTATION ORDER (rotating
   `GH_TOKEN` before transferring repo admin breaks the photo mirror
   mid-handover), an AP operating runbook covering §9 calls and consequence
   administration, and a post-handover verification pass.

## Environment limits worth knowing

The sandbox reaches GitHub and npm. It does NOT reach `docs.google.com`,
`script.google.com`, `michealrayberry.com`, Netlify, IndexNow or Search
Console. Google's *API* hosts (`sheets.googleapis.com`,
`script.googleapis.com`) ARE reachable and return auth errors, not proxy
blocks — so API access works given credentials.

Consequence: publisher changes were validated against stubbed CSV fixtures and
the repo's real photos, not against the live sheet, and no claim about live
deployed behaviour has been verified end to end. Verify anything load-bearing.

## Suggested order of work

Get the Apps Script in-repo, resolve the deployment ID, secure the videos, then
build the §11 notice/cure automation and the multi-source compliance check —
never conclude "missed" from a single empty CSV read, since an unshared sheet
and a genuine miss look identical, and §11 has no rollback.
