# Public daily record interface

## Public surfaces

- Human-readable daily records: `/daily-records/`
- Daily-record JSON: `/api/public/daily-records`
- Weight progress: `/progress/`

Each progress-table day links to its matching daily record. The daily-record page displays the approved public weight, public note, media-component counts, media-completeness status, missing components, and public media references.

## Media hosting status

Media links are classified as:

- durable site assets hosted on `michealrayberry.com`
- external assets that remain publicly reachable but require eventual durable replacement
- unavailable components that have no published URL

The production verifier checks every non-null media reference. Google Drive-hosted assets are reported separately so they can be migrated later without treating their current host as a violation or changing the source Sheet.

## Governance boundary

Media completeness and link availability are factual inventory states. They are not violation determinations. This interface does not reconcile amendments, declare violations, assign consequences, expose financial amounts, or publish private evidence.

## Rollback

The interface is static and read-only. Rollback consists of reverting the page, progress links, verifier, and sitemap entries. The daily-media database records and Google Sheet are not modified by this interface layer.
