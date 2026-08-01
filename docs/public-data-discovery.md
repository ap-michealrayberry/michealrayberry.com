# Public data discovery

The public progress dataset is discoverable through both human-readable and machine-readable surfaces.

## Canonical surfaces

- Dashboard: `/progress/`
- JSON API: `/api/public/progress`
- CSV API: `/api/public/progress.csv`
- Status API: `/api/public/status`
- Schema.org dataset metadata: `/dataset.json`
- Frictionless Data package descriptor: `/datapackage.json`
- Sitemap index: `/sitemap.xml`

## Link relations

Netlify response headers connect the dashboard and APIs to the dataset metadata and alternate representations using `describedby` and `alternate` link relations.

## Privacy boundary

The public dataset contains project day, date, weight, and public note only. It excludes media URLs, private evidence, violation evidence, consequence amounts, credentials, signed-document contents, and Appendix A details.

## Production verification

After deployment:

1. Confirm `/dataset.json` returns `application/ld+json`.
2. Confirm `/datapackage.json` returns valid JSON with one CSV resource.
3. Confirm `/sitemap-static.xml` contains `/progress/` and both public progress API representations.
4. Confirm the dashboard and progress APIs return `Link` headers pointing to dataset metadata and alternate formats.
5. Confirm the existing public API response bodies are unchanged.
