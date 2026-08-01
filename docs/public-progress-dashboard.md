# Public progress dashboard

The static dashboard at `/progress/` reads only from `/api/public/progress`.

## Features

- latest public weight, net change, lowest recorded weight, and record count
- accessible SVG trend chart with per-point descriptions
- newest-first public record table
- links to the public CSV export and public data status endpoint
- responsive layout for mobile and desktop
- explicit error state when the API is unavailable

## Privacy boundary

The page displays only project day, date, weight, and public note fields. It does not request or display media URLs, private evidence, violation evidence, financial consequence amounts, credentials, signed-document contents, or Appendix A details.

## Production verification

After deployment:

1. Open `/progress/` and confirm the four summary metrics match `/api/public/progress`.
2. Confirm the chart contains one point per public weight record.
3. Confirm the table contains the same records in newest-first order.
4. Confirm the CSV and data-status links resolve successfully.
5. Test at a narrow viewport and verify the metrics and table remain usable.
6. Temporarily block the API in browser developer tools and confirm the visible error state appears without exposing internal details.
