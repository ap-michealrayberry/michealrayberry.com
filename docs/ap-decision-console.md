# AP violation decision console

## Purpose

`/ap/violations/` is the private operator surface for reviewing a violation proposal and recording an Accountability Partner decision. The corresponding function is `/api/ap/violation-decisions`.

## Authentication

The function requires a production-scoped Netlify environment variable named `AP_KEY`. The console sends the operator-entered value in the `X-AP-Key` request header. No credential is committed to GitHub or embedded in browser JavaScript.

Before production use, create `AP_KEY` in Netlify with Functions and Runtime scope. Treat it as a secret and rotate it after suspected disclosure.

## Decision semantics

Supported decisions are:

- `approve`
- `reduce`
- `substitute`
- `return`
- `waive`

A decision requires an explicit confirmation checkbox and a second browser confirmation. The API records:

- decision type and timestamp
- approved level and corner-time duration
- public rationale
- optional private rationale
- component deadline
- Penalty Uniform start and requirement
- private corrective-session requirement
- governing document identifier
- request fingerprint and audit payload

The proposal is never edited. A successful decision inserts an immutable private decision and a separate public-safe activation record in one database transaction. Required consequence components are generated only for active approvals or reductions.

## Privacy boundary

The public violation API and page never receive the AP key, private rationale, medical or safety basis, signatures, private Drive identifiers, financial amounts, payment evidence, or private corrective-session media.

## Safety and governance

A deployment never approves a consequence. Approval requires an authenticated POST with `confirmed=true`. Permanent-abandonment remains a manual AP determination. Safety stops, medical reviews, accessibility reviews, and technical appeals remain separate review records.

## Recovery

Decision, activation, and audit rows are append-only. Do not attempt SQL updates or deletions. Corrections must be represented by a later override workflow. If activation fails, the transaction rolls back and no partial decision should remain.
