# CLAUDE.md — michealrayberry.com

This repository operates the public record for the Micheal Ray Berry Public Accountability Project. Accuracy, traceability, privacy, and reversibility take priority over speed.

## Authority and governance

- The signed execution agreement and signed amendments are authoritative. Drafts, Sheet notes, site copy, and automation must yield to signed documents.
- Project start: July 20, 2026. Starting reference: 340 lb. Completion requires 175 lb or below held for 28 days, followed by the required official completion process.
- The Accountability Partner administers the project through `ap@michealrayberry.com`.
- Never expose Appendix A dollar amounts, private consequence details, credentials, private evidence, or signature material.
- Never alter Wix MX or TXT records.
- When a document conflict exists, block dependent enforcement imports until the conflict is resolved and recorded.

## Current architecture

- Repository: `ap-michealrayberry/michealrayberry.com`; production branch: `main`.
- Hosting: Netlify project `hilarious-seahorse-b93845`; primary domain `https://michealrayberry.com`.
- Public site: static files in the repository, with Netlify Functions for database-backed APIs.
- Relational source of record: Netlify Database via `@netlify/database`.
- Production database branch: `production`; functions run in `us-east-1` / IAD.
- Google Sheets is a read-only migration and historical source during cutover. Do not treat it as the long-term runtime source.
- Google Drive remains the private archive for signed original PDFs and other restricted originals.
- Signed PDFs must not be committed to the public GitHub repository.

## Public data surfaces

- `/progress/` — public weight dashboard.
- `/daily-records/` — daily public record and media completeness interface.
- `/api/public/progress` — public progress JSON.
- `/api/public/progress.csv` — public progress CSV.
- `/api/public/daily-records` — daily records and public media references.
- `/api/public/status` — public database status and integrity summary.
- `/dataset.json` and `/datapackage.json` — dataset discovery metadata.
- `/.well-known/database-health` and `/.well-known/import-reconciliation` — operational checks.

Public APIs may expose only approved public fields. Media completeness is factual inventory data and is not, by itself, a violation determination.

## Database and migrations

- Use `@netlify/database`; do not introduce Supabase.
- Migrations belong in `netlify/database/migrations/<number>_<slug>/migration.sql`.
- Production migrations apply immediately before publication and must be idempotent where practical.
- Public records belong in `public_record`; restricted details belong in `private_record`; audit history belongs in `audit`.
- Preserve source-system and source-row traceability for imported records.
- Prefer append-only corrections and audit events over destructive edits.
- Before modifying Netlify Functions or database code, obtain current Netlify coding context.

## Governing documents

- Private signed originals stay in Google Drive.
- The database registry stores metadata such as internal document ID, legal title, execution status, effective date, source reference, hash, size, and supersession relationships.
- GitHub stores schema, migrations, reconciliation logic, and public-safe documentation only.
- Public pages may show approved summaries or redacted copies, but never private signatures or Appendix A amounts.
- The confirmed signed automated-violation document is the sole current Amendment No. 1. The unverified Sheet row titled “Amendment No. 1 — Evening Meal Photograph” was removed on August 1, 2026; no Drive file was deleted.

## Repository workflow

- Use feature branches and pull requests. Avoid direct commits to `main`.
- Create draft PRs first; mark ready after approval; merge only after a subsequent approval.
- Bundle coherent work into larger PRs rather than creating a PR for every small change.
- Use squash merges unless there is a specific reason not to.
- Verify the production Netlify deploy after merge, including migrations, functions, secret scanning, redirects, and headers.

## Verification commands

- `npm run verify:public-api`
- `npm run verify:public-site`
- `npm run verify:daily-records`
- `npm run verify:daily-media`
- `npm run verify:production`

The scheduled GitHub Actions integrity workflow runs every six hours and must remain read-only.

## Privacy and safety boundaries

- Do not commit credentials, tokens, private Drive file bytes, private evidence, or Appendix A amounts.
- Do not publish private consequence amounts, due dates, payment status, or restricted evidence.
- Do not import or automate violations until the applicable signed rule version is unambiguous.
- Keep physical-safety decisions under live human control; never automate restraint, confinement, or unsafe device behavior.
- Keep the public site safe for work.

## Style

- Design system: paper `#FAFAF7`, ink `#141412`, signal red `#B3261E`, green `#1B6E3C`; flat borders, condensed uppercase headings, and monospaced labels.
- Voice: factual, direct, and non-theatrical. Do not soften or exaggerate the record.
