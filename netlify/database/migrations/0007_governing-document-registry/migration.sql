create table if not exists private_record.governing_documents (
  document_id text primary key,
  document_type text not null check (document_type in ('agreement', 'amendment', 'other')),
  display_title text not null,
  internal_label text not null unique,
  execution_status text not null check (execution_status in ('confirmed_signed', 'unconfirmed', 'withdrawn', 'superseded')),
  effective_date date,
  source_system text not null,
  source_locator text,
  content_sha256 text,
  mime_type text,
  byte_size bigint,
  private_original boolean not null default true,
  public_copy_status text not null default 'none' check (public_copy_status in ('none', 'summary_only', 'redacted_copy', 'public_original')),
  supersedes_document_id text references private_record.governing_documents(document_id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private_record.document_reconciliation_issues (
  issue_id bigserial primary key,
  issue_code text not null unique,
  status text not null check (status in ('open', 'resolved', 'dismissed')),
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  summary text not null,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into private_record.document_reconciliation_issues (
  issue_code, status, severity, summary, resolution, resolved_at
) values (
  'amendment-number-1-duplicate-sheet-entry',
  'resolved',
  'blocking',
  'The Amendments sheet contained an unverified Evening Meal Photograph entry also labeled Amendment No. 1, conflicting with the confirmed signed Automated Violation Declaration amendment.',
  'The unverified Sheet row was removed on 2026-08-01. No Drive file was deleted. The signed Automated Violation Declaration remains the sole confirmed Amendment No. 1.',
  now()
)
on conflict (issue_code) do update set
  status = excluded.status,
  severity = excluded.severity,
  summary = excluded.summary,
  resolution = excluded.resolution,
  resolved_at = excluded.resolved_at,
  updated_at = now();

comment on table private_record.governing_documents is
  'Private registry metadata for signed governing documents. Signed PDF bytes and Appendix A amounts are never stored in the public repository.';

comment on table private_record.document_reconciliation_issues is
  'Append-only-oriented reconciliation record for conflicts that must be resolved before enforcement data is imported.';
