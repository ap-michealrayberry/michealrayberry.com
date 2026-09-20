/* Cloudflare Pages Function — POST /api/media-init
   Called by the Recording Assistant after a take. Verifies the device key
   against Apps Script, then returns:
     r2_put_url   presigned S3 PUT for the untouched original (private bucket)
     r2_key       object key recorded on the sheet beside the SHA-256
     stream_url   Stream direct-creator-upload URL (one-shot, ≤ 200 MB)
     stream_uid   the Stream video id the upload will create
   Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
        CF_ACCOUNT_ID, STREAM_API_TOKEN, APPS_SCRIPT_URL */
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(key, data, raw = false) {
  const k = await crypto.subtle.importKey('raw', key instanceof ArrayBuffer || ArrayBuffer.isView(key) ? key : enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return raw ? sig : hex(sig);
}
async function presignPut(env, key, contentType, expires = 900) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const qs = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'content-type;host',
  });
  const canonicalUri = '/' + env.R2_BUCKET + '/' + key.split('/').map(encodeURIComponent).join('/');
  const canonicalQs = [...qs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonical = ['PUT', canonicalUri, canonicalQs, `content-type:${contentType}\nhost:${host}\n`, 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  let k = await hmac('AWS4' + env.R2_SECRET_ACCESS_KEY, date, true);
  k = await hmac(k, 'auto', true); k = await hmac(k, 's3', true); k = await hmac(k, 'aws4_request', true);
  const sig = await hmac(k, sts);
  return `https://${host}${canonicalUri}?${canonicalQs}&X-Amz-Signature=${sig}`;
}
export async function onRequestPost({ request, env }) {
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const key = String(body.key || ''), kind = String(body.kind || 'daily'), date = String(body.date || ''), day = Number(body.day || 0);
  const mime = /webm/i.test(String(body.mime || '')) ? 'video/webm' : 'video/mp4';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !key) return json({ ok: false, error: 'bad request' }, 400);
  // Device-key check delegated to the record script (it owns the secret).
  const chk = await fetch(env.APPS_SCRIPT_URL, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'keycheck', key }) }).then((r) => r.json()).catch(() => null);
  if (!chk || !chk.ok) return json({ ok: false, error: 'unauthorized' }, 401);
  const stem = { daily: 'inspection', corrective: 'corrective-session', weekly: 'weekly-review', confirmation: 'consent-confirmation' }[kind] || kind;
  const ext = mime === 'video/webm' ? 'webm' : 'mp4';
  const r2Key = `originals/${date.slice(0, 4)}/${date.slice(5, 7)}/micheal-ray-berry-day-${String(day).padStart(3, '0')}-${stem}-${date}.${ext}`;
  const out = { ok: true, r2_key: r2Key, r2_put_url: await presignPut(env, r2Key, mime) };
  if (kind === 'daily') {
    out.photos = {};
    for (const angle of ['front', 'left', 'rear', 'right']) {
      const pk = `originals/${date.slice(0, 4)}/${date.slice(5, 7)}/micheal-ray-berry-day-${String(day).padStart(3, '0')}-photo-${angle}-${date}.jpg`;
      out.photos[angle] = { r2_key: pk, r2_put_url: await presignPut(env, pk, 'image/jpeg') };
    }
  }
  if (kind !== 'corrective' || body.publish === true) {
    const meta = { name: `Micheal Ray Berry — Day ${day} ${stem} — ${date}`, date, day: String(day), kind };
    const su = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/direct_upload`, {
      method: 'POST', headers: { authorization: `Bearer ${env.STREAM_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ maxDurationSeconds: 3600, requireSignedURLs: false, allowedOrigins: ['michealrayberry.com', '*.michealrayberry.com'], meta, thumbnailTimestampPct: 0.05 }),
    }).then((r) => r.json()).catch(() => null);
    if (su && su.success) { out.stream_url = su.result.uploadURL; out.stream_uid = su.result.uid; }
    else out.stream_error = (su && su.errors && su.errors[0] && su.errors[0].message) || 'stream unavailable';
  }
  return json(out);
}
