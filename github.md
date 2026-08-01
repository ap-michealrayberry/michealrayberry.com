# Current GitHub and publication state

Updated: 2026-08-01 (America/New_York)

## Main branch inventory

The Netlify Database functions are present on `main`, including:

- `netlify/functions/public-progress.mts` → `/api/public/progress`
- `netlify/functions/public-progress-csv.mts` → `/api/public/progress.csv`
- `netlify/functions/public-daily-records.mts` → `/api/public/daily-records`
- `netlify/functions/public-violations.mts` → `/api/public/violations`
- `netlify/functions/public-data-status.mts` → `/api/public/status`
- `netlify/functions/database-health.mts` → `/.well-known/database-health`
- `netlify/functions/import-reconciliation.mts` → `/.well-known/import-reconciliation`
- `netlify/functions/ap-violation-decisions.mts` → `/api/ap/violation-decisions`

The source for `/api/public/progress` is therefore on `main` at `netlify/functions/public-progress.mts`. If Netlify shows “no source,” treat that as a deploy/UI inspection issue rather than a missing repository file and compare the deployed commit with `main`.

## Verification interface

The verification interface is also present on `main`:

- `verify/index.html`
- `verify/support.js`

However, `verify/index.html` still queries the historical Google Sheets Attestation CSV. It is merged, but it has not completed the Netlify Database source-of-record cutover. Until a database-backed public attestation endpoint exists, the page must be described as a legacy/historical verifier rather than the current operational authority.

## Source-of-record rule

- Netlify Database is the operational source of record.
- Google Sheets is read-only migration/historical reference.
- Signed governing documents are the authority for rules.
- Changing public facts should be served from Netlify public APIs and canonical pages.

Known remaining cutover defects include Sheets-backed reads in the homepage, verification interface, Recording Assistant, and SEO publisher. These must not be mistaken for equal authoritative records.

## V-001 / July 31 violation

The July 31 missed Daily Compliance Packet is the first confirmed violation event and is referred to operationally as `V-001`.

Current state:

- violation: confirmed
- resolution: unresolved
- consequence proposal: Level One, 15 minutes, Penalty Uniform proposed
- AP decision: not yet recorded
- activation: none
- publication of an approved consequence: blocked

A deployment does not approve or activate a consequence. Publication remains blocked until the Accountability Partner authenticates in `/ap/violations/`, reviews the proposal, selects approve/reduce/substitute/return/waive, supplies the required rationale and timing fields, and explicitly confirms the append-only decision.

## AP decision requirements

Before recording V-001, confirm all of the following:

1. `AP_KEY` exists in Netlify as a production secret with Functions and Runtime scope.
2. Migration `0009_ap-decision-console` has applied successfully.
3. `/api/ap/violation-decisions` authenticates and returns the V-001 case.
4. The AP has chosen the decision type and final components.
5. Approvals/reductions include a completion deadline.
6. A required Penalty Uniform includes a start timestamp.
7. The public rationale contains no private, medical, financial, security, contact, signature, or private-evidence information.

The decision must be entered by the Accountability Partner through the authenticated console. The AP key and private rationale must never be committed, pasted into issues, or sent through public endpoints.

## Publication gate

Nothing should publish as an approved or active consequence until an immutable AP decision and activation record exist. Public pages must distinguish:

- proposed
- approved
- active
- performed
- verified
- satisfied

These terms are not interchangeable.
