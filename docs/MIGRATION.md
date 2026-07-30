# Migration plan

## Phase 0 — freeze

- Do not delete or restructure the legacy production files.
- Stop adding optional features to the legacy implementation.
- Record the current production commit SHA and deployed URLs.

## Phase 1 — verify configuration

Before activating v2, verify:

- official start date
- official starting and goal weights
- daily deadline and timezone
- milestone values
- current Apps Script deployment
- authoritative Sheet and tab schema
- AP and participant account boundaries

## Phase 2 — backend import

- Export the current Apps Script source.
- Scan for secrets and hard-coded credentials.
- Commit sanitized source under `backend/`.
- Configure Script Properties for keys and IDs.
- Create or migrate the v2 tabs.

## Phase 3 — parallel run

- Deploy the public site, recorder, and AP console to staging.
- Submit test packets that cannot affect the official record.
- Test success, incomplete packet, network failure, duplicate submission,
  violation declaration, resolution, and recovery.
- Compare v2's public snapshot against the legacy record.

## Phase 4 — production cutover

- Pause writes briefly.
- Export a final backup.
- Import the latest official records.
- Switch the production domain.
- Confirm public pages, recorder submission, AP review, and scheduled checks.
- Keep the legacy implementation archived and read-only.
