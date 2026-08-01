# Public API cache and integrity verification

## Cache validators

`/api/public/progress` derives its ETag only from stable public data:

- schema version
- status
- timezone
- summary
- ordered records

The response still includes `generated_at`, but that timestamp is excluded from the ETag. Repeated requests against unchanged data therefore receive the same validator even after CDN cache expiry.

The endpoint also returns `Last-Modified` from the newest imported or created weight record and supports comma-separated and weak `If-None-Match` validators.

## Automated production verification

Run locally:

```sh
npm run verify:public-api
```

Override the target deployment when necessary:

```sh
PUBLIC_BASE_URL=https://deploy-preview.example.netlify.app npm run verify:public-api
```

The check validates:

1. JSON status, schema version, timezone, record shape, and summary count.
2. Stable conditional GET behavior with a `304 Not Modified` response.
3. Matching GET and HEAD ETags.
4. Agreement between progress and status record counts.
5. Agreement between JSON and CSV row counts.
6. Referential integrity reported by the public status endpoint.

GitHub Actions runs this verification every six hours and can also be started manually.

## Privacy and write boundary

The verification process performs only public GET and HEAD requests. It does not authenticate, mutate the database, alter Google Sheets, inspect private evidence, or expose financial consequence details, credentials, signed-document contents, or Appendix A amounts.
