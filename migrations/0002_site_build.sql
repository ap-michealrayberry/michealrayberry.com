-- Step 2: the Worker builds and serves the site.

-- Size and digest of each filed photograph, read once from R2.
CREATE TABLE media_meta (
  key TEXT PRIMARY KEY,           -- R2 key, e.g. photos/2026/10/03/micheal-ray-berry-day-001-front-2026-10-03.jpg
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL
);

-- Named leases (e.g. 'build'): taken with a conditional UPDATE, so only one holder at a time.
CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  until TEXT NOT NULL
);
INSERT INTO locks (name, until) VALUES ('build', '1970-01-01T00:00:00.000Z');
