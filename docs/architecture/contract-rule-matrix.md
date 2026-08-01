# Contract rule matrix

Status: Initial operating matrix. The signed execution agreement and later signed amendments override every other project document.

## Controlling documents verified

1. Micheal Ray Berry Public Accountability Agreement — Execution Copy.
2. Amendment No. 1 — Automated Violation Declaration and Violation Mode Activation.

A document is controlling only after execution requirements are verified. This matrix must be updated when another signed amendment is located or executed.

| Area | Controlling rule | System requirement |
|---|---|---|
| Authority | Signed agreement and later signed amendments override prior drafts, public announcements, repository notes, and implementation assumptions. | Store agreement versions and effective dates; associate automated decisions with a rule version. |
| Project time | Project Day and the daily deadline use Eastern Time. | Calculate with `America/New_York`; record UTC event time plus derived Project Day. |
| Daily packet | A packet requires every currently effective component and a successful server-side receipt by 10:00 PM ET. | Persist component state, validation results, receipt time, and an unambiguous success/failure response. |
| Downstream failure | Publication delay after successful timely receipt is not a participant violation. | Separate receipt state from publication jobs and retries. |
| Documentation | Required capture, identity, attire, pose, angle, integrity, and completeness rules are objective validation inputs. | Version validators and preserve their outputs as evidence. |
| Medical exception | Documented medical advice may pause requirements without penalty and without public medical detail. | Keep medical evidence private; expose only the authorized pause and dates. |
| Automatic declaration | Amendment No. 1 authorizes immediate automatic declaration from objective system evidence without advance AP approval. | Create an immutable declaration event containing the rule, evidence, time, Project Day, and system version. |
| July 31, 2026 | AP has determined the incomplete packet was a violation. | Preserve the event and migrate it as an official violation, including source provenance and subsequent state. |
| Immediate mode | Automatic declaration activates public Violation Mode immediately and does not wait for the review period. | Publish current violation state and record activation time. |
| Review | The participant retains 48 hours to submit objective compliance or exception evidence. | Accept evidence, record submission time, and provide an AP review workflow. |
| Correction | A material system error is corrected append-only as `System Error — No Violation`; original machine history remains in the administrative trail. | Never delete the declaration; append correction and cancel only consequences caused by the false declaration. |
| Levels | The accumulated violation count determines Level One, Two, or Three, subject to milestone resets. | Calculate from confirmed historical events and preserved reset events. |
| Consequences | Declaration creates the consequence record, Corner Time assignment, financial status, deadlines, and notifications. | Model assignments and state transitions separately from the violation event. |
| Public consequence fields | Public records include the contract-required level, requirements, deadlines, statuses, evidence links, mode history, and disposition. Dollar amounts and sensitive financial identifiers remain private. | Build explicit public projections; never expose private schema fields. |
| Permanent history | Accurate violation and consequence records remain permanent; corrections are dated and appended. | Use append-only event history and generated permanent archive pages. |
| Completion | Completion requires an official weigh-in at or below 175 lb, 28 qualifying days, and the required confirming official weigh-in. | Model completion period events and interruptions explicitly. |
| Abandonment | Implement only the exact controlling signed text and any later signed amendment. | Do not derive the rule from repository summaries. Add tests from the verified signed section before enabling automation. |
| Platforms | Publish records to the Official Platforms defined by the controlling version. | Store publication destination and external IDs; do not assume earlier platform lists remain complete. |
| Security | AP controls the operating record. Credentials and Appendix A confidential values are not public. | Server-only secrets, least privilege, audit logging, rotation procedures, and no credentials in Git. |
| DNS | Wix MX and TXT records must not be changed as part of the site migration. | Restrict DNS work to specifically reviewed web-host records, with a before/after export. |

## Open verification items

- Confirm the execution signatures and effective date of Amendment No. 1 from the original signed pages or signature metadata.
- Locate and verify any additional signed amendment, including any evening-meal-photo amendment, before treating its requirement as effective.
- Verify the controlling abandonment text directly before implementation.
- Verify Appendix A custody and deadline-calculation rules without committing or publishing dollar amounts.

## Change control

Any code or schema PR that implements a contractual rule must cite the controlling section and include tests for ordinary operation, late/missing data, accepted exception, downstream outage, duplicate delivery, and correction after system error.
