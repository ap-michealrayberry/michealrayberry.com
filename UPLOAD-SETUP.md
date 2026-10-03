# Recording Assistant → Cloudflare (direct upload)

Every take now uploads straight from the browser to **Cloudflare Stream**; photographs go to the record media bucket (**R2**). Each accepted filing publishes and rebuilds the site automatically. There is no separate private copy.

## 1. Cloudflare Stream
- Dashboard → Stream → enable it (paid add-on; billed per minute stored and delivered).
- Copy your **Account ID** (right sidebar of the dashboard).
- Stream → your customer subdomain looks like `customer-abc123.cloudflarestream.com` — note the `abc123` part.
- My Profile → API Tokens → Create token → Custom: permission **Account · Stream · Edit**, scoped to your account. Copy the token.

## 2. R2 bucket for photographs
- R2 → use the existing `mrb-video` bucket (public URL `https://pub-944fe11d344847f68307fb252477ba11.r2.dev`) or create a new public bucket.
- If you use a different bucket or custom domain, set its public URL as `MEDIA_PUBLIC_BASE` below **and** in Apps Script (Project Settings → Script properties → `MEDIA_PUBLIC_BASE`), and add the host to `img-src` in `_headers`.

## 3. Cloudflare Pages (the main site project)
Settings → Variables and Secrets (Production):
- `APPS_SCRIPT_URL` — Secret, the web-app URL ending in `/exec` (already set if notifications are on)
- `CF_ACCOUNT_ID` — Secret
- `STREAM_API_TOKEN` — Secret
- `STREAM_CUSTOMER_CODE` — Variable, e.g. `abc123`
- `MEDIA_PUBLIC_BASE` — Variable, the bucket's public URL

Settings → Bindings → Add → R2 bucket: variable name **`MEDIA`** → the bucket above.

## 4. Automatic rebuild
Pages → Settings → Builds → Deploy hooks → Add (branch `main`). In Apps Script run `setBuildHook('<that URL>')` once.

## 5. Apps Script
Paste the new `apps-script/Code.gs`, deploy a new version.

## What happens on each recording
- **Daily Inspection**: video → Stream; four photos → R2; the dated tracker row is created automatically; the packet is filed; the site rebuilds and the day page embeds the Stream player.
- **Weekly Review**: video → Stream, filed to the Weekly Log, published.
- **Corrective session**: video → Stream, filed beside the violation entry and published at once; the entry stays open until the AP verifies the session (§8).
- **Consent recording**: video → Stream, filed for the AP's review (§1).
- YouTube is optional: the assistant still shows a title and description for posting the same take to @michealrayberry, but there is nothing to paste back.
