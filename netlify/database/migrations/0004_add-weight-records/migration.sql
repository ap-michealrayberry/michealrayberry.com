-- Add normalized public weight records for controlled migration from the legacy Sheet.
-- This migration imports no records and contains no credentials or private financial data.

create table if not exists public_record.weight_records (
  id uuid primary key default gen_random_uuid(),
  project_date date not null unique references public_record.project_days(project_date),
  weight_lb numeric(6,1) not null check (weight_lb > 0),
  note text,
  source_system text not null,
  source_record_id text,
  imported_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists weight_records_project_date_idx
  on public_record.weight_records(project_date);
