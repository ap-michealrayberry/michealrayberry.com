import { accessIdentity } from '../../server/access.js';
import { json, relay, sameOrigin } from '../../server/forms.js';

const COOKIE = '__Host-mrb-session';
const actions = new Set(['attest','packet','correctivefiled','weeklyfiled','ytfiled','confirmationfiled','challenge','ping','mystate','vidinit','vidchunk']);
const clearCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
function respond(value, status = 200, cookie) {
  const response = json(value, status);
  if (cookie) response.headers.set('set-cookie', cookie);
  return response;
}
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return respond({ ok: false, error: 'Origin rejected' }, 403);
  let identity;
  try { identity = await accessIdentity(request, env); }
  catch { return respond({ ok: false, error: 'Assistant protection unavailable' }, 503); }
  if (!identity) return respond({ ok: false, error: 'Authorized access required' }, 403);
  if (!env.ASSISTANT_SESSIONS || !env.ASSISTANT_DEVICE_KEY || !env.APPS_SCRIPT_URL) return respond({ ok: false, error: 'Assistant relay unavailable' }, 503);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024) return respond({ ok: false, error: 'Request too large' }, 413);
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return respond({ ok: false, error: 'Invalid request' }, 400);
    const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)__Host-mrb-session=([a-f0-9]{64})(?:;|$)/);
    const sessionId = match?.[1];
    const key = sessionId ? `session:${sessionId}` : '';
    if (payload.action === 'logout') {
      if (key) await env.ASSISTANT_SESSIONS.delete(key);
      return respond({ ok: true }, 200, clearCookie);
    }
    if (payload.action === 'unlock') {
      if (typeof payload.code !== 'string' || payload.code.length < 20 || payload.code.length > 128) return respond({ ok: false, error: 'Unlock code invalid' }, 400);
      const out = await relay(env, { action: 'unlock', key: env.ASSISTANT_DEVICE_KEY, code: payload.code });
      if (!out?.ok || !out.token || !Number.isFinite(Number(out.expires))) return respond({ ok: false, error: 'Unlock refused' }, 403);
      const expires = Math.min(Number(out.expires), Date.now() + 2 * 60 * 60 * 1000, identity.exp * 1000);
      if (expires <= Date.now() + 60000) return respond({ ok: false, error: 'Access session expires soon; sign in again' }, 403);
      if (key) await env.ASSISTANT_SESSIONS.delete(key);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const next = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
      const ttl = Math.max(60, Math.ceil((expires - Date.now()) / 1000));
      await env.ASSISTANT_SESSIONS.put(`session:${next}`, JSON.stringify({ sub: identity.sub, unlock: out.token, expires, version: env.ASSISTANT_SESSION_VERSION || '1' }), { expirationTtl: ttl });
      // This is a UI marker, not a credential. The real grant is server-only.
      return respond({ ok: true, token: 'SERVER-SESSION', expires }, 200, `${COOKIE}=${next}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`);
    }
    if (!actions.has(payload.action)) return respond({ ok: false, error: 'Action rejected' }, 400);
    const session = key ? await env.ASSISTANT_SESSIONS.get(key, 'json') : null;
    if (!session || session.sub !== identity.sub || session.expires <= Date.now() || session.version !== (env.ASSISTANT_SESSION_VERSION || '1')) return respond({ ok: false, error: 'Unlock required or expired' }, 401, clearCookie);
    // Ignore every client-provided credential; never permit AP actions here.
    const out = await relay(env, { ...payload, key: env.ASSISTANT_DEVICE_KEY, unlock: session.unlock });
    if (out?.token) delete out.token;
    return respond(out);
  } catch { return respond({ ok: false, error: 'Assistant request failed' }, 502); }
}
