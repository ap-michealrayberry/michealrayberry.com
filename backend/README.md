# Apps Script backend scaffold

This directory is intentionally small. It defines the v2 API boundary without
copying any secrets from the legacy system.

## Script Properties

- `SHEET_ID`
- `PACKET_KEY`
- `AP_KEY`

## Tabs

- `Project`
- `Packets`
- `Violations`
- `Audit`

## Deployment rule

Use one stable Apps Script web-app deployment URL. Create new deployment
versions without changing the URL. Store that URL in the front-end deployment
configuration, not in multiple source files.

## Before production use

- import and reconcile the legacy Apps Script source
- add media upload/ownership handling
- add packet review actions
- add deadline checks with multi-source evidence
- add rate limiting
- test CORS and redirects from each staging origin
- verify contract values
