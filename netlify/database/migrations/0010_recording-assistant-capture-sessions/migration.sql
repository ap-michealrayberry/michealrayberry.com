-- Recording Assistant capture-session system.
-- Sessions, challenge codes, attestations, uploads, and verification events
-- for the contractual capture instrument. Capture rows are created by the
-- capture-only PACKET_KEY path; nothing in this schema lets that path read,
-- modify, or delete existing records (enforced in the functions layer and by
-- the append-only triggers below).

create table if not exists private_record.capture_sessions (
  session_id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in (
    'daily-inspection',
    'weigh-in',
    'milestone-weigh-in',
    'meal-photo',
    'violation-portrait',
    'violation-resolution',
    'corrective-session',
    'location-check-in'
  )),
  project_date date not null,
  violation_id uuid references public_record.violations(id),
  assignment_id uuid references public_record.consequence_assignments(assignment_id),
  challenge_code text not null unique,
  code_issued_at timestamptz not null default now(),
  code_expires_at timestamptz not null,
  code_first_used_at timestamptz,
  requirements jsonb not null default '{}'::jsonb,
  upload_token_hash text not null,
  status text not null default 'issued' check (status in (
    'issued', 'recording', 'attested', 'uploading', 'uploaded',
    'verifying', 'verified', 'returned', 'incomplete',
    'safety-stop-pending-review', 'expired', 'cancelled'
  )),
  safety_stop boolean not null default false,
  safety_stop_reason text,
  client_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private_record.capture_components (
  component_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private_record.capture_sessions(session_id),
  component_kind text not null check (component_kind in (
    'inspection-video',
    'photo-front', 'photo-left', 'photo-rear', 'photo-right',
    'acknowledgment-video',
    'corner-time-video',
    'milestone-video',
    'scale-photo',
    'meal-photo',
    'violation-portrait',
    'corrective-session-video',
    'frame-strip',
    'location-record'
  )),
  -- public components publish to record pages after verification;
  -- private-ap components are delivered to AP storage only and must never be
  -- reachable from any public URL.
  storage_scope text not null check (storage_scope in ('public', 'private-ap')),
  attested_sha256 text,
  attested_bytes bigint,
  attested_duration_seconds numeric(10, 2),
  attested_at timestamptz,
  attest_client_meta jsonb,
  storage_key text,
  received_sha256 text,
  received_bytes bigint,
  uploaded_at timestamptz,
  filed_at timestamptz,
  public_url text,
  status text not null default 'pending' check (status in (
    'pending', 'attested', 'uploading', 'uploaded', 'hash-mismatch',
    'verifying', 'verified', 'returned', 'incomplete'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, component_kind)
);

-- Permanent verification log: hard gates, AI review, AP review, AP override.
-- Every automated result is recorded with model and prompt version. Rows are
-- immutable — corrections are new rows, never edits.
create table if not exists private_record.capture_verification_events (
  event_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private_record.capture_sessions(session_id),
  component_id uuid references private_record.capture_components(component_id),
  phase text not null check (phase in ('hard-gate', 'ai-review', 'ap-review', 'ap-override')),
  outcome text not null check (outcome in ('pass', 'fail', 'flagged-for-ap-review', 'error-fallback')),
  defects jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text,
  evidence jsonb,
  public_summary text,
  created_at timestamptz not null default now()
);

drop trigger if exists capture_verification_events_no_mutation on private_record.capture_verification_events;
create trigger capture_verification_events_no_mutation
before update or delete on private_record.capture_verification_events
for each row execute function private_record.reject_immutable_mutation();

create index if not exists capture_sessions_date_mode_idx
  on private_record.capture_sessions(project_date, mode);
create index if not exists capture_sessions_status_idx
  on private_record.capture_sessions(status);
create index if not exists capture_components_session_idx
  on private_record.capture_components(session_id, status);
create index if not exists capture_verification_events_session_idx
  on private_record.capture_verification_events(session_id, created_at);

-- Public-safe capture log: factual inventory only. Private-scope components
-- (corrective sessions, location records) surface status and duration but
-- never a storage key or URL, per Amendment No. 4 and §1.5.
create or replace view public_record.public_capture_log as
select
  s.session_id,
  s.mode,
  s.project_date,
  s.challenge_code,
  s.code_issued_at,
  s.status as session_status,
  s.safety_stop,
  c.component_kind,
  c.storage_scope,
  case when c.storage_scope = 'public' then c.attested_sha256 end as attested_sha256,
  c.attested_duration_seconds,
  c.attested_at,
  c.status as component_status,
  case when c.storage_scope = 'public' then c.public_url end as public_url,
  c.verified_summary
from private_record.capture_sessions s
left join lateral (
  select cc.*, (
    select v.public_summary
    from private_record.capture_verification_events v
    where v.component_id = cc.component_id and v.outcome = 'pass'
    order by v.created_at desc limit 1
  ) as verified_summary
  from private_record.capture_components cc
  where cc.session_id = s.session_id
) c on true
where s.mode <> 'location-check-in';

comment on table private_record.capture_sessions is
  'Recording Assistant sessions: one-time challenge codes, mode requirements read from the live record, and server-time compliance stamps.';
comment on table private_record.capture_components is
  'Attested capture files. attested_at is the server compliance stamp; bytes may land later (slow connection is not a miss, but no bytes = not filed).';
comment on table private_record.capture_verification_events is
  'Append-only verification history. A failed technical check never raises a consequence level or creates a violation by itself.';
comment on view public_record.public_capture_log is
  'Public-safe factual capture inventory. Private-scope media never exposes storage keys or URLs.';
