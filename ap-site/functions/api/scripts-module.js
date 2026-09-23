/* GET /api/scripts-module — the assistant's voice-script module, served
   same-origin so the console's CSP stays script-src 'self'. Pulled from the
   deployed assistant bundle (the section between its 12-scripts and 13-
   markers), so the console always shows exactly what the phone runs.
   The whole hostname is behind Cloudflare Access. */
export async function onRequestGet() {
  const res = await fetch('https://michealrayberry.com/assistant/app.js', { cf: { cacheTtl: 60 } });
  if (!res.ok) return new Response('/* assistant bundle unavailable: ' + res.status + ' */', { status: 502, headers: { 'content-type': 'application/javascript' } });
  const src = await res.text();
  const a = src.indexOf('/* ==== 12-scripts.js ==== */');
  const b = src.indexOf('/* ==== 13-', a + 10);
  if (a < 0 || b < 0) return new Response('/* script section not found in bundle */', { status: 502, headers: { 'content-type': 'application/javascript' } });
  return new Response(src.slice(a, b), { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' } });
}
