/* Validate Access at the origin too, including pages.dev aliases. Merely
   receiving a Cf-Access-Jwt-Assertion header never grants access. */
let cachedKeys = { domain: '', until: 0, keys: [] };
const decode = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const object = value => JSON.parse(new TextDecoder().decode(decode(value)));

export async function accessIdentity(request, env) {
  const domain = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https:\/\//, '').replace(/\/$/, '');
  const aud = String(env.ACCESS_AUD || '');
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !aud) throw new Error('Access protection is not configured');
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (token.length > 12000) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = object(parts[0]), claims = object(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid || claims.iss !== `https://${domain}` || !Array.isArray(claims.aud) || !claims.aud.includes(aud)
      || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > now))
      || (claims.iat != null && (!Number.isFinite(claims.iat) || claims.iat > now + 60)) || !claims.sub) return null;
    if (cachedKeys.domain !== domain || cachedKeys.until < Date.now() || !cachedKeys.keys.some(k => k.kid === header.kid)) {
      const response = await fetch(`https://${domain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const result = await response.json();
      if (!Array.isArray(result.keys)) return null;
      cachedKeys = { domain, until: Date.now() + 300000, keys: result.keys };
    }
    const jwk = cachedKeys.keys.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]))) return null;
    return { sub: String(claims.sub), exp: claims.exp };
  } catch { return null; }
}
