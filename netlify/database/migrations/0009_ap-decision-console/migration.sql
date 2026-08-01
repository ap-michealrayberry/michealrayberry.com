-- Authenticated AP decision and activation layer.
-- Proposals remain immutable; decisions and activations are append-only records.

create table if not exists public_record.consequence_activations (
  activation_id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public_record.consequence_assignments(assignment_id),
  decision_id uuid not null unique references private_record.consequence_decisions(decision_id),
  approved_level integer check (approved_level between 1 and 3),
  corner_time_minutes integer check (corner_time_minutes in (15,20,30)),
  penalty_uniform_required boolean not null default false,
  penalty_uniform_starts_at timestamptz,
  completion_deadline timestamptz,
  private_corrective_required boolean not null default false,
  activation_status text not null check (activation_status in ('active','returned','waived','substituted')),
  public_reason text not null,
  governing_document_id text not null references private_record.governing_documents(document_id),
  activated_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists private_record.ap_decision_audit (
  audit_id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references private_record.consequence_decisions(decision_id),
  request_fingerprint text not null,
  actor_role text not null default 'Accountability Partner',
  recorded_at timestamptz not null default now(),
  payload jsonb not null,
  unique (decision_id, request_fingerprint)
);

create or replace function private_record.reject_immutable_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'immutable record: updates and deletes are prohibited';
end;
$$;

drop trigger if exists consequence_decisions_no_mutation on private_record.consequence_decisions;
create trigger consequence_decisions_no_mutation
before update or delete on private_record.consequence_decisions
for each row execute function private_record.reject_immutable_mutation();

drop trigger if exists consequence_activations_no_mutation on public_record.consequence_activations;
create trigger consequence_activations_no_mutation
before update or delete on public_record.consequence_activations
for each row execute function private_record.reject_immutable_mutation();

drop trigger if exists ap_decision_audit_no_mutation on private_record.ap_decision_audit;
create trigger ap_decision_audit_no_mutation
before update or delete on private_record.ap_decision_audit
for each row execute function private_record.reject_immutable_mutation();

-- PostgreSQL cannot use CREATE OR REPLACE VIEW when an existing column would
-- be renamed or when new columns are inserted before an existing column.
-- Drop and recreate the derived public-safe view inside the migration transaction.
drop view if exists public_record.public_violation_cases;

create view public_record.public_violation_cases as
select
  v.id as violation_id,
  pd.project_day,
  v.project_date,
  v.declared_at,
  v.failed_requirement,
  v.objective_rule,
  v.accumulated_count,
  v.consequence_level,
  v.review_deadline,
  v.final_status,
  a.assignment_id,
  a.proposal_version,
  a.proposed_level,
  a.proposed_corner_time_minutes,
  a.proposed_penalty_uniform,
  case when x.activation_id is null then a.proposal_status else x.activation_status end as proposal_status,
  a.proposed_at,
  d.decision_at as decided_at,
  coalesce(x.public_reason, a.decision_summary) as decision_summary,
  x.activated_at as effective_at,
  x.completion_deadline,
  a.overall_status,
  x.approved_level,
  x.corner_time_minutes,
  x.penalty_uniform_required,
  x.penalty_uniform_starts_at,
  x.private_corrective_required,
  x.governing_document_id,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'component_type', c.component_type,
      'status', c.status,
      'required', c.required,
      'required_duration_minutes', c.required_duration_minutes,
      'due_at', c.due_at,
      'performed_at', c.performed_at,
      'verified_at', c.verified_at,
      'public_url', c.public_url,
      'verification_summary', c.verification_summary
    ) order by c.component_type)
    from public_record.consequence_components c
    where c.assignment_id = a.assignment_id and c.public_component = true
  ), '[]'::jsonb) as public_components
from public_record.violations v
join public_record.project_days pd on pd.project_date = v.project_date
left join lateral (
  select ca.* from public_record.consequence_assignments ca
  where ca.violation_id = v.id order by ca.proposal_version desc limit 1
) a on true
left join public_record.consequence_activations x on x.assignment_id = a.assignment_id
left join private_record.consequence_decisions d on d.decision_id = x.decision_id;

comment on table public_record.consequence_activations is
  'Append-only public-safe effect of an authenticated AP decision. The original proposal is never edited.';
