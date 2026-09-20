# ap.michealrayberry.com — Accountability Partner console

Separate Cloudflare Pages project (root directory: ap-site). The entire
hostname sits behind Cloudflare Access; the console holds no key.

## One-time setup (AP's Cloudflare account)
1. Zero Trust → Settings → Authentication → add **Google** (and keep
   One-time PIN). Require the AP's Google account to use 2-Step / passkey.
2. Zero Trust → Access → Applications → Add → Self-hosted
   - Domain: ap.michealrayberry.com (whole host, no path)
   - Session: 8 h · Policy: Allow · Include: Emails = the AP's address only
   - Copy the **Application Audience (AUD) tag**.
3. Workers & Pages → Create → Pages → same repo, **Root directory: ap-site**,
   build command empty, output "." → deploy → Custom domain ap.michealrayberry.com.
4. Pages project → Settings → Variables & Secrets:
   ACCESS_TEAM_DOMAIN = <team>.cloudflareaccess.com
   ACCESS_AUD = <AUD tag> · ACCESS_ALLOWED_EMAIL = <AP email>
   AP_KEY (secret) = the value from setApKey() · APPS_SCRIPT_URL = the /exec URL
5. Redeploy. Visit ap.michealrayberry.com → Access login → console.

Every action is relayed by functions/api/ap.js, which re-verifies the Access
identity token and stamps actor/IP/UA into the sheet's **AP Actions** tab.
Guarded ops (activate, deactivate, declare, verify, overrule, complete,
abandon, supervision rulings) require the console's confirmation sheet.
Sign out = /cdn-cgi/access/logout.

## Rework (Sept 20)
Panels: Project control (Start project / Resume / Suspend; banner Auto·On·Off), Review queue (daily packets → Accept / Reject→violation; corrective → Resolve / Overrule; declared misses → Confirm / Waive §9; inline Stream player), Record (Add violation, Edit weigh-in, Post update, File Stream uid), Operations (AP actions log, Observer inbox with review states, media backfill status). Add STREAM_CUSTOMER_CODE to this project's variables for inline video. Start project marks pre-activation misses "not enforced under §9".
