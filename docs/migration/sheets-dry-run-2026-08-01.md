# Google Sheets dry-run import report — 2026-08-01

Source spreadsheet: `MRB Accountability — Weigh-ins`

Spreadsheet ID: `1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM`

Mode: **read-only dry run**. No source or database records were changed.

## Proposed import counts

| Target | Proposed rows | Notes |
|---|---:|---|
| `public_record.project_days` | 13 | July 20 through August 1, 2026. August 1 exists as a dated placeholder and should be imported only as an open project day, not as a completed packet. |
| `public_record.weight_records` | 12 | July 20 through July 31 contain weights. |
| `public_record.daily_packets` | 12 | July 20 through July 31 have at least one recorded accountability component. Packet completion must be derived separately from component evidence. |
| `public_record.packet_components` | 60 | Four pose photographs plus one video expected per completed historical row. July 31 has weight only and requires missing-component states rather than fabricated URLs. |
| `public_record.violations` | 1 | July 31 unresolved automatic violation: missed 10 PM ET deadline; packet incomplete by two items. |
| `public_record.consequences` | 0 pending rule resolution | Consequence level and terms must be derived from the governing agreement/amendments, not inferred from the abbreviated Penalty Log row. |
| `public_record.rule_versions` | 0 pending reconciliation | Signed documents must be hashed and registered before dependent imports. |

## Weight validation

Twelve historical weight values are present:

- 2026-07-20: 337.8 lb
- 2026-07-21: 337.6 lb
- 2026-07-22: 337.8 lb
- 2026-07-23: 338.4 lb
- 2026-07-24: 338.1 lb
- 2026-07-25: 335.9 lb
- 2026-07-26: 337.0 lb
- 2026-07-27: 337.9 lb
- 2026-07-28: 337.9 lb
- 2026-07-29: 335.6 lb
- 2026-07-30: 337.6 lb
- 2026-07-31: 336.0 lb

Validation result: dates are unique, values are numeric, and all values fall within a plausible range. Source row identity should be preserved as `Weigh-ins:<row-number>`.

## Evidence validation

- July 20 through July 30 contain four pose-photo links and one video link.
- July 31 contains a weight and source note but no pose-photo or video URLs in the Weigh-ins tab.
- Existing URLs must be imported verbatim. The importer must not download, rewrite, or claim independent verification of the media during the first pass.
- July 31 missing evidence must remain explicitly missing; no placeholder evidence may be generated.

## Violation preservation

The Penalty Log contains one source row:

- Date: 2026-07-31
- Declaration: `Missed 10 PM ET deadline — Daily Compliance Packet incomplete (2 items) [auto-declared]`
- Status: `Unresolved`

Proposed normalized values:

- `project_date`: `2026-07-31`
- `declaration_source`: `automatic`
- `final_status`: `unresolved`
- `failed_requirement`: preserve the source text
- `objective_rule`: populate only after the signed rule version is registered
- `declared_at`: must be represented in Eastern Time; the date-only source does not establish an exact timestamp

The import must not invent a declaration timestamp, accumulated count, consequence level, or review deadline. Those required fields need an approved rule-derived value or a separate migration exception record.

## Blocking reconciliation items

1. **Amendment numbering conflict.** The Sheets Amendments tab identifies “Amendment No. 1 — Evening Meal Photograph,” while the separately supplied signed amendment identifies Amendment No. 1 as automated violation declaration and activation. Signed documents govern, but both records require distinct durable identifiers and a documented numbering correction.
2. **Spreadsheet timezone.** The source spreadsheet is configured as `America/Los_Angeles`; the governing process uses Eastern Time. Date-only values are safe as project dates, but timestamps must be normalized from their actual source context and must not inherit the spreadsheet timezone silently.
3. **Required violation fields.** The abbreviated Penalty Log row does not contain every non-null field required by the database schema.
4. **Rule-version hashes.** Signed agreement and amendment files must be hashed and entered in `public_record.rule_versions` before dependent packet and violation records are inserted.
5. **August 1 status.** The Weigh-ins row contains only the date at dry-run time and must not be represented as a completed submission.

## Recommended execution order

1. Register signed governing documents and hashes.
2. Resolve amendment identifiers without altering the signed documents.
3. Insert project days.
4. Insert 12 weight records.
5. Insert packet and component records with explicit missing states.
6. Insert the July 31 violation only after required rule-derived fields are approved.
7. Reconcile row counts, dates, weights, URLs, and hashes against the source.
8. Keep Google Sheets active until the reconciliation report passes.

## Dry-run decision

**Partially ready.** Weight records and project-day records are ready for a controlled transactional import. Packet evidence can be imported with explicit missing states. The July 31 violation and rule-version records remain blocked pending signed-document hashing and required-field reconciliation.
