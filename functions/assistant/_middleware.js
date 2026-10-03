import { accessIdentity } from '../../server/access.js';

export async function onRequest(context) {
  let identity;
  try { identity = await accessIdentity(context.request, context.env); }
  catch { return new Response('Recording Assistant protection must be configured before use.', { status: 503, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }); }
  if (!identity) return new Response('Authorized access is required.', { status: 403, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  const upstream = await context.next();
  const response = new Response(upstream.body, upstream);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('permissions-policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
  response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' blob: https://api.elevenlabs.io https://www.googleapis.com https://storage.googleapis.com; worker-src 'self' blob:; frame-src 'self' https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  return response;
}
