-- Step 5: the AP console.

-- §12: an amendment takes effect only once written, dated, logged and co-signed by both parties.
ALTER TABLE updates ADD COLUMN cosigned_on TEXT;

-- §10: corrections, redactions and removals keep a dated explanation, without repeating
-- the protected information.
CREATE TABLE redactions (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  target TEXT NOT NULL,        -- e.g. 'days:2026-10-05:video', 'days:2026-10-05:photo_front'
  date TEXT NOT NULL,
  explanation TEXT NOT NULL,
  actor TEXT NOT NULL
);
