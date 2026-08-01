-- Controlled initial import from the legacy Google Sheet.
-- Source spreadsheet: MRB Accountability — Weigh-ins.
-- This migration imports only project-day and weight records approved by the dry-run report.
-- It does not import violations, consequences, amendments, private data, credentials, or Appendix A amounts.

insert into public_record.project_days (project_date, project_day, timezone, status)
values
  ('2026-07-20', 1, 'America/New_York', 'open'),
  ('2026-07-21', 2, 'America/New_York', 'open'),
  ('2026-07-22', 3, 'America/New_York', 'open'),
  ('2026-07-23', 4, 'America/New_York', 'open'),
  ('2026-07-24', 5, 'America/New_York', 'open'),
  ('2026-07-25', 6, 'America/New_York', 'open'),
  ('2026-07-26', 7, 'America/New_York', 'open'),
  ('2026-07-27', 8, 'America/New_York', 'open'),
  ('2026-07-28', 9, 'America/New_York', 'open'),
  ('2026-07-29', 10, 'America/New_York', 'open'),
  ('2026-07-30', 11, 'America/New_York', 'open'),
  ('2026-07-31', 12, 'America/New_York', 'open'),
  ('2026-08-01', 13, 'America/New_York', 'open')
on conflict (project_date) do update
set project_day = excluded.project_day,
    timezone = excluded.timezone;

insert into public_record.weight_records (
  project_date,
  weight_lb,
  note,
  source_system,
  source_record_id,
  imported_at
)
values
  ('2026-07-20', 337.8, null, 'google-sheets', 'Weigh-ins!2', now()),
  ('2026-07-21', 337.6, null, 'google-sheets', 'Weigh-ins!3', now()),
  ('2026-07-22', 337.8, null, 'google-sheets', 'Weigh-ins!4', now()),
  ('2026-07-23', 338.4, null, 'google-sheets', 'Weigh-ins!5', now()),
  ('2026-07-24', 338.1, null, 'google-sheets', 'Weigh-ins!6', now()),
  ('2026-07-25', 335.9, null, 'google-sheets', 'Weigh-ins!7', now()),
  ('2026-07-26', 337.0, null, 'google-sheets', 'Weigh-ins!8', now()),
  ('2026-07-27', 337.9, null, 'google-sheets', 'Weigh-ins!9', now()),
  ('2026-07-28', 337.9, null, 'google-sheets', 'Weigh-ins!10', now()),
  ('2026-07-29', 335.6, null, 'google-sheets', 'Weigh-ins!11', now()),
  ('2026-07-30', 337.6, 'scale-synced (Withings via Google Health)', 'google-sheets', 'Weigh-ins!12', now()),
  ('2026-07-31', 336.0, 'scale-synced (Withings via Google Health)', 'google-sheets', 'Weigh-ins!13', now())
on conflict (project_date) do update
set weight_lb = excluded.weight_lb,
    note = excluded.note,
    source_system = excluded.source_system,
    source_record_id = excluded.source_record_id,
    imported_at = excluded.imported_at;
