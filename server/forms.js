export const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
});
export function sameOrigin(request) {
  return request.headers.get('origin') === new URL(request.url).origin
    && !['cross-site', 'none'].includes(request.headers.get('sec-fetch-site'));
}
export function relayUrl(env) {
  const url = new URL(env.APPS_SCRIPT_URL || '');
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error('Invalid relay configuration');
  return url.href;
}
export async function relay(env, payload) {
  const response = await fetch(relayUrl(env), {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Relay unavailable');
  return response.json();
}
export async function readForm(request) {
  if (!sameOrigin(request)) throw new Error('origin');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 32768) throw new Error('size');
  return new Request(request.url, { method: 'POST', headers: request.headers, body: text }).formData();
}
export async function verifyTurnstile(request, env, form, action) {
  const token = String(form.get('cf-turnstile-response') || '');
  if (!env.TURNSTILE_SECRET || !token || token.length > 2048) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }),
    });
    const result = await response.json();
    return response.ok && result.success === true && result.hostname === new URL(request.url).hostname && result.action === action;
  } catch { return false; }
}
