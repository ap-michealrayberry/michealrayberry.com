# Main-site public data integration

## Canonical public data surface

The database-backed progress page at `/progress/` is the canonical human-readable public weigh-in record. The legacy `/dashboard`, `/data`, and `/weigh-ins` routes redirect to it.

The page links directly to:

- `/api/public/progress`
- `/api/public/progress.csv`
- `/api/public/status`
- `/dataset.json`

The progress page contains no Google Sheets runtime dependency.

## Scope

This integration changes public routing, navigation, metadata links, and production verification. It does not delete or modify Google Sheets, import additional records, or change the database schema.

Violations, amendments, private evidence, signed-document contents, consequence amounts, credentials, and Appendix A details remain outside this change.

## Production verification

Run:

```sh
npm run verify:production
```

The combined check validates API consistency plus canonical pages, legacy redirects, public data links, dataset distributions, sitemap discovery, and the absence of a Google Sheets dependency on the progress page.

## Cutover and rollback

Cutover is limited to routing public dashboard aliases to `/progress/`. Google Sheets remains available privately as the migration source and historical backup.

To roll back:

1. Revert the merge commit for this integration.
2. Confirm `/dashboard` again resolves to the legacy index route.
3. Confirm `/progress/` and all read-only APIs remain available independently.
4. Run `npm run verify:public-api` to ensure the database-backed record was not affected.

No database rollback is required because this integration applies no migrations or record mutations.
