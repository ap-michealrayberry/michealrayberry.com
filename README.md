# michealrayberry.com

Official public record for the Micheal Ray Berry Public Accountability Project.

The site is deployed from this repository to Netlify. Public progress and daily-record views are backed by Netlify Database and exposed through read-only Netlify Functions. Google Sheets remains a migration and historical source during cutover; Google Drive remains the private archive for signed governing documents.

## Production

- Site: `https://michealrayberry.com`
- Netlify project: `hilarious-seahorse-b93845`
- Repository: `ap-michealrayberry/michealrayberry.com`
- Production branch: `main`
- Governing timezone: `America/New_York`

## Public surfaces

- `/progress/` — weight dashboard, trend chart, and public weigh-in table
- `/daily-records/` — daily weight, media inventory, completeness, and missing components
- `/api/public/progress` — JSON progress dataset
- `/api/public/progress.csv` — CSV progress dataset
- `/api/public/daily-records` — JSON daily-record and media dataset
- `/api/public/status` — data counts and referential-integrity status
- `/dataset.json` — Schema.org dataset metadata
- `/datapackage.json` — Frictionless Data package metadata
- `/.well-known/database-health` — required database relations
- `/.well-known/import-reconciliation` — initial import reconciliation

## Architecture

### Netlify

The root of the repository is the static publish directory. Netlify deploys static pages, redirects, headers, and TypeScript functions in `netlify/functions/`.

### Netlify Database

Relational records are managed through `@netlify/database`.

- `public_record` contains approved public accountability records.
- `private_record` contains restricted administrative and governing-document metadata.
- `audit` contains append-only audit events.
- Migrations are under `netlify/database/migrations/`.

Production deploys use the `production` database branch. Deploy previews receive isolated database branches.

### Google Sheets

The Sheet is retained as a read-only migration and historical source while database-backed workflows are completed. It is not the intended long-term public runtime dependency. Source-system and source-row identifiers are preserved in imported records.

### Google Drive

Signed execution copies and signed amendments remain private in Google Drive. Signed PDFs, signatures, Appendix A amounts, and other restricted originals must not be committed to this public repository.

The database governing-document registry stores metadata and reconciliation state, not the signed PDF bytes.

## Imported public data

Current imported public data includes:

- project days beginning July 20, 2026
- weigh-ins for July 20–31, 2026
- 55 public media references for July 20–30
- explicit missing-media status for July 31

Media completeness is an inventory fact. It does not independently declare a violation.

## Governing-document status

The confirmed signed automated-violation amendment is the sole current **Amendment No. 1**.

An unverified Sheet entry titled **“Amendment No. 1 — Evening Meal Photograph”** was removed on August 1, 2026 after the numbering conflict was confirmed. No Drive file was deleted. The private governing-document registry records the reconciliation outcome.

## Development

```sh
npm install
npm run dev
```

Netlify CLI is used for local emulation.

## Verification

```sh
npm run verify:public-api
npm run verify:public-site
npm run verify:daily-records
npm run verify:daily-media
npm run verify:production
```

A read-only GitHub Actions workflow runs production integrity checks every six hours.

## Deployment workflow

1. Create a feature branch from `main`.
2. Bundle a coherent workstream into a draft pull request.
3. Mark the PR ready after review approval.
4. Merge after a separate merge approval.
5. Verify the production Netlify deploy, migrations, functions, redirects, headers, and secret scan.

Avoid direct commits to `main`.

## Non-negotiable boundaries

- Never expose Appendix A dollar amounts.
- Never commit credentials, private evidence, signed PDF bytes, or signature material.
- Never alter Wix MX or TXT records.
- Never import a violation until the applicable signed rule version is unambiguous.
- Do not introduce Supabase; the approved stack is Netlify Database, Functions, static pages, and approved external media services.
