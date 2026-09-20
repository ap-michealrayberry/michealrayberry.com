/* Cloudflare Pages Function — POST /observer
   Receives the Observer Submission form, verifies Turnstile, relays the
   fields server-side to the record's Apps Script (action 'observer') with a
   shared secret, then redirects. Nothing is stored here.
   Pages → Settings → Variables & Secrets:
     TURNSTILE_SECRET   Turnstile widget secret key
     OBSERVER_SECRET    same value as setObserverSecret() in Code.gs
     APPS_SCRIPT_URL    the record script's /exec URL */
export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  const back = (q) => Response.redirect(origin + '/observer/' + (q ? '?' + q : ''), 303);
  let form;
  try { form = await request.formData(); } catch { return back('error=form'); }
  if (String(form.get('website') || '').trim()) return back('error=spam');
  const message = String(form.get('message') || '').trim();
  if (!message) return back('error=empty');
  const token = form.get('cf-turnstile-response');
  if (!token || !env.TURNSTILE_SECRET) return back('error=verify');
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const tv = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  }).then((r) => r.json()).catch(() => ({ success: false }));
  if (!tv.success) return back('error=verify');
  const payload = {
    action: 'observer', secret: env.OBSERVER_SECRET,
    type: String(form.get('type') || 'Other').slice(0, 60),
    message: message.slice(0, 4000),
    name: String(form.get('name') || '').slice(0, 120),
    email: String(form.get('email') || '').slice(0, 200),
    source_url: String(form.get('source_url') || '').slice(0, 500),
    quotable: form.get('quotable') ? 'yes' : 'no',
  };
  const res = await fetch(env.APPS_SCRIPT_URL, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
    .then((r) => r.json()).catch(() => ({ ok: false }));
  return res && res.ok ? Response.redirect(origin + '/observer/received/', 303) : back('error=relay');
}
/* No onRequestGet: Pages treats /observer and /observer/ as the same route,
   so a GET redirect here loops against the static /observer/index.html. GET
   falls through to the static page automatically. */
