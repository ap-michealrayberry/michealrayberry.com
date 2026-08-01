# Site consistency and AP operations portal

## Canonical public routes

The project database and public APIs are the source of truth for changing operational facts.

- `/project-status/` — consolidated live project status
- `/progress/` — public weight progress
- `/daily-records/` — dated weight and media records
- `/violations/` — public-safe violation and consequence state
- `/api/public/progress` and `/api/public/progress.csv` — progress data
- `/api/public/daily-records` — daily records and media completeness
- `/api/public/violations` — violation and consequence state

Retired route handling:

- `/dashboard` redirects permanently to `/progress/`
- `/record` redirects permanently to `/daily-records/`
- `/penalties` redirects permanently to `/violations/`

The AP portal is excluded from the public sitemap and receives `noindex`, `no-store`, anti-framing, no-referrer, and restrictive content-security headers.

## Status vocabulary

Public and private interfaces must keep these states distinct:

- `proposed` — generated but not approved or owed
- `approved` — component approved by an authenticated AP decision
- `active` — an approved assignment currently in force
- `performed` — participant submitted or completed an action
- `verified` — evidence has passed verification or AP review
- `satisfied` — every required component is verified, replaced, waived, or otherwise closed

A deploy never turns a proposal into an active consequence.

## Expanded AP portal

`/ap/violations/` now provides:

- project-wide metrics and pending-decision alerts
- case filtering and detailed case review
- source evidence and component state
- append-only decision form with a preview and Level One template
- governing-document selection limited to confirmed signed records
- deadline and Penalty Uniform validation
- private rationale separated from public rationale
- safety-stop, medical, accessibility, and technical-appeal records
- decision and review history
- governing-document registry overview
- session lock, key clearing, refresh, and JSON export

The API rejects duplicate activation, inactive governing documents, incomplete approval fields, invalid dates, and overlong text. Decision writes remain transactional and append-only.

## Privacy boundary

Never expose credentials, signed document bytes, signatures, Appendix A amounts, private source locators, private evidence, medical details, or private AP rationale through public endpoints or pages.
