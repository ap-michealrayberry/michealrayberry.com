-- Step 3: filing moves from Apps Script to the Worker.

-- One-time session codes, burned into the recording (contract §5 verification code).
CREATE TABLE challenges (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  day INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  context TEXT,                -- corrective: 'CTX3|V-…|C-…|A-…'; milestone: 'MS|<threshold>'
  used_at TEXT,
  UNIQUE (date, kind, code)
);

-- A corrective attestation is bound to its exact assignment and attempt (write-once).
CREATE TABLE corrective_contexts (
  seal TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL,
  ref TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  video_sha256 TEXT NOT NULL
);

-- Corrective session recordings as filed (one per attempt, write-once).
CREATE TABLE corrective_filings (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  violation_id INTEGER NOT NULL REFERENCES violations (id),
  assignment_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  date TEXT NOT NULL,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  attestation_seal TEXT NOT NULL,
  UNIQUE (assignment_id, attempt_id)
);

-- §7 milestone documentation: official only after AP review.
CREATE TABLE milestone_filings (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold IN (320, 300, 275, 250, 225, 200)),
  weight_lb REAL,
  url TEXT NOT NULL,
  attestation_seal TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'verified', 'rejected')),
  reviewed_at TEXT,
  ap_note TEXT
);

-- §4: receipts. When each packet component reached the record (ISO times, by component).
ALTER TABLE days ADD COLUMN receipts TEXT NOT NULL DEFAULT '{}';

ALTER TABLE weekly ADD COLUMN attestation_seal TEXT;
ALTER TABLE weekly ADD COLUMN covers TEXT; -- JSON array of the active dates the review reports

-- Stable identity of rows still mirrored from the Sheets (until step 4).
ALTER TABLE violations ADD COLUMN sheet_key TEXT;
CREATE UNIQUE INDEX violations_sheet_key ON violations (sheet_key);
