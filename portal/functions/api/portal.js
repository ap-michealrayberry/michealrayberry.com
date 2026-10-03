/* /api/portal — MRB portal relay (Cloudflare Pages Function).
   GET  → record state for the signed-in role (+ live Twitch status)
   POST → Micheal's filings: supstart | supend | contest | corrective
   Secrets (Pages → Settings → Variables and Secrets):
     APPS_SCRIPT_URL, PORTAL_RELAY_KEY, ACCESS_TEAM_DOMAIN, ACCESS_AUD,
     TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
   Optional: MRB_EMAIL, AP_EMAIL, TWITCH_CHANNEL */
import { accessIdentity } from '../../lib/access.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function relay(env, body) {
  if (!env.APPS_SCRIPT_URL || !env.PORTAL_RELAY_KEY) return { ok: false, error: 'Portal relay is not configured.' };
  const r = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, relay: env.PORTAL_RELAY_KEY }),
  });
  try { return await r.json(); } catch { return { ok: false, error: 'The record system returned an unreadable response.' }; }
}

let tw = { token: '', exp: 0 };
async function twitchLive(env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return null;
  if (!tw.token || Date.now() > tw.exp) {
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error('Twitch token request failed');
    tw = { token: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 };
  }
  const login = String(env.TWITCH_CHANNEL || 'michealrayberry').toLowerCase();
  const r = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tw.token}` },
  });
  if (r.status === 401) { tw = { token: '', exp: 0 }; throw new Error('Twitch token rejected'); }
  const s = ((await r.json()).data || [])[0];
  return { live: !!s && s.type === 'live', title: s ? s.title : '', startedAt: s ? s.started_at : '' };
}

export async function onRequestGet({ request, env }) {
  const me = await accessIdentity(request, env);
  if (!me.ok) return json({ ok: false, error: me.error }, 401);
  const [state, live] = await Promise.all([
    relay(env, { action: 'portalstate', role: me.role, email: me.email }),
    twitchLive(env).catch(() => ({ error: true })),
  ]);
  return json({ ...state, me: { email: me.email, role: me.role },
    twitch: live === null ? { configured: false } : live.error ? { configured: true, error: true } : { configured: true, ...live } });
}

const ACTIONS = { supstart: 'portalsupstart', supend: 'portalsupend', contest: 'portalcontest', corrective: 'portalcorrective' };

export async function onRequestPost({ request, env }) {
  const me = await accessIdentity(request, env);
  if (!me.ok) return json({ ok: false, error: me.error }, 401);
  if (me.role !== 'mrb') return json({ ok: false, error: 'Read-only access.' }, 403);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'Cross-origin request refused.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const action = ACTIONS[body && body.action];
  if (!action) return json({ ok: false, error: 'Unknown action.' }, 400);
  const payload = { action, role: me.role, email: me.email };
  if (body.action === 'supstart') {
    let live = null;
    try { live = await twitchLive(env); } catch { return json({ ok: false, error: 'Could not reach Twitch to confirm the stream. Try again in a minute.' }); }
    if (live === null) return json({ ok: false, error: 'Twitch check is not configured (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET).' });
    if (!live.live) return json({ ok: false, error: 'Twitch shows the channel offline. Start the stream on Twitch, wait a few seconds, then press Start.' });
    payload.twitchLive = true;
    payload.twitchStartedAt = live.startedAt;
  }
  if (body.action === 'contest') { payload.id = String(body.id || '').slice(0, 40); payload.reason = String(body.reason || '').slice(0, 2000); payload.evidence = String(body.evidence || '').slice(0, 500); }
  if (body.action === 'corrective') { payload.id = String(body.id || '').slice(0, 40); payload.url = String(body.url || '').slice(0, 300); }
  return json(await relay(env, payload));
}
