/* /api/stream-upload — opens a Cloudflare Stream Direct Creator Upload (tus)
   for the Recording Assistant. The device key + unlock token are checked by
   Apps Script ('ping' → deviceAuthorized) before any upload URL is issued.
   Secrets (Pages → Settings → Variables and Secrets):
     APPS_SCRIPT_URL   web-app /exec URL
     CF_ACCOUNT_ID     Cloudflare account id
     STREAM_API_TOKEN  API token with Stream:Edit
   Optional: STREAM_CUSTOMER_CODE (the "customer-xxxx" part of your Stream
   domain; without it the legacy iframe.videodelivery.net player URL is used). */
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const KINDS = ['daily', 'weekly', 'corrective', 'confirmation', 'announcement', 'milestone', 'demo'];

async function deviceOk(env, key, unlock) {
  if (!env.APPS_SCRIPT_URL) return { ok: false, error: 'APPS_SCRIPT_URL is not configured.' };
  const r = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'ping', key, unlock }),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return j && j.ok ? { ok: true } : { ok: false, error: (j && j.error) || 'Device not authorized.' };
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'Cross-origin request refused.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const kind = String(body.kind || '');
  const date = String(body.date || '');
  const size = Number(body.size);
  const name = String(body.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 160) || `mrb-${kind}-${date}.webm`;
  if (!KINDS.includes(kind)) return json({ ok: false, error: 'Unknown recording kind.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'Bad date.' }, 400);
  if (!Number.isInteger(size) || size < 1 || size > 4 * 1024 ** 3) return json({ ok: false, error: 'Bad size.' }, 400);
  if (!env.CF_ACCOUNT_ID || !env.STREAM_API_TOKEN) return json({ ok: false, error: 'Cloudflare Stream is not configured (CF_ACCOUNT_ID / STREAM_API_TOKEN).' });

  const auth = await deviceOk(env, String(body.key || ''), String(body.unlock || ''));
  if (!auth.ok) return json({ ok: false, error: auth.error }, 401);

  const expiry = new Date(Date.now() + 5 * 3600e3).toISOString();
  const meta = [
    `name ${b64(name)}`,
    `maxdurationseconds ${b64('3600')}`,
    `expiry ${b64(expiry)}`,
  ].join(',');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream?direct_user=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STREAM_API_TOKEN}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(size),
      'Upload-Metadata': meta,
    },
  });
  const uploadUrl = r.headers.get('Location');
  const uid = r.headers.get('stream-media-id');
  if (!r.ok || !uploadUrl || !/^[a-f0-9]{32}$/.test(uid || '')) {
    const text = await r.text().catch(() => '');
    return json({ ok: false, error: `Cloudflare Stream refused the upload (${r.status}). ${text.slice(0, 160)}` }, 502);
  }
  const code = String(env.STREAM_CUSTOMER_CODE || '').replace(/^customer-/, '').trim();
  const url = /^[a-z0-9]+$/.test(code)
    ? `https://customer-${code}.cloudflarestream.com/${uid}/iframe`
    : `https://iframe.videodelivery.net/${uid}`;
  return json({ ok: true, uploadUrl, uid, url });
}
