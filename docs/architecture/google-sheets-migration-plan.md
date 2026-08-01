# Google Sheets migration plan

Status: Draft for review. This document authorizes no production cutover.

## Current authoritative workbook

The current live workbook is `MRB Accountability — Weigh-ins`, owned by `ap@michealrayberry.com`. It remains operational until the replacement passes reconciliation and an AP-approved cutover.

## Migration principles

- The signed agreement and signed amendments control every field and workflow.
- Preserve the July 31, 2026 violation and all other historical records exactly as source evidence.
- Import source provenance for every row: workbook ID, sheet ID, row number, source timestamp where available, and import hash.
- Do not infer a violation from one missing source. Evaluate authoritative receipts, validation events, exceptions, media state, and consequence state under the controlling rules.
- Do not expose or copy credentials into migration files, logs, fixtures, or commits.
- Keep Wix MX and TXT records unchanged.

## Phases

### Phase 0 — Evidence and rule freeze

1. Inventory the execution agreement, signed amendments, Appendix A custody, and effective dates.
2. Build a rule-version register.
3. Export and hash every workbook tab.
4. Export Apps Script source and deployment metadata after scanning for secrets.
5. Record the currently live Apps Script deployment ID and endpoint consumers.

Exit criteria: signed-rule inventory and immutable source exports exist.

### Phase 1 — Schema and read-only importer

Create relational structures for:

- project days and packet receipts
- packet components and validation results
- media objects and publication destinations
- attestations and challenge events
- weigh-ins and health observations
- accepted exceptions
- violations, evidence, and review/correction events
- consequence assignments and state transitions
- agreement versions and amendments
- site-state events and publication jobs
- administrative audit events

Build a read-only importer. It must not write to the live workbook or change production behavior.

Exit criteria: repeatable imports produce identical counts and hashes.

### Phase 2 — Shadow reads

Run the new system alongside the workbook without serving it publicly. Compare:

- daily packet completeness
- deadlines in `America/New_York`
- violation count and levels
- active consequence status
- site mode
- public/private field projections

Exit criteria: no unexplained differences across an AP-approved observation period.

### Phase 3 — Dual write

Make the new database the first write target and retain the workbook as a temporary mirror. Each write receives a durable server receipt and an idempotency key. Failed mirrors create operational alerts but do not invalidate an otherwise successful authoritative receipt.

Exit criteria: every accepted write reconciles, and recovery procedures are tested.

### Phase 4 — Public read cutover

Move Astro public reads to contract-filtered database views or server functions. Keep the workbook available as a read-only comparison and emergency export.

Exit criteria: public pages, archives, violation mode, amendments, and current state match approved records.

### Phase 5 — Submission cutover

Move Recording Assistant and AP portal writes from Apps Script to authenticated server endpoints. Preserve the existing endpoint until clients and service-worker caches have migrated safely.

Exit criteria: end-to-end packet receipt, media processing, automatic violation declaration, review, correction, and consequence transitions are tested.

### Phase 6 — Decommission operating writes

Disable Apps Script triggers and workbook writes only after AP approval. Retain final exports, hashes, source mapping, and a documented rollback package.

## Required rollback capability

Before each cutover, document how to restore the previous write path, endpoint, data snapshot, and site deploy. A rollback must not delete or rewrite events accepted during the attempted cutover.

## First implementation boundary

The foundation PR may add documentation and non-production scaffolding only. It must not initialize a production database, change DNS, modify the existing endpoint, modify the service worker, alter the live workbook, or change Netlify production settings.
