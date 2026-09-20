/* PATCH for the live Code.gs — Cloudflare Stream + R2 evidence pipeline.
   Apply in three steps, in order.

   1. SHEET: on the Weigh-ins tab add two columns after video_sec:
        J = stream_uid   K = r2_key
      On the Violation Log tab add one column after event_verification:
        J = stream_uid
      (The publisher accepts these as optional trailing columns.)

   2. PROPERTIES: run once in the editor —
        setCloudflareMedia('<CF_ACCOUNT_ID>', '<STREAM_API_TOKEN>', '<R2_ACCOUNT_ID>', '<R2_BUCKET>')
      The R2 write for the backfill uses Stream's upload-by-URL from the Drive
      file's download link; originals are copied to R2 by the assistant going
      forward (and by backfillR2FromDrive for history, which needs
      R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY set via setR2Keys()).

   3. CODE: paste these functions; add the two route lines to routePost. */

// ── routePost additions (place beside the other action lines) ──
//   if (obj && obj.action === 'keycheck') return jsonOut({ ok: keyOk(obj.key) });
//   (packet handler: see handlePacketMediaFields below — call it inside your
//    existing 'packet' finalize branch with (sheet, row, obj).)

function setCloudflareMedia(cfAccountId, streamToken, r2AccountId, r2Bucket) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('CF_ACCOUNT_ID', String(cfAccountId || '').trim());
  p.setProperty('STREAM_API_TOKEN', String(streamToken || '').trim());
  p.setProperty('R2_ACCOUNT_ID', String(r2AccountId || '').trim());
  p.setProperty('R2_BUCKET', String(r2Bucket || 'mrb-evidence').trim());
  Logger.log('Cloudflare media properties stored.');
}
function setR2Keys(accessKeyId, secret) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('R2_ACCESS_KEY_ID', String(accessKeyId || '').trim());
  p.setProperty('R2_SECRET_ACCESS_KEY', String(secret || '').trim());
  Logger.log('R2 keys stored.');
}

/* Inside the packet finalize branch: persist the assistant's media ids.
   Columns J/K on Weigh-ins. Idempotent; never overwrites a filled cell. */
function handlePacketMediaFields(sh, row, obj) {
  var uid = String(obj.stream_uid || '').trim(), key = String(obj.r2_key || '').trim();
  if (/^[a-f0-9]{32}$/i.test(uid) && !String(sh.getRange(row, 10).getValue() || '').trim()) sh.getRange(row, 10).setValue(uid.toLowerCase());
  if (key && /^originals\//.test(key) && !String(sh.getRange(row, 11).getValue() || '').trim()) sh.getRange(row, 11).setValue(key.slice(0, 200));
}

/* Manual filing for a corrective recording's Stream uid (Violation Log col J). */
function setCorrectiveStreamUid(date, uid) {
  var sh = tab('Violation Log'); var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (Utilities.formatDate(new Date(vals[i][0]), 'America/New_York', 'yyyy-MM-dd') === String(date)) {
      if (!/^[a-f0-9]{32}$/i.test(String(uid))) { Logger.log('Bad uid'); return; }
      sh.getRange(i + 1, 10).setValue(String(uid).toLowerCase()); Logger.log('Filed.'); return;
    }
  }
  Logger.log('No violation row for ' + date);
}

/* ── BACKFILL: Days 1–N from the Drive backups → Stream (upload-by-URL) ──
   Runs one row per call to stay inside the 6-minute limit; re-run until it
   logs "nothing left". Requires the Drive files to be link-shareable for the
   duration (the function toggles sharing on, then off). */
function backfillStreamFromDrive() {
  var p = PropertiesService.getScriptProperties();
  var acct = p.getProperty('CF_ACCOUNT_ID'), tok = p.getProperty('STREAM_API_TOKEN');
  if (!acct || !tok) { Logger.log('Run setCloudflareMedia first.'); return; }
  var sh = tab('Weigh-ins'); var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var videoCell = String(vals[i][7] || '').trim(), uidCell = String(vals[i][9] || '').trim();
    if (uidCell) continue;
    var dateIso = Utilities.formatDate(new Date(vals[i][0]), 'America/New_York', 'yyyy-MM-dd');
    var file = findDriveBackup_(dateIso, 'inspection');
    if (!file) { Logger.log(dateIso + ': no Drive backup found — skipped'); continue; }
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var dl = 'https://drive.google.com/uc?export=download&id=' + file.getId();
    var res = UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + acct + '/stream/copy', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + tok },
      payload: JSON.stringify({ url: dl, meta: { name: 'Micheal Ray Berry — Day ' + dayNumber_(dateIso) + ' inspection — ' + dateIso, date: dateIso, kind: 'daily' }, requireSignedURLs: false, allowedOrigins: ['michealrayberry.com', '*.michealrayberry.com'], thumbnailTimestampPct: 0.05 }),
    });
    var body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    if (!body.success) { Logger.log(dateIso + ': Stream copy failed — ' + res.getContentText().slice(0, 300)); return; }
    sh.getRange(i + 1, 10).setValue(body.result.uid);
    Logger.log(dateIso + ': Stream uid ' + body.result.uid + ' filed. Re-run for the next row.');
    return;
  }
  Logger.log('Backfill: nothing left.');
}

/* Originals → R2 (private bucket) via S3 PUT, one row per call. Needs setR2Keys(). */
function backfillR2FromDrive() {
  var p = PropertiesService.getScriptProperties();
  var acct = p.getProperty('R2_ACCOUNT_ID'), bucket = p.getProperty('R2_BUCKET') || 'mrb-evidence';
  var ak = p.getProperty('R2_ACCESS_KEY_ID'), sk = p.getProperty('R2_SECRET_ACCESS_KEY');
  if (!acct || !ak || !sk) { Logger.log('Run setCloudflareMedia + setR2Keys first.'); return; }
  var sh = tab('Weigh-ins'); var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][10] || '').trim()) continue;
    var dateIso = Utilities.formatDate(new Date(vals[i][0]), 'America/New_York', 'yyyy-MM-dd');
    var file = findDriveBackup_(dateIso, 'inspection');
    if (!file) { Logger.log(dateIso + ': no Drive backup — skipped'); continue; }
    var blob = file.getBlob(); if (blob.getBytes().length > 45 * 1024 * 1024) { Logger.log(dateIso + ': >45 MB, exceeds Apps Script fetch limit — copy manually'); continue; }
    var ext = /webm/i.test(blob.getContentType()) ? 'webm' : 'mp4';
    var key = 'originals/' + dateIso.slice(0, 4) + '/' + dateIso.slice(5, 7) + '/micheal-ray-berry-day-' + ('00' + dayNumber_(dateIso)).slice(-3) + '-inspection-' + dateIso + '.' + ext;
    var res = r2Put_(acct, bucket, ak, sk, key, blob);
    if (res.getResponseCode() >= 300) { Logger.log(dateIso + ': R2 PUT ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200)); return; }
    sh.getRange(i + 1, 11).setValue(key);
    Logger.log(dateIso + ': archived to R2 as ' + key + '. Re-run for the next row.');
    return;
  }
  Logger.log('R2 backfill: nothing left.');
}

function findDriveBackup_(dateIso, stem) {
  var root = photosFolder(); var q = "title contains '" + stem + "-" + dateIso + "'";
  var it = root.searchFiles(q); if (it.hasNext()) return it.next();
  var subs = root.getFolders();
  while (subs.hasNext()) { var f = subs.next().searchFiles(q); if (f.hasNext()) return f.next(); }
  return null;
}
function dayNumber_(dateIso) { var s = new Date(PROJECT_START + 'T12:00:00Z'), d = new Date(dateIso + 'T12:00:00Z'); return Math.round((d - s) / 86400000) + 1; }

/* Minimal SigV4 PUT for R2. */
function r2Put_(acct, bucket, ak, sk, key, blob) {
  var host = acct + '.r2.cloudflarestorage.com';
  var now = new Date(); var amz = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); var date = amz.slice(0, 8);
  var scope = date + '/auto/s3/aws4_request';
  var uri = '/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/');
  var ct = blob.getContentType() || 'application/octet-stream';
  var payloadHash = 'UNSIGNED-PAYLOAD';
  var canonical = ['PUT', uri, '', 'content-type:' + ct, 'host:' + host, 'x-amz-content-sha256:' + payloadHash, 'x-amz-date:' + amz, '', 'content-type;host;x-amz-content-sha256;x-amz-date', payloadHash].join('\n');
  var sts = ['AWS4-HMAC-SHA256', amz, scope, hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8))].join('\n');
  var k = hmac_('AWS4' + sk, date); k = hmac_(k, 'auto'); k = hmac_(k, 's3'); k = hmac_(k, 'aws4_request');
  var sig = hex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(sts).getBytes(), k));
  return UrlFetchApp.fetch('https://' + host + uri, { method: 'put', contentType: ct, payload: blob.getBytes(), muteHttpExceptions: true,
    headers: { 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash, Authorization: 'AWS4-HMAC-SHA256 Credential=' + ak + '/' + scope + ', SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=' + sig } });
}
function hmac_(key, data) { return Utilities.computeHmacSha256Signature(Utilities.newBlob(data).getBytes(), typeof key === 'string' ? Utilities.newBlob(key).getBytes() : key); }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
