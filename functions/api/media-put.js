/* /api/media-put — stores a Recording Assistant photograph in the record
   media bucket (R2) and returns its public URL. Device credentials are checked
   by Apps Script first. Filed photographs are immutable: a different image
   for an existing view/date is refused.
   Bindings / variables (Pages → Settings):
     R2 binding  MEDIA            → the public record media bucket
     Variable    MEDIA_PUBLIC_BASE → its public URL (r2.dev or custom domain)
     Secret      APPS_SCRIPT_URL */
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const DEFAULT_BASE = 'https://pub-944fe11d344847f68307fb252477ba11.r2.dev';

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

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'Cross-origin request refused.' }, 403);
  if (!env.MEDIA) return json({ ok: false, error: 'The MEDIA R2 binding is not configured.' });
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const date = String(body.date || '');
  const day = Number(body.day);
  const name = String(body.name || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'Bad date.' }, 400);
  if (!Number.isInteger(day) || day < 1 || day > 9999) return json({ ok: false, error: 'Bad day.' }, 400);
  const view = (name.match(/(front|left|rear|right|wait)/i) || [])[1];
  if (!view) return json({ ok: false, error: 'Photo view not recognized.' }, 400);
  const ext = /\.png$/i.test(name) ? 'png' : /\.webp$/i.test(name) ? 'webp' : 'jpg';
  let bytes;
  try { bytes = Uint8Array.from(atob(String(body.image_b64 || '')), (c) => c.charCodeAt(0)); }
  catch { return json({ ok: false, error: 'Bad image data.' }, 400); }
  if (bytes.length < 1000 || bytes.length > 15 * 1024 * 1024) return json({ ok: false, error: 'Image size out of range.' }, 400);

  const auth = await deviceOk(env, String(body.key || ''), String(body.unlock || ''));
  if (!auth.ok) return json({ ok: false, error: auth.error }, 401);

  const [y, m, d] = date.split('-');
  const folder = view.toLowerCase() === 'wait' ? 'wait' : 'photos';
  const objectKey = `${folder}/${y}/${m}/${d}/micheal-ray-berry-day-${String(day).padStart(3, '0')}-${view.toLowerCase()}-${date}.${ext}`;
  const sha = await sha256Hex(bytes);
  const existing = await env.MEDIA.head(objectKey);
  if (existing && existing.customMetadata && existing.customMetadata.sha256 !== sha) {
    return json({ ok: false, error: `The ${view} photograph for ${date} is already on file and cannot be replaced.` }, 409);
  }
  if (!existing) {
    await env.MEDIA.put(objectKey, bytes, {
      httpMetadata: { contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { sha256: sha, date, view: view.toLowerCase() },
    });
  }
  const base = String(env.MEDIA_PUBLIC_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  return json({ ok: true, url: `${base}/${objectKey}`, sha256: sha });
}
