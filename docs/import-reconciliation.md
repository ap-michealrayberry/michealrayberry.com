# Initial import reconciliation

This runbook verifies migration `0005_import-initial-project-days-and-weights` without modifying source or destination data.

## Endpoints

- `/.well-known/database-health` verifies all required schemas and tables, including `project_days` and `weight_records`.
- `/.well-known/import-reconciliation` verifies the approved import counts, date ranges, Eastern Time normalization, source traceability, and expected weight bounds.
- `/api/public/progress` exposes only public project-day, date, weight, and note fields for the website migration.

## Expected reconciliation

- 13 project days from July 20 through August 1, 2026.
- 12 weights from July 20 through July 31, 2026.
- All project days use `America/New_York`.
- All imported weights retain Google Sheets source-system and source-row identifiers.
- Imported weight values remain within the approved dry-run range of 335.6–338.4 lb.

## Exclusions

This suite does not expose media URLs, private evidence, financial details, credentials, Appendix A amounts, or signed-document contents. It does not import violations, consequences, amendments, or media records.
