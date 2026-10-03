import { readForm, relay, verifyTurnstile } from '../../server/forms.js';

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  const back = (error) => new Response(null, { status: 303, headers: { location: `${origin}/observer/?error=${error}`, 'cache-control': 'no-store' } });
  try {
    if (!env.OBSERVER_SECRET || !env.APPS_SCRIPT_URL) return back('unavailable');
    const form = await readForm(request);
    if (String(form.get('website') || '').trim()) return back('spam');
    const message = String(form.get('message') || '').trim();
    const type = String(form.get('type') || '').trim();
    if (!message || message.length > 4000 || !['Encouragement','I know Micheal personally','Possible compliance issue','Found/shared elsewhere','Question','Other'].includes(type)) return back('form');
    if (!await verifyTurnstile(request, env, form, 'observer')) return back('verify');
    const out = await relay(env, {
      action: 'observer', secret: env.OBSERVER_SECRET, type, message,
      name: String(form.get('name') || '').slice(0, 120),
      email: String(form.get('email') || '').slice(0, 200),
      source_url: String(form.get('source_url') || '').slice(0, 500),
      quotable: form.get('quotable') === 'yes' ? 'yes' : 'no',
    });
    return out?.ok ? new Response(null, { status: 303, headers: { location: `${origin}/observer/received/`, 'cache-control': 'no-store' } }) : back('relay');
  } catch { return back('relay'); }
}
export function onRequestGet({ request }) {
  return Response.redirect(new URL('/observer/', request.url), 303);
}
