-- Step 4: scheduled jobs, email, Twitch, Fitbit move to the Worker.

-- Each scheduled job runs at most once per slot (a date, an hour, or a 5-minute tick).
CREATE TABLE job_runs (
  job TEXT NOT NULL,
  slot TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  outcome TEXT,
  PRIMARY KEY (job, slot)
);

-- Where a flag came from and which requirement it concerns (contract §8: a flag is
-- evidence for AP review, never a Violation Event by itself).
ALTER TABLE violations ADD COLUMN source TEXT;       -- nightly | supervision | corrective-deadline | observer | sheets | ap
ALTER TABLE violations ADD COLUMN requirement TEXT;  -- e.g. 'daily-packet', 'evening-supervision', 'corrective-deadline'
ALTER TABLE violations ADD COLUMN subject_ref TEXT;  -- e.g. the corrective assignment id a deadline flag is about
CREATE UNIQUE INDEX violations_flag_once ON violations (date, requirement, subject_ref) WHERE source IN ('nightly', 'supervision', 'corrective-deadline');

-- Weight readings as the scale reported them (Fitbit Web API), one row per log entry.
CREATE TABLE weight_readings (
  log_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  date TEXT NOT NULL,
  time TEXT,
  weight_lb REAL NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX weight_readings_date ON weight_readings (date);
