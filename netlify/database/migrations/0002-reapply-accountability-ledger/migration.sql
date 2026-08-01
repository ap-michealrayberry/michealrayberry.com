-- Reapply the accountability ledger after production health verification showed
-- that migration 0001 was recorded without the expected schemas and tables.
-- This migration is idempotent and imports no production records.

create extension if not exists pgcrypto;

create schema if not exists public_record;
create schema if not exists private_record;
create schema if not exists audit;

create table if not exists public_record.rule_versions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type text not null check (document_type in ('agreement','amendment','system-rule')),
  effective_at timestamptz not null,
  source_url text,
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table if not exists public_record.project_days (
  project_date date primary key,
  project_day integer not null unique check (project_day > 0),
  timezone text not null default 'America/New_York',
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public_record.daily_packets (
  id uuid primary key default gen_random_uuid(),
  project_date date not null references public_record.project_days(project_date),
  received_at timestamptz,
  receipt_id text unique,
  submission_status text not null check (submission_status in ('pending','received','late','incomplete','invalid','excused')),
  rule_version_id uuid references public_record.rule_versions(id),
  source_system text not null,
  source_record_id text,
  created_at timestamptz not null default now()
);

create table if not exists public_record.packet_components (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public_record.daily_packets(id),
  component_type text not null,
  status text not null check (status in ('pending','valid','missing','invalid','excused')),
  received_at timestamptz,
  public_url text,
  sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (packet_id, component_type)
);

create table if not exists public_record.violations (
  id uuid primary key default gen_random_uuid(),
  project_date date not null references public_record.project_days(project_date),
  declared_at timestamptz not null,
  failed_requirement text not null,
  objective_rule text not null,
  declaration_source text not null check (declaration_source in ('automatic','manual')),
  system_version text not null,
  accumulated_count integer not null check (accumulated_count > 0),
  consequence_level integer not null check (consequence_level between 1 and 3),
  review_deadline timestamptz,
  final_status text not null check (final_status in ('unresolved','resolved','system-error-no-violation')),
  rule_version_id uuid references public_record.rule_versions(id),
  created_at timestamptz not null default now()
);

create table if not exists public_record.violation_evidence (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public_record.violations(id),
  evidence_type text not null,
  description text not null,
  public_url text,
  sha256 text,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public_record.consequences (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid not null unique references public_record.violations(id),
  corner_time_minutes integer not null check (corner_time_minutes in (15,20,30)),
  corner_time_due_at timestamptz,
  corner_time_status text not null,
  financial_due_at timestamptz,
  financial_status text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public_record.site_state_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  effective_at timestamptz not null,
  violation_id uuid references public_record.violations(id),
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public_record.ap_determinations (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public_record.violations(id),
  determination text not null,
  rationale text not null,
  determined_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists private_record.financial_consequence_details (
  id uuid primary key default gen_random_uuid(),
  consequence_id uuid not null unique references public_record.consequences(id),
  amount_cents bigint,
  currency text default 'USD',
  payment_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists private_record.exceptions (
  id uuid primary key default gen_random_uuid(),
  project_date date not null references public_record.project_days(project_date),
  exception_type text not null,
  private_basis text not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  actor_type text not null,
  actor_id text,
  rule_version_id uuid references public_record.rule_versions(id),
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  previous_event_hash text,
  event_hash text not null unique
);

create or replace function audit.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table: updates and deletes are prohibited';
end;
$$;

drop trigger if exists audit_events_no_update on audit.events;
create trigger audit_events_no_update
before update or delete on audit.events
for each row execute function audit.reject_mutation();

create index if not exists daily_packets_project_date_idx on public_record.daily_packets(project_date);
create index if not exists violations_project_date_idx on public_record.violations(project_date);
create index if not exists violations_status_idx on public_record.violations(final_status);
create index if not exists site_state_effective_idx on public_record.site_state_events(effective_at desc);
create index if not exists audit_events_entity_idx on audit.events(entity_type, entity_id, occurred_at);
