/* ap.michealrayberry.com — POST /api/ap
   The whole hostname sits behind Cloudflare Access (one allowed email).
   This Function is the only thing that may hold the AP key: it verifies the
   Access identity JWT (signature, issuer, audience, expiry, email) and then
   relays the console's request to Apps Script with the key from secrets.
   Env: ACCESS_TEAM_DOMAIN, ACCESS_AUD, ACCESS_ALLOWED_EMAIL, AP_KEY, APPS_SCRIPT_URL */
let jwksCache = { at: 0, keys: [] };
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
async function jwks(team) {
  if (Date.now() - jwksCache.at < 6 * 3600e3 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`).then((x) => x.json());
  jwksCache = { at: Date.now(), keys: r.keys || [] };
  return jwksCache.keys;
}
async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64u(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(env.ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp < now || (payload.nbf && payload.nbf > now + 60)) return null;
  if (String(payload.email || '').toLowerCase() !== String(env.ACCESS_ALLOWED_EMAIL || '').toLowerCase()) return null;
  const jwk = (await jwks(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  return ok ? payload : null;
}
const CONFIRM_REQUIRED = new Set(['activate', 'deactivate', 'start_project', 'resume', 'banner_mode', 'add_violation', 'waive', 'edit_weighin', 'post_update', 'review_daily', 'fresh_start', 'declare', 'verify_violation', 'verify_resolution', 'overrule', 'complete', 'abandon_presume', 'abandon_confirm', 'abandon_clear', 'supervision_rule']);
export async function onRequestPost({ request, env }) {
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const id = await verifyAccess(request, env);
  if (!id) return json({ ok: false, error: 'unauthorized' }, 401);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const op = String(body.op || 'status');
  if (CONFIRM_REQUIRED.has(op) && body.confirmed !== true) return json({ ok: false, error: 'confirmation required' }, 400);
  const payload = { ...body, action: 'apconsole', op, key: env.AP_KEY, actor: id.email, actor_ip: request.headers.get('CF-Connecting-IP') || '', actor_ua: (request.headers.get('User-Agent') || '').slice(0, 120) };
  const res = await fetch(env.APPS_SCRIPT_URL, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'record unavailable' }));
  return json(res);
}
export async function onRequestGet({ request, env }) {
  const id = await verifyAccess(request, env);
  return new Response(JSON.stringify({ ok: !!id, email: id ? id.email : null, stream_customer_code: id ? (env.STREAM_CUSTOMER_CODE || '') : null }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
