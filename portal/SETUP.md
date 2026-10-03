# MRB Portal — mrb.michealrayberry.com

Micheal's filing portal. Files only: it cannot edit, resolve, excuse or remove a public entry.
The AP gets a read-only view. Lives in `portal/` of the same repo as its own Cloudflare Pages project.

## 1. Twitch app (for the live check on Start)
dev.twitch.tv/console/apps → Register Your Application
- Name: mrb-portal · OAuth Redirect URL: `http://localhost` · Category: Website Integration · Client type: Confidential
- Copy the **Client ID**, then **New Secret** → copy the **Client Secret**.

## 2. Apps Script
1. Paste the new `apps-script/Code.gs`.
2. Run `setPortalRelayKey('<random string, 32+ letters/digits>')` once.
3. Deploy → Manage deployments → edit → New version.

## 3. Cloudflare Pages project
Workers & Pages → Create → Pages → Connect to Git → `ap-michealrayberry/michealrayberry.com`
- Project name: `michealrayberry-mrb`
- Production branch: `main`
- Framework preset: None · Build command: *(empty)* · Build output directory: `.`
- Root directory (advanced): `portal`

Settings → Variables and Secrets (add as **Secret**, Production):
- `APPS_SCRIPT_URL` — the web-app URL ending in `/exec`
- `PORTAL_RELAY_KEY` — the same string as step 2
- `ACCESS_TEAM_DOMAIN` — e.g. `yourteam.cloudflareaccess.com` (Zero Trust → Settings → Custom pages shows it)
- `ACCESS_AUD` — from step 4
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` — from step 1

Custom domains → Set up a custom domain → `mrb.michealrayberry.com` (DNS is on Cloudflare, so the record is added for you).

## 4. Cloudflare Access (sign-in)
Zero Trust → Settings → Authentication → Login methods: make sure **One-time PIN** is on.
Zero Trust → Access → Applications → Add → Self-hosted:
- Application domain: `mrb.michealrayberry.com`
- Add a second domain: `michealrayberry-mrb.pages.dev` **and** `*.michealrayberry-mrb.pages.dev` (otherwise preview URLs bypass sign-in)
- Session duration: 24 hours
- Policy: Action **Allow** · Include → Emails → `michealrayberry@gmail.com`, `ap@michealrayberry.com`
- Save, then open the application → Overview → copy **Application Audience (AUD) Tag** into `ACCESS_AUD`.

Redeploy the Pages project after adding the secrets.

## What it does
- **Today's packet** — status of each item and a countdown to 10:00 PM ET; opens the Recording Assistant.
- **Owed now** — open corrective requirements (level, minutes, due date). A pasted YouTube link goes to the private *Portal Filings* tab and the AP is emailed to check and attach it. Filing does not resolve the entry.
- **Evening Supervision** — Start (5:45–10:00 PM ET, only while Twitch shows the channel live) and End. End sets the night to `SUBMITTED · awaiting AP verification`. A night started but never ended is still `IN PROGRESS` at the 10:20 PM check and is marked MISSED.
- **Contest** — one per Violation Event, with a reason and an https evidence link, within 48 hours of the AP's verification notice. Goes to the private *Contests* tab and the AP is emailed. The form locks when the window closes.

The portal's own code never holds the Apps Script URL or any key; the Pages Function verifies the Access sign-in token on every request and relays server-side.
