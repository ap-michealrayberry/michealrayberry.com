/* ---- Inspection video: browser → Cloudflare R2, direct ----
   Apps Script signs a 15-minute PUT URL for one exact object key and the
   file goes straight from this device to the bucket, so there is no relay
   and no size ceiling. The server builds the object key from a validated
   date, so a stolen device key cannot write arbitrary paths. Corrective and
   corner recordings never come through here — they stay in the AP's private
   Drive archive.

   cfg: { endpoint, deviceKey(), isoStr, fetchFn, XhrCtor } */

export function createR2Uploader(cfg) {
  const fetchFn = cfg.fetchFn || ((...a) => fetch(...a));
  const XhrCtor = cfg.XhrCtor || XMLHttpRequest;

  return async function uploadVideoToR2(blob, onProgress) {
    const sign = await (await fetchFn(cfg.endpoint, {
      method: 'POST',
      body: JSON.stringify({ action: 'r2sign', key: cfg.deviceKey(), date: cfg.isoStr, kind: 'daily', mime: blob.type || 'video/mp4' }),
    })).json();
    if (!sign || !sign.ok) throw new Error((sign && sign.error) || 'could not sign upload');

    await new Promise((resolve, reject) => {
      const xhr = new XhrCtor();
      xhr.open('PUT', sign.uploadUrl, true);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status === 200 || xhr.status === 201
        ? resolve()
        : reject(new Error('R2 ' + xhr.status + ' ' + String(xhr.responseText || '').slice(0, 120))));
      xhr.onerror = () => reject(new Error('the storage bucket refused the upload (CORS) — add https://michealrayberry.com to the R2 bucket’s CORS policy with PUT allowed'));
      xhr.send(blob);
    });
    return sign.publicUrl;
  };
}
