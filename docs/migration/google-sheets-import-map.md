# Google Sheets to Netlify Database import map

Status: planning and schema preparation only. No source records are imported by this change.

## Source workbook

- File: `MRB Accountability — Weigh-ins`
- Spreadsheet ID: `1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM`
- Source timezone currently reports `America/Los_Angeles`.
- Contract-governed project dates and deadlines must be interpreted in `America/New_York`; no timestamp conversion may rely on the workbook timezone without an explicit rule.

## Initial mappings

### Weigh-ins

| Sheet column | Destination |
| --- | --- |
| `date` | `public_record.project_days.project_date` and `public_record.weight_records.project_date` |
| `weight_lb` | `public_record.weight_records.weight_lb` |
| `note` | `public_record.weight_records.note` |
| source row identity | `public_record.weight_records.source_record_id` |
| literal source name | `public_record.weight_records.source_system` |
| `photo_front`, `photo_left`, `photo_rear`, `photo_right`, `video` | `public_record.packet_components.public_url`, one component row per item |

### Penalty Log

| Sheet column | Destination |
| --- | --- |
| `date` | `public_record.violations.project_date` |
| `violation` | parsed into `failed_requirement`, `objective_rule`, and `declaration_source` |
| `status` | normalized into `final_status` |

The July 31, 2026 row is an unresolved, automatically declared violation and must be preserved as such unless a later signed correction controls.

### Site State

The current tab contains only `key` and `value` headers in the inspected range. Import requires a complete bounded read before mapping to `public_record.site_state_events`.

### Form Responses

The inspected header is `Timestamp`, `Title`, and `Note`. These rows require classification before import; no direct destination is assumed.

### Amendments

The workbook currently lists an item titled `Amendment No. 1 — Evening Meal Photograph`. A separately supplied signed amendment is also numbered Amendment No. 1 and governs automated violation declarations. This numbering conflict must be reconciled against signed source documents before amendment metadata is imported.

## Import controls

1. Read-only source extraction.
2. Deterministic normalization in Eastern Time.
3. Dry-run report with row counts, rejected rows, and hashes.
4. Human approval of the dry-run report.
5. Transactional import with source IDs and audit events.
6. Post-import reconciliation against the source workbook.
7. Google Sheets remains authoritative until reconciliation passes and cutover is explicitly approved.

## Prohibited content

- Credentials or connection strings
- Appendix A dollar amounts
- Private exception evidence
- Any mutation of Wix MX/TXT records
