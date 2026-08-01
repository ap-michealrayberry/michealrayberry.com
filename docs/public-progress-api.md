# Public progress API

The public progress surface is intentionally limited to non-private weight and project-day data.

## Endpoints

- `GET /api/public/progress` — JSON records plus derived summary statistics.
- `HEAD /api/public/progress` — availability and cache headers without a response body.
- `GET /api/public/progress.csv` — CSV export of the same public record fields.
- `GET /api/public/status` — counts, date range, latest import timestamp, and referential-integrity status.
- `GET /.well-known/import-reconciliation` — fixed reconciliation checks for migration `0005_import-initial-project-days-and-weights`.
- `GET /.well-known/database-health` — required database-relation checks.

## Public fields

The JSON and CSV progress endpoints expose only:

- project day
- project date
- weight in pounds
- public note

The JSON endpoint also derives record count, first and latest records, net change, and observed minimum and maximum weights. Derived values are calculated from public records at request time.

## Caching

Progress responses use a five-minute public cache. JSON responses include an ETag and support `If-None-Match`. Status responses use a one-minute public cache. Error responses use `no-store`.

## Exclusions

These endpoints do not expose media URLs, private evidence, violation evidence, consequence amounts, credentials, signed-document contents, or Appendix A financial details.

## Production verification

After deployment:

1. Confirm `/api/public/progress` returns `status: ok`, twelve records for the initial import, and a populated summary.
2. Confirm a second request with the returned ETag in `If-None-Match` receives HTTP 304.
3. Confirm `/api/public/progress.csv` contains the four approved columns and twelve initial data rows.
4. Confirm `/api/public/status` reports referential integrity as true.
5. Confirm unsupported methods return HTTP 405 with `Allow: GET, HEAD`.
