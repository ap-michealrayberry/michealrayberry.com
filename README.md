# MichealRayBerry.com

This repository builds the public, static accountability record at
`michealrayberry.com`. The mixed operational workbook, raw media, credentials,
and deployment identifiers are private inputs. The browser receives only the
reviewed files staged into `dist/` during the build.

The code and static site may be deployed while the agreement gate is inactive.
Inactive means no enforcement, retrospective ruling, or public agreement status
may be inferred from the deployment itself.

## Authoritative current state


`project-config-v2.json` is the reviewed Edition 2 source: official Day 1 October 11, 2026, declared baseline 340.0 lb, goal 200.0 lb, and 28 consecutive days at goal. Keep the signed edition and this config aligned. After a reviewed change, run `npm run sync-config`; CI refuses mismatched generated server/assistant facts. Site State dates must match the versioned config.

Public prelaunch testing remains enabled from October 3 through October 10. Test evidence and AP-reviewed outcomes remain at `/testing/` after launch and are excluded from official progress. A test gate runs simulated requirements; it does not verify signatures or consent. Keep test rows and published derivative assets in the source feeds so the archive can be rebuilt.

- Edition 2 is the only current agreement version. It has no operative effect
  until the execution gate below reports `ACTIVE`.
- Routine recordings use a plain black unitard. Recorded corrective sessions
  use the designated pink unitard.
- Weight change is informational. It is never itself a violation or a trigger
  for corrective action; only a documentation failure can be evaluated under
  the active agreement.
- The declared baseline remains 340 lb. The earliest scale measurement is a
  separate observed fact and must not replace that declaration.
- A daily packet is one dated tracker row with a recorded weight, all four
  photo angles, and the inspection video. Attestation supports provenance but
  is not an extra packet-completion requirement.
- A scale row at or below a threshold means **threshold recorded**, not
  **milestone reached**. A milestone becomes official only after the required
  milestone video and explicit Accountability Partner verification.
- Public live supervision is ON (user ruling, Oct 3 2026). During a confirmed
  session /live/ embeds the Twitch live stream (twitch.tv/michealrayberry) and
  the public Twitch player is available on /live/. Attendance and completion remain separate AP-reviewed states. Optional Cloudflare Pages variables:
  `TWITCH_CHANNEL` (default michealrayberry) and `TWITCH_PARENTS` (extra
  hostnames, comma-separated, e.g. the *.pages.dev preview). YouTube stays the
  archive for recorded sessions.

## Non-negotiable privacy boundaries

`PUBLIC_SUPERVISION_VIDEO_ENABLED = true` in `apps-script/Code.gs` (Oct 3
2026). `PUBLIC_SUPERVISION_URLS_ENABLED` (Cloudflare Pages env) separately controls archive
links for completed sessions. Agreement execution still decides whether any
session is required. Camera framing: a plain area, no windows, mail, documents,
or exterior features that identify the location.

The operations workbook and every raw, corrective, intake, and mirror Drive
item must remain `PRIVATE`, shared only with named operational collaborators,
with editor resharing disabled. The script fails closed when it cannot verify
that boundary. Do not make the workbook public to satisfy a build.

Public browser code must use only reviewed same-origin outputs such as
`/data/weigh-ins.csv`, `/data/violations.csv`, and the sanitized JSON feeds.
It must never fetch the operations workbook, a Google Sheets export, or a raw
Drive object directly.

Do not commit or publish any real spreadsheet ID, Drive URL, Apps Script `/exec`
URL, AP/device/unlock/observer key, OAuth credential, GitHub token, build hook,
or private feed URL. Store operational values only in Apps Script Properties,
the hosting environment, and a private runbook. Public examples must use
placeholders such as `<PRIVATE_RECORD_SHEET_ID>` and
`<APPS_SCRIPT_EXEC_URL>`.

Raw camera bytes are quarantine inputs, not publishable assets. The GitHub
mirror accepts only constrained JPEG input, rejects metadata-bearing or
ambiguous containers, strips allowed non-pixel segments, verifies the exact
source digest against the corresponding same-date daily attestation, verifies
the published digest, and then changes the Sheet pointer. It never republishes
the original camera blob. A rejected file must be physically oriented and
re-encoded through the repository's pinned image pipeline before it replaces
the private source.

## Agreement execution gate

Apps Script enforcement is fail closed. Activation requires all of the
following:

1. `Site State` selects agreement edition `2`.
2. `start_date` is a real ISO date.
3. Micheal's signature and the Accountability Partner's signature have each
   been personally verified, with real verification dates recorded by the
   Sheet menu.
4. A valid Edition 2 Confirmation row exists. Its canonical YouTube URL and
   `attestation_seal` must identify one exact same-date, challenge-consumed,
   sealed confirmation attestation.
5. The AP has reviewed that immutable confirmation. The Sheet menu stores its
   bound date, review date, and a fingerprint over edition, date, canonical
   URL, attestation seal, and attested video hash.

The effective date is:

```text
max(project start, Micheal signature date, AP signature date,
    earliest valid Edition 2 confirmation date, AP confirmation review date)
```

Every prerequisite date must be real, and the effective date must be today or
earlier. Future-dated prerequisites keep the gate inactive. Dates before the
effective date and dates after the current Eastern civil day are non-operative.
Nightly checks, weekly reviews, missed-day and completion streaks, corrective
deadlines, supervision rulings, stage transitions, milestone notices, imports,
and mirrors are bounded to that interval.

The Attestation tab contract has exactly these first 14 columns:

```text
logged_at_server, date, day, event, code, kind, video_sha256,
photo_sha256s, weight, status, chunk_chain, chunk_count, server_seal,
sealed_at
```

On first use, Apps Script may add the four blank seal columns to the known
legacy 10-column layout. It refuses to overwrite a shifted or unexpected
header. Legacy rows without valid seal data remain invalid and are never
backfilled. The v2 HMAC binds every normalized security-relevant column except
the seal itself; earlier partial-field seals are intentionally invalid. An
accepted row must satisfy the full schema and its HMAC must recompute
successfully.

Every operative daily, weekly, or corrective filing must carry the exact
accepted attestation seal for that capture; same-date fallback matching is not
allowed. Corrective challenges are additionally bound server-side to one
canonical opaque violation reference, assignment id, and current attempt id;
the resulting seal cannot be reused for a different assignment or rejected
attempt. A later delivery retains the accepted capture date and is permitted
only with a server seal created before 10 PM ET and within the applicable
assignment window. New challenges still require current eligibility. Weekly counts, closing weight, and open-entry
totals are recomputed from the protected workbook before a filing is accepted;
client-provided figures are comparison claims, not authority.

The sanitized Weigh-ins build feed has exactly these nine columns:

```text
date, weight_lb, note, photo_front, photo_left, photo_rear, photo_right,
video, video_sec
```

`published_at` belongs only to the generated public CSV and must not be fed
back into the publisher as a recording duration.

The Confirmations tab and sanitized build feed have exactly these six columns:

```text
logged_at, date, version, day, url, attestation_seal
```

The participant route writes the accepted seal with the pending row. A URL is
filled once, and the AP review fingerprint binds the exact resulting evidence.

The Violation Log contract has these first nine columns:

```text
date, violation, status, submitted, resolved, ap_verification,
corrections, recording, event_verification
```

Automated checks may add a private `Pending AP review` signal, but it is not a
violation, is not published, and does not affect corrective levels. The AP must
review the exact date and wording. Approval writes an `APV1` marker in the
protected `event_verification` column; that marker binds the decision to both
fields. Blank, malformed, copied, future-dated, or stale markers fail closed.
Existing rows must be reviewed individually and are never grandfathered.
Public violation IDs are stable opaque values derived from that validated
marker; they do not expose private worksheet row positions. A Corrective Log
assignment is operative only when its status carries the full source `APV1`
marker and its protected `assignment_id` is a valid opaque `C-…` identity. The
six-column Corrective Log contract is:

```text
date, assignment, due, status, completed, assignment_id
```

`setup()` performs the explicit append-only migration and assigns identities
to existing rows. New AP assignments require a unique `request_id`; retries of
that request deterministically return the same assignment instead of creating
a second generation. Participant filing is accepted only for that one exact
open assignment, current opaque `A-…` attempt, and recorded due date. Each
attempt identity is derived from the assignment plus the protected rejection
generation and is bound through challenge issuance, capture attestation,
offline queueing, filing, and AP review. Legacy queued corrective records that
lack this identity are quarantined rather than retried. If the AP rejects a
filed session, protected `APJ1` evidence keeps the same assignment open for a
full retry after the initial due date and chains every rejected recording URL
hash, so an editable status cannot authorize a retry and a rejected video
cannot be filed again. The device endpoint cannot replace a recording already
on file. Acceptance is two explicit AP decisions: complete the exact
assignment and attempt only after its server-bound filing evidence validates,
then resolve that same completed attempt. A valid `APR1` marker in
`ap_verification` binds the original `APV1` marker and exact resolution date;
editing visible status or completion text alone cannot close or hide an
approved event.

To activate intentionally:

1. Record the Edition 2 Consent Confirmation through the assistant so the
   server consumes a same-date challenge and writes a sealed
   `VALID-CONSUMED` attestation.
2. File the canonical YouTube recording URL on that Confirmation date.
3. Personally verify both signatures and review the filed confirmation.
4. In the operations Sheet choose **MRB → Agreement gate · verify both
   signatures**.
5. Choose **Agreement gate · show status** and require
   `ACTIVE effective YYYY-MM-DD` before operating any enforcement path.

Signature images do not belong in `Site State`. **Agreement gate · revoke
signature verification** clears both signature and confirmation-review
bindings, triggers a rebuild, and immediately disables gated processing. Triggers may
be installed before activation; they log an inactive result and do not perform
gated work.

## Apps Script setup

Run setup from the AP-owned Apps Script project and keep all returned values in
the private runbook.

1. Paste `apps-script/Code.gs` into the project.
2. Run `createRecordSpreadsheet()` for a new private workbook, or point at an
   existing private workbook with `setSheetId('<PRIVATE_RECORD_SHEET_ID>')`.
   Creation refuses to replace an existing `SHEET_ID`.
3. Set independent long random values with
   `setApKey('<LONG_RANDOM_AP_KEY>')`,
   `setDeviceKey('<LONG_RANDOM_DEVICE_KEY>')`, and
   `setUnlockCode('<LONG_RANDOM_UNLOCK_CODE>')`.
   The unlock code must be 20–128 characters with no surrounding whitespace;
   generate it cryptographically rather than choosing a memorable phrase.
   The assistant requires the device key plus the AP unlock code, then uses a
   server-issued 14-day HMAC token bound to both current values. Rotating either
   value invalidates outstanding tokens.
4. Run `showPhotosFolderUrl()`. Store the result privately and share it only
   with named collaborators. For an optional private participant archive, use
   `setMirrorFolder('<PRIVATE_MIRROR_FOLDER_ID>')`, then `mirrorBackfill()`.
5. If photo mirroring is enabled, use
   `setGithubToken('<FINE_GRAINED_GITHUB_TOKEN>')` with only the required
   repository permission.
6. Add the production build hook with
   `setBuildHook('<CLOUDFLARE_PAGES_DEPLOY_HOOK_URL>')`. Leave the secondary hook empty
   unless a second host is intentionally operated.
7. Deploy a web-app version and retain its `/exec` URL privately. Endpoint
   credentials are accepted only in POST bodies; do not put them in URLs.
8. Run `setup()`, then `diagnose()`, `applySheetGuards()`, and `photoAudit()`.
   Most sheet guards warn against accidental edits; `Violation Log` decision
   columns E:F and event-marker column I, plus the complete `Corrective Log`,
   are hard, owner-only range protections.
   The `Attestation`, `Confirmations`, and `Site State` evidence/state columns
   are also hard, owner-only protections; participant routes can still write
   through the AP-owned web app. Workbook access control remains the primary
   security boundary.

Optional Withings setup:

1. Deploy the Apps Script web app first, then set the Withings application's
   private callback to the exact value returned by `withingsRedirectUri()`.
2. Run
   `setWithingsCredentials('<WITHINGS_CLIENT_ID>', '<WITHINGS_CLIENT_SECRET>')`.
3. Run `withingsAuthUrl()` and approve within ten minutes. The callback checks
   and consumes a random one-use state before exchanging the code server-side.
4. Run `setup()` again after connection so the sync trigger is present.

Important Script Properties include `SHEET_ID`, `AP_KEY`, `PACKET_KEY`,
`UNLOCK_CODE`, `PHOTOS_FOLDER_ID`, `CORRECTIVE_FOLDER_ID`, `GH_TOKEN`, and
`BUILD_HOOK`. The automatically created `SEAL_SECRET` must stay private;
optional integrations also use `MIRROR_FOLDER_ID`,
`OBSERVER_SECRET`, and the Withings properties. Never print their values into
public issues, logs, documentation, or support messages.
AP action clients must use the opaque `ref`, `review_key`, and `assignment_id`
values returned by `handleApState()`; physical sheet row numbers are
intentionally not accepted as record identities because sorting or insertion
can change them. `apcorrective/assign` also requires a caller-generated,
retry-stable `request_id` of 16–128 URL-safe characters, and
`apcorrective/complete` requires the exact current `assignment_id` and
`attempt_id`. After that completion succeeds, `apviolation/resolve` requires
the same two identities and revalidates their sealed filing evidence before it
writes resolution evidence.

## Private build feeds

Set all seven feed URLs plus the seal-verification secret in the private
Cloudflare Pages environment (Settings → Variables and Secrets):

| Variable | Sanitized source |
| --- | --- |
| `WEIGHINS_CSV` | Reviewed Weigh-ins fields |
| `VIOLATION_CSV` | Reviewed Violation Log fields, including `event_verification` |
| `ATTESTATION_CSV` | Reviewed sealed-attestation fields |
| `CONFIRMATIONS_CSV` | Reviewed Confirmation fields |
| `SUPERVISION_CSV` | Neutral text status only; no private notes or video |
| `UPDATES_CSV` | Reviewed public update fields |
| `SITE_STATE_CSV` | Explicitly allowlisted public state keys |
| `ATTESTATION_SEAL_SECRET` | Exact private Apps Script `SEAL_SECRET`; never a URL or public value |

Missing, empty, unreachable, malformed, or duplicate-key sources fail the
publisher. A valid header-only CSV is the explicit representation of a section
with no rows. CSV syntax and every nonblank row width are validated exactly;
duplicate accepted attestation seals fail closed. The publisher performs
plain HTTPS GETs, so each upstream URL must expose only its dedicated sanitized
view even if the URL itself is kept private. Do not point these variables at
direct exports from the mixed workbook and do not publish the workbook to make
an unauthenticated export work. If a sanitized upstream feed service is not in
place, production publication is blocked.

The allowlisted `SITE_STATE_CSV` includes `start_date` and, when execution is
being activated, `agreement_edition`, both signature-verification dates,
`agreement_confirmation_date`, `agreement_confirmation_verified_at`, and
`agreement_confirmation_fingerprint`. It must omit operational identifiers,
keys, hooks, private URLs, and unrelated workbook state.

The publisher recomputes every accepted attestation HMAC with
`ATTESTATION_SEAL_SECRET`; a shape-valid but unauthenticated seal is ignored and
cannot activate the agreement. Keep `PUBLIC_SUPERVISION_URLS_ENABLED` unset or
`false`.

## Build, test, and deploy

Cloudflare Pages configuration (project `michealrayberry-com`) is:

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `24`
- `SITE_ORIGIN`: `https://michealrayberry.com`

Run before release:

```sh
npm ci
npm run check-syntax
npm run test:audit
npm run test:apps-script
npm run test:assistant
npm run test:release
npm run test:functions
npm run security:audit
npm run build
```

`npm run build` performs syntax checks, generates the site, stages the explicit
allowlist into `dist/`, and audits `dist/`. The audit, Apps Script identity,
signed-release, and dependency-security tests are separate checks. `npm run generate` alone is not a
deployable build. For byte-stable release timestamps in a reproducibility
check, set `SOURCE_DATE_EPOCH` to Unix seconds; ordinary production builds use
their actual build instant.

The recording assistant fails closed when its private endpoint is not
configured. Offline demonstration mode requires an explicit local opt-in,
never opens agreement-gated flows, and never substitutes synthetic state for
the public record. `assistant/bundle-sections.json` pins the complete executable
preamble and ordered bundle sections `00` through `20`; syntax checks verify the
bundle against those digests and every available modular source.
Completed corrective uploads retain compact, separate capture receipts in
IndexedDB even if localStorage is unavailable. The fallback filing page can
recover these receipts after a reload and requires selection of the matching
take when more than one exists. Stored video bytes are released only after
the receipt transaction commits.

After a successful production deployment, submit changed URLs manually:

```sh
npm run postdeploy:indexnow
```

IndexNow is not part of the build and must never make a failed deploy look
successful.

### Release checklist

- Confirm the agreement status and expected effective date; inactive is valid
  only when no enforcement or agreement-dependent record is intended.
- Confirm the workbook, raw intake, corrective archive, and optional mirror are
  private and shared only with current named collaborators.
- Confirm all seven upstreams are sanitized views, the seal secret matches the
  Apps Script property, and no operational identifier appears in source, build
  logs, or `dist/`.
- Keep public Twitch live video enabled. Archive recording links remain controlled separately by `PUBLIC_SUPERVISION_URLS_ENABLED`. The stream being available does not verify attendance or completion.
- Deploy the Apps Script changes and run the explicit schema migration before
  activating the new assistant. During the labeled public test period, exercise capture,
  filing, rejection, stale-attempt refusal, reload recovery, completion, and
  resolution. Test real sheet protections and concurrent calls; local tests
  cannot validate Google-hosted permissions or transaction behavior.
- Run every command above and treat all audit errors and feed warnings as
  blockers.
- Deploy `main`, smoke-test the public pages and same-origin feeds, then run the
  manual IndexNow command.

## Observer submissions

The Observer form posts to `/api/observer`; notifications post to `/api/subscribe`. Both use Turnstile, same-origin checks, honeypots, and a server-only POST relay to Apps Script. Observer messages remain private until AP review. Notifications require an emailed confirmation; pending confirmation links expire after 48 hours. Relay secrets never travel in query strings.

Configure the Pages widget site key and private secrets as described in `DEPLOYMENT.md`. Cloudflare Functions compile from the root `functions/` directory; the public output is `dist/`. Do not deploy only the ZIP contents as static assets or omit Functions. Public testing deliberately exercises these real flows; every test email includes `[TEST]`.

## Protected Recording Assistant

`/assistant/` and `/api/assistant` require a verified Cloudflare Access JWT at the origin. The server verifies the signature, issuer, audience, and expiry, including on Pages aliases. The device key stays in the server environment. An AP unlock code creates a two-hour HttpOnly, Secure, SameSite cookie backed by the `ASSISTANT_SESSIONS` KV binding. The browser stores only a UI marker; it receives neither the device key nor the upstream unlock grant. Logout deletes the KV session and clears its cookie. Changing `ASSISTANT_SESSION_VERSION` revokes all grants. KV propagation is eventually consistent, so revocation is also enforced by expiration, Access, and the upstream key/code binding. Protected assets are not cached for offline use; already recorded captures remain in IndexedDB for recovery. Setup is in `DEPLOYMENT.md`.

## Privacy incident response — owner actions

A historical official image and previously committed operational identifiers
must be treated as exposed even after the working tree is cleaned. The owner
must complete and privately document all of these actions:

1. Replace affected media with verified metadata-free derivatives.
2. Rewrite every affected Git branch, tag, release, and reachable object;
   force-push carefully and coordinate fresh clones.
3. Purge old Cloudflare Pages deployments and CDN caches, and request the applicable
   GitHub cached-object/sensitive-data purge. Verify old direct object URLs no
   longer return the material.
4. Search Git history, build artifacts, deployment logs, and caches for former
   workbook, Drive, Apps Script, hook, and feed identifiers.
5. Make the workbook and folders private, disable editor resharing, and audit
   every named collaborator.
6. Revoke the prior Apps Script deployment if practical and deploy a new
   version. Rotate AP, device, unlock, observer, GitHub, build-hook, OAuth, and
   feed credentials that were actually exposed.
7. Redeploy, rerun the output/privacy audit, verify old URLs fail, and record
   completion only in the private incident log. Do not publish the recovered
   media metadata values.

## Remaining architecture work

- Provide the authenticated or capability-limited sanitized feed service
  described above. The mixed workbook must stay private.
- Move source-to-public photo digest links from Script Properties into a
  durable, append-only private audit ledger and back it up.
- Run an integration test against a newly deployed Apps Script version and the
  real Google Drive/Sheets/GitHub policies; local mocks cannot prove external
  sharing or API behavior.
- Regenerate or explicitly migrate any older public photo that fails the strict
  JPEG verifier before relying on automatic mirroring.
