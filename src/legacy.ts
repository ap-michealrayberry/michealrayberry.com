/* Public form endpoints carried over unchanged from the Pages Functions
   (functions/, server/forms.js) so the domain cutover breaks nothing. They
   still relay to Apps Script; step 4 replaces the relay with D1 + Postmark.
     GET  /api/form-config        Turnstile site key for the observer form
     POST /api/observer           observer report (Turnstile + same-origin)
     POST /observer, /report      older observer form targets
     GET|POST /api/subscribe      notification sign-up, confirm, unsubscribe */

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
});
const redirect = (url: string, status: 301 | 302 | 303) => new Response(null, { status, headers: { location: url, 'cache-control': 'no-store' } });

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin
    && !['cross-site', 'none'].includes(request.headers.get('sec-fetch-site') ?? '');
}

function relayUrl(env: Env): string {
  const url = new URL(env.APPS_SCRIPT_URL || 'invalid:');
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid relay configuration');
  }
  return url.href;
}

async function relay(env: Env, payload: Record<string, string>): Promise<{ ok?: boolean; error?: string; state?: string }> {
  const response = await fetch(relayUrl(env), {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Relay unavailable');
  return response.json();
}

async function readForm(request: Request): Promise<FormData> {
  if (!sameOrigin(request)) throw new Error('origin');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 32768) throw new Error('size');
  return new Request(request.url, { method: 'POST', headers: request.headers, body: text }).formData();
}

async function verifyTurnstile(request: Request, env: Env, form: FormData, action: string): Promise<boolean> {
  const token = String(form.get('cf-turnstile-response') || '');
  if (!env.TURNSTILE_SECRET || !token || token.length > 2048) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }),
    });
    const result = await response.json<{ success?: boolean; hostname?: string; action?: string }>();
    return response.ok && result.success === true && result.hostname === new URL(request.url).hostname && result.action === action;
  } catch { return false; }
}

const OBSERVER_TYPES = ['Encouragement', 'I know Micheal personally', 'Possible compliance issue', 'Found/shared elsewhere', 'Question', 'Other'];

export function formConfig(env: Env): Response {
  return env.TURNSTILE_SITE_KEY ? json({ sitekey: env.TURNSTILE_SITE_KEY }) : json({ error: 'Form verification is unavailable.' }, 503);
}

export async function observerReport(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const back = (error: string) => redirect(`${origin}/observer/?error=${error}`, 303);
  try {
    if (!env.OBSERVER_SECRET || !env.APPS_SCRIPT_URL) return back('unavailable');
    const form = await readForm(request);
    if (String(form.get('website') || '').trim()) return back('spam');
    const message = String(form.get('message') || '').trim();
    const type = String(form.get('type') || '').trim();
    if (!message || message.length > 4000 || !OBSERVER_TYPES.includes(type)) return back('form');
    if (!await verifyTurnstile(request, env, form, 'observer')) return back('verify');
    const out = await relay(env, {
      action: 'observer', secret: env.OBSERVER_SECRET, type, message,
      name: String(form.get('name') || '').slice(0, 120),
      email: String(form.get('email') || '').slice(0, 200),
      source_url: String(form.get('source_url') || '').slice(0, 500),
      quotable: form.get('quotable') === 'yes' ? 'yes' : 'no',
    });
    return out?.ok ? redirect(`${origin}/observer/received/`, 303) : back('relay');
  } catch { return back('relay'); }
}

const subscribePage = (title: string, text: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — Micheal Ray Berry</title></head>
<body style="margin:0;background:#FAFAF7;color:#141412;font-family:system-ui,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:64px 24px;display:flex;flex-direction:column;gap:16px">
<span style="font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#B3261E">Public accountability record · Notifications</span>
<h1 style="font-size:40px;line-height:1;text-transform:uppercase;margin:0">${title}</h1>
<p style="font-size:17px;line-height:1.6;margin:0">${text}</p>
<p style="margin:0"><a href="/" style="color:#141412;font-weight:600">michealrayberry.com →</a></p>
</div></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

async function subscribeRelay(env: Env, params: Record<string, string>): Promise<{ ok?: boolean; error?: string; state?: string }> {
  if (!env.APPS_SCRIPT_URL || !env.SUBSCRIBE_RELAY_KEY) return { ok: false, error: 'not configured' };
  const url = new URL(env.APPS_SCRIPT_URL);
  for (const [k, v] of Object.entries({ ...params, key: env.SUBSCRIBE_RELAY_KEY })) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { redirect: 'follow' });
  try { return await r.json(); } catch { return { ok: false, error: 'bad relay response' }; }
}

export async function subscribe(request: Request, env: Env): Promise<Response> {
  if (request.method === 'POST') {
    const form = await request.formData();
    if (String(form.get('website') || '')) return subscribePage('Check your email', 'A confirmation link is on its way.'); // honeypot
    const email = String(form.get('email') || '').trim().slice(0, 254);
    const out = await subscribeRelay(env, { sub: 'subscribe', email });
    if (!out.ok) return subscribePage('Not subscribed', out.error === 'invalid email' ? 'That email address doesn’t look valid. <a href="/notify/">Try again</a>.' : 'Sign-up is unavailable right now. Try again later or write to ap@michealrayberry.com.', 400);
    return out.state === 'active'
      ? subscribePage('Already subscribed', 'This address already receives notifications.')
      : subscribePage('Check your email', 'A confirmation link is on its way. Nothing is sent until you confirm.');
  }
  const q = new URL(request.url).searchParams;
  const confirm = q.get('confirm'), unsub = q.get('unsubscribe');
  if (!confirm && !unsub) return redirect(new URL('/notify/', request.url).toString(), 302);
  const token = String(confirm || unsub).slice(0, 64);
  const out = await subscribeRelay(env, { sub: confirm ? 'confirm' : 'unsubscribe', token });
  if (!out.ok) return subscribePage('Link not valid', 'This link has expired or was already used. You can sign up again at <a href="/notify/">/notify/</a>.', 400);
  return confirm
    ? subscribePage('Subscribed', 'You will now receive the nightly result, new violations, escalations, completed corrections, missed supervision, and the weekly audit. Every message has an unsubscribe link.')
    : subscribePage('Unsubscribed', 'You will receive no further notifications. The public record remains at michealrayberry.com.');
}
