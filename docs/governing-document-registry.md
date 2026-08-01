# Governing document registry

## Purpose

The registry separates private signed originals from public-safe metadata and blocks enforcement imports when the governing document chain is ambiguous.

## Storage boundaries

- Google Drive stores private signed original PDFs.
- `private_record.governing_documents` stores metadata, execution status, effective dates, source references, hashes, sizes, and supersession relationships.
- `private_record.document_reconciliation_issues` stores blocking conflicts and their resolutions.
- GitHub stores schema and operational documentation only. It does not store signed PDF bytes, signatures, credentials, or Appendix A amounts.

## Confirmed documents

The private archive currently contains a signed execution copy and a signed amendment titled “Amendment No. 1 — Automated Violation Declaration.” Their private Drive originals remain unchanged.

## Resolved numbering conflict

The Google Sheet previously contained an unverified row titled “Amendment No. 1 — Evening Meal Photograph.” The row referenced a filename, but a corresponding signed original was not confirmed in Drive. The duplicate numbering conflicted with the confirmed signed automated-violation amendment.

On August 1, 2026, the unverified Sheet row was deleted after explicit approval. No Drive file was deleted. The confirmed signed automated-violation amendment remains the sole current Amendment No. 1.

## Remaining work before violation import

1. Compute SHA-256 hashes from the private original bytes without committing the files.
2. Insert the confirmed execution copy and signed amendment into the private registry through a secure administrative process.
3. Record effective dates and the amendment-to-agreement relationship.
4. Verify that the applicable rule version for July 31, 2026 is unambiguous.
5. Import the July 31 violation in a separate reviewed migration while keeping financial consequence details private.

## Rollback

Migration `0007_governing-document-registry` creates only private metadata and reconciliation tables. Rolling back should remove those tables only after exporting any administrative records. It must not delete or alter signed Drive originals.
