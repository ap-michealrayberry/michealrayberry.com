-- michealrayberry.com record (replaces the Google Sheets workbook).
-- Contract: contract-2026-10-03.txt (Edition 2). Day 1 = 2026-10-03, America/New_York.
-- Timestamps are ISO-8601 UTC strings; record dates are YYYY-MM-DD (Eastern).

-- One row per Project Day. Created by the first filing for that date.
CREATE TABLE days (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL UNIQUE,
  weight_lb REAL,
  note TEXT,
  photo_front TEXT,
  photo_left TEXT,
  photo_rear TEXT,
  photo_right TEXT,
  video TEXT,
  video_sec INTEGER,
  stream_uid TEXT,
  r2_key TEXT
);

-- Scale-synced readings (Fitbit Web API). Manual weight is never accepted.
CREATE TABLE health (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL UNIQUE,
  steps INTEGER,
  zone_minutes INTEGER,
  active_minutes INTEGER,
  distance_mi REAL,
  calories INTEGER,
  weight_lb REAL,
  synced_at TEXT
);

CREATE TABLE attestations (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  logged_at TEXT NOT NULL,
  date TEXT NOT NULL,
  day INTEGER,
  event TEXT,
  code TEXT,
  kind TEXT CHECK (kind IN ('daily', 'weekly', 'corrective', 'confirmation', 'milestone', 'demo', 'announcement')),
  video_sha256 TEXT,
  photo_sha256s TEXT,
  weight REAL,
  status TEXT,
  chunk_chain TEXT,
  chunk_count INTEGER,
  server_seal TEXT,
  sealed_at TEXT
);
CREATE INDEX attestations_date ON attestations (date, kind);

-- Contract §8: a Violation Event exists only once the AP verifies it.
--   flagged   automated flag or observer report awaiting AP review (private)
--   rejected  AP reviewed and rejected the flag (private)
--   open      AP-verified, corrective outstanding (public)
--   submitted corrective recording received, awaiting AP verification (public)
--   resolved  AP verified the corrective session (public; the entry stays)
CREATE TABLE violations (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL,
  violation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('flagged', 'rejected', 'open', 'submitted', 'resolved')),
  status_note TEXT,                     -- the AP's own wording of the status (Sheets column C)
  verified_at TEXT,
  submitted_at TEXT,
  resolved_at TEXT,
  ap_verification TEXT,
  corrections TEXT NOT NULL DEFAULT '', -- append-only, ';'-separated
  recording TEXT,
  event_marker TEXT,
  public_id TEXT UNIQUE                 -- 'V-' + 12 hex, set on AP verification
);
CREATE INDEX violations_date ON violations (date);

CREATE TABLE correctives (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  violation_id INTEGER NOT NULL REFERENCES violations (id),
  assignment_id TEXT NOT NULL UNIQUE, -- 'C-' + 24 hex
  assigned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,               -- assigned_at + 72 h (§8)
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  minutes INTEGER NOT NULL CHECK (minutes IN (10, 20, 30)),
  status TEXT NOT NULL,
  completed_at TEXT,
  attempts TEXT NOT NULL DEFAULT '[]', -- JSON
  -- §9 safety stop / documented exception recorded by the AP
  revised_due_at TEXT,
  exception_note TEXT
);

-- Contract §6. status: SCHEDULED | IN PROGRESS | REVIEW REQUIRED | SUBMITTED |
-- COMPLETED | MISSED | EXCEPTION. Only an AP ruling writes COMPLETED/MISSED/EXCEPTION.
CREATE TABLE supervision (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL UNIQUE,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  stream_url TEXT,
  note TEXT,
  twitch_samples TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE weekly (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  logged_at TEXT NOT NULL,
  date TEXT NOT NULL,
  week INTEGER NOT NULL UNIQUE,
  documented INTEGER,
  required INTEGER,
  weight_lb REAL,
  open_entries INTEGER,
  url TEXT
);

CREATE TABLE confirmations (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  logged_at TEXT NOT NULL,
  date TEXT NOT NULL,
  edition INTEGER NOT NULL,
  day INTEGER,
  url TEXT,
  attestation_seal TEXT
);

-- type amendment = contract §12 (written, dated, co-signed).
CREATE TABLE updates (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('official', 'personal', 'amendment')),
  title TEXT,
  body TEXT,
  link TEXT
);

CREATE TABLE site_state (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL
);

-- Was "Contests". One per violation, no time window (contract §3).
CREATE TABLE correction_requests (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  received_at TEXT NOT NULL,
  violation_id INTEGER NOT NULL UNIQUE REFERENCES violations (id),
  reason TEXT NOT NULL,
  evidence_url TEXT,
  status TEXT NOT NULL,
  ap_note TEXT
);

CREATE TABLE portal_filings (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  received_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  violation_id INTEGER REFERENCES violations (id),
  assignment_id TEXT,
  url TEXT,
  status TEXT NOT NULL
);

CREATE TABLE observer_reports (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  received_at TEXT NOT NULL,
  type TEXT,
  record_ref TEXT,
  message TEXT,
  name TEXT,
  email TEXT,
  source_url TEXT,
  quotable INTEGER NOT NULL DEFAULT 0,
  review TEXT NOT NULL DEFAULT 'received',
  ap_note TEXT
);

CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'UNSUBSCRIBED')),
  token TEXT NOT NULL,
  confirmed_at TEXT
);

-- Append-only audit log. hash = sha256(prev_hash || '\n' || canonical row JSON).
-- prev_hash is UNIQUE so two concurrent writers cannot fork the chain: the loser retries.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL UNIQUE
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
