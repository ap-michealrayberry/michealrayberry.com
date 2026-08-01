# ADR-001: Astro and Netlify record system

- Status: Proposed
- Date: 2026-08-01
- Scope: Foundation only; no production cutover

## Decision

Adopt Astro as the public-site framework and Netlify as the deployment and server-execution platform. Replace Google Sheets and Apps Script as the authoritative operating system through a staged migration to a server-side relational database and controlled object storage.

The signed Public Accountability Agreement and every later signed amendment are the controlling authority. Repository notes, implementation documents, database schemas, and code must conform to them.

## Target components

- Astro for public pages, permanent archives, the Recording Assistant shell, and the AP portal.
- Netlify deploy previews and production deploys.
- A server-side relational database accessed only through trusted functions.
- Netlify Functions for packet receipt, validation, violation declaration, review, correction, consequence state, and AP actions.
- Object storage for original media, receipts, manifests, evidence attachments, and exports.
- YouTube for public videos required by the agreement.
- GitHub for code, schema migrations, rule versions, generated public artifacts, and review history.

## Non-negotiable controls

1. No browser receives a privileged database credential.
2. Private Appendix A amounts, payment evidence, medical information, credentials, and internal AP notes never enter public records.
3. Historical declarations and corrections are append-only. Corrections add events rather than silently rewriting prior events.
4. Every automated declaration records the failed requirement, objective rule, supporting evidence, declaration time, Project Day, system version, assigned level, and consequence activation.
5. Project-day and deadline calculations use `America/New_York`.
6. A successful server-side packet receipt is distinguished from downstream publication success.
7. Public records expose every field required by the controlling agreement and signed amendments, but no field they require to remain private.
8. Wix MX and TXT records are outside the migration scope and must not be altered.
9. Credentials, tokens, private keys, deployment secrets, and Appendix A amounts must not be committed.

## Why Astro

The project is primarily a permanent, indexable public record with a limited number of interactive and authenticated workflows. Astro supports static output for historical records while allowing server-rendered endpoints and components where current state or authenticated actions are required.

## Why not use Sheets as the final authority

The current workbook is useful as an operational prototype but does not provide a sufficiently explicit event model for immutable declarations, corrections, rule versions, evidence relationships, consequence state changes, and public/private field separation. It also currently uses a spreadsheet timezone inconsistent with the contract.

## Consequences

- Migration must be staged and reversible.
- Google Sheets and Apps Script remain operational until reconciliation proves the replacement complete.
- The first implementation PR must not switch production reads or writes.
- Database selection and initialization require a separate reviewed decision after Netlify capabilities and pricing are verified in the connected account.
