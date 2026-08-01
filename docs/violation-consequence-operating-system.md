# Violation and Consequence Operating System

## Purpose

This subsystem records objective violation facts, generates a proposed consequence, requires an explicit Accountability Partner decision, and publishes only the public-safe state.

## Governing inputs

The registry treats the following as active based on Accountability Partner confirmation:

- the July 20, 2026 execution agreement;
- Amendment No. 1, Automated Violation Declaration; and
- Amendment No. 5, Escalated Public Consequences, supported by an offline signed original and a Drive reference copy.

Signed bytes, signatures, private Drive identifiers, Appendix A amounts, medical details, private deliberations, and private corrective-session footage are not stored in the public repository.

## July 31 violation

The migration records one violation event for July 31, 2026:

- requirement: Daily Compliance Packet by 22:00 America/New_York;
- observed state: no packet media recorded by the deadline;
- declaration source: automatic;
- accumulated count: 1;
- level: 1;
- status: unresolved;
- review deadline: 48 hours after declaration.

Multiple missing components on the same date remain one violation event.

## Proposed consequence

The system creates proposal version 1 with:

- Level One;
- 15 minutes of public corner time;
- Penalty Uniform proposed;
- status `proposed`;
- no effective date and no completion deadline.

This proposal is not approved, owed, performed, or published as an approved consequence until the Accountability Partner records one of the allowed decisions: approve, reduce, substitute, return, waive, override, or appeal review.

## Public surfaces

- `/violations/` provides the human-readable record.
- `/api/public/violations` provides stable JSON with ETag, GET/HEAD support, and conditional 304 responses.
- `public_record.public_violation_cases` excludes private rationale and sensitive evidence.

## Status model

Assignment statuses:

`proposed · approved · reduced · substituted · returned · waived · superseded`

Component statuses:

`assigned · approved · performed · verified · overdue · waived · replaced`

Overall status:

`open · satisfied`

## Safety and consent

The private workflow supports safety stops, medical review, accessibility review, technical appeals, safe substitutes, prospective consent withdrawal, future-publication stops, and project-controlled media removal requests.

A good-faith safety stop is not a new violation. Permanent-abandonment remains a manual Accountability Partner determination.

## Required next decision

Before any Amendment No. 5 public consequence becomes active, the Accountability Partner must record a decision for the July 31 proposal. Until that write exists, the public record must continue to label the consequence as proposed and pending AP decision.

## Rollback

Before production migration, revert this PR. After production migration, preserve the violation and audit history. Disable the public page or function if necessary, but do not delete the factual violation or attestation records. Correct errors through new determinations or superseding proposal versions.
