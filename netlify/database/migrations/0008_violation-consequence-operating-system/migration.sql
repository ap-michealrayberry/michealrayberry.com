-- Contract-driven violation and consequence operating system.
-- Public facts are separated from private deliberations, signatures, financial
-- amounts, medical details, and private corrective-session evidence.

create table if not exists private_record.document_attestations (
  attestation_id uuid primary key default gen_random_uuid(),
  document_id text not null references private_record.governing_documents(document_id),
  attestation_type text not null check (attestation_type in ('drive-copy-confirmed','offline-original-confirmed','execution-confirmed','effective-status-confirmed')),
  actor_role text not null,
  attested_at timestamptz not null,
  public_summary text not null,
  private_notes text,
  created_at timestamptz not null default now(),
  unique (document_id, attestation_type, attested_at)
);

create table if not exists public_record.consequence_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public_record.violations(id),
  proposal_version integer not null default 1 check (proposal_version > 0),
  proposed_level integer not null check (proposed_level between 1 and 3),
  proposed_corner_time_minutes integer check (proposed_corner_time_minutes in (15,20,30)),
  proposed_penalty_uniform boolean not null default false,
  proposal_status text not null check (proposal_status in ('proposed','approved','reduced','substituted','returned','waived','superseded')),
  proposed_at timestamptz not null,
  decided_at timestamptz,
  decision_summary text,
  effective_at timestamptz,
  completion_deadline timestamptz,
  overall_status text not null default 'open' check (overall_status in ('open','satisfied')),
  created_at timestamptz not null default now(),
  unique (violation_id, proposal_version)
);

create table if not exists public_record.consequence_components (
  component_id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public_record.consequence_assignments(assignment_id),
  component_type text not null check (component_type in ('public-acknowledgment','public-corner-time','violation-portrait','penalty-uniform-period','private-corrective-session','financial-status','other')),
  required boolean not null default true,
  public_component boolean not null default true,
  status text not null check (status in ('assigned','approved','performed','verified','overdue','waived','replaced')),
  required_duration_minutes integer,
  due_at timestamptz,
  performed_at timestamptz,
  verified_at timestamptz,
  public_url text,
  verification_summary text,
  created_at timestamptz not null default now(),
  unique (assignment_id, component_type)
);

create table if not exists private_record.consequence_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public_record.consequence_assignments(assignment_id),
  decision_type text not null check (decision_type in ('approve','reduce','substitute','return','waive','override','appeal-review')),
  decision_at timestamptz not null,
  public_reason text not null,
  private_rationale text,
  resulting_status text not null,
  created_at timestamptz not null default now()
);

create table if not exists private_record.safety_reviews (
  review_id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public_record.consequence_assignments(assignment_id),
  violation_id uuid references public_record.violations(id),
  review_type text not null check (review_type in ('safety-stop','medical-review','accessibility-review','technical-appeal')),
  status text not null check (status in ('requested','suspended','approved','correction-required','safe-substitute','closed')),
  requested_at timestamptz not null,
  resolved_at timestamptz,
  public_summary text,
  private_basis text,
  created_at timestamptz not null default now(),
  check (assignment_id is not null or violation_id is not null)
);

create table if not exists private_record.consent_media_actions (
  action_id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public_record.consequence_assignments(assignment_id),
  action_type text not null check (action_type in ('withdrawal-recorded','future-publication-stopped','project-media-removal-requested','project-media-removed','request-denied')),
  requested_at timestamptz not null,
  completed_at timestamptz,
  public_summary text,
  private_notes text,
  created_at timestamptz not null default now()
);

-- Register governing documents without storing signed bytes, signatures,
-- private Drive identifiers, or Appendix A amounts in the repository.
insert into private_record.governing_documents (
  document_id, document_type, display_title, internal_label, execution_status,
  effective_date, source_system, source_locator, private_original,
  public_copy_status, notes
) values
  ('agreement-execution-2026-07-20', 'agreement',
   'Micheal Ray Berry Public Accountability Agreement — Execution Copy',
   'agreement-execution-2026-07-20', 'confirmed_signed', '2026-07-20',
   'google-drive', 'private-authoritative-archive', true, 'summary_only',
   'Signed execution copy confirmed by the Accountability Partner. Appendix A amounts remain private.'),
  ('amendment-01-automated-violation', 'amendment',
   'Amendment No. 1 — Automated Violation Declaration',
   'amendment-01-automated-violation', 'confirmed_signed', '2026-08-01',
   'google-drive', 'private-authoritative-archive', true, 'summary_only',
   'Signed amendment confirmed by the Accountability Partner.'),
  ('amendment-05-escalated-public-consequences', 'amendment',
   'Amendment No. 5 — Escalated Public Consequences',
   'amendment-05-escalated-public-consequences', 'confirmed_signed', '2026-08-01',
   'offline-original-and-drive-reference', 'offline-authoritative-original', true, 'summary_only',
   'Offline signed original attested active by the Accountability Partner; Drive PDF is the reference copy.')
on conflict (document_id) do update set
  execution_status = excluded.execution_status,
  effective_date = excluded.effective_date,
  source_system = excluded.source_system,
  source_locator = excluded.source_locator,
  public_copy_status = excluded.public_copy_status,
  notes = excluded.notes,
  updated_at = now();

insert into private_record.document_attestations (
  document_id, attestation_type, actor_role, attested_at, public_summary, private_notes
) values
  ('agreement-execution-2026-07-20', 'execution-confirmed', 'Accountability Partner', '2026-08-01T13:56:00-04:00', 'Signed execution copy confirmed.', null),
  ('amendment-01-automated-violation', 'execution-confirmed', 'Accountability Partner', '2026-08-01T14:04:00-04:00', 'Signed Amendment No. 1 confirmed active.', null),
  ('amendment-05-escalated-public-consequences', 'offline-original-confirmed', 'Accountability Partner', '2026-08-01T16:00:00-04:00', 'Offline signed original confirmed active; Drive PDF retained as a reference copy.', 'Signature fields are not visible in the reference PDF. Authority is the AP attestation to the offline signed original.')
on conflict do nothing;

-- Import the confirmed July 31 violation. This is one violation event for the
-- missed daily packet deadline. The consequence proposal remains unapproved.
with inserted_violation as (
  insert into public_record.violations (
    project_date, declared_at, failed_requirement, objective_rule,
    declaration_source, system_version, accumulated_count, consequence_level,
    review_deadline, final_status, rule_version_id
  )
  select
    '2026-07-31'::date,
    '2026-07-31T22:00:00-04:00'::timestamptz,
    'Daily Compliance Packet was not received by the 22:00 ET deadline.',
    'One daily packet is required by 22:00 America/New_York; multiple same-day missing components constitute one violation event.',
    'automatic',
    'automated-declaration-1.0',
    1,
    1,
    '2026-08-02T22:00:00-04:00'::timestamptz,
    'unresolved',
    null
  where not exists (
    select 1 from public_record.violations
    where project_date = '2026-07-31'::date
      and failed_requirement = 'Daily Compliance Packet was not received by the 22:00 ET deadline.'
  )
  returning id
), violation_row as (
  select id from inserted_violation
  union all
  select id from public_record.violations
  where project_date = '2026-07-31'::date
    and failed_requirement = 'Daily Compliance Packet was not received by the 22:00 ET deadline.'
  order by id
  limit 1
)
insert into public_record.consequence_assignments (
  violation_id, proposal_version, proposed_level, proposed_corner_time_minutes,
  proposed_penalty_uniform, proposal_status, proposed_at, decision_summary,
  overall_status
)
select
  id, 1, 1, 15, true, 'proposed', '2026-08-01T16:02:00-04:00'::timestamptz,
  'System-generated proposal only. No consequence component is owed or approved until the Accountability Partner records a decision.',
  'open'
from violation_row
on conflict (violation_id, proposal_version) do nothing;

insert into public_record.violation_evidence (
  violation_id, evidence_type, description, public_url, sha256, captured_at
)
select
  v.id,
  'deadline-record',
  'The July 31 daily record contains weight data but no public packet media, and the source Penalty Log records the missed 22:00 ET packet deadline.',
  null,
  null,
  '2026-07-31T22:00:00-04:00'::timestamptz
from public_record.violations v
where v.project_date = '2026-07-31'::date
  and v.failed_requirement = 'Daily Compliance Packet was not received by the 22:00 ET deadline.'
  and not exists (
    select 1 from public_record.violation_evidence e
    where e.violation_id = v.id and e.evidence_type = 'deadline-record'
  );

insert into public_record.site_state_events (
  event_type, effective_at, violation_id, public_payload
)
select
  'violation-declared',
  '2026-07-31T22:00:00-04:00'::timestamptz,
  v.id,
  jsonb_build_object(
    'project_date', '2026-07-31',
    'requirement', 'Daily Compliance Packet by 22:00 ET',
    'status', 'unresolved',
    'consequence_assignment', 'proposed-pending-ap-decision'
  )
from public_record.violations v
where v.project_date = '2026-07-31'::date
  and v.failed_requirement = 'Daily Compliance Packet was not received by the 22:00 ET deadline.'
  and not exists (
    select 1 from public_record.site_state_events s
    where s.violation_id = v.id and s.event_type = 'violation-declared'
  );

create or replace view public_record.public_violation_cases as
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
  a.proposal_status,
  a.proposed_at,
  a.decided_at,
  a.decision_summary,
  a.effective_at,
  a.completion_deadline,
  a.overall_status,
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
  select ca.*
  from public_record.consequence_assignments ca
  where ca.violation_id = v.id
  order by ca.proposal_version desc
  limit 1
) a on true;

create index if not exists consequence_assignments_violation_idx
  on public_record.consequence_assignments(violation_id, proposal_version desc);
create index if not exists consequence_assignments_status_idx
  on public_record.consequence_assignments(proposal_status, overall_status);
create index if not exists consequence_components_assignment_idx
  on public_record.consequence_components(assignment_id, status);
create index if not exists document_attestations_document_idx
  on private_record.document_attestations(document_id, attested_at desc);

comment on view public_record.public_violation_cases is
  'Public-safe violation and consequence state. Excludes private rationale, signatures, financial amounts, medical details, and private evidence.';
