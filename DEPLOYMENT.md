# Deploy the corrected project

The package is source code, not a production data snapshot. It does not include operational credentials and does not change the live deployment by itself. The attached Edition 2 facts remain October 11, 2026, 340.0 lb → 200.0 lb, with 28 consecutive days at goal. A goal or signed-edition change must be reviewed and made in the versioned config and agreement together.

## Cloudflare Pages

Use Node 24, build command `npm run build`, output directory `dist`, and the repository root as the project root. Pages must compile the root `functions/` directory alongside the static output. The checked-in `_routes.json` invokes Functions for `/api/*` and all Recording Assistant routes. Keep the existing private reviewed feed environment values described in README, including `ATTESTATION_SEAL_SECRET`.

Add the following to both the production environment and any preview environment used for real public testing:

| Setting | Value |
| --- | --- |
| `TURNSTILE_SITE_KEY` | Public widget site key for the serving hostnames |
| `TURNSTILE_SECRET` | Matching private widget secret |
| `OBSERVER_SECRET` | Exact Apps Script `OBSERVER_SECRET` |
| `SUBSCRIBE_RELAY_KEY` | Exact Apps Script `SUBSCRIBE_RELAY_KEY` |
| `APPS_SCRIPT_URL` | Current deployed `/macros/s/.../exec` URL; no query string |
| `ASSISTANT_DEVICE_KEY` | Exact Apps Script participant device key; server only |
| `ACCESS_TEAM_DOMAIN` | Team hostname ending in `.cloudflareaccess.com` |
| `ACCESS_AUD` | Access application audience for the protected operational routes |
| `ASSISTANT_SESSION_VERSION` | `1` initially; increment to revoke all sessions |
| `ASSISTANT_SESSIONS` | KV namespace binding, not a text variable |
| `TWITCH_PARENTS` | Comma-separated additional serving hostnames for preview embeds |

Keep public Twitch video enabled. `PUBLIC_SUPERVISION_URLS_ENABLED=true` is separate and allows reviewed historical session recording links. A Twitch player reporting live video is not an AP completion ruling.

Create an Access application/policy for the Recording Assistant and its relay: protect `/assistant`, `/assistant/*`, and `/api/assistant`, using the same application audience. Allow only the named participant and authorized APs. Cover the serving aliases used for this application as well. The code independently verifies Access tokens so an unprotected `pages.dev` alias cannot bypass the gate. Missing configuration returns 503; an absent or invalid token returns 403. The public site, livestream, test archive, Observer form, and notifications remain public.

Enable the Turnstile widget for the canonical and preview hostnames you actually use. Use real widget keys for public end-to-end testing; do not disable server validation. The public configuration endpoint returns only the site key. Widget action and hostname must match each submission. Add a Cloudflare rate-limit rule for the public POST endpoints according to actual traffic if abuse occurs.

## Apps Script

Run `npm run sync-config` before copying the updated `apps-script/Code.gs` into the existing operations project. Deploy a new web-app version; update the Pages URL if a new deployment changes it. Set the Observer and subscription relay properties with the existing setter helpers. The subscription relay now accepts POST JSON with `action: subscribe`; credential-bearing GET subscription requests are retired. Do not publish the operations workbook or subscriber addresses.

The device key, AP key, and AP-issued unlock code remain separate. Participant requests can never invoke AP actions through `/api/assistant`. Unlock grants now expire after two hours. Old browser device keys and unlock tokens are discarded by the updated assistant. Test capture recovery before relying on it for a real filing. Logout deletes the KV session; changing the session version revokes all stored grants, and changing the upstream key or unlock code invalidates the corresponding binding. KV changes are eventually consistent.

## Public testing and launch

Keep these Site State entries:

| Key | Value |
| --- | --- |
| `start_date` | `2026-10-11` |
| `test_start_date` | `2026-10-03` |
| `test_mode` | `on` |

Testing is public from October 3 through October 10. The simulated requirements exercise daily evidence, AP review, corrections, supervision, and notifications. Pages carry a test banner and T-n labels; emails carry `[TEST]`. Test mode does not count as signed agreement execution. On October 11 the official date filter takes over. Keep test-period feed rows and the published derivative media available: `/testing/` and `/data/testing.json` rebuild their history from those reviewed inputs. Do not delete test rows at launch. Safety, privacy, consent, and lawful takedown procedures remain available for both archives.

At launch the ordinary signed execution gate still requires the complete signatures, confirmation, AP verification, and exact confirmation fingerprint. Merely reaching the start date cannot activate an unsigned agreement.

## Domain redirects

Import `deployment/domain-redirects.csv` into a Cloudflare Bulk Redirect List, enable its rule, and ensure the source-domain DNS is proxied. The CSV has no header row. It preserves paths and query strings and redirects the typo domain and its subdomains to `https://michealrayberry.com/`. Host-level redirects belong in Cloudflare rules; `_redirects` contains only supported path redirects.

## Verification

Run the checks in the repository:

```sh
npm ci
npm run check-syntax
npm run test:audit
npm run test:apps-script
npm run test:assistant
npm run test:functions
npm run test:release
npm run security:audit
npm run build
```

The build command requires the real reviewed feed configuration. Tests supply isolated fixtures and do not send real emails or upload participant evidence. The release test starts from a fresh checkout, exercises public testing, checks photo and AP-event retention at launch, verifies inactive and signed activation, and audits every staged file in each successful phase. GitHub CI runs these regression checks.

Local verification completed October 3, 2026: syntax and bundle checks, publisher/output audits, Apps Script checks, capture-recovery checks, all 12 Function tests, and the release integration checks passed. Cloudflare's Functions compiler successfully built the Worker. The updated public-test fixture’s 35 generated pages are checked in Chromium at desktop (1440 px), phone (390 px), and narrow-phone (320 px) sizes. The browser check also exercises scheduled, unconfirmed, live, completed, inactive, and stale supervision states; the live page must retain exactly one Twitch player in each state. See the final verification summary in README for results. Browser verification used a stubbed Turnstile widget and blocked external services. `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities. Synthetic fixture evidence is used only in temporary test directories and is not included as production evidence in this package.

After deployment, test the actual integrations publicly:

1. Load `/observer/`, `/notify/`, `/accountable/`, `/partner/`, `/testing/`, and `/live/`. Check a phone-sized screen and a desktop.
2. Submit a clearly labeled test Observer note. Confirm it reaches the private Observer tab; confirm an invalid or missing widget response is refused. No report is automatically published.
3. Subscribe with a test address; confirm the email, receive a `[TEST]` result, and unsubscribe. Confirm the address never appears in public output. Confirmation links expire after 48 hours.
4. Open Twitch on each serving hostname and verify its player. Confirm the page does not claim a session completed merely because video is available.
5. Sign in to the protected Recording Assistant, unlock with the AP code, capture and file a test packet, and test interrupted capture recovery. Verify logout, a wrong audience, and an expired grant cannot make a filing.
6. Have the AP review a test event and its correction. Stop a corrective session for pain, dizziness, numbness, injury concerns, or an emergency; document the stop for rescheduling rather than adding time or immediately repeating it.
7. Verify four test photos, public recording links, supervision outcomes, and AP-reviewed test events appear in `/testing/`. After launch, confirm the same test evidence remains there and is absent from official totals.

These real delivery, account-policy, camera, microphone, email, and Twitch checks need the owner's configured services. Local fixtures and Function compilation cannot verify an external deployment's credentials or permissions.

References: [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/), [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Bulk Redirect CSV format](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/csv-file-format/).
