/* /api/subscribe — observer notification sign-up (Cloudflare Pages Function).
   Relays to Apps Script so the /exec URL never appears in public code.
   Env (Cloudflare Pages → Settings → Variables and Secrets, as Secrets):
     APPS_SCRIPT_URL      the deployed web-app /exec URL
     SUBSCRIBE_RELAY_KEY  same value as the Apps Script property (setSubscribeRelayKey) */
const page = (title, text, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — Micheal Ray Berry</title></head>
<body style="margin:0;background:#FAFAF7;color:#141412;font-family:system-ui,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:64px 24px;display:flex;flex-direction:column;gap:16px">
<span style="font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#B3261E">Public accountability record · Notifications</span>
<h1 style="font-size:40px;line-height:1;text-transform:uppercase;margin:0">${title}</h1>
<p style="font-size:17px;line-height:1.6;margin:0">${text}</p>
<p style="margin:0"><a href="/" style="color:#141412;font-weight:600">michealrayberry.com →</a></p>
</div></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

async function relay(env, params) {
  if (!env.APPS_SCRIPT_URL || !env.SUBSCRIBE_RELAY_KEY) return { ok: false, error: 'not configured' };
  const url = new URL(env.APPS_SCRIPT_URL);
  Object.entries({ ...params, key: env.SUBSCRIBE_RELAY_KEY }).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { redirect: 'follow' });
  try { return await r.json(); } catch { return { ok: false, error: 'bad relay response' }; }
}

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  if (String(form.get('website') || '')) return page('Check your email', 'A confirmation link is on its way.'); // honeypot
  const email = String(form.get('email') || '').trim().slice(0, 254);
  const out = await relay(env, { sub: 'subscribe', email });
  if (!out.ok) return page('Not subscribed', out.error === 'invalid email' ? 'That email address doesn’t look valid. <a href="/notify/">Try again</a>.' : 'Sign-up is unavailable right now. Try again later or write to ap@michealrayberry.com.', 400);
  return out.state === 'active'
    ? page('Already subscribed', 'This address already receives notifications.')
    : page('Check your email', 'A confirmation link is on its way. Nothing is sent until you confirm.');
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const confirm = q.get('confirm'), unsub = q.get('unsubscribe');
  if (!confirm && !unsub) return Response.redirect(new URL('/notify/', request.url), 302);
  const token = String(confirm || unsub).slice(0, 64);
  const out = await relay(env, { sub: confirm ? 'confirm' : 'unsubscribe', token });
  if (!out.ok) return page('Link not valid', 'This link has expired or was already used. You can sign up again at <a href="/notify/">/notify/</a>.', 400);
  return confirm
    ? page('Subscribed', 'You will now receive the nightly result, new violations, escalations, completed corrections, missed supervision, and the weekly audit. Every message has an unsubscribe link.')
    : page('Unsubscribed', 'You will receive no further notifications. The public record remains at michealrayberry.com.');
}
