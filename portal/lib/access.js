/* Cloudflare Access identity for the MRB portal.
   Verifies the Access JWT (RS256, team certs, audience, issuer, expiry) and
   maps the email to a role. Never trust the plain email header alone: the
   *.pages.dev hostname would bypass Access unless it is also protected. */
let certs = { at: 0, keys: [] };
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));
const fail = (error) => ({ ok: false, error });

export async function accessIdentity(request, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = String(env.ACCESS_AUD || '').trim();
  if (!team || !aud) return fail('Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD).');
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || (cookie && cookie[1]);
  if (!token) return fail('Not signed in.');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return fail('Malformed sign-in token.');
  let header, payload;
  try { header = part(h); payload = part(p); } catch { return fail('Malformed sign-in token.'); }
  if (header.alg !== 'RS256') return fail('Unexpected token algorithm.');
  if (Date.now() - certs.at > 3600e3 || !certs.keys.some((k) => k.kid === header.kid)) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    certs = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) return fail('Unknown signing key.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) return fail('Invalid sign-in token.');
  const now = Date.now() / 1000;
  if (!payload.exp || payload.exp < now) return fail('Sign-in expired.');
  if (payload.nbf && payload.nbf > now + 60) return fail('Sign-in not yet valid.');
  if (payload.iss !== `https://${team}`) return fail('Wrong issuer.');
  if (!(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(aud)) return fail('Wrong audience.');
  const email = String(payload.email || '').toLowerCase();
  const mrb = String(env.MRB_EMAIL || 'michealrayberry@gmail.com').toLowerCase();
  const ap = String(env.AP_EMAIL || 'ap@michealrayberry.com').toLowerCase();
  const role = email === mrb ? 'mrb' : email === ap ? 'ap' : '';
  if (!role) return fail('This address is not authorized for the portal.');
  return { ok: true, email, role };
}
