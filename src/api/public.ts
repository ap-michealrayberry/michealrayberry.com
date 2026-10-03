/* Public form endpoints (no sign-in). Step 4 moves them off the Apps Script
   relay onto D1 + Postmark, keeping Code.gs's behaviour and wording:
     GET  /api/form-config        Turnstile site key for the observer form
     POST /api/observer           observer report (Turnstile + same-origin) → D1, AP email
     POST /observer, /report      older observer form targets
     GET|POST /api/subscribe      double opt-in sign-up, confirm, unsubscribe (incl. one-click) */
import { appendEvent } from '../events';
import { mailAP, sendMail } from '../mail';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
});
const redirect = (url: string, status: 301 | 302 | 303) => new Response(null, { status, headers: { location: url, 'cache-control': 'no-store' } });

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin
    && !['cross-site', 'none'].includes(request.headers.get('sec-fetch-site') ?? '');
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

export function formConfig(env: Env): Response {
  return env.TURNSTILE_SITE_KEY ? json({ sitekey: env.TURNSTILE_SITE_KEY }) : json({ error: 'Form verification is unavailable.' }, 503);
}

// ───────────────────────────── observer reports (§10) ─────────────────────────────

const OBSERVER_TYPES = ['Encouragement', 'I know Micheal personally', 'Possible compliance issue', 'Found/shared elsewhere', 'Question', 'Other'];

/** Observers may report evidence; they do not impose anything (§10). Nothing publishes from a report. */
export async function observerReport(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const back = (error: string) => redirect(`${origin}/observer/?error=${error}`, 303);
  try {
    const form = await readForm(request);
    if (String(form.get('website') || '').trim()) return back('spam');
    const message = String(form.get('message') || '').trim();
    const type = String(form.get('type') || '').trim();
    if (!message || message.length > 4000 || !OBSERVER_TYPES.includes(type)) return back('form');
    if (!await verifyTurnstile(request, env, form, 'observer')) return back('verify');
    const name = String(form.get('name') || '').trim().slice(0, 120);
    const email = String(form.get('email') || '').trim().slice(0, 200);
    let src = String(form.get('source_url') || '').trim().slice(0, 500);
    try { if (src && new URL(src).protocol !== 'https:') src = ''; } catch { src = ''; }
    const quotable = form.get('quotable') === 'yes';
    const receivedAt = new Date().toISOString();
    const res = await env.DB.prepare(
      "INSERT INTO observer_reports (received_at, type, message, name, email, source_url, quotable, review) VALUES (?, ?, ?, ?, ?, ?, ?, 'received')",
    ).bind(receivedAt, type, message, name || null, email || null, src || null, quotable ? 1 : 0).run();
    const n = res.meta.last_row_id;
    await appendEvent(env.DB, { actor: 'system', action: 'observer.received', subject: String(n), payload: { type } });
    const stamp = new Date(receivedAt).toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' ET';
    await mailAP(env, `Observer submission #${n} — ${type}`,
      `Received ${stamp}\nType: ${type}\nQuotable anonymously: ${quotable ? 'yes' : 'no'}` +
      (name ? `\nName/nickname: ${name}` : '') + (email ? `\nEmail: ${email}` : '') + (src ? `\nSource URL: ${src}` : '') +
      `\n\n${message}\n\n— Review it in the AP console (received → dismissed / verified / published / actioned). ` +
      'A substantiated compliance issue is logged as a flag for your ruling; nothing publishes from a report.', 'observer');
    return redirect(`${origin}/observer/received/`, 303);
  } catch { return back('relay'); }
}

// ───────────────────────────── notifications (double opt-in) ─────────────────────────────

const subscribePage = (title: string, text: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — Micheal Ray Berry</title></head>
<body style="margin:0;background:#FAFAF7;color:#141412;font-family:system-ui,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:64px 24px;display:flex;flex-direction:column;gap:16px">
<span style="font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#B3261E">Public accountability record · Notifications</span>
<h1 style="font-size:40px;line-height:1;text-transform:uppercase;margin:0">${title}</h1>
<p style="font-size:17px;line-height:1.6;margin:0">${text}</p>
<p style="margin:0"><a href="/" style="color:#141412;font-weight:600">michealrayberry.com →</a></p>
</div></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/;
const TOKEN = /^[a-f0-9]{32}$/;
const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sendConfirmation(env: Env, email: string, token: string) {
  await sendMail(env, {
    to: email, audience: 'person', tag: 'subscribe-confirm',
    subject: 'Confirm: Micheal Ray Berry public accountability notifications',
    text: 'You asked to receive notifications from the Micheal Ray Berry public accountability record: the nightly result, new violations, escalations, completed corrections, missed supervision, and the weekly audit.\n\n' +
      `Confirm: ${env.SITE_ORIGIN}/api/subscribe?confirm=${token}\n\n` +
      `If you did not ask for this, ignore this message; nothing will be sent.\n\n— Administered by the Accountability Partner · ${env.AP_EMAIL}`,
  });
}

/** Sign-up: a PENDING row and a confirmation link; a pending address gets at most one email per 10 minutes. */
async function subscribeEmail(env: Env, raw: string): Promise<'active' | 'pending' | 'invalid'> {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email)) return 'invalid';
  const row = await env.DB.prepare('SELECT status, created_at FROM subscribers WHERE email = ?').bind(email).first<{ status: string; created_at: string }>();
  if (row?.status === 'ACTIVE') return 'active';
  if (row?.status === 'PENDING' && Date.now() - Date.parse(row.created_at) < 10 * 60_000) return 'pending';
  const token = newToken();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO subscribers (email, status, token, created_at) VALUES (?, 'PENDING', ?, ?)
     ON CONFLICT(email) DO UPDATE SET status = 'PENDING', token = excluded.token, created_at = excluded.created_at, confirmed_at = NULL`,
  ).bind(email, token, now).run();
  await appendEvent(env.DB, { actor: 'system', action: 'subscriber.pending', subject: null, payload: {} });
  await sendConfirmation(env, email, token);
  return 'pending';
}

async function setSubscription(env: Env, token: string, to: 'ACTIVE' | 'UNSUBSCRIBED'): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  // A confirm link never re-activates an address that unsubscribed (fixes a Code.gs quirk).
  const res = to === 'ACTIVE'
    ? await env.DB.prepare("UPDATE subscribers SET status = 'ACTIVE', confirmed_at = ? WHERE token = ? AND status = 'PENDING'").bind(new Date().toISOString(), token).run()
    : await env.DB.prepare("UPDATE subscribers SET status = 'UNSUBSCRIBED' WHERE token = ?").bind(token).run();
  if (res.meta.changes === 1) await appendEvent(env.DB, { actor: 'system', action: to === 'ACTIVE' ? 'subscriber.confirmed' : 'subscriber.unsubscribed', subject: null, payload: {} });
  return res.meta.changes === 1 || (to === 'ACTIVE' && !!(await env.DB.prepare("SELECT 1 FROM subscribers WHERE token = ? AND status = 'ACTIVE'").bind(token).first()));
}

export async function subscribe(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  if (request.method === 'POST' && q.get('unsubscribe')) {
    // RFC 8058 one-click unsubscribe from the mail client.
    const ok = await setSubscription(env, String(q.get('unsubscribe')), 'UNSUBSCRIBED');
    return new Response(ok ? 'Unsubscribed.' : 'Unknown link.', { status: ok ? 200 : 400 });
  }
  if (request.method === 'POST') {
    const form = await request.formData();
    if (String(form.get('website') || '')) return subscribePage('Check your email', 'A confirmation link is on its way.'); // honeypot
    const state = await subscribeEmail(env, String(form.get('email') || '').slice(0, 254));
    if (state === 'invalid') return subscribePage('Not subscribed', 'That email address doesn’t look valid. <a href="/notify/">Try again</a>.', 400);
    return state === 'active'
      ? subscribePage('Already subscribed', 'This address already receives notifications.')
      : subscribePage('Check your email', 'A confirmation link is on its way. Nothing is sent until you confirm.');
  }
  const confirm = q.get('confirm'), unsub = q.get('unsubscribe');
  if (!confirm && !unsub) return redirect(new URL('/notify/', request.url).toString(), 302);
  const ok = await setSubscription(env, String(confirm || unsub).slice(0, 64), confirm ? 'ACTIVE' : 'UNSUBSCRIBED');
  if (!ok) return subscribePage('Link not valid', 'This link has expired or was already used. You can sign up again at <a href="/notify/">/notify/</a>.', 400);
  return confirm
    ? subscribePage('Subscribed', 'You will now receive the nightly result, new violations, escalations, completed corrections, missed supervision, and the weekly audit. Every message has an unsubscribe link.')
    : subscribePage('Unsubscribed', 'You will receive no further notifications. The public record remains at michealrayberry.com.');
}
