/* Cloudflare Access identity (ported from portal/lib/access.js).
   Verifies the Access JWT (RS256, team certs, audience, issuer, expiry) and maps
   it to a role. A role needs both the right email AND a token issued for that
   role's Access application, so a token from one app cannot act in another. */

export type Role = 'mrb' | 'ap';
export type Identity = { ok: true; email: string; role: Role } | { ok: false; status: 401 | 403 | 500; error: string };

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN: string;
  MRB_EMAIL: string;
  AP_EMAIL: string;
  ACCESS_AUD_ASSISTANT?: string;
  ACCESS_AUD_MRB?: string;
  ACCESS_AUD_AP?: string;
  /** Local `wrangler dev` only (.dev.vars); honoured only for localhost requests. */
  DEV_ACCESS_EMAIL?: string;
}

interface Jwk { kid: string; kty: string; n: string; e: string }

// Team signing keys are shared, non-request state; refreshed hourly or on an unknown kid.
let certCache: { team: string; at: number; keys: Jwk[] } = { team: '', at: 0, keys: [] };

const b64u = (s: string) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')),
  (c) => c.charCodeAt(0),
);
const decodePart = (s: string) => JSON.parse(new TextDecoder().decode(b64u(s)));
const fail = (status: 401 | 403 | 500, error: string): Identity => ({ ok: false, status, error });

function roleFor(email: string, audiences: string[], env: AccessEnv): Role | null {
  const has = (aud?: string) => !!aud && audiences.includes(aud);
  if (email === env.MRB_EMAIL.toLowerCase() && (has(env.ACCESS_AUD_ASSISTANT) || has(env.ACCESS_AUD_MRB))) return 'mrb';
  if (email === env.AP_EMAIL.toLowerCase() && has(env.ACCESS_AUD_AP)) return 'ap';
  return null;
}

function devIdentity(request: Request, env: AccessEnv): Identity | null {
  if (!env.DEV_ACCESS_EMAIL) return null;
  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return null;
  const email = env.DEV_ACCESS_EMAIL.toLowerCase();
  if (email === env.MRB_EMAIL.toLowerCase()) return { ok: true, email, role: 'mrb' };
  if (email === env.AP_EMAIL.toLowerCase()) return { ok: true, email, role: 'ap' };
  return fail(403, 'DEV_ACCESS_EMAIL is not an authorized address.');
}

async function signingKeys(team: string, kid: string): Promise<Jwk[]> {
  const fresh = certCache.team === team && Date.now() - certCache.at < 3600e3;
  if (fresh && certCache.keys.some((k) => k.kid === kid)) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = await res.json<{ keys?: Jwk[] }>();
  certCache = { team, at: Date.now(), keys: body.keys ?? [] };
  return certCache.keys;
}

export async function accessIdentity(request: Request, env: AccessEnv): Promise<Identity> {
  const dev = devIdentity(request, env);
  if (dev) return dev;

  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const audiences = [env.ACCESS_AUD_ASSISTANT, env.ACCESS_AUD_MRB, env.ACCESS_AUD_AP].filter(Boolean);
  if (!team || !audiences.length) return fail(500, 'Access is not configured.');

  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie?.[1];
  if (!token) return fail(401, 'Not signed in.');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return fail(401, 'Malformed sign-in token.');

  let header: { alg?: string; kid?: string };
  let payload: { exp?: number; nbf?: number; iss?: string; aud?: string | string[]; email?: string };
  try { header = decodePart(h); payload = decodePart(p); } catch { return fail(401, 'Malformed sign-in token.'); }
  if (header.alg !== 'RS256' || !header.kid) return fail(401, 'Unexpected token algorithm.');

  let keys: Jwk[];
  try { keys = await signingKeys(team, header.kid); } catch { return fail(500, 'Could not load Access signing keys.'); }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return fail(401, 'Unknown signing key.');
  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) return fail(401, 'Invalid sign-in token.');

  const now = Date.now() / 1000;
  if (!payload.exp || payload.exp < now) return fail(401, 'Sign-in expired.');
  if (payload.nbf && payload.nbf > now + 60) return fail(401, 'Sign-in not yet valid.');
  if (payload.iss !== `https://${team}`) return fail(401, 'Wrong issuer.');
  const tokenAuds = (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).filter((a): a is string => !!a);
  if (!tokenAuds.some((a) => audiences.includes(a))) return fail(401, 'Wrong audience.');

  const email = String(payload.email || '').toLowerCase();
  const role = roleFor(email, tokenAuds, env);
  if (!role) return fail(403, 'This address is not authorized here.');
  return { ok: true, email, role };
}
