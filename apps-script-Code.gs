/**
 * MRB Public Accountability Project — record engine
 * ═══════════════════════════════════════════════════════════════════
 * ONE spreadsheet holds the record; this script writes to it, guards it
 * with two keys, and runs every scheduled check. The website reads the
 * sheet directly (published CSV) and needs no server.
 *
 * FIRST RUN (fresh start)
 *   1. Open this script in the AP's Google account and paste this file in.
 *   2. Run  createRecordSpreadsheet()  — builds a brand-new record
 *      spreadsheet in this account's Drive with every tab, header and
 *      format, and logs the new SHEET ID plus the gids the website needs.
 *   3. Run  setApKey('LONG-RANDOM')  and  setDeviceKey('LONG-RANDOM').
 *   4. Run  setup()  — installs all triggers.
 *   5. Run  showPhotosFolderUrl()  — share that folder with Micheal
 *      (Editor). Never share the private corrective folder.
 *   6. Paste the logged SHEET ID and gids into the website's index.html,
 *      then Deploy → New deployment (Execute as: Me · Access: Anyone)
 *      and paste the /exec URL into the four site files that call it.
 * ═══════════════════════════════════════════════════════════════════
 */

var CONFIG = {
  /* Filled in by createRecordSpreadsheet(); the copy in Script Properties
     always wins at runtime, so changing this line alone does NOT repoint the
     script — run setSheetId() with the same value. */
  SHEET_ID: '1sEL0SWIh4NnNji4XUAVVG4pQSZe7a0y3vDmvvLNV6wE',
};

var AP_EMAIL = 'ap@michealrayberry.com';
var AGREEMENT_EDITION = 2; // Edition 2 (Aug 31, 2026) — version written to Confirmations
var MRB_EMAIL = 'contact@michealrayberry.com';
var PROJECT_START_FALLBACK = '2026-08-31';
/* Day 1 of the CURRENT attempt. The Site State key `start_date` overrides the
   fallback (cached 5 min), so a restart is ONE sheet edit — script, publisher,
   and SPA all read the same cell. */
var PROJECT_START = (function () {
  try {
    var c = CacheService.getScriptCache().get('mrb_start_date');
    if (c) return c;
    var vals = siteStateSheet().getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() !== 'start_date') continue;
      var v = vals[i][1];
      var ds = v instanceof Date ? Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd') : String(v || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) { CacheService.getScriptCache().put('mrb_start_date', ds, 300); return ds; }
    }
  } catch (e) {}
  return PROJECT_START_FALLBACK;
})();
var WEIGHT_AUTO_START = '2026-07-30'; // date the scale began writing weights

/* Tabs, in creation order. The headers are the contract between this
   script and the website — never reorder columns, only append. */
var TABS = {
  /* J stream_uid = Cloudflare Stream video id (site player); K r2_key = the
     untouched original in the private R2 bucket (evidence, never a player). */
  'Weigh-ins':      ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video', 'video_sec', 'stream_uid', 'r2_key'],
  /* The public record, exactly as the site renders it. Status is normalised
     on the site to open / corrected / resolved, so column C may hold the AP's
     own phrasing. 'corrections' is an append-only, semicolon-separated
     history — never rewrite an earlier note, add another. 'recording' holds
     the public URL of the corrective session filed against the entry; the
     site publishes it beside the entry (§8). */
  'Violation Log':  ['date', 'violation', 'status', 'submitted', 'resolved', 'ap_verification', 'corrections', 'recording', 'event_verification', 'stream_uid'],
  'Attestation':    ['logged_at_server', 'date', 'day', 'event', 'code', 'kind', 'video_sha256', 'photo_sha256s', 'weight', 'status', 'chunk_chain', 'chunk_count', 'server_seal', 'sealed_at'],
  'Corrective Log': ['date', 'assignment', 'due', 'status', 'completed'],
  /* type: official (AP entry) | personal (Micheal's note) | amendment (\u00a712.1 — also
     rendered on the agreement page's amendment log). */
  'Updates':        ['date', 'type', 'title', 'body', 'link'],
  'Site State':     ['key', 'value'],
  /* Written by withingsSync (weight only). The activity columns are legacy
     spacing kept so weight_lb stays column H for the site's readers. */
  'Health':         ['date', 'steps', 'zone_minutes', 'active_minutes', 'synced_at', 'distance_mi', 'calories', 'weight_lb'],
  'Weekly Log':     ['logged_at', 'date', 'week', 'documented', 'required', 'weight_lb', 'open_entries', 'url'],
  'Confirmations':  ['logged_at', 'date', 'version', 'day', 'url', 'attestation_seal'],
  /* §3.4 Evening Supervision — one row per scheduled night once ruled on.
     status: COMPLETED · MISSED · EXCEPTION · <reason>. Written by the
     nightly check (MISSED), the File tool (COMPLETED + stream_url), or the
     AP via the MRB menu (EXCEPTION). The site reads it on /live. */
  'Supervision':    ['date', 'required', 'status', 'start', 'end', 'stream_url', 'note'],
  /* "Report a Record Issue" (/report/) → Pages Function → action 'observer'
     (shared secret OBSERVER_SECRET). record_ref = date or Project Day the
     report concerns. AP-only; never read by the site.
     review = received | dismissed | verified | published | actioned. */
  'Observer':       ['received_at', 'type', 'record_ref', 'message', 'name', 'email', 'source_url', 'review', 'ap_note'],
  /* Every console action, stamped by the Access relay: who (verified email),
     from where, what, and the result. Append-only. */
  'AP Actions':     ['logged_at', 'actor', 'ip', 'user_agent', 'op', 'args', 'result'],
  /* Where each historical photo original landed in R2 (backfillPhotosToR2). */
  'R2 Photo Keys':  ['date', 'angle', 'r2_key', 'status', 'logged_at'],
};

/* §3.4 Evening Supervision — 18:00–22:00 ET. UNTIL FURTHER NOTICE (AP ruling,
   14 Sept 2026) nights are ASSIGNED by the Accountability Partner, not
   automatic: a night is required only when the Supervision tab holds a row
   for that date with required = yes (written from the /ap/ console). The
   22:20 check rules only on assigned nights. */
var SUPERVISION_START = '2026-09-13';
function supervisionScheduled(ds) {
  if (ds < SUPERVISION_START) return false;
  var sr = supervisionRow(ds);
  return !!(sr && /^(yes|true|1)$/i.test(String(sr.vals[1] || '').trim()));
}
/* Assign (required=yes) or release (required=no) a night. Never touches a
   night already ruled COMPLETED / MISSED / EXCEPTION. */
function supervisionAssign(ds, on, note) {
  var sh = supervisionSheet();
  var sr = supervisionRow(ds);
  if (sr) {
    var cur = String(sr.vals[2] || '');
    if (/^(COMPLETED|MISSED|EXCEPTION)/i.test(cur)) return { ok: false, error: 'That night is already ruled ' + cur.split(' · ')[0] + '.' };
    sh.getRange(sr.row, 2).setValue(on ? 'yes' : 'no');
    if (note) sh.getRange(sr.row, 7).setValue(note);
    return { ok: true };
  }
  if (!on) return { ok: true };
  sh.appendRow([ds, 'yes', '', '', '', '', note || 'assigned by the AP ' + menuToday()]);
  return { ok: true };
}
function supervisionSheet() { return tab('Supervision'); }
function supervisionRow(ds) {
  var sh = supervisionSheet();
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (apDateStr(v[i][0]) === ds) return { row: i + 1, vals: v[i] };
  return null;
}

/* ═════════════════ FRESH-START BUILD (run once) ═════════════════ */

function createRecordSpreadsheet() {
  // One-time build. Refuses if a record is already in use, so an accidental run
  // cannot orphan the live record by repointing SHEET_ID at a new empty file.
  var existing = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (existing) {
    Logger.log('A record is already in use: ' + existing +
      '\nRefusing to create another. To move deliberately, clear the SHEET_ID property first.');
    return existing;
  }
  var file = SpreadsheetApp.create('MRB Accountability Record — ' +
    Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'));
  var id = file.getId();

  var first = file.getSheets()[0];
  var names = Object.keys(TABS);
  for (var i = 0; i < names.length; i++) {
    var sh = (i === 0) ? first.setName(names[i]) : file.insertSheet(names[i]);
    var hdr = TABS[names[i]];
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, hdr.length)
      .setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10)
      .setBackground('#141412').setFontColor('#FAFAF7');
  }
  var TAB_COLORS = { 'Weigh-ins': '#B3261E', 'Violation Log': '#B3261E', 'Updates': '#B3261E',
    'Attestation': '#6B6A64', 'Corrective Log': '#6B6A64', 'Weekly Log': '#6B6A64',
    'Confirmations': '#6B6A64', 'Health': '#6B6A64', 'Site State': '#141412', 'Supervision': '#B3261E', 'Observer': '#6B6A64', 'AP Actions': '#141412' };
  for (var tc in TAB_COLORS) { var tsh = file.getSheetByName(tc); if (tsh) tsh.setTabColor(TAB_COLORS[tc]); }
  file.getSheetByName('Weigh-ins').setColumnWidth(1, 110);
  file.getSheetByName('Violation Log').setColumnWidth(2, 460);
  file.getSheetByName('Corrective Log').setColumnWidth(2, 380);

  PropertiesService.getScriptProperties().setProperty('SHEET_ID', id);

  var lines = ['', '════════ NEW RECORD SPREADSHEET ════════',
    'SHEET ID: ' + id,
    'URL:      ' + file.getUrl(),
    '',
    'Paste into the website (index.html):',
    '  SHEET_ID = ' + JSON.stringify(id)];
  var shs = file.getSheets();
  for (var s = 0; s < shs.length; s++) lines.push('  gid ' + shs[s].getSheetId() + '  → ' + shs[s].getName());
  lines.push('', 'Next: setApKey(...) · setDeviceKey(...) · setup() · showPhotosFolderUrl()');
  Logger.log(lines.join('\n'));
  return id;
}

/* ═════════════════════ CORE ACCESS ═════════════════════ */

function ss() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || CONFIG.SHEET_ID;
  if (!id) throw new Error('No SHEET_ID — run createRecordSpreadsheet() first.');
  return SpreadsheetApp.openById(id);
}
function tab(name) {
  var s = ss();
  var sh = s.getSheetByName(name);
  if (!sh && TABS[name]) {
    sh = s.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, TABS[name].length).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10).setBackground('#141412').setFontColor('#FAFAF7');
  }
  return sh;
}
function weighinsSheet() { return tab('Weigh-ins'); }
function violationLogSheet() { return tab('Violation Log'); }

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════════════ KEYS ═══════════════════════
   AP key — authorizes ap* endpoints (legacy; the console is the sheet’s MRB menu).
   Device key — Micheal's phone; files records, never edits them.
   Rotating either takes effect instantly. */
/* Point the script at an existing record spreadsheet (the ID is the long
   string in its URL). createRecordSpreadsheet() sets this automatically;
   use this when the record was made by hand or is being switched. */
function setSheetId(id) {
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', String(id || '').trim());
  Logger.log('SHEET_ID stored: ' + String(id || '').trim());
}

/* Read-only self-test: run it and the log tells you exactly what is wrong. */
function diagnose() {
  var p = PropertiesService.getScriptProperties();
  var out = ['', '════════ DIAGNOSE ════════'];
  out.push('SHEET_ID property: ' + (p.getProperty('SHEET_ID') || '(unset — falling back to CONFIG.SHEET_ID)'));
  out.push('AP_KEY set: ' + (p.getProperty('AP_KEY') ? 'yes' : 'NO — run setApKey()'));
  out.push('Device key set: ' + (p.getProperty('PACKET_KEY') ? 'yes' : 'NO — run setDeviceKey()'));
  out.push('Assistant unlock code set: ' + (p.getProperty('UNLOCK_CODE') ? 'yes' : 'NO — run setUnlockCode()'));
  try {
    var s = ss();
    out.push('Spreadsheet: ' + s.getName());
    var names = s.getSheets().map(function (x) { return x.getName(); });
    out.push('Tabs: ' + names.join(', '));
    var missing = Object.keys(TABS).filter(function (t) { return names.indexOf(t) === -1; });
    out.push(missing.length ? 'MISSING TABS (created on first use): ' + missing.join(', ') : 'All expected tabs present.');
  } catch (e) {
    out.push('CANNOT OPEN SPREADSHEET: ' + e);
  }
  out.push('Triggers: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
  out.push('Weight source: ' +
    (p.getProperty('WITHINGS_REFRESH') ? 'Withings direct (scale-synced)' : 'NOT CONNECTED — run the Withings connect steps'));
  out.push('Mail to: ' + MRB_EMAIL + ' (Micheal) · ' + AP_EMAIL + ' (AP)');
  out.push('Mail quota remaining today: ' + MailApp.getRemainingDailyQuota());
  Logger.log(out.join('\n'));
}

function setApKey(k) {
  PropertiesService.getScriptProperties().setProperty('AP_KEY', String(k || '').trim());
  Logger.log('AP key stored.');
}
function apOk(k) {
  var stored = PropertiesService.getScriptProperties().getProperty('AP_KEY');
  return !!stored && String(k || '').trim() === stored;
}
function setDeviceKey(k) {
  PropertiesService.getScriptProperties().setProperty('PACKET_KEY', String(k || '').trim());
  Logger.log('Device key stored.');
}
/* Assistant unlock code — the AP's half of the two-key lock on /assistant/.
   Distinct from AP_KEY (which authorises record actions and is never given to
   the participant). Run setUnlockCode('…') and hand the code to Micheal;
   change it any time to force every device to re-unlock. */
function setUnlockCode(c) {
  PropertiesService.getScriptProperties().setProperty('UNLOCK_CODE', String(c || '').trim());
  Logger.log('Unlock code stored.');
}
function unlockOk(c) {
  var stored = PropertiesService.getScriptProperties().getProperty('UNLOCK_CODE');
  return !!stored && String(c || '').trim() === stored;
}
function handleUnlock(obj) {
  var cache = CacheService.getScriptCache();
  var misses = Number(cache.get('unlock_misses') || 0);
  if (misses >= 5) return jsonOut({ ok: false, error: 'locked out — try again in 15 minutes' });
  if (!keyOk(obj.key) || !unlockOk(obj.code)) {
    cache.put('unlock_misses', String(misses + 1), 900);
    return jsonOut({ ok: false, error: 'keys not accepted' });
  }
  cache.remove('unlock_misses');
  var stamped = new Date().toISOString();
  return jsonOut({ ok: true, token: sealFor(['unlock', stamped].join('|')), issued: stamped });
}
/* ═════ OBSERVER SUBMISSIONS ═════
   A relay (functions/observer.js when hosted on Cloudflare Pages) verifies
   the visitor, then POSTs here with the shared secret. Rows land on the Observer tab; the AP is
   mailed. Nothing here touches the public record. */
function setObserverSecret(s) {
  PropertiesService.getScriptProperties().setProperty('OBSERVER_SECRET', String(s || '').trim());
  Logger.log('Observer secret stored. Set the SAME value as OBSERVER_SECRET on the relay host.');
}
function observerOk(s) {
  var stored = PropertiesService.getScriptProperties().getProperty('OBSERVER_SECRET');
  return !!stored && String(s || '').trim() === stored;
}
function handleObserver(obj) {
  var clip = function (v, n) { return String(v || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n); };
  var TYPES = ['Possible missed requirement', 'Incorrect or inconsistent record', 'Missing or broken evidence', 'Suspected misuse of public material', 'Question for the Accountability Partner'];
  var type = clip(obj.type, 60); if (TYPES.indexOf(type) === -1) type = 'Question for the Accountability Partner';
  var message = clip(obj.message, 4000);
  if (!message) return jsonOut({ ok: false, error: 'empty message' });
  var ref = clip(obj.record_ref, 40);
  if (TYPES.indexOf(type) <= 2 && !ref) return jsonOut({ ok: false, error: 'date or Project Day required' });
  var name = clip(obj.name, 120), email = clip(obj.email, 200), src = clip(obj.source_url, 500);
  var stamp = Utilities.formatDate(new Date(), 'America/New_York', "yyyy-MM-dd HH:mm 'ET'");
  var sh = tab('Observer');
  sh.appendRow([stamp, type, ref, message, name, email, src, 'received', '']);
  var n = sh.getLastRow() - 1;
  try {
    sendMail(AP_EMAIL, 'Record issue report #' + n + ' — ' + type + (ref ? ' — ' + ref : ''),
      'Received ' + stamp + '\nType: ' + type + (ref ? '\nRecord reference: ' + ref : '') +
      (name ? '\nName: ' + name : '') + (email ? '\nEmail: ' + email : '') + (src ? '\nLink: ' + src : '') +
      '\n\n' + message +
      '\n\n— A report is evidence for review, not a verdict. Check it against the record and the written rules. ' +
      'Review on the Observer tab (col H: received → dismissed / verified / published / actioned). Nothing publishes from this tab.' + apSign());
  } catch (e) { Logger.log('Observer mail failed: ' + e); }
  return jsonOut({ ok: true, n: n });
}

function keyOk(k) {
  var stored = PropertiesService.getScriptProperties().getProperty('PACKET_KEY');
  return !!stored && String(k || '').trim() === stored;
}

/* ═════════════════════ WEB ENDPOINT ═════════════════════
   GET  ?action=challenge (device key) · ?action=apstate (AP key)
   POST attest | packet | vidinit | vidchunk (device key) · ap* (AP key) */

function doGet(e) {
  try {
    return routeGet(e);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function routeGet(e) {
  /* Withings OAuth landing: point the Withings app's Callback URL at this
     /exec URL and approval redirects straight here — the code is exchanged
     server-side the same second, no copy-paste race. Remove nothing after
     connecting; without ?code this branch never fires. */
  if (e && e.parameter && e.parameter.code && e.parameter.state === 'mrb') {
    // One-shot: once the scale is bound, an unauthenticated visit cannot
    // rebind the weight feed to another Withings account. To reconnect, the
    // AP clears WITHINGS_REFRESH in Script Properties first.
    if (PropertiesService.getScriptProperties().getProperty('WITHINGS_REFRESH')) {
      return ContentService.createTextOutput('Withings is already connected. Reconnect requires the AP to clear WITHINGS_REFRESH first.');
    }
    withingsExchange(e.parameter.code);
    var ok = !!PropertiesService.getScriptProperties().getProperty('WITHINGS_REFRESH');
    return ContentService.createTextOutput(ok
      ? 'Withings connected. First sync has run — close this tab, then run setup() in the editor for the hourly trigger.'
      : 'Exchange failed — check the execution log in the Apps Script editor.');
  }
  // Device keys travel only in POST bodies — GET never accepts one (URLs are logged).
  if (e && e.parameter && e.parameter.action === 'apstate') {
    return apOk(e.parameter.key) ? handleApState() : jsonOut({ ok: false, error: 'unauthorized' });
  }
  return jsonOut({ ok: true, service: 'MRB record endpoint' });
}

/* One-time code stamped with GOOGLE SERVER TIME: a video recorded earlier
   cannot contain a code that did not exist until seconds ago. Today's
   scale-synced weight rides along so the assistant burns the OFFICIAL figure
   into the overlay instead of asking for a typed one. */
function issueChallenge(kind) {
  var code = String(Math.floor(1000 + Math.random() * 9000));
  var now = new Date();
  var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  var day = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  attestationSheet().appendRow([now, today, day, 'challenge-issued', code, String(kind || 'daily'), '', '', '', '']);
  var syncedW = '';
  try {
    var wv = weighinsSheet().getDataRange().getValues();
    for (var wi = 1; wi < wv.length; wi++) {
      if (apDateStr(wv[wi][0]) === today) { syncedW = parseFloat(wv[wi][1]) || ''; break; }
    }
  } catch (we) {}
  return jsonOut({ ok: true, code: code, day: day, issuedAt: now.toISOString(), weight: syncedW });
}

function doPost(e) {
  try {
    if (e && e.postData && e.postData.contents && String(e.postData.contents).charAt(0) === '{') {
      var obj = null;
      try { obj = JSON.parse(e.postData.contents); } catch (perr) {}
      if (obj && obj.action === 'attest') return keyOk(obj.key) ? handleAttest(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'packet') return keyOk(obj.key) ? handlePacket(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'keycheck') return jsonOut({ ok: keyOk(obj.key) }); // Pages Function /api/media-init asks before minting upload URLs
      if (obj && obj.action === 'correctivefiled') return keyOk(obj.key) ? handleCorrectiveFiled(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'ytfiled') return keyOk(obj.key) ? handleYtFiled(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'challenge') return keyOk(obj.key) ? issueChallenge(String(obj.kind || 'daily')) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'ping') return keyOk(obj.key) ? jsonOut({ ok: true }) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'unlock') return handleUnlock(obj);
      if (obj && obj.action === 'mystate') return keyOk(obj.key) ? handleMyState() : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'observer') return observerOk(obj.secret) ? handleObserver(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'vidinit') return keyOk(obj.key) ? handleVidInit(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'vidchunk') return keyOk(obj.key) ? handleVidChunk(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action && String(obj.action).indexOf('ap') === 0) return apOk(obj.key) ? handleApAction(obj) : jsonOut({ ok: false, error: 'unauthorized' });
    }
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ═════════════════ TRIGGERS ═════════════════ */

/* Adds the video_sec header to an existing Weigh-ins tab (append-only). */
function ensureWeighinsColumns() {
  var sh = weighinsSheet();
  var hdr = sh.getRange(1, 1, 1, Math.max(9, sh.getLastColumn())).getValues()[0];
  if (String(hdr[8] || '').trim() !== 'video_sec') {
    sh.getRange(1, 9).setValue('video_sec').setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10)
      .setBackground('#141412').setFontColor('#FAFAF7');
    Logger.log('Weigh-ins: added column I video_sec.');
  }
}

/* Append-only schema upgrade: for every tab, add any TRAILING headers that
   TABS defines but the sheet lacks (Sept 14: Violation Log I
   event_verification, Confirmations F attestation_seal). Never reorders or
   renames; a sheet whose existing headers differ is reported and left alone. */
/* One-time: old Observer layout (…, message@C, …, quotable@G, review@H) →
   new (record_ref@C inserted, quotable removed). Detects by header. */
function migrateObserverTab() {
  var sh = ss().getSheetByName('Observer'); if (!sh) return;
  var hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  if (hdr[2] === 'record_ref') return;
  if (hdr[2] === 'message' && hdr[6] === 'quotable') {
    sh.deleteColumn(7);              // quotable
    sh.insertColumnBefore(3);        // record_ref
    sh.getRange(1, 1, 1, TABS['Observer'].length).setValues([TABS['Observer']])
      .setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10).setBackground('#141412').setFontColor('#FAFAF7');
    Logger.log('Observer: migrated to record_ref layout.');
  } else Logger.log('Observer: unrecognised header layout — left untouched.');
}

function ensureTabHeaders() {
  var s = ss();
  Object.keys(TABS).forEach(function (name) {
    var sh = s.getSheetByName(name);
    if (!sh) return;
    var cols = TABS[name];
    var width = Math.min(sh.getLastColumn(), cols.length);
    var have = width > 0 ? sh.getRange(1, 1, 1, width).getValues()[0].map(function (v) { return String(v).trim(); }) : [];
    var prefixOk = have.every(function (v, i) { return v === cols[i]; });
    if (!prefixOk) { Logger.log(name + ': headers differ from TABS — left untouched (fix by hand; do not reorder).'); return; }
    if (have.length < cols.length) {
      var add = cols.slice(have.length);
      sh.getRange(1, have.length + 1, 1, add.length).setValues([add])
        .setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10).setBackground('#141412').setFontColor('#FAFAF7');
      Logger.log(name + ': appended header(s) ' + add.join(', '));
    }
  });
}

/* Latest server_seal of a VALID-CONSUMED 'confirmation' capture-attested row
   for the given date — the value the Confirmations tab binds to (col F). */
function confirmationSealFor(date) {
  var att = tab('Attestation');
  var last = att.getLastRow();
  if (last < 2) return '';
  var rows = att.getRange(2, 1, last - 1, 14).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var d = rows[i][1] instanceof Date ? Utilities.formatDate(rows[i][1], 'America/New_York', 'yyyy-MM-dd') : String(rows[i][1] || '').trim();
    if (d !== String(date || '').trim()) continue;
    if (String(rows[i][3]).trim() !== 'capture-attested' || String(rows[i][5]).trim() !== 'confirmation') continue;
    if (String(rows[i][9]).trim() !== 'VALID-CONSUMED') continue;
    return String(rows[i][12] || '').trim().toLowerCase();
  }
  return '';
}

/* Run once to copy SEAL_SECRET into the deployment environment as
   ATTESTATION_SEAL_SECRET (the publisher verifies seals against it). */
function showSealSecret() { Logger.log(sealSecret()); }

/* Site State keys the publisher REQUIRES to exist (it refuses to infer them).
   Written only when absent — never overwrites an AP-set value. */
function ensureSiteState() {
  var sh = tab('Site State');
  var vals = sh.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < vals.length; i++) have[String(vals[i][0] || '').trim()] = true;
  var required = { start_date: PROJECT_START_FALLBACK };
  Object.keys(required).forEach(function (k) {
    if (have[k]) return;
    sh.appendRow([k, required[k]]);
    sh.getRange(sh.getLastRow(), 2).setNumberFormat('@'); // keep the ISO date as text
    Logger.log('Site State: added ' + k + ' = ' + required[k]);
  });
}

function setup() {
  ensureWeighinsColumns();
  migrateObserverTab();
  ensureTabHeaders();
  ensureSiteState();
  repairSiteState();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importPhotos').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('mirrorToMicheal').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('githubMirrorPhotos').timeBased().everyMinutes(15).create();
  // 22:00 packet check deploys the day's report card verdict (COMPLIANT /
  // INCOMPLETE / NOT FILED / VIOLATION) within minutes of the deadline.
  ScriptApp.newTrigger('nightlyComplianceCheck').timeBased().everyDays(1).atHour(22).inTimezone('America/New_York').create();
  ScriptApp.newTrigger('abandonmentCheck').timeBased().everyDays(1).atHour(23).inTimezone('America/New_York').create();
  // §3.4 Evening Supervision ruling, 20 minutes after the packet check.
  ScriptApp.newTrigger('supervisionNightlyCheck').timeBased().everyDays(1).atHour(22).nearMinute(20).inTimezone('America/New_York').create();
  // Monday: project weeks run Monday→Sunday from Day 1 (Mon Aug 31); the
  // weekly review is recorded Monday, so both mails land Monday morning.
  ScriptApp.newTrigger('apWeeklyReview').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone('America/New_York').create();
  // Micheal's mail: the day's requirements at 07:00, a two-hour warning at
  // 20:00 (silent if the packet is already complete), a Monday review, and an
  // hourly watch for AP verdicts, corrective submissions, and milestones.
  ScriptApp.newTrigger('morningBrief').timeBased().everyDays(1).atHour(7).inTimezone('America/New_York').create();
  ScriptApp.newTrigger('eveningWarning').timeBased().everyDays(1).atHour(20).inTimezone('America/New_York').create();
  ScriptApp.newTrigger('mrbWeeklyBrief').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone('America/New_York').create();
  ScriptApp.newTrigger('hourlyWatch').timeBased().everyHours(1).create();
  // Installable onOpen bound to the record spreadsheet, so the MRB menu appears
  // even though this is a standalone script (a simple onOpen can't reach a
  // sheet the script isn't contained in).
  try {
    ScriptApp.newTrigger('onOpen').forSpreadsheet(ss()).onOpen().create();
  } catch (e) { Logger.log('onOpen trigger not installed: ' + e); }
  if (PropertiesService.getScriptProperties().getProperty('WITHINGS_REFRESH')) {
    ScriptApp.newTrigger('withingsSync').timeBased().everyHours(1).create();
  }
  Logger.log('Triggers installed.');
}

/* ═════════════════ DRIVE: PHOTO + VIDEO INTAKE ═════════════════
   Daily photos land in the shared folder's root; videos are filed into
   per-kind subfolders (Inspection Videos / Weekly Reviews / Consent
   Confirmations / Announcements & Demos) so the archive stays legible.
   importPhotos scans the root and Inspection Videos and files everything
   into the Weigh-ins row by filename. Corrective media go to the PRIVATE
   folder and never touch the public record. */

var ANGLE_COLS = { front: 4, left: 5, rear: 6, right: 7 };

/* Named subfolder of the public photos folder (created on first use). */
function publicSubfolder(name) {
  var root = photosFolder();
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/* Root files plus one level of subfolders — the intake and mirror view. */
function publicFiles(cb) {
  var root = photosFolder();
  var files = root.getFiles();
  while (files.hasNext()) cb(files.next());
  var subs = root.getFolders();
  while (subs.hasNext()) {
    var sf = subs.next().getFiles();
    while (sf.hasNext()) cb(sf.next());
  }
}

function importPhotos() {
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();

  // Index existing rows by date string.
  var byDate = {};
  for (var i = 1; i < vals.length; i++) {
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (ds) byDate[ds] = { row: i + 1 };
  }

  publicFiles(function (f) {
    var mt = String(f.getMimeType());
    var isImg = mt.indexOf('image/') === 0;
    var isVid = mt.indexOf('video/') === 0;
    if (!isImg && !isVid) return;

    var name = f.getName().toLowerCase();
    var m = name.match(/(\d{4}-\d{2}-\d{2})/);
    var dateStr = m ? m[1] : Utilities.formatDate(f.getDateCreated(), 'America/New_York', 'yyyy-MM-dd');

    var col;
    var url;
    if (isVid) {
      // Only the daily inspection video belongs in column H. Corner-time /
      // resolution / corrective session videos also land in Drive (auto-upload)
      // but are linked from their own entries, never the daily row.
      if (name.indexOf('corner') !== -1 || name.indexOf('corrective') !== -1 || name.indexOf('resolution') !== -1 || name.indexOf('acknowledgment') !== -1) return;
      if (name.indexOf('weekly') !== -1 || name.indexOf('confirmation') !== -1 || name.indexOf('demo') !== -1 || name.indexOf('announcement') !== -1) return; // own archive folders, not the daily row
      col = 8; // column H = inspection video archive
      url = 'https://drive.google.com/file/d/' + f.getId() + '/view';
    } else {
      var angle = 'front';
      if (name.indexOf('corner') !== -1 || name.indexOf('corrective') !== -1 || name.indexOf('resolution') !== -1 || name.indexOf('acknowledgment') !== -1) return; // corrective/resolution photos are their own record material — not daily angle photos, never mirrored
      if (name.indexOf('meal') !== -1) return;   // meal photos stay in the folder archive; not an angle column
      if (name.indexOf('-wait-') !== -1) return; // Wait stills are the /positions reference (Site State), not a record angle
      if (name.indexOf('left') !== -1) angle = 'left';
      else if (name.indexOf('rear') !== -1 || name.indexOf('back') !== -1) angle = 'rear';
      else if (name.indexOf('right') !== -1) angle = 'right';
      col = ANGLE_COLS[angle];
      url = 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1200';
    }

    var rec = byDate[dateStr];
    if (!rec) {
      sh.appendRow([dateStr]);
      rec = { row: sh.getLastRow() };
      byDate[dateStr] = rec;
    }
    var cell = sh.getRange(rec.row, col);
    if (String(cell.getValue() || '').trim()) return; // first file per slot is final
    cell.setValue(url);
  });
}

function photosFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTOS_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) {}
  }
  var folder = DriveApp.createFolder('MRB Daily Photos');
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty('PHOTOS_FOLDER_ID', folder.getId());
  return folder;
}

// Run from the editor; the execution log prints the folder URL to share with Micheal.
function showPhotosFolderUrl() {
  Logger.log(photosFolder().getUrl());
}

/* ═════ MICHEAL'S DRIVE MIRROR (optional) ═════

   Auto-copies every PUBLIC file (daily photos + inspection videos) into a
   folder in MICHEAL'S OWN Drive, so he holds his own archive. Setup:
     1. Micheal creates a folder in his Drive and shares it with the AP's
        Google account as Editor.
     2. AP runs setMirrorFolder('<that folder id>').
   The hourly trigger then copies anything new. The private corrective /
   verification folder is NEVER mirrored — this reads only the public
   photos folder. Clearing the property stops the mirror.  */

function setMirrorFolder(id) {
  PropertiesService.getScriptProperties().setProperty('MIRROR_FOLDER_ID', String(id || '').trim());
  Logger.log(String(id || '').trim() ? 'Mirror folder stored — mirrorToMicheal() will copy new public files hourly.' : 'Mirror folder cleared — mirroring stopped.');
}

function mirrorToMicheal() {
  var id = PropertiesService.getScriptProperties().getProperty('MIRROR_FOLDER_ID');
  if (!id) return; // not configured — mirroring is optional
  var dst;
  try { dst = DriveApp.getFolderById(id); } catch (e) { Logger.log('Mirror folder unreachable: ' + e); return; }
  var cutoff = Date.now() - 48 * 3600 * 1000; // only look at recent files; older ones were mirrored on earlier runs
  var copied = 0, skipped = 0;
  publicFiles(function (f) {
    if (f.getDateCreated().getTime() < cutoff) return;
    if (dst.getFilesByName(f.getName()).hasNext()) { skipped++; return; }
    try { f.makeCopy(f.getName(), dst); copied++; } catch (e) { Logger.log('Mirror copy failed for ' + f.getName() + ': ' + e); }
  });
  if (copied) Logger.log('Mirrored ' + copied + ' new file(s) to Micheal\u2019s Drive (' + skipped + ' already there).');
}

/* One-time backfill: copies EVERYTHING in the public folder regardless of
   age. Run once after setMirrorFolder(); the hourly mirror handles the rest. */
function mirrorBackfill() {
  var id = PropertiesService.getScriptProperties().getProperty('MIRROR_FOLDER_ID');
  if (!id) { Logger.log('Run setMirrorFolder() first.'); return; }
  var dst = DriveApp.getFolderById(id);
  var copied = 0;
  publicFiles(function (f) {
    if (!dst.getFilesByName(f.getName()).hasNext()) { f.makeCopy(f.getName(), dst); copied++; }
  });
  Logger.log('Backfilled ' + copied + ' file(s).');
}

function correctiveFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CORRECTIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) {}
  }
  var folder = DriveApp.createFolder('MRB Corrective Sessions'); // private — no link sharing
  props.setProperty('CORRECTIVE_FOLDER_ID', folder.getId());
  return folder;
}

/* ═════ AUTO VIDEO UPLOAD (chunked relay to a Drive resumable session) ═════
   The tools post the finished file in ~4 MB base64 chunks, each relayed
   straight into Drive — no whole-file blob ever exists here, so file
   size is unlimited. Destination by kind:
     corrective                    → private archive (never public, never mirrored)
     daily                         → Inspection Videos (public folder)
     weekly                        → Weekly Reviews
     confirmation                  → Consent Confirmations
     demo / announcement / other   → Announcements & Demos */

/* Filed when the corrective session's public posting is submitted: stamps the
   submission timestamp (col D, if empty), files the public recording URL
   (col H), and RESOLVES the entry (cols C/E) — submission clears the
   violation; the AP reviews the posting and may overrule by reopening the
   row (set status back to Unresolved, note it in corrections). */
function handleCorrectiveFiled(obj) {
  var sh = violationLogSheet();
  var row = 0;
  var n = parseInt(String(obj.ref || '').replace(/^V-0*/i, ''), 10);
  if (n && n >= 1 && n + 1 <= sh.getLastRow()) row = n + 1;
  if (!row && obj.date) {
    // Fall back to the entry date — prefer the latest unresolved match.
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var ds = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], 'America/New_York', 'yyyy-MM-dd') : String(v[i][0] || '').trim();
      if (ds !== String(obj.date).trim()) continue;
      row = i + 1;
      if (!/^\s*(resolved|satisfied|closed)/i.test(String(v[i][2] || ''))) break;
    }
  }
  if (!row) return jsonOut({ ok: false, error: 'bad ref' });
  var now = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm');
  if (!String(sh.getRange(row, 4).getValue() || '').trim()) sh.getRange(row, 4).setValue(now);
  var url = String(obj.url || '').trim();
  if (url) sh.getRange(row, 8).setValue(url);
  // Submission resolves the entry (§8 as amended). Overrule = AP edits the row.
  var todayIso = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (!/^\s*resolved/i.test(String(sh.getRange(row, 3).getValue() || ''))) {
    sh.getRange(row, 3).setValue('Resolved · ' + todayIso);
    sh.getRange(row, 5).setValue(todayIso);
  }
  return jsonOut({ ok: true });
}

/* Files the public YouTube URL for any session kind (§2: YouTube is an
   Official Platform; the site embeds whatever URL the record holds).
   daily → Weigh-ins col H · corrective → Violation Log col H (via
   handleCorrectiveFiled) · weekly → Weekly Log url · confirmation →
   Confirmations url · demo → Site State demo_video_url. */
/* Canonical YouTube link: youtu.be/ID. Accepts watch?v=, shorts/, embed/,
   live/, m., and share-sheet ?si= variants; anything else returns ''. */
function canonicalYouTube(raw) {
  var s = String(raw || '').trim();
  var m = s.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[\/?#].*)?$/)
    || s.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$/)
    || s.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})(?:[\/?#].*)?$/);
  return m ? 'https://youtu.be/' + m[1] : '';
}

function handleYtFiled(obj) {
  var url = canonicalYouTube(obj.url) || String(obj.url || '').trim();
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) return jsonOut({ ok: false, error: 'not a YouTube link' });
  var kind = String(obj.kind || '');
  var date = String(obj.date || '').trim();
  if (kind === 'corrective') return handleCorrectiveFiled(obj);
  if (kind === 'daily') {
    var sh = weighinsSheet();
    var v = sh.getDataRange().getValues();
    for (var i = v.length - 1; i >= 1; i--) {
      var ds = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], 'America/New_York', 'yyyy-MM-dd') : String(v[i][0] || '').trim();
      if (ds === date) { sh.getRange(i + 1, 8).setValue(url); return jsonOut({ ok: true }); }
    }
    return jsonOut({ ok: false, error: 'no weigh-in row for ' + date });
  }
  if (kind === 'weekly' || kind === 'confirmation') {
    var sh2 = tab(kind === 'weekly' ? 'Weekly Log' : 'Confirmations');
    var col = kind === 'weekly' ? 8 : 5;
    var vv = sh2.getDataRange().getValues();
    for (var j = vv.length - 1; j >= 1; j--) {
      var d2 = vv[j][1] instanceof Date ? Utilities.formatDate(vv[j][1], 'America/New_York', 'yyyy-MM-dd') : String(vv[j][1] || '').trim();
      if (d2 === date) { sh2.getRange(j + 1, col).setValue(url); return jsonOut({ ok: true }); }
    }
    return jsonOut({ ok: false, error: 'no ' + kind + ' row for ' + date });
  }
  if (kind === 'consent') {
    // Consent Confirmation filed from the File tool. Upsert by date so a
    // re-record after an amendment lands on the same day's row. Col F carries
    // the server_seal of the day's sealed 'confirmation' capture so the
    // publisher can bind the posted video to its attested take.
    var cf = tab('Confirmations');
    var seal = confirmationSealFor(date);
    var cv = cf.getDataRange().getValues();
    for (var k2 = cv.length - 1; k2 >= 1; k2--) {
      var d3 = cv[k2][1] instanceof Date ? Utilities.formatDate(cv[k2][1], 'America/New_York', 'yyyy-MM-dd') : String(cv[k2][1] || '').trim();
      if (d3 === date) {
        cf.getRange(k2 + 1, 5).setValue(url);
        if (seal) cf.getRange(k2 + 1, 6).setValue(seal);
        return jsonOut({ ok: true });
      }
    }
    cf.appendRow([new Date(), date, AGREEMENT_EDITION, Math.floor((new Date(date) - new Date(PROJECT_START)) / 864e5) + 1, url, seal]);
    return jsonOut({ ok: true });
  }
  if (kind === 'supervision') {
    // Evening Supervision archive link (§3.4). Filing before the 22:20 ruling
    // marks the night COMPLETED; after a MISSED ruling the link is kept as a
    // note but the status stands — the record controls.
    var sr = supervisionRow(date);
    var ssh = supervisionSheet();
    var start = String(obj.start || '').trim(), end = String(obj.end || '').trim();
    if (sr) {
      var cur = String(sr.vals[2] || '');
      ssh.getRange(sr.row, 6).setValue(url);
      if (start) ssh.getRange(sr.row, 4).setValue(start);
      if (end) ssh.getRange(sr.row, 5).setValue(end);
      if (/^MISSED/i.test(cur)) ssh.getRange(sr.row, 7).setValue((String(sr.vals[6] || '') + '; link filed after the MISSED ruling').replace(/^; /, ''));
      else if (!/^EXCEPTION/i.test(cur)) ssh.getRange(sr.row, 3).setValue('COMPLETED');
    } else {
      ssh.appendRow([date, supervisionScheduled(date) ? 'yes' : 'no', 'COMPLETED', start, end, url, '']);
    }
    return jsonOut({ ok: true });
  }
  if (kind === 'announcement') { stateSet('intro_video_url', url); return jsonOut({ ok: true }); }
  if (kind === 'demo' || !kind) { stateSet('demo_video_url', url); return jsonOut({ ok: true }); }
  // An unknown kind must never silently overwrite a Site State URL.
  return jsonOut({ ok: false, error: 'unknown kind: ' + kind });
}

/* Drive filenames from devices: printable, no slashes, bounded. */
function safeFileName(n, fallback) {
  var s = String(n || '').replace(/[\x00-\x1f\x7f\/\\]/g, '').trim().slice(0, 160);
  return s || fallback;
}

function handleVidInit(obj) {
  var kind = String(obj.kind || '');
  var folder;
  if (kind === 'corrective') folder = correctiveFolder();
  else if (kind === 'daily') folder = publicSubfolder('Inspection Videos');
  else if (kind === 'weekly') folder = publicSubfolder('Weekly Reviews');
  else if (kind === 'confirmation') folder = publicSubfolder('Consent Confirmations');
  else folder = publicSubfolder('Announcements & Demos');
  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': String(obj.mime || 'video/webm'),
      'X-Upload-Content-Length': String(Number(obj.size) || 0)
    },
    payload: JSON.stringify({ name: safeFileName(obj.name, 'video.webm'), parents: [folder.getId()] }),
    muteHttpExceptions: true
  });
  var headers = r.getAllHeaders();
  var loc = headers['Location'] || headers['location'];
  if (r.getResponseCode() !== 200 || !loc) return jsonOut({ ok: false, error: 'init ' + r.getResponseCode() });
  return jsonOut({ ok: true, session: String(loc) });
}

function handleVidChunk(obj) {
  // The relay only ever writes to a Drive resumable session it opened itself.
  var session = String(obj.session || '');
  if (session.indexOf('https://www.googleapis.com/upload/drive/v3/') !== 0) return jsonOut({ ok: false, error: 'bad session' });
  var bytes = Utilities.base64Decode(String(obj.chunk_b64 || ''));
  var offset = Number(obj.offset) || 0;
  var total = Number(obj.total) || 0;
  var r = UrlFetchApp.fetch(session, {
    method: 'put',
    contentType: String(obj.mime || 'application/octet-stream'),
    headers: { 'Content-Range': 'bytes ' + offset + '-' + (offset + bytes.length - 1) + '/' + total },
    payload: bytes,
    muteHttpExceptions: true
  });
  var code = r.getResponseCode();
  if (code === 308) return jsonOut({ ok: true, done: false });
  if (code === 200 || code === 201) {
    var id = '';
    try { id = JSON.parse(r.getContentText()).id || ''; } catch (e) {}
    return jsonOut({ ok: true, done: true, id: id, url: id ? 'https://drive.google.com/file/d/' + id + '/view' : '' });
  }
  return jsonOut({ ok: false, error: 'chunk ' + code });
}

function handlePacket(obj) {
  var today = String(obj.date || Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'));
  if (obj.image_b64) {
    var name = safeFileName(obj.name, 'mrb-daily-photo-' + today + '-front.jpg');
    var isPrivate = /corrective|corner|resolution|acknowledgment/i.test(name);
    var isWait = /-wait-/i.test(name);
    var mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
    var blob = Utilities.newBlob(Utilities.base64Decode(String(obj.image_b64)), mime, name);
    if (isWait) {
      // Wait-position still: the /positions reference frame, never a record photograph.
      var wf = publicSubfolder('Wait Stills').createFile(blob);
      stateSet('wait_still_url', 'https://drive.google.com/thumbnail?id=' + wf.getId() + '&sz=w1200');
      stateSet('wait_still_date', today);
    } else {
      (isPrivate ? correctiveFolder() : photosFolder()).createFile(blob);
    }
  }
  var videoUrl = String(obj.video_url || '').trim();
  if (videoUrl) {
    var vs = weighinsSheet();
    var vv = vs.getDataRange().getValues();
    var vrow = 0;
    for (var v = 1; v < vv.length; v++) if (apDateStr(vv[v][0]) === today) { vrow = v + 1; break; }
    if (!vrow) { vs.appendRow([today]); vrow = vs.getLastRow(); }
    vs.getRange(vrow, 8).setValue(videoUrl); // column H — inspection video
    var dur = Math.round(Number(obj.duration_sec) || 0);
    if (dur > 0) vs.getRange(vrow, 9).setValue(dur); // column I — recording length in seconds (VideoObject duration)
    handlePacketMediaFields(vs, vrow, obj);
  }
  if (!videoUrl && (obj.stream_uid || obj.r2_key)) {
    var ms = weighinsSheet(), mv = ms.getDataRange().getValues();
    for (var mi = 1; mi < mv.length; mi++) if (apDateStr(mv[mi][0]) === today) { handlePacketMediaFields(ms, mi + 1, obj); break; }
  }

  /* Manual weight is no longer accepted (AP directive): the official daily
     weight is ONLY the scale-synced figure written by withingsSync(). A weight
     sent by a device tool still lands in the Attestation log (spoken and
     burned into the video) but never touches the Weigh-ins column. */
  if (obj.video_url) {
    var vsh = weighinsSheet();
    var vv = vsh.getDataRange().getValues();
    for (var k = 1; k < vv.length; k++) {
      if (apDateStr(vv[k][0]) === today) { vsh.getRange(k + 1, 8).setValue(String(obj.video_url)); break; }
    }
  }
  if (obj.finalize) importPhotos(); // pull anything just written into its column
  return jsonOut({ ok: true });
}

/* ═════ CLOUDFLARE STREAM (player) + R2 (originals) ═════
   The assistant uploads each take to R2 (untouched original) and Stream
   (playback copy) via the site's /api/media-init Pages Function, then files
   stream_uid + r2_key with the packet. Weigh-ins J/K; Violation Log J.
   Setup: setCloudflareMedia(cfAccountId, streamToken, r2AccountId, r2Bucket)
   then setR2Keys(accessKeyId, secret) — needed only for backfillR2FromDrive. */
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
/* Idempotent: never overwrites a filled cell. */
function handlePacketMediaFields(sh, row, obj) {
  var uid = String(obj.stream_uid || '').trim(), key = String(obj.r2_key || '').trim();
  // Photo originals in R2: the publisher mirrors any 'originals/…' value in D–G
  // from the bucket instead of Drive. First value per slot is final.
  var pk = obj.photo_keys && typeof obj.photo_keys === 'object' ? obj.photo_keys : {};
  var cols = { front: 4, left: 5, rear: 6, right: 7 };
  Object.keys(cols).forEach(function (a) {
    var k = String(pk[a] || '').trim();
    if (k && /^originals\//.test(k) && !String(sh.getRange(row, cols[a]).getValue() || '').trim()) sh.getRange(row, cols[a]).setValue(k);
  });
  if (/^[a-f0-9]{32}$/i.test(uid) && !String(sh.getRange(row, 10).getValue() || '').trim()) sh.getRange(row, 10).setValue(uid.toLowerCase());
  if (key && /^originals\//.test(key) && !String(sh.getRange(row, 11).getValue() || '').trim()) sh.getRange(row, 11).setValue(key.slice(0, 200));
}
/* File a corrective recording's Stream uid by hand (Violation Log col J). */
function setCorrectiveStreamUid(date, uid) {
  if (!/^[a-f0-9]{32}$/i.test(String(uid || ''))) { Logger.log('Bad uid'); return; }
  var sh = violationLogSheet(), vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) if (apDateStr(vals[i][0]) === String(date)) { sh.getRange(i + 1, 10).setValue(String(uid).toLowerCase()); Logger.log('Filed.'); return; }
  Logger.log('No violation row for ' + date);
}
/* One-off: re-apply allowedOrigins to every Stream uid already filed
   (Weigh-ins col J + Violation Log col J). Fixes "not configured to be
   allowed on this domain" on the AP console. Safe to re-run. */
function streamFixOrigins() {
  var p = PropertiesService.getScriptProperties();
  var acct = p.getProperty('CF_ACCOUNT_ID'), tok = p.getProperty('STREAM_API_TOKEN');
  if (!acct || !tok) { Logger.log('Run setCloudflareMedia first.'); return; }
  var uids = [];
  [weighinsSheet(), violationLogSheet()].forEach(function (sh) { sh.getDataRange().getValues().slice(1).forEach(function (r) { var u = String(r[9] || '').trim().toLowerCase(); if (/^[a-f0-9]{32}$/.test(u)) uids.push(u); }); });
  var ok = 0, bad = 0;
  uids.forEach(function (uid) {
    var res = UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + acct + '/stream/' + uid, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok },
      payload: JSON.stringify({ allowedOrigins: ['michealrayberry.com', 'www.michealrayberry.com', 'ap.michealrayberry.com', '*.michealrayberry.com', '*.pages.dev'], requireSignedURLs: false }) });
    if (res.getResponseCode() < 300) ok++; else { bad++; Logger.log(uid + ': ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200)); }
  });
  Logger.log('Stream origins fixed on ' + ok + ' video(s); ' + bad + ' failed.');
}

/* BACKFILL Days 1–N → Stream by upload-from-URL, one row per run (6-min limit).
   Re-run until it logs "nothing left". Toggles link-sharing on the Drive file
   only for the duration of the copy. */
function backfillStreamFromDrive() {
  var p = PropertiesService.getScriptProperties();
  var acct = p.getProperty('CF_ACCOUNT_ID'), tok = p.getProperty('STREAM_API_TOKEN');
  if (!acct || !tok) { Logger.log('Run setCloudflareMedia first.'); return; }
  var sh = weighinsSheet(), vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][9] || '').trim()) continue;
    var dateIso = apDateStr(vals[i][0]);
    var file = findDriveBackup_(dateIso, 'inspection');
    if (!file) { Logger.log(dateIso + ': no Drive backup found — skipped'); continue; }
    // The backups were uploaded by the participant's account, so this script
    // (running as the AP) cannot change their sharing; Stream's copy-from-URL
    // needs a public link. Upload the bytes directly instead (basic upload,
    // multipart). Apps Script caps outbound payloads at 50 MB; bigger files
    // are logged and uploaded by hand.
    var blob = file.getBlob();
    var size = file.getSize();
    if (size > 45 * 1024 * 1024) { Logger.log(dateIso + ': ' + Math.round(size / 1048576) + ' MB — over the Apps Script payload cap; upload to Stream by hand and paste the uid into column J.'); continue; }
    var res = UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + acct + '/stream', {
      method: 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok },
      payload: { file: blob.setName('micheal-ray-berry-day-' + ('00' + dayOf(dateIso)).slice(-3) + '-inspection-' + dateIso + (/webm/i.test(blob.getContentType()) ? '.webm' : '.mp4')) },
    });
    var body = {}; try { body = JSON.parse(res.getContentText()); } catch (err) {}
    if (body.success && body.result && body.result.uid) {
      // name + origins + thumbnail via a follow-up PATCH (cheap; no memory cost)
      try { UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + acct + '/stream/' + body.result.uid, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok },
        payload: JSON.stringify({ meta: { name: 'Micheal Ray Berry — Day ' + dayOf(dateIso) + ' inspection — ' + dateIso, date: dateIso, kind: 'daily' }, allowedOrigins: ['michealrayberry.com', 'www.michealrayberry.com', 'ap.michealrayberry.com', '*.michealrayberry.com', '*.pages.dev'], thumbnailTimestampPct: 0.05 }) }); } catch (err) {}
    }
    if (!body.success) { Logger.log(dateIso + ': Stream copy failed — ' + res.getContentText().slice(0, 300)); return; }
    sh.getRange(i + 1, 10).setValue(body.result.uid);
    Logger.log(dateIso + ': Stream uid ' + body.result.uid + ' filed. Re-run for the next row.');
    return;
  }
  Logger.log('Stream backfill: nothing left.');
}
/* Originals → private R2 bucket via SigV4 PUT, one row per run. ≤ 45 MB/file
   (Apps Script fetch payload cap); larger originals are copied by hand. */
function backfillR2FromDrive() {
  var p = PropertiesService.getScriptProperties();
  var acct = p.getProperty('R2_ACCOUNT_ID'), bucket = p.getProperty('R2_BUCKET') || 'mrb-evidence';
  var ak = p.getProperty('R2_ACCESS_KEY_ID'), sk = p.getProperty('R2_SECRET_ACCESS_KEY');
  if (!acct || !ak || !sk) { Logger.log('Run setCloudflareMedia + setR2Keys first.'); return; }
  var sh = weighinsSheet(), vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][10] || '').trim()) continue;
    var dateIso = apDateStr(vals[i][0]);
    var file = findDriveBackup_(dateIso, 'inspection');
    if (!file) { Logger.log(dateIso + ': no Drive backup — skipped'); continue; }
    var size = file.getSize();
    if (size > 45 * 1024 * 1024) { Logger.log(dateIso + ': ' + Math.round(size / 1048576) + ' MB — over the Apps Script payload cap; upload to R2 by hand as originals/… and paste the key into column K.'); continue; }
    var blob = file.getBlob();
    var ext = /webm/i.test(blob.getContentType()) ? 'webm' : 'mp4';
    var key = 'originals/' + dateIso.slice(0, 4) + '/' + dateIso.slice(5, 7) + '/micheal-ray-berry-day-' + ('00' + dayOf(dateIso)).slice(-3) + '-inspection-' + dateIso + '.' + ext;
    var res = r2Put_(acct, bucket, ak, sk, key, blob);
    if (res.getResponseCode() >= 300) { Logger.log(dateIso + ': R2 PUT ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200)); return; }
    sh.getRange(i + 1, 11).setValue(key);
    Logger.log(dateIso + ': archived as ' + key + '. Re-run for the next row.');
    return;
  }
  Logger.log('R2 backfill: nothing left.');
}
/* Historical photo originals → private R2 bucket, one day (4 angles) per run.
   Source order per angle: the Drive file the sheet cell points at (or pointed
   at before the mirror repointed it — matched by filename in the photos
   folder), else the committed repo copy fetched over HTTPS. Records the key in
   a 'R2 Photo Keys' tab so the sheet's public URLs stay untouched. Re-run
   until "nothing left". */
function backfillPhotosToR2() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('R2_ACCOUNT_ID') || !p.getProperty('R2_ACCESS_KEY_ID')) { Logger.log('Run setCloudflareMedia + setR2Keys first.'); return; }
  var acct = p.getProperty('R2_ACCOUNT_ID'), bucket = p.getProperty('R2_BUCKET') || 'mrb-evidence', ak = p.getProperty('R2_ACCESS_KEY_ID'), sk = p.getProperty('R2_SECRET_ACCESS_KEY');
  var log = tab('R2 Photo Keys'); var doneRows = log.getDataRange().getValues().slice(1); var done = {};
  doneRows.forEach(function (r) { done[apDateStr(r[0]) + '|' + String(r[1]).trim()] = true; });
  var vals = weighinsSheet().getDataRange().getValues(); var angles = ['front', 'left', 'rear', 'right'];
  for (var r = 1; r < vals.length; r++) {
    var dateIso = apDateStr(vals[r][0]); if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) continue;
    var pending = angles.filter(function (a) { return !done[dateIso + '|' + a] && String(vals[r][3 + angles.indexOf(a)] || '').trim(); });
    if (!pending.length) continue;
    var day = dayOf(dateIso), okCount = 0;
    for (var i = 0; i < pending.length; i++) {
      var a = pending[i], cell = String(vals[r][3 + angles.indexOf(a)] || '').trim();
      var name = 'micheal-ray-berry-day-' + ('00' + day).slice(-3) + '-' + a + '-' + dateIso + '.jpg';
      var blob = null;
      try {
        if (/^originals\//.test(cell)) { log.appendRow(["'" + dateIso, a, cell, 'already-r2', new Date()]); okCount++; continue; }
        var id = driveIdFromUrl(cell);
        if (id) blob = DriveApp.getFileById(id).getBlob();
        else { var f = findDriveBackup_(dateIso, a); if (f) blob = f.getBlob(); }
        if (!blob && /^https?:/i.test(cell)) { var resp = UrlFetchApp.fetch(cell, { muteHttpExceptions: true, followRedirects: true }); if (resp.getResponseCode() === 200) blob = resp.getBlob(); }
        if (!blob) { Logger.log(dateIso + ' ' + a + ': no source found'); log.appendRow(["'" + dateIso, a, '', 'no-source', new Date()]); continue; }
        blob.setContentType('image/jpeg');
        var key = 'originals/' + dateIso.slice(0, 4) + '/' + dateIso.slice(5, 7) + '/micheal-ray-berry-day-' + ('00' + day).slice(-3) + '-photo-' + a + '-' + dateIso + '.jpg';
        var res = r2Put_(acct, bucket, ak, sk, key, blob);
        if (res.getResponseCode() >= 300) { Logger.log(dateIso + ' ' + a + ': R2 PUT ' + res.getResponseCode()); return; }
        log.appendRow(["'" + dateIso, a, key, 'archived', new Date()]); okCount++;
      } catch (e) { Logger.log(dateIso + ' ' + a + ': ' + e); return; }
    }
    Logger.log(dateIso + ': ' + okCount + '/' + pending.length + ' photo originals archived. Re-run for the next day.');
    return;
  }
  Logger.log('Photo backfill: nothing left.');
}

/* Loops backfillPhotosToR2 inside a 5-minute budget. Run until it logs "nothing left". */
function backfillPhotosToR2All() {
  var t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    var before = tab('R2 Photo Keys').getLastRow();
    backfillPhotosToR2();
    if (tab('R2 Photo Keys').getLastRow() === before) return;
  }
  Logger.log('Time budget reached — run again.');
}

function findDriveBackup_(dateIso, stem) {
  var root = photosFolder(), q = "title contains '" + stem + "-" + dateIso + "'";
  var it = root.searchFiles(q); if (it.hasNext()) return it.next();
  var subs = root.getFolders();
  while (subs.hasNext()) { var f = subs.next().searchFiles(q); if (f.hasNext()) return f.next(); }
  return null;
}
function dayOf(dateIso) { var s = new Date(projectStart() + 'T12:00:00Z'), d = new Date(dateIso + 'T12:00:00Z'); return Math.round((d - s) / 86400000) + 1; }
function r2Put_(acct, bucket, ak, sk, key, blob) {
  var host = acct + '.r2.cloudflarestorage.com';
  var amz = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"), date = amz.slice(0, 8), scope = date + '/auto/s3/aws4_request';
  var uri = '/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/');
  var ct = blob.getContentType() || 'application/octet-stream', ph = 'UNSIGNED-PAYLOAD';
  var canonical = ['PUT', uri, '', 'content-type:' + ct, 'host:' + host, 'x-amz-content-sha256:' + ph, 'x-amz-date:' + amz, '', 'content-type;host;x-amz-content-sha256;x-amz-date', ph].join('\n');
  var sts = ['AWS4-HMAC-SHA256', amz, scope, hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8))].join('\n');
  var k = hmac_('AWS4' + sk, date); k = hmac_(k, 'auto'); k = hmac_(k, 's3'); k = hmac_(k, 'aws4_request');
  var sig = hex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(sts).getBytes(), k));
  return UrlFetchApp.fetch('https://' + host + uri, { method: 'put', contentType: ct, payload: blob, muteHttpExceptions: true,
    headers: { 'x-amz-date': amz, 'x-amz-content-sha256': ph, Authorization: 'AWS4-HMAC-SHA256 Credential=' + ak + '/' + scope + ', SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=' + sig } });
}
/* SigV4 GET from the private R2 bucket; returns a Blob. Used by the photo
   mirror for 'originals/…' keys filed by the assistant. */
function r2Get_(key) {
  var p = PropertiesService.getScriptProperties();
  var acct = p.getProperty('R2_ACCOUNT_ID'), bucket = p.getProperty('R2_BUCKET') || 'mrb-evidence', ak = p.getProperty('R2_ACCESS_KEY_ID'), sk = p.getProperty('R2_SECRET_ACCESS_KEY');
  if (!acct || !ak || !sk) throw new Error('R2 keys not set (setCloudflareMedia + setR2Keys)');
  var host = acct + '.r2.cloudflarestorage.com';
  var amz = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"), date = amz.slice(0, 8), scope = date + '/auto/s3/aws4_request';
  var uri = '/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/');
  var ph = 'UNSIGNED-PAYLOAD';
  var canonical = ['GET', uri, '', 'host:' + host, 'x-amz-content-sha256:' + ph, 'x-amz-date:' + amz, '', 'host;x-amz-content-sha256;x-amz-date', ph].join('\n');
  var sts = ['AWS4-HMAC-SHA256', amz, scope, hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8))].join('\n');
  var k = hmac_('AWS4' + sk, date); k = hmac_(k, 'auto'); k = hmac_(k, 's3'); k = hmac_(k, 'aws4_request');
  var sig = hex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(sts).getBytes(), k));
  var res = UrlFetchApp.fetch('https://' + host + uri, { method: 'get', muteHttpExceptions: true, headers: { 'x-amz-date': amz, 'x-amz-content-sha256': ph, Authorization: 'AWS4-HMAC-SHA256 Credential=' + ak + '/' + scope + ', SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=' + sig } });
  if (res.getResponseCode() >= 300) throw new Error('R2 GET ' + res.getResponseCode());
  var b = res.getBlob(); b.setName(key.split('/').pop()); return b;
}
function hmac_(key, data) { return Utilities.computeHmacSha256Signature(Utilities.newBlob(data).getBytes(), typeof key === 'string' ? Utilities.newBlob(key).getBytes() : key); }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }

/* ═════ CAPTURE ATTESTATION (challenge codes + file fingerprints) ═════
   Every session fetches a one-time code (logged with server time, spoken
   and burned into the video), then posts back SHA-256 hashes of the
   finished files. If a Drive file is later edited or replaced, its hash
   no longer matches the one logged at capture. */

function attestationSheet() {
  var s = ss();
  var sh = s.getSheetByName('Attestation');
  if (!sh) {
    sh = s.insertSheet('Attestation');
    sh.appendRow(['logged_at_server', 'date', 'day', 'event', 'code', 'kind', 'video_sha256', 'photo_sha256s', 'weight', 'status']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    var p = sh.protect().setDescription('Server-timestamped attestation log — AP only');
    p.removeEditors(p.getEditors().filter(function (ed) { return ed.getEmail() !== Session.getEffectiveUser().getEmail(); }));
    sh.setTabColor('#B3261E');
  }
  return sh;
}

function handleAttest(obj) {
  var sh = attestationSheet();
  var now = new Date();
  var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  var code = String(obj.code || '').trim();
  var status = 'NO CODE';
  if (code) {
    status = 'UNKNOWN CODE';
    var vals = sh.getDataRange().getValues();
    for (var i = vals.length - 1; i >= 1; i--) {
      if (String(vals[i][3]) === 'challenge-issued' && String(vals[i][4]) === code) {
        var ageMin = Math.round((now - new Date(vals[i][0])) / 60000);
        status = (ageMin <= 90 ? 'VALID' : 'STALE') + ' — code issued ' + ageMin + ' min before attest';
        break;
      }
    }
  }
  /* Chunk chain: a rolling SHA-256 over each ~2s of recording, seeded from the
     session id. The single whole-file hash proves a file was not SWAPPED; the
     chain additionally makes a mid-file edit detectable, because altering any
     chunk changes every value after it. */
  var chain = String(obj.chunk_chain || '').trim();
  var chunks = Number(obj.chunk_count) || 0;

  /* Server-witnessed seal. Everything above is asserted by the device. This is
     the record's own attestation: an HMAC over those hashes, keyed by a secret
     that never leaves Script Properties and stamped with Google's clock. A
     device that later produces a different file cannot produce a matching seal,
     which closes the client-only forgery window. */
  var stamped = now.toISOString();
  var seal = sealFor([code, String(obj.video_sha256 || ''), (obj.photo_sha256s || []).join(' '), chain, stamped].join('|'));

  sh.appendRow([now, today, obj.day || '', 'capture-attested', code, String(obj.kind || ''),
    String(obj.video_sha256 || ''), (obj.photo_sha256s || []).join(' '), obj.weight || '', status,
    chain, chunks, seal, stamped]);
  return jsonOut({ ok: true, status: status, seal: seal, sealed_at: stamped });
}

/* Generated once and never published. Rotating it would invalidate every
   existing seal, so it is only ever created, never replaced. */
function sealSecret() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SEAL_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SEAL_SECRET', s); }
  return s;
}
function sealFor(payload) {
  var raw = Utilities.computeHmacSha256Signature(payload, sealSecret());
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/* Re-derives the seal from values the AP supplies and reports whether it
   matches. Give it the attestation row's own figures: if a file is later
   altered its hash changes, the seal no longer derives, and the mismatch is
   provable rather than asserted. */
function verifySeal(code, videoSha, photoShas, chain, stampedAt, expectedSeal) {
  var got = sealFor([code, videoSha || '', photoShas || '', chain || '', stampedAt || ''].join('|'));
  Logger.log(got === expectedSeal
    ? 'SEAL VALID — these hashes are what the record witnessed at ' + stampedAt + '.'
    : 'SEAL MISMATCH — these values are not what was sealed at ' + stampedAt + '.\nderived:  ' + got + '\nexpected: ' + expectedSeal);
  return got === expectedSeal;
}

/* ═════ NIGHTLY 10 PM COMPLIANCE CHECK ═════
   Final photo scan, then today's packet is checked. An incomplete packet
   auto-declares ONE violation for the day and emails the AP, who reviews
   after the fact and can resolve it with a note under §9. */

function nightlyComplianceCheck() {
  // Environment follows the record: end-of-day state drives the home.
  importPhotos(); // final scan so a 9:58 PM upload still counts
  try { withingsSync(); } catch (ew) {} // final weight pull so tonight's reading is on the record
  triggerDeploy(); // the ONE production deploy of the day — photo commits are [skip ci]

  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (today < PROJECT_START) return;

  correctiveDeadlineCheck(today); // escalate any 72-hour corrective deadline that lapsed (§8.3)

  var vals = weighinsSheet().getDataRange().getValues();
  var row = null;
  for (var i = 1; i < vals.length; i++) {
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (ds === today) { row = vals[i]; break; }
  }

  var missing = [];
  if (!row) missing.push('entire daily row (no weight, no photos)');
  else {
    if (!parseFloat(row[1])) missing.push('scale-synced weight (no Withings reading reached the record — step on the scale and let it sync)');
    if (!String(row[3] || '').trim()) missing.push('front daily photo (column D)');
  }
  // Capture attestation: was a daily session attested today (challenge + hashes)?
  var attested = false;
  try {
    var av = attestationSheet().getDataRange().getValues();
    for (var a = av.length - 1; a >= 1; a--) {
      var ad = av[a][1];
      var ads = ad instanceof Date ? Utilities.formatDate(ad, 'America/New_York', 'yyyy-MM-dd') : String(ad).trim();
      if (ads === today && String(av[a][3]) === 'capture-attested' && String(av[a][5]).indexOf('daily') === 0) { attested = true; break; }
    }
  } catch (aerr) { attested = true; }
  if (!attested) missing.push('capture attestation (no challenge code / file fingerprints logged today)');
  if (!missing.length) return;
  var autoDeclared = autoDeclareViolation(today, missing);
  if (autoDeclared) triggerDeploy(); // violation mode goes live tonight, not tomorrow

  var dayNum = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  MailApp.sendEmail({
    to: AP_EMAIL,
    subject: 'MRB Day ' + dayNum + ' - 10 PM deadline check: packet incomplete' + (autoDeclared ? ' - VIOLATION V-AUTO DECLARED' : ''),
    body: 'Automated 10 PM ET compliance check for ' + today + ' (Day ' + dayNum + ').\n\n' +
      'Missing at deadline:\n- ' + missing.join('\n- ') + '\n\n' +
      (autoDeclared
        ? 'AUTO-DECLARATION (AP amendment A2): the system has logged a Violation Event for ' + today + ' on the public record and fired the violation consequence. ' +
          'The site enters violation mode on tonight\'s deploy. No action is required to uphold it.\n' +
          'If a documented medical event or verified platform failure (\u00a79) applies, resolve the entry from the record sheet (MRB menu) with a note; the reversal is itself logged.\n\n'
        : 'A violation for today is already on the log; no duplicate was added.\n\n') +
      'All times in this check are Google server time (America/New_York) - the device clock plays no part.\n' +
      'Cross-check file authenticity against the Attestation tab: hash the received file (shasum -a 256) and compare.\n\n' +
      'Tracker: https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '\n' +
      'Console: the MRB menu in the record sheet.\n' +
      'This is an automated message from the site Apps Script.',
  });
  // He should not learn of the declaration from the website in the morning.
  try { mrbViolationNotice(today, missing, autoDeclared); } catch (e) {}
}

/* ═════ 10:20 PM SUPERVISION CHECK (§3.4) ═════
   Rules on tonight. A scheduled night with no COMPLETED row and no EXCEPTION
   becomes MISSED and a Violation Event is declared automatically. Runs after
   the 22:00 packet check so the two declarations never collide. */
function supervisionNightlyCheck() {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (!supervisionScheduled(today)) return;
  var sr = supervisionRow(today);
  var status = sr ? String(sr.vals[2] || '') : '';
  if (/^(COMPLETED|EXCEPTION|MISSED)/i.test(status)) return; // already ruled
  var sh = supervisionSheet();
  if (sr) sh.getRange(sr.row, 3).setValue('MISSED');
  else sh.appendRow([today, 'yes', 'MISSED', '', '', '', 'no archive link filed by 10:20 PM ET']);
  violationLogSheet().appendRow([today, 'Evening Supervision session not completed — 6:00–10:00 PM ET (§3.4) [auto-declared]', 'Unresolved', '', '', '', '', '', '']);
  triggerDeploy();
  var day = dayOf(today);
  var c = nextConsequence();
  try {
    mailAP('MISSED — Evening Supervision ' + today + ' — Violation Event declared',
      'No Evening Supervision archive link was filed for ' + today + ' (Day ' + day + ') by 10:20 PM ET and no exception is on the record.\n\n' +
      'The Supervision tab shows MISSED and a Violation Event has been entered on the log. If a §3.4 exception applies, mark it from the MRB menu (Supervision · EXCEPTION) and resolve the entry with a note; the reversal is itself logged.');
    mailMRB('MISSED — Evening Supervision — Day ' + day + ' — ' + today,
      'The scheduled 6:00–10:00 PM ET supervision session for ' + today + ' was not filed by 10:20 PM.\n\n' +
      'Its status is MISSED and a Violation Event has been entered on the public record. It is permanent.\n\n' +
      'Assigned: ' + c.text + '.\n\nCompleting a later session does not erase a missed one.');
  } catch (e) {}
}

function autoDeclareViolation(today, missing) {
  var sh = violationLogSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    // A 72-hour escalation appended earlier tonight is a DIFFERENT violation
    // event — it must not swallow a genuine packet miss on the same date.
    var txt = String(vals[i][1] || '');
    if (ds === today && txt.indexOf('72-hour corrective deadline') === -1 && txt.indexOf('Evening Supervision') === -1) return false; // already on the log for today
  }
  var what = missing.length === 1 ? missing[0] : 'Daily Compliance Packet incomplete (' + missing.length + ' items)';
  sh.appendRow([today, 'Missed 10 PM ET deadline — ' + what + ' [auto-declared]', 'Unresolved', '', '', '', '', '', '']);
  return true;
}

/* §8.3: a corrective session must be filed within 72 hours of the violation
   notice. Any open entry (status still Unresolved, no corrective filed) whose
   notice moment is more than 72 hours past gets a NEW Violation Event declared
   automatically at the next level — the level follows the total count, so a
   plain appended row escalates on its own. The lapsed entry is stamped so it
   escalates only once per notice moment; if the AP later overrules and reopens
   it, the overrule date becomes a fresh notice moment with its own 72 hours.
   Runs at the nightly 22:00 check, the same hour notices are declared, so the
   first check strictly past the 72-hour mark is the day-4 run. */
function correctiveDeadlineCheck(today) {
  var sh = violationLogSheet();
  var vals = sh.getDataRange().getValues();
  var todayDate = new Date(today + 'T00:00:00Z');
  var lapsed = [];
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][2] || '').toLowerCase().indexOf('unresolved') === -1) continue; // open entries only
    if (String(vals[i][7] || '').trim()) continue; // a corrective recording is already filed
    var corrections = String(vals[i][6] || '');
    // Notice moment = the entry date, unless a later overrule reopened it.
    var noticeStr = vals[i][0] instanceof Date
      ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd')
      : String(vals[i][0] || '').trim();
    var ovr = corrections.match(/overrul[a-z]*[^0-9]*(\d{4}-\d{2}-\d{2})/gi);
    if (ovr) { var last = ovr[ovr.length - 1].match(/(\d{4}-\d{2}-\d{2})/); if (last) noticeStr = last[1]; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeStr)) continue;
    if (corrections.indexOf('[72h-escalated:' + noticeStr + ']') !== -1) continue; // already escalated for this notice
    var dayDiff = Math.round((todayDate - new Date(noticeStr + 'T00:00:00Z')) / 864e5);
    if (dayDiff < 4) continue; // within the 72-hour window (notice at 22:00; day-4 check is the first past 72h)
    sh.appendRow([today, 'Missed 72-hour corrective deadline for the ' + noticeStr + ' violation [auto-declared, next level]', 'Unresolved', '', '', '', '', '', '']);
    var note = today + ': 72-hour corrective deadline missed — new Violation Event auto-declared at the next level [72h-escalated:' + noticeStr + ']';
    sh.getRange(i + 1, 7).setValue(corrections ? corrections + '; ' + note : note);
    lapsed.push(noticeStr);
  }
  if (lapsed.length) {
    triggerDeploy(); // the new entries go live tonight
    try {
      MailApp.sendEmail(AP_EMAIL,
        '72-hour corrective deadline missed — ' + lapsed.length + ' new Violation Event(s)',
        'The corrective deadline (§8.3: 72 hours from the notice) passed with no corrective session filed for the following violation notice date(s): ' + lapsed.join(', ') + '.\n\n' +
        'The Official Record System has automatically declared a new Violation Event at the NEXT level for each and noted the escalation on the original entry. Level follows the count and is not discretionary; no action is required to uphold it. Confirm or reject each new declaration against the written rules within the contest window.\n\n' +
        'Console: the MRB menu in the record sheet.');
    } catch (e) {}
  }
  return lapsed.length;
}

function apWeeklyReview() {
  var today = new Date();
  var vals = weighinsSheet().getDataRange().getValues();
  var days = [], missing = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(today); d.setDate(d.getDate() - i - 1); // last 7 completed days
    var ds = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
    if (ds < PROJECT_START) continue;
    var row = null;
    for (var r = 1; r < vals.length; r++) {
      var rd = vals[r][0];
      var rds = rd instanceof Date ? Utilities.formatDate(rd, 'America/New_York', 'yyyy-MM-dd') : String(rd).trim();
      if (rds === ds) { row = vals[r]; break; }
    }
    var dayNum = Math.floor((new Date(ds) - new Date(PROJECT_START)) / 864e5) + 1;
    if (!row) { days.push('Day ' + dayNum + ' (' + ds + '): NO ROW'); missing.push(dayNum); continue; }
    var w = parseFloat(row[1]);
    var ok = !isNaN(w) && String(row[3] || '').trim() && String(row[7] || '').trim();
    days.push('Day ' + dayNum + ' (' + ds + '): ' + (isNaN(w) ? 'no weight' : w.toFixed(1) + ' lb') +
      ' · photos ' + (String(row[3] || '').trim() ? '✓' : '✗') +
      ' · video ' + (String(row[7] || '').trim() ? '✓' : '✗') + (ok ? '' : '  ← REVIEW'));
    if (!ok) missing.push(dayNum);
  }

  var pens = [];
  try {
    var pv = violationLogSheet().getDataRange().getValues();
    for (var p = 1; p < pv.length; p++) {
      if (String(pv[p][2] || '').toLowerCase().indexOf('unresolved') !== -1) {
        pens.push(pv[p][0] + ' — ' + pv[p][1]);
      }
    }
  } catch (e) {}

  MailApp.sendEmail({
    to: AP_EMAIL,
    subject: 'MRB weekly review — ' + Utilities.formatDate(today, 'America/New_York', 'yyyy-MM-dd') +
      (missing.length || pens.length ? ' — ACTION NEEDED' : ' — clean week'),
    body: 'Last 7 project days:\n' + days.join('\n') +
      '\n\nUnresolved violations: ' + (pens.length ? '\n' + pens.join('\n') : 'none') +
      '\n\n5-MINUTE CHECKLIST\n' +
      '1. Any ← REVIEW lines above: verify against Drive + YouTube, log a Violation Event if unexcused.\n' +
      '2. Unresolved violations: corrective corner time per §8; verify and mark resolved when done.\n' +
      '3. Spot-check one day\u2019s video + photos for documentation standard (§4).\n' +
      '4. Confirm the site is up and showing current data: https://michealrayberry.com\n' +
      '5. Note anything worth recording in the Updates log.\n\n' +
      'Tracker: https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID +
      '\nAutomated message from the site Apps Script.',
  });
}

/* ═════ SITE STATE (abandonment / completion) ═════
   Key/value tab the website reads live — stage changes need no deploy. */

function siteStateSheet() {
  var s = ss();
  var sh = s.getSheetByName('Site State');
  if (!sh) {
    sh = s.insertSheet('Site State');
    sh.appendRow(['key', 'value']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    sh.setTabColor('#141412');
  }
  return sh;
}

function stateGet(k) {
  var v = siteStateSheet().getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === k) return String(v[i][1] || '');
  return '';
}

/* ═════ SITE STATE REPAIR ═════
   The publisher requires Site State row 1 to be exactly key | value. Twice a
   paste has landed in A1/B1 and fused rows into the header (multi-line cells),
   which fails every build with "Site State schema mismatch". This repairs it
   idempotently: splits fused header cells back into rows, forces A1/B1,
   drops blank rows, dedupes keys (last wins). Safe to run any time; also
   runs from setup() and from the console's Publish action. */
function repairSiteState() {
  var sh = tab('Site State');
  var vals = sh.getDataRange().getValues();
  if (!vals.length) { sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]); return 'created header'; }
  var rows = [];
  var report = [];
  for (var r = 0; r < vals.length; r++) {
    var k = String(vals[r][0] == null ? '' : vals[r][0]), v = String(vals[r][1] == null ? '' : vals[r][1]);
    if (r === 0 && (/\n/.test(k) || /\n/.test(v))) {
      var ks = k.split(/\r?\n/), vs = v.split(/\r?\n/);
      report.push('header held ' + Math.max(ks.length, vs.length) + ' fused lines');
      for (var i = 1; i < Math.max(ks.length, vs.length); i++) rows.push([String(ks[i] || '').trim(), String(vs[i] || '').trim()]);
      continue; // header itself is rewritten below
    }
    if (r === 0) continue;
    if (!k.trim() && !v.trim()) continue;
    rows.push([k.trim(), v]);
  }
  // dedupe by key, last wins
  var seen = {}, out = [];
  for (var j = rows.length - 1; j >= 0; j--) { if (!rows[j][0] || seen[rows[j][0]]) continue; seen[rows[j][0]] = true; out.unshift(rows[j]); }
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
  if (out.length) sh.getRange(2, 1, out.length, 2).setValues(out);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold');
  var msg = 'Site State repaired: ' + out.length + ' rows' + (report.length ? ' (' + report.join('; ') + ')' : '');
  Logger.log(msg);
  return msg;
}

/* stateSet must never write into row 1. If the sheet has no header, create
   it first; then append/update the key on rows 2+. */
function stateSet(k, val) {
  var __sh = tab('Site State');
  if (String(__sh.getRange(1, 1).getValue()).trim() !== 'key' || String(__sh.getRange(1, 2).getValue()).trim() !== 'value') repairSiteState();
  var sh = siteStateSheet();
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === k) { sh.getRange(i + 1, 2).setValue(val); return; }
  sh.appendRow([k, val]);
}

function siteStateAll() {
  var v = siteStateSheet().getDataRange().getValues();
  var out = {};
  for (var i = 1; i < v.length; i++) if (v[i][0]) out[String(v[i][0])] = String(v[i][1] || '');
  return out;
}

// Consecutive days (ending yesterday) with an incomplete packet: no weight or <4 photos.
function missedDayStreak() {
  var vals = weighinsSheet().getDataRange().getValues();
  var byDate = {};
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    var photos = 0;
    for (var c = 3; c <= 6; c++) if (vals[i][c]) photos++;
    byDate[ds] = !!(parseFloat(vals[i][1]) && photos === 4);
  }
  var streak = 0;
  var d = new Date();
  d.setDate(d.getDate() - 1);
  for (var k = 0; k < 60; k++) {
    var ds2 = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
    if (ds2 < PROJECT_START) break;
    if (byDate[ds2]) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function abandonmentCheck() {
  completionStreakAlert();
  var stage = stateGet('abandoned');
  if (stage === 'confirmed') return; // permanent — nothing to do
  var streak = missedDayStreak();
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (streak >= 30 && stage !== 'presumed') {
    stateSet('abandoned', 'presumed');
    stateSet('abandoned_date', today);
    try {
      mailMRB('PRESUMED ABANDONED — 30 consecutive missed days',
        'The site now shows PRESUMED ABANDONED. Thirty consecutive days have passed without a\n' +
        'complete Daily Compliance Packet.\n\n' +
        'This is still reversible. File a complete packet and the notice clears.\n\n' +
        'It becomes permanent only when the Accountability Partner confirms it — at which point\n' +
        'he takes ownership of the site and publishes a factual statement. The archive stays up\n' +
        'either way. There is no version of this where it quietly disappears.\n\n' +
        PORTAL_URL);
    } catch (e) {}
    MailApp.sendEmail(AP_EMAIL, 'ABANDONMENT PRESUMED — 30 consecutive missed days (§11)',
      'The record has had ' + streak + ' consecutive days without a complete Daily Compliance Packet.\n\n' +
      'The site now shows PRESUMED ABANDONED. Per §11 this becomes permanent only on your confirmation ' +
      '(medical exception, §9, is the reason confirmation is manual).\n\n' +
      'Confirm or clear from the record sheet: MRB menu → Stage.');
    return;
  }
  if ((streak === 7 || streak === 14 || streak === 21) && stage !== 'presumed') {
    try {
      mailMRB('ABANDONMENT WATCH — ' + streak + ' consecutive missed days',
        streak + ' consecutive days without a complete Daily Compliance Packet.\n\n' +
        'At 30 the site enters PRESUMED ABANDONED by itself. No one has to decide that;\n' +
        'it is what silence produces.\n\n' +
        'Presumed abandonment is reversible — file a complete packet and it clears.\n' +
        'Confirmed abandonment is not: the Accountability Partner takes the site permanently\n' +
        'and publishes a factual statement of what happened and when. The record does not\n' +
        'come down in either case.\n\n' +
        'You have ' + (30 - streak) + ' days before the site makes that judgement without you.\n\n' +
        'File tonight: ' + PORTAL_URL);
    } catch (e) {}
    MailApp.sendEmail(AP_EMAIL, 'Abandonment warning — ' + streak + ' consecutive missed days',
      streak + ' consecutive days without a complete packet. At 30, the site automatically enters ' +
      'PRESUMED ABANDONED (§11). Console: the MRB menu in the record sheet.');
  }
}

function completionStreakAlert() {
  if (stateGet('completed') === 'confirmed') return;
  var vals = weighinsSheet().getDataRange().getValues();
  var byDate = {};
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    var w = parseFloat(vals[i][1]);
    if (ds && !isNaN(w)) byDate[ds] = w;
  }
  var streak = 0;
  var d = new Date();
  for (var k = 0; k < 60; k++) {
    var ds2 = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
    if (ds2 < PROJECT_START) break;
    var w2 = byDate[ds2];
    if (w2 === undefined || w2 > 200.0) { if (k === 0) { d.setDate(d.getDate() - 1); continue; } break; } // today may not be filed yet
    streak++;
    d.setDate(d.getDate() - 1);
  }
  if (streak === 14 || streak === 21 || streak >= 28) {
    var key = 'COMPLETION_ALERT_' + (streak >= 28 ? 28 : streak);
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(key)) return;
    props.setProperty(key, '1');
    MailApp.sendEmail(AP_EMAIL,
      streak >= 28 ? 'COMPLETION CONDITION MET — 28 days at/under 200 (§6.3)' : 'Completion watch — ' + streak + ' days at/under 200',
      streak >= 28
        ? 'The tracker shows 28 consecutive days at or under 200.0 lbs.\n\nSchedule the official on-camera completion weigh-in (§6.3). Once verified, declare completion from the record sheet (MRB menu → Stage)'
        : streak + ' consecutive days at or under 200.0 lbs. At 28, the completion condition is met pending the official weigh-in.');
  }
}

function correctiveSheet() {
  var s = ss();
  var sh = s.getSheetByName('Corrective Log');
  if (!sh) {
    sh = s.insertSheet('Corrective Log');
    sh.appendRow(['assigned_date', 'assignment', 'due', 'status', 'completed_date']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    sh.setTabColor('#B3261E');
  }
  return sh;
}

/* Normalizes a date cell to yyyy-MM-dd. Cells arrive three ways: a real
   Date, an ISO string, or text like "7/22/2026" (what the migration wrote).
   Every date read anywhere in this script goes through here. */
function apDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return s;
}

/* One-off cleanup: rewrites the Weigh-ins and Violation Log date columns as
   real dates in ISO format, so every future read is unambiguous. Safe to
   run more than once. */
function normalizeRecordDates() {
  var fixed = 0;
  [['Weigh-ins', 1], ['Violation Log', 1]].forEach(function (pair) {
    var sh = ss().getSheetByName(pair[0]);
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    var rng = sh.getRange(2, pair[1], last - 1, 1);
    var vals = rng.getValues();
    for (var i = 0; i < vals.length; i++) {
      var iso = apDateStr(vals[i][0]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && String(vals[i][0]) !== iso) { vals[i][0] = iso; fixed++; }
    }
    rng.setNumberFormat('@').setValues(vals);
  });
  Logger.log('Normalized ' + fixed + ' date cell(s) to yyyy-MM-dd.');
}

/* ═════ SHEET CONSOLE (MRB menu) ═════
   The /ap portal is retired — the AP operates from the record spreadsheet
   itself. onOpen() adds an MRB menu whose items write the EXACT status
   strings the site parses, with confirmations, so nothing is hand-typed. */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MRB')
    .addItem('Publish site now', 'menuPublish')
    .addSeparator()
    .addItem('Declare violation (today)', 'menuDeclareViolation')
    .addItem('Verify violation → PUBLISH', 'menuVerifyViolation')
    .addItem('Verify resolution → CLOSE', 'menuVerifyResolution')
    .addSeparator()
    .addItem('Agreement · ACTIVATE Edition 2', 'menuActivateAgreement')
    .addItem('Agreement · activation status', 'menuActivationStatus')
    .addItem('Agreement · DEACTIVATE (clear flag)', 'menuDeactivateAgreement')
    .addItem('Overrule selected entry', 'menuOverrule')
    .addItem('Post update to the site', 'menuPostUpdate')
    .addItem('Supervision · mark tonight EXCEPTION', 'menuSupervisionException')
    .addSeparator()
    .addItem('Stage · abandonment presumed', 'menuAbandonPresumed')
    .addItem('Stage · abandonment CONFIRMED', 'menuAbandonConfirmed')
    .addItem('Stage · clear abandonment', 'menuAbandonClear')
    .addItem('Stage · completion CONFIRMED', 'menuCompleteConfirmed')
    .addItem('Stage · clear completion', 'menuCompleteClear')
    .addSeparator()
    .addItem('Apply sheet guards', 'applySheetGuards')
    .addToUi();
}

function menuToday() { return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'); }

function menuPublish() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Publish', 'Trigger a deploy of michealrayberry.com now?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  triggerDeploy();
  ui.alert('Deploy triggered. The site rebuilds in about a minute.');
}

function menuDeclareViolation() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Declare violation (today)', 'Nature of the documentation failure — published verbatim (§8: factual and neutral):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  violationLogSheet().appendRow([menuToday(), r.getResponseText().trim(), 'Unresolved', '', '', '', '', '', '']);
  ui.alert('Entered. The site shows it on the next publish (Attestation → MRB → Publish site now).');
}

/* ═════ AP VERIFICATION MARKERS (publisher contract) ═════
   The publisher lists a Violation Log row only when col I carries
   APV1|<verified date>|sha256("violation-v1\n<date>\n<violation text>")
   and treats it Resolved only when col F carries
   APR1|<resolution date>|sha256("violation-resolution-v1\n<APV1 marker>\n<date>")
   with the resolution date in col E. Both bind the exact row text, so
   editing wording or date after verification unpublishes the entry until
   re-verified. Select the row in the Violation Log tab, then use the menu. */
function sha256Hex(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}
function vlRowDate(v) { return v instanceof Date ? Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd') : String(v || '').trim(); }
function selectedViolationRow(ui) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'Violation Log') { ui.alert('Select the entry’s row in the Violation Log tab first.'); return null; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('Select the entry’s row (not the header).'); return null; }
  return { sh: sh, row: row, vals: sh.getRange(row, 1, 1, 9).getValues()[0] };
}
function menuVerifyViolation() {
  var ui = SpreadsheetApp.getUi();
  var p = selectedViolationRow(ui); if (!p) return;
  if (/^APV1\|/.test(String(p.vals[8] || ''))) { ui.alert('Row ' + p.row + ' is already verified.'); return; }
  var date = vlRowDate(p.vals[0]), text = String(p.vals[1] || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) { ui.alert('Row needs an ISO date in A and wording in B.'); return; }
  var c = ui.alert('Verify violation — row ' + p.row, date + '\n"' + text + '"\n\nPublish this as a verified Violation Event? Editing A or B afterwards unpublishes it until re-verified.', ui.ButtonSet.YES_NO);
  if (c !== ui.Button.YES) return;
  var today = menuToday();
  p.sh.getRange(p.row, 9).setValue('APV1|' + today + '|' + sha256Hex('violation-v1\n' + date + '\n' + text));
  if (!String(p.vals[2] || '').trim()) p.sh.getRange(p.row, 3).setValue('Unresolved');
  triggerDeploy();
  ui.alert('Verified. Published on the next build (triggered).');
}
function menuVerifyResolution() {
  var ui = SpreadsheetApp.getUi();
  var p = selectedViolationRow(ui); if (!p) return;
  var ev = String(p.vals[8] || '').trim();
  if (!/^APV1\|/.test(ev)) { ui.alert('Row ' + p.row + ' is not a verified violation yet — verify it first.'); return; }
  if (/^APR1\|/.test(String(p.vals[5] || ''))) { ui.alert('Row ' + p.row + ' is already resolved.'); return; }
  var today = menuToday();
  var c = ui.alert('Verify resolution — row ' + p.row, vlRowDate(p.vals[0]) + '\n"' + String(p.vals[1]).slice(0, 80) + '"\n\nMark RESOLVED as of ' + today + '? The corrective evidence (col H) should already be filed.', ui.ButtonSet.YES_NO);
  if (c !== ui.Button.YES) return;
  p.sh.getRange(p.row, 5).setValue(today);
  p.sh.getRange(p.row, 6).setValue('APR1|' + today + '|' + sha256Hex('violation-resolution-v1\n' + ev + '\n' + today));
  p.sh.getRange(p.row, 3).setValue('Resolved · ' + today);
  triggerDeploy();
  ui.alert('Resolution verified. Published on the next build (triggered).');
}

/* ═════ AGREEMENT ACTIVATION (publisher gate) ═════
   Enforcement publishes only when Site State holds a complete, self-
   consistent tuple: agreement_edition=2, both signature-verified dates,
   the reviewed Edition 2 confirmation's date + review date, and its
   fingerprint sha256("agreement-confirmation-v1\n2\n<date>\n<canonical url>
   \n<attestation seal>\n<video sha256>"). The publisher recomputes the
   fingerprint from the Confirmations + Attestation rows and fails the build
   if anything disagrees — so this menu derives every value from the sheet
   and asks the AP only for the two facts it cannot know: that both
   signatures were personally verified. */
function canonicalYouTubeForFingerprint(raw) {
  // publisher confirmationVideoUrl(): exactly watch?v=ID or youtu.be/ID
  var s = String(raw || '').trim();
  var m = s.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/);
  if (m) return 'https://www.youtube.com/watch?v=' + m[1];
  m = s.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})$/);
  return m ? 'https://youtu.be/' + m[1] : '';
}
function latestEdition2Confirmation() {
  var cf = tab('Confirmations').getDataRange().getValues();
  for (var i = cf.length - 1; i >= 1; i--) {
    if (String(cf[i][2]).trim() !== '2') continue;
    var date = vlRowDate(cf[i][1]);
    var url = canonicalYouTubeForFingerprint(cf[i][4]);
    var seal = String(cf[i][5] || '').trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !url || !/^[a-f0-9]{64}$/.test(seal)) continue;
    // matching sealed capture → video hash
    var att = tab('Attestation').getDataRange().getValues();
    for (var a = att.length - 1; a >= 1; a--) {
      if (vlRowDate(att[a][1]) !== date) continue;
      if (String(att[a][3]).trim() !== 'capture-attested' || String(att[a][5]).trim() !== 'confirmation') continue;
      if (String(att[a][9]).trim() !== 'VALID-CONSUMED') continue;
      if (String(att[a][12] || '').trim().toLowerCase() !== seal) continue;
      var vh = String(att[a][6] || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(vh)) continue;
      return { row: i + 1, date: date, url: url, seal: seal, videoHash: vh,
        fingerprint: sha256Hex('agreement-confirmation-v1\n2\n' + date + '\n' + url + '\n' + seal + '\n' + vh) };
    }
  }
  return null;
}
function menuActivationStatus() {
  var ui = SpreadsheetApp.getUi();
  var st = siteStateAll();
  var c = latestEdition2Confirmation();
  var lines = [
    'agreement_edition: ' + (st.agreement_edition || '(blank — INACTIVE)'),
    'mrb_signature_verified_at: ' + (st.mrb_signature_verified_at || '—'),
    'ap_signature_verified_at: ' + (st.ap_signature_verified_at || '—'),
    'agreement_confirmation_date: ' + (st.agreement_confirmation_date || '—'),
    'agreement_confirmation_verified_at: ' + (st.agreement_confirmation_verified_at || '—'),
    'agreement_confirmation_fingerprint: ' + (st.agreement_confirmation_fingerprint ? st.agreement_confirmation_fingerprint.slice(0, 16) + '…' : '—'),
    '',
    'Edition 2 confirmation on record: ' + (c ? 'YES — ' + c.date + ' · ' + c.url + ' · fingerprint ' + c.fingerprint.slice(0, 16) + '…' : 'NO (needs a filed consent link with a sealed confirmation capture)'),
    c && st.agreement_confirmation_fingerprint ? 'Fingerprint matches Site State: ' + (c.fingerprint === String(st.agreement_confirmation_fingerprint).toLowerCase()) : '',
  ];
  ui.alert('Agreement activation status', lines.filter(function (x) { return x !== undefined; }).join('\n'), ui.ButtonSet.OK);
}
function menuActivateAgreement() {
  var ui = SpreadsheetApp.getUi();
  var c = latestEdition2Confirmation();
  if (!c) { ui.alert('Cannot activate', 'No Edition 2 consent confirmation is on record with a sealed capture.\n\nMicheal records the Consent Confirmation in the assistant, posts it, and files the link; col F (attestation_seal) fills automatically. Then run this again.', ui.ButtonSet.OK); return; }
  var today = menuToday();
  var q1 = ui.alert('Step 1 of 3 — Micheal\'s signature', 'Have you personally verified Micheal Ray Berry\'s signature on the Edition 2 agreement?', ui.ButtonSet.YES_NO);
  if (q1 !== ui.Button.YES) { ui.alert('Not activated.'); return; }
  var q2 = ui.alert('Step 2 of 3 — your signature', 'Have you counter-signed the Edition 2 agreement and verified your own signature?', ui.ButtonSet.YES_NO);
  if (q2 !== ui.Button.YES) { ui.alert('Not activated.'); return; }
  var q3 = ui.alert('Step 3 of 3 — consent recording', 'Consent recording on record:\n' + c.date + '\n' + c.url + '\n\nHave you watched it and confirmed a clear, deliberate nod inside the CONFIRMATION WINDOW? (Stillness is not consent.)', ui.ButtonSet.YES_NO);
  if (q3 !== ui.Button.YES) { ui.alert('Not activated. If the nod was unclear, the recording must be rejected and re-made.'); return; }
  var go = ui.alert('ACTIVATE Edition 2', 'This publishes enforcement: verified violations, supervision status, nightly checks. Effective date = latest of Day 1, both signature dates, the confirmation date, and today.\n\nProceed?', ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) { ui.alert('Not activated.'); return; }
  stateSet('mrb_signature_verified_at', today);
  stateSet('ap_signature_verified_at', today);
  stateSet('agreement_confirmation_date', c.date);
  stateSet('agreement_confirmation_verified_at', today);
  stateSet('agreement_confirmation_fingerprint', c.fingerprint);
  stateSet('agreement_edition', '2'); // commit flag last
  try { CacheService.getScriptCache().remove('mrb_start_date'); } catch (e) {}
  try {
    tab('Updates').appendRow([today, 'official', 'Edition 2 agreement activated',
      'Both signatures verified and the Edition 2 consent recording of ' + c.date + ' reviewed by the Accountability Partner. Enforcement is active from this date.', c.url]);
  } catch (e) {}
  triggerDeploy();
  ui.alert('Activated', 'Site State written. Deploy triggered — if the publisher rejects the tuple the build fails closed and the site stays as it was; check the Netlify log.', ui.ButtonSet.OK);
}
function menuDeactivateAgreement() {
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert('DEACTIVATE', 'Clear agreement_edition? Enforcement stops publishing on the next build (other tuple keys are kept for the record). Log the reason in Updates afterwards.', ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) return;
  stateSet('agreement_edition', '');
  triggerDeploy();
  ui.alert('Cleared. Deploy triggered.');
}

function menuOverrule() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'Violation Log') { ui.alert('Select the entry’s row in the Violation Log tab first.'); return; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('Select the entry’s row (not the header).'); return; }
  var r = ui.prompt('Overrule — reopen row ' + row, 'Why the submitted session fails the standard (appended to corrections):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var today = menuToday();
  sh.getRange(row, 3).setValue('Unresolved · overruled · ' + today);
  sh.getRange(row, 5).setValue('');
  var prev = String(sh.getRange(row, 7).getValue() || '').trim();
  var note = today + ': overruled — ' + (r.getResponseText().trim() || 'fails the §8 standard') + '; replacement session required';
  sh.getRange(row, 7).setValue(prev ? prev + '; ' + note : note);
  ui.alert('Reopened. The sitewide notice returns on the next publish; a replacement session is required.');
}

/* §3.4 authorized exception for a scheduled night. Enter the date (default
   tonight) and the reason; the reason is published on /live. */
function menuSupervisionException() {
  var ui = SpreadsheetApp.getUi();
  var d = ui.prompt('Supervision exception', 'Night (YYYY-MM-DD, blank = tonight):', ui.ButtonSet.OK_CANCEL);
  if (d.getSelectedButton() !== ui.Button.OK) return;
  var ds = d.getResponseText().trim() || menuToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { ui.alert('Date must be YYYY-MM-DD.'); return; }
  var r = ui.prompt('Supervision exception — ' + ds, 'Authorized reason (§3.4: work schedule · travel · illness · emergency · non-consenting person present · technical failure) — published verbatim:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  var sr = supervisionRow(ds);
  var st = 'EXCEPTION · ' + r.getResponseText().trim();
  if (sr) supervisionSheet().getRange(sr.row, 3).setValue(st);
  else supervisionSheet().appendRow([ds, supervisionScheduled(ds) ? 'yes' : 'no', st, '', '', '', 'entered by the AP ' + menuToday()]);
  ui.alert('Recorded. /live shows the exception on the next publish; no MISSED ruling will be made for that night.');
}

function menuPostUpdate() {
  var ui = SpreadsheetApp.getUi();
  var t1 = ui.prompt('Post update', 'Title:', ui.ButtonSet.OK_CANCEL);
  if (t1.getSelectedButton() !== ui.Button.OK || !t1.getResponseText().trim()) return;
  var t2 = ui.prompt('Post update', 'Body — published verbatim under the official AP label:', ui.ButtonSet.OK_CANCEL);
  if (t2.getSelectedButton() !== ui.Button.OK) return;
  var kind = ui.alert('Post update', 'Is this an AMENDMENT to the agreement (§12.1)? YES = logged in Updates AND on the agreement page\u2019s amendment log. NO = ordinary update.', ui.ButtonSet.YES_NO_CANCEL);
  if (kind === ui.Button.CANCEL) return;
  tab('Updates').appendRow([menuToday(), kind === ui.Button.YES ? 'amendment' : 'official', t1.getResponseText().trim(), t2.getResponseText().trim(), '']);
  triggerDeploy();
  ui.alert('Posted. A rebuild was triggered; it appears in Updates' + (kind === ui.Button.YES ? ' and on the agreement page' : '') + ' within a few minutes.');
}

function menuStage(key, val, label) {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Stage change', label, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  stateSet(key, val);
  if (key === 'abandoned' && val && !stateGet('abandoned_date')) stateSet('abandoned_date', menuToday());
  if (key === 'completed' && val === 'confirmed' && !stateGet('completed_date')) stateSet('completed_date', menuToday());
  ui.alert('Done. The site reads Site State live.');
}
function menuAbandonPresumed()  { menuStage('abandoned', 'presumed',  'Set PRESUMED ABANDONED (§11)? Reversible.'); }
function menuAbandonConfirmed() { menuStage('abandoned', 'confirmed', 'CONFIRM abandonment (§11)? The site becomes the permanent abandonment record.'); }
function menuAbandonClear()     { menuStage('abandoned', '',          'Clear the abandonment stage (documented §9 exception)?'); }
function menuCompleteConfirmed(){ menuStage('completed', 'confirmed', 'CONFIRM completion (§6.3)? The site becomes the permanent completion archive.'); }
function menuCompleteClear()    { menuStage('completed', '',          'Clear the completion stage?'); }

/* Warning-only protections on machine-written data: a stray edit shows a
   warning instead of silently corrupting a parsed field. */
function applySheetGuards() {
  var s = ss();
  var count = 0;
  [['Attestation', null], ['Violation Log', [4, 5, 8]]].forEach(function (spec) {
    var sh = s.getSheetByName(spec[0]);
    if (!sh) return;
    if (!spec[1]) {
      var p = sh.protect().setDescription('Machine-written — edits break the evidence chain');
      p.setWarningOnly(true); count++;
    } else {
      spec[1].forEach(function (col) {
        var p2 = sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1).protect()
          .setDescription('Written by the tools — edit via the MRB menu');
        p2.setWarningOnly(true); count++;
      });
    }
  });
  SpreadsheetApp.getUi().alert('Applied ' + count + ' warning-only protection(s).');
}

/* ═════ LEGACY ENDPOINTS (kept: the assistant logs weekly/confirmation
   sessions through ap* actions) ═════ */

function handleApState() {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var day = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  var out = { ok: true, today: today, day: day };
  var wv = weighinsSheet().getDataRange().getValues();
  for (var i = 1; i < wv.length; i++) {
    if (apDateStr(wv[i][0]) === today) {
      out.weighin = { weight: wv[i][1] || '', note: wv[i][2] || '', front: wv[i][3] || '', left: wv[i][4] || '', rear: wv[i][5] || '', right: wv[i][6] || '', video: wv[i][7] || '' };
      break;
    }
  }
  var av = attestationSheet().getDataRange().getValues();
  out.attest = [];
  for (var a = 1; a < av.length; a++) {
    if (apDateStr(av[a][1]) !== today) continue;
    out.attest.push({
      at: av[a][0] instanceof Date ? Utilities.formatDate(av[a][0], 'America/New_York', 'HH:mm') : String(av[a][0]),
      event: String(av[a][3] || ''), kind: String(av[a][5] || ''), status: String(av[a][9] || ''), weight: String(av[a][8] || ''),
    });
  }
  var hv = healthSheet().getDataRange().getValues();
  for (var h = 1; h < hv.length; h++) {
    if (apDateStr(hv[h][0]) === today) {
      out.health = { wt: hv[h][7] || '' };
      break;
    }
  }
  var pv = violationLogSheet().getDataRange().getValues();
  out.violations = [];
  for (var p = 1; p < pv.length; p++) {
    if (!pv[p][0]) continue;
    out.violations.push({ row: p + 1, date: apDateStr(pv[p][0]), violation: String(pv[p][1] || ''), status: String(pv[p][2] || '') });
  }
  out.siteState = siteStateAll();
  out.missedStreak = missedDayStreak();
  var cs = correctiveSheet().getDataRange().getValues();
  out.corrective = [];
  for (var c = 1; c < cs.length; c++) {
    if (!cs[c][0]) continue;
    out.corrective.push({ row: c + 1, date: apDateStr(cs[c][0]), assignment: String(cs[c][1] || ''), due: apDateStr(cs[c][2]), status: String(cs[c][3] || ''), completed: apDateStr(cs[c][4]) });
  }
  return jsonOut(out);
}

/* ═════ AP CONSOLE (/ap/) — JSON API ═════
   Everything the MRB sheet menu does, callable from the web console with the
   AP key. Each op returns { ok, ... } and the console re-reads 'status'.
   Writes are the same code paths the menu uses; nothing is hand-typed that
   the record can compute. */
function apAudit(obj, result) {
  try {
    var args = Object.assign({}, obj); delete args.key; delete args.action; delete args.actor; delete args.actor_ip; delete args.actor_ua;
    tab('AP Actions').appendRow([new Date(), String(obj.actor || 'menu'), String(obj.actor_ip || ''), String(obj.actor_ua || ''), String(obj.op || ''), JSON.stringify(args).slice(0, 2000), String(result || '').slice(0, 300)]);
  } catch (e) { Logger.log('AP audit failed: ' + e); }
}
function handleApConsole(obj) {
  var res = handleApConsoleInner(obj);
  var op = String(obj.op || 'status');
  if (op !== 'status') { var txt = ''; try { txt = res.getContent(); } catch (e) {} apAudit(obj, txt); }
  return res;
}
function handleApConsoleInner(obj) {
  var today = menuToday();
  var op = String(obj.op || 'status');
  var out = { ok: true };
  var deploy = false;

  if (op === 'status') return jsonOut(apConsoleStatus(today));

  if (op === 'publish') { var rep = repairSiteState(); triggerDeploy(); return jsonOut({ ok: true, note: rep }); }

  if (op === 'declare') {
    var dd = /^\d{4}-\d{2}-\d{2}$/.test(String(obj.date || '')) ? String(obj.date) : today;
    var txt = String(obj.text || '').trim();
    if (!txt) return jsonOut({ ok: false, error: 'Wording is required.' });
    violationLogSheet().appendRow([dd, txt, 'Unresolved', '', '', '', '', '', '']);
    return jsonOut({ ok: true, row: violationLogSheet().getLastRow() });
  }

  if (op === 'verify_violation' || op === 'verify_resolution' || op === 'overrule') {
    var sh = violationLogSheet();
    var row = Number(obj.row);
    if (!(row >= 2 && row <= sh.getLastRow())) return jsonOut({ ok: false, error: 'Bad row.' });
    var v = sh.getRange(row, 1, 1, 9).getValues()[0];
    var date = vlRowDate(v[0]), text = String(v[1] || '').trim(), ev = String(v[8] || '').trim();
    if (op === 'verify_violation') {
      if (/^APV1\|/.test(ev)) return jsonOut({ ok: false, error: 'Already verified.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) return jsonOut({ ok: false, error: 'Row needs an ISO date and wording.' });
      sh.getRange(row, 9).setValue('APV1|' + today + '|' + sha256Hex('violation-v1\n' + date + '\n' + text));
      if (!String(v[2] || '').trim()) sh.getRange(row, 3).setValue('Unresolved');
      deploy = true;
    } else if (op === 'verify_resolution') {
      if (!/^APV1\|/.test(ev)) return jsonOut({ ok: false, error: 'Verify the violation first.' });
      if (/^APR1\|/.test(String(v[5] || ''))) return jsonOut({ ok: false, error: 'Already resolved.' });
      sh.getRange(row, 5).setValue(today);
      sh.getRange(row, 6).setValue('APR1|' + today + '|' + sha256Hex('violation-resolution-v1\n' + ev + '\n' + today));
      sh.getRange(row, 3).setValue('Resolved · ' + today);
      deploy = true;
    } else {
      var reason = String(obj.reason || '').trim() || 'fails the §8 standard';
      sh.getRange(row, 3).setValue('Unresolved · overruled · ' + today);
      sh.getRange(row, 5).setValue('');
      sh.getRange(row, 6).setValue('');
      var prev = String(sh.getRange(row, 7).getValue() || '').trim();
      var note = today + ': overruled — ' + reason + '; replacement session required';
      sh.getRange(row, 7).setValue(prev ? prev + '; ' + note : note);
      deploy = true;
    }
    if (deploy) triggerDeploy();
    return jsonOut({ ok: true });
  }

  if (op === 'activate') {
    var c = latestEdition2Confirmation();
    if (!c) return jsonOut({ ok: false, error: 'No Edition 2 consent recording with a sealed capture is on record.' });
    var at = obj.attest || {};
    if (!(at.mrb === true && at.ap === true && at.nod === true)) return jsonOut({ ok: false, error: 'All three attestations are required.' });
    stateSet('mrb_signature_verified_at', today);
    stateSet('ap_signature_verified_at', today);
    stateSet('agreement_confirmation_date', c.date);
    stateSet('agreement_confirmation_verified_at', today);
    stateSet('agreement_confirmation_fingerprint', c.fingerprint);
    stateSet('agreement_edition', '2');
    try { CacheService.getScriptCache().remove('mrb_start_date'); } catch (e) {}
    try { tab('Updates').appendRow([today, 'official', 'Agreement activated', 'Both signatures verified and the consent recording of ' + c.date + ' reviewed by the Accountability Partner. Enforcement is active from this date.', c.url]); } catch (e) {}
    triggerDeploy();
    return jsonOut({ ok: true });
  }

  /* Reverse activation. Enforcement stops; nothing already on the record is
     altered. Requires a written reason, which is published to Updates. */
  if (op === 'deactivate') {
    var why = String(obj.reason || '').trim();
    if (!why) return jsonOut({ ok: false, error: 'A written reason is required.' });
    if (!stateGet('agreement_confirmation_verified_at')) return jsonOut({ ok: false, error: 'The agreement is not active.' });
    ['mrb_signature_verified_at', 'ap_signature_verified_at', 'agreement_confirmation_verified_at'].forEach(function (k) { stateSet(k, ''); });
    stateSet('agreement_edition', '');
    stateSet('agreement_confirmation_attested_by', '');
    try { CacheService.getScriptCache().remove('mrb_start_date'); } catch (e) {}
    try { tab('Updates').appendRow([today, 'official', 'Agreement enforcement suspended', why, '']); } catch (e) {}
    triggerDeploy();
    return jsonOut({ ok: true });
  }
  if (op === 'deactivate') { stateSet('agreement_edition', ''); triggerDeploy(); return jsonOut({ ok: true }); }

  if (op === 'supervision_assign' || op === 'supervision_release') {
    var ad = String(obj.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ad)) return jsonOut({ ok: false, error: 'Date required.' });
    if (ad < today) return jsonOut({ ok: false, error: 'Cannot assign a past night.' });
    var res = supervisionAssign(ad, op === 'supervision_assign', String(obj.note || '').trim());
    if (res.ok) triggerDeploy();
    return jsonOut(res);
  }

  if (op === 'supervision_exception') {
    var ds = /^\d{4}-\d{2}-\d{2}$/.test(String(obj.date || '')) ? String(obj.date) : today;
    var why = String(obj.reason || '').trim();
    if (!why) return jsonOut({ ok: false, error: 'Reason is required (published verbatim).' });
    var sr = supervisionRow(ds);
    var st = 'EXCEPTION · ' + why;
    if (sr) supervisionSheet().getRange(sr.row, 3).setValue(st);
    else supervisionSheet().appendRow([ds, supervisionScheduled(ds) ? 'yes' : 'no', st, '', '', '', '']);
    triggerDeploy();
    return jsonOut({ ok: true });
  }

  if (op === 'observer_review') {
    var osh = tab('Observer');
    var orow = Number(obj.row);
    if (!(orow >= 2 && orow <= osh.getLastRow())) return jsonOut({ ok: false, error: 'Bad row.' });
    var rv = String(obj.review || '').trim().toLowerCase();
    if (['received', 'dismissed', 'verified', 'published', 'actioned'].indexOf(rv) === -1) return jsonOut({ ok: false, error: 'Bad review state.' });
    osh.getRange(orow, 8).setValue(rv);
    osh.getRange(orow, 9).setValue(String(obj.note || '').trim());
    return jsonOut({ ok: true });
  }

  if (op === 'post_update') {
    var title = String(obj.title || '').trim(), body = String(obj.body || '').trim();
    if (!title) return jsonOut({ ok: false, error: 'Title is required.' });
    tab('Updates').appendRow([today, obj.amendment === true ? 'amendment' : 'official', title, body, String(obj.link || '').trim()]);
    triggerDeploy();
    return jsonOut({ ok: true });
  }

  if (op === 'stage') {
    var key = String(obj.key || ''), val = String(obj.value || '');
    if (['abandoned', 'completed'].indexOf(key) === -1) return jsonOut({ ok: false, error: 'Bad stage key.' });
    if (['', 'presumed', 'confirmed'].indexOf(val) === -1) return jsonOut({ ok: false, error: 'Bad stage value.' });
    stateSet(key, val);
    if (key === 'abandoned' && val && !stateGet('abandoned_date')) stateSet('abandoned_date', today);
    if (key === 'completed' && val === 'confirmed' && !stateGet('completed_date')) stateSet('completed_date', today);
    if (!val) stateSet(key + '_date', '');
    return jsonOut({ ok: true });
  }

  /* ── Project control ── */
  if (op === 'start_project') {
    var startWhy = String(obj.reason || 'Agreement counter-signed; enforcement begins today.').trim();
    var vsP = violationLogSheet(), vvP = vsP.getDataRange().getValues(), marked = 0;
    for (var pi = 1; pi < vvP.length; pi++) {
      var stP = String(vvP[pi][2] || '').toLowerCase();
      if (stP === 'unresolved' || stP === 'open' || stP === 'declared') {
        vsP.getRange(pi + 1, 3).setValue('not enforced');
        var corrP = String(vvP[pi][6] || '');
        vsP.getRange(pi + 1, 7).setValue((corrP ? corrP + '; ' : '') + 'Before activation — not enforced under §9 (' + today + ')');
        marked++;
      }
    }
    var nowIsoP = new Date().toISOString();
    ['mrb_signature_verified_at', 'ap_signature_verified_at', 'agreement_confirmation_verified_at'].forEach(function (k) { stateSet(k, nowIsoP); });
    stateSet('agreement_effective_date', today);
    stateSet('agreement_edition', '2');
    stateSet('agreement_confirmation_date', stateGet('agreement_confirmation_date') || today);
    stateSet('banner_mode', 'auto');
    try { CacheService.getScriptCache().remove('mrb_start_date'); } catch (e) {}
    try { tab('Updates').appendRow([today, 'official', 'Agreement activated', startWhy + (marked ? ' ' + marked + ' pre-activation entr' + (marked === 1 ? 'y was' : 'ies were') + ' recorded as not enforced under §9.' : ''), '']); } catch (e) {}
    triggerDeploy();
    return jsonOut({ ok: true, marked: marked });
  }
  if (op === 'resume') {
    if (stateGet('agreement_confirmation_verified_at')) return jsonOut({ ok: false, error: 'Already active.' });
    var nowIsoR = new Date().toISOString();
    ['mrb_signature_verified_at', 'ap_signature_verified_at', 'agreement_confirmation_verified_at'].forEach(function (k) { stateSet(k, nowIsoR); });
    stateSet('agreement_edition', '2');
    if (!stateGet('agreement_confirmation_attested_by') && !(typeof latestEdition2Confirmation === 'function' && latestEdition2Confirmation())) {
      stateSet('agreement_confirmation_attested_by', String(obj.actor || 'menu') + ' ' + today);
      if (!/^[a-f0-9]{64}$/.test(String(stateGet('agreement_confirmation_fingerprint') || ''))) stateSet('agreement_confirmation_fingerprint', sha256Hex('ap-attested-consent-review\n' + today + '\n' + String(obj.actor || 'menu')));
      if (!stateGet('agreement_confirmation_date')) stateSet('agreement_confirmation_date', today);
    }
    try { tab('Updates').appendRow([today, 'official', 'Enforcement resumed', String(obj.reason || '').trim(), '']); } catch (e) {}
    triggerDeploy();
    return jsonOut({ ok: true });
  }
  if (op === 'banner_mode') {
    var mode = String(obj.mode || 'auto').toLowerCase();
    if (['auto', 'on', 'off'].indexOf(mode) === -1) return jsonOut({ ok: false, error: 'mode must be auto|on|off' });
    stateSet('banner_mode', mode);
    stateSet('banner_mode_reason', String(obj.reason || '').trim().slice(0, 300));
    triggerDeploy();
    return jsonOut({ ok: true, mode: mode });
  }

  /* ── Fresh start: new Day 1, nothing before it on the record ──
     Archives every record tab to a dated copy inside the same spreadsheet
     (tab names prefixed "ARCHIVE <date> ·"), clears the live tabs, resets
     Site State (start_date = chosen day; activation cleared; banner auto),
     writes one Updates entry, and redeploys. TF060 is a static page and is
     untouched. Requires reason + the exact typed date as a second factor. */
  if (op === 'fresh_start') {
    var nd = String(obj.new_start || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return jsonOut({ ok: false, error: 'new_start must be YYYY-MM-DD' });
    if (String(obj.confirm_date || '') !== nd) return jsonOut({ ok: false, error: 'Type the new Day 1 date again to confirm.' });
    var fsWhy = String(obj.reason || '').trim(); if (!fsWhy) return jsonOut({ ok: false, error: 'A written reason is required (published).' });
    var s = ss(); var stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HHmm');
    var archived = [];
    ['Weigh-ins', 'Violation Log', 'Attestation', 'Corrective Log', 'Weekly Log', 'Confirmations', 'Health', 'Supervision', 'Updates', 'R2 Photo Keys'].forEach(function (name) {
      var sh = s.getSheetByName(name); if (!sh) return;
      if (sh.getLastRow() > 1) {
        var copy = sh.copyTo(s); copy.setName(('ARCHIVE ' + stamp + ' · ' + name).slice(0, 99)); copy.hideSheet(); archived.push(name);
        sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(1, sh.getLastColumn())).clearContent();
      }
    });
    // Site State: keep only the keys that describe the project, reset the rest
    // The fresh start IS the activation decision: the AP attests the agreement
    // stands from the new Day 1, so enforcement begins that night with no
    // second ceremony. (Suspend remains available.)
    var fsIso = new Date().toISOString(), fsActor = String(obj.actor || 'menu');
    var keep = { start_date: nd, banner_mode: 'auto', agreement_edition: '2', mrb_signature_verified_at: fsIso, ap_signature_verified_at: fsIso, agreement_confirmation_verified_at: fsIso, agreement_confirmation_date: nd, agreement_confirmation_fingerprint: sha256Hex('ap-attested-consent-review\n' + nd + '\n' + fsActor), agreement_confirmation_attested_by: fsActor + ' ' + today, agreement_effective_date: nd, abandoned: '', abandoned_date: '', completed: '', completed_date: '', verdict_seen: '', submitted_seen: '', milestones_hit: '', intro_video_url: stateGet('intro_video_url') || '', wait_still_url: '', wait_still_date: '' };
    var stTab = tab('Site State'); if (stTab.getLastRow() > 1) stTab.getRange(2, 1, stTab.getLastRow() - 1, 2).clearContent();
    Object.keys(keep).forEach(function (k) { stateSet(k, keep[k]); });
    try { CacheService.getScriptCache().remove('mrb_start_date'); } catch (e) {}
    try { PropertiesService.getScriptProperties().deleteProperty('GH_MIRRORED'); } catch (e) {}
    tab('Updates').appendRow([nd, 'official', 'Fresh start — Day 1 is ' + nd, fsWhy + ' All prior entries were archived by the Accountability Partner; nothing before this date is part of the current record. The agreement is active from this date by the Accountability Partner\u2019s attestation. The TF060 page is unchanged.', '']);
    triggerDeploy();
    return jsonOut({ ok: true, archived: archived, start_date: nd });
  }

  /* ── Review queue ── */
  if (op === 'review_queue') {
    var wsQ = weighinsSheet(), wvQ = wsQ.getDataRange().getValues();
    var vlogQ = violationLogSheet().getDataRange().getValues();
    var items = [];
    for (var rq = 1; rq < wvQ.length; rq++) {
      var dq = apDateStr(wvQ[rq][0]); if (!dq) continue;
      if (String(wvQ[rq][2] || '').indexOf('[AP:') !== -1) continue;
      items.push({ kind: 'daily', date: dq, day: dayOf(dq), weight: wvQ[rq][1], video: wvQ[rq][7] || '', stream_uid: wvQ[rq][9] || '', photos: [wvQ[rq][3], wvQ[rq][4], wvQ[rq][5], wvQ[rq][6]].filter(Boolean).length, note: wvQ[rq][2] || '' });
    }
    for (var qq = 1; qq < vlogQ.length; qq++) {
      var vdq = vlRowDate(vlogQ[qq][0]); var vstq = String(vlogQ[qq][2] || '').toLowerCase();
      var evq = String(vlogQ[qq][8] || ''), resq = String(vlogQ[qq][5] || '');
      if (vlogQ[qq][7] && !/^APR1\|/.test(resq)) items.push({ kind: 'corrective', row: qq + 1, date: vdq, violation: vlogQ[qq][1], status: vstq, recording: vlogQ[qq][7] || '', stream_uid: vlogQ[qq][9] || '', submitted: vlRowDate(vlogQ[qq][3]) });
      else if (!/^APV1\|/.test(evq) && vstq !== 'not enforced' && vstq !== 'resolved') items.push({ kind: 'declared', row: qq + 1, date: vdq, violation: vlogQ[qq][1], status: vstq });
    }
    items.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return jsonOut({ ok: true, items: items.slice(0, 60) });
  }
  if (op === 'review_daily') {
    var rd = String(obj.date || ''), dec = String(obj.decision || '');
    var ws2 = weighinsSheet(), wv2 = ws2.getDataRange().getValues();
    for (var r2 = 1; r2 < wv2.length; r2++) if (apDateStr(wv2[r2][0]) === rd) {
      var noteR = String(wv2[r2][2] || '');
      ws2.getRange(r2 + 1, 3).setValue((noteR ? noteR + ' ' : '') + '[AP:' + dec + ' ' + today + ']');
      if (dec === 'reject') violationLogSheet().appendRow([rd, String(obj.reason || 'Daily packet rejected on review'), 'Unresolved', '', '', '', 'AP review ' + today, '', '', '']);
      triggerDeploy();
      return jsonOut({ ok: true });
    }
    return jsonOut({ ok: false, error: 'No weigh-in row for ' + rd });
  }
  if (op === 'add_violation') {
    var ad = /^\d{4}-\d{2}-\d{2}$/.test(String(obj.date || '')) ? String(obj.date) : today, what = String(obj.violation || '').trim();
    if (!what) return jsonOut({ ok: false, error: 'violation text required' });
    violationLogSheet().appendRow([ad, what, 'Unresolved', '', '', '', 'Added by AP ' + today + (obj.reason ? ': ' + String(obj.reason) : ''), '', '', '']);
    triggerDeploy();
    return jsonOut({ ok: true });
  }
  if (op === 'waive') {
    var wr = String(obj.reason || '').trim(); if (!wr) return jsonOut({ ok: false, error: 'A written §9 reason is required.' });
    var vs3 = violationLogSheet(), rowW = Number(obj.row) || 0;
    if (!rowW) { var vv3 = vs3.getDataRange().getValues(); for (var w = 1; w < vv3.length; w++) if (vlRowDate(vv3[w][0]) === String(obj.date || '')) { rowW = w + 1; break; } }
    if (!(rowW >= 2 && rowW <= vs3.getLastRow())) return jsonOut({ ok: false, error: 'No entry.' });
    vs3.getRange(rowW, 3).setValue('not enforced');
    var corrW = String(vs3.getRange(rowW, 7).getValue() || '');
    vs3.getRange(rowW, 7).setValue((corrW ? corrW + '; ' : '') + 'Waived under §9: ' + wr + ' (' + today + ')');
    triggerDeploy();
    return jsonOut({ ok: true });
  }
  if (op === 'set_stream_uid') {
    var su = String(obj.uid || '').trim().toLowerCase(), sd = String(obj.date || ''), target = String(obj.target || 'daily');
    if (!/^[a-f0-9]{32}$/.test(su)) return jsonOut({ ok: false, error: 'bad uid' });
    var sh4 = target === 'corrective' ? violationLogSheet() : weighinsSheet(); var v4 = sh4.getDataRange().getValues();
    for (var x = 1; x < v4.length; x++) if ((target === 'corrective' ? vlRowDate(v4[x][0]) : apDateStr(v4[x][0])) === sd) { sh4.getRange(x + 1, 10).setValue(su); triggerDeploy(); return jsonOut({ ok: true }); }
    return jsonOut({ ok: false, error: 'No row for ' + sd });
  }

  /* ── Record editing, guarded ── */
  if (op === 'edit_weighin') {
    var ed = String(obj.date || ''), er = String(obj.reason || '').trim();
    if (!er) return jsonOut({ ok: false, error: 'A written reason is required.' });
    var ws5 = weighinsSheet(), wv5 = ws5.getDataRange().getValues();
    for (var y = 1; y < wv5.length; y++) if (apDateStr(wv5[y][0]) === ed) {
      if (obj.weight != null && obj.weight !== '' && !isNaN(Number(obj.weight))) ws5.getRange(y + 1, 2).setValue(Number(obj.weight));
      if (typeof obj.note === 'string') ws5.getRange(y + 1, 3).setValue(obj.note + ' [AP edit ' + today + ': ' + er + ']');
      else ws5.getRange(y + 1, 3).setValue(String(wv5[y][2] || '') + ' [AP edit ' + today + ': ' + er + ']');
      if (obj.clear_photo) { var colC = { front: 4, left: 5, rear: 6, right: 7 }[String(obj.clear_photo)]; if (colC) ws5.getRange(y + 1, colC).setValue(''); }
      triggerDeploy();
      return jsonOut({ ok: true });
    }
    return jsonOut({ ok: false, error: 'No row for ' + ed });
  }

  /* ── Ops ── */
  if (op === 'actions_log') {
    var al = tab('AP Actions').getDataRange().getValues().slice(1).slice(-50).reverse();
    return jsonOut({ ok: true, rows: al.map(function (r) { return { at: r[0], actor: r[1], ip: r[2], op: r[4], args: String(r[5] || '').slice(0, 200), result: String(r[6] || '').slice(0, 120) }; }) });
  }
  if (op === 'observer_inbox') {
    var all = tab('Observer').getDataRange().getValues().slice(1);
    var ob = all.slice(-50).reverse(); var base = all.length;
    return jsonOut({ ok: true, rows: ob.map(function (r, k) { return { n: base - k, at: r[0], type: r[1], ref: r[2], message: String(r[3] || '').slice(0, 600), name: r[4], email: r[5], link: r[6], review: r[7] }; }) });
  }
  if (op === 'media_backfill_status') {
    var wv6 = weighinsSheet().getDataRange().getValues().slice(1);
    return jsonOut({ ok: true, rows: wv6.filter(function (r) { return r[7]; }).length, missing_stream: wv6.filter(function (r) { return r[7] && !r[9]; }).length, missing_r2: wv6.filter(function (r) { return r[7] && !r[10]; }).length });
  }
  return jsonOut({ ok: false, error: 'unknown op' });
}

function apConsoleStatus(today) {
  var st = siteStateAll();
  var ps = packetState(today);
  var et = new Date();
  var nowEt = Utilities.formatDate(et, 'America/New_York', 'HH:mm');
  // weigh-ins, last 14
  var wv = weighinsSheet().getDataRange().getValues();
  var att = attestationSheet().getDataRange().getValues();
  var attestedDates = {};
  for (var a = 1; a < att.length; a++) if (String(att[a][3]) === 'capture-attested' && String(att[a][5]) === 'daily') attestedDates[apDateStr(att[a][1])] = true;
  var weighins = [];
  for (var i = wv.length - 1; i >= 1 && weighins.length < 14; i--) {
    var d = apDateStr(wv[i][0]); if (!d) continue;
    var photos = [3, 4, 5, 6].filter(function (c) { return String(wv[i][c] || '').trim(); }).length;
    weighins.push({ date: d, day: dayOf(d), weight: wv[i][1] ? Number(wv[i][1]) : null, photos: photos, video: !!String(wv[i][7] || '').trim(), attested: !!attestedDates[d] });
  }
  // violations
  var pv = violationLogSheet().getDataRange().getValues();
  var violations = [];
  for (var p = 1; p < pv.length; p++) {
    if (!pv[p][0]) continue;
    var evm = String(pv[p][8] || '').trim(), apr = String(pv[p][5] || '').trim();
    violations.push({ row: p + 1, date: apDateStr(pv[p][0]), day: dayOf(apDateStr(pv[p][0])), violation: String(pv[p][1] || ''), status: String(pv[p][2] || ''),
      submitted: String(pv[p][3] || ''), resolved: apDateStr(pv[p][4]) || '', recording: String(pv[p][7] || ''), corrections: String(pv[p][6] || ''),
      verified: /^APV1\|/.test(evm), verifiedAt: (evm.match(/^APV1\|(\d{4}-\d{2}-\d{2})/) || [])[1] || '', resolutionVerified: /^APR1\|/.test(apr) });
  }
  // supervision: tonight + last 7 scheduled
  var sup = { tonight: { date: today, scheduled: supervisionScheduled(today), status: '' }, recent: [] };
  var sv = supervisionSheet().getDataRange().getValues();
  var srow = supervisionRow(today); if (srow) sup.tonight.status = String(srow.vals[2] || '');
  sup.upcoming = [];
  for (var s = sv.length - 1; s >= 1; s--) {
    var sd0 = apDateStr(sv[s][0]);
    var rowObj = { date: sd0, required: String(sv[s][1] || ''), status: String(sv[s][2] || ''), url: String(sv[s][5] || ''), note: String(sv[s][6] || '') };
    if (sd0 > today) sup.upcoming.push(rowObj);
    else if (sup.recent.length < 7) sup.recent.push(rowObj);
  }
  sup.upcoming.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  sup.mode = 'assigned';
  // observers
  var ov = tab('Observer').getDataRange().getValues();
  var observers = [];
  for (var o = ov.length - 1; o >= 1 && observers.length < 30; o--) {
    if (!ov[o][0]) continue;
    observers.push({ row: o + 1, received_at: String(ov[o][0] || ''), type: String(ov[o][1] || ''), message: String(ov[o][2] || ''), name: String(ov[o][3] || ''), email: String(ov[o][4] || ''), source_url: String(ov[o][5] || ''), quotable: String(ov[o][6] || ''), review: String(ov[o][7] || 'received'), note: String(ov[o][8] || '') });
  }
  // updates last 6
  var uv = tab('Updates').getDataRange().getValues();
  var updates = [];
  for (var u = uv.length - 1; u >= 1 && updates.length < 6; u--) updates.push({ date: apDateStr(uv[u][0]), type: String(uv[u][1] || ''), title: String(uv[u][2] || ''), body: String(uv[u][3] || ''), link: String(uv[u][4] || '') });
  var c = latestEdition2Confirmation();
  return {
    banner_mode: stateGet('banner_mode') || 'auto',
    ok: true, today: today, day: dayOf(today), nowEt: nowEt, start: PROJECT_START,
    packet: { complete: ps.complete, missing: ps.missing },
    weighins: weighins,
    agreement: {
      active: String(st.agreement_edition || '') === '2',
      edition: st.agreement_edition || '',
      effectiveDate: st.agreement_effective_date || '',
      mrbSig: st.mrb_signature_verified_at || '', apSig: st.ap_signature_verified_at || '',
      confDate: st.agreement_confirmation_date || '', confVerifiedAt: st.agreement_confirmation_verified_at || '',
      fingerprint: st.agreement_confirmation_fingerprint || '',
      confirmation: c ? { date: c.date, url: c.url, fingerprint: c.fingerprint, matches: c.fingerprint === String(st.agreement_confirmation_fingerprint || '').toLowerCase() } : null,
    },
    violations: violations, supervision: sup, observers: observers, updates: updates,
    stage: { abandoned: st.abandoned || '', abandoned_date: st.abandoned_date || '', completed: st.completed || '', completed_date: st.completed_date || '' },
    hook: !!(PropertiesService.getScriptProperties().getProperty('BUILD_HOOK') || PropertiesService.getScriptProperties().getProperty('NETLIFY_HOOK')),
  };
}

function handleApAction(obj) {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  try {
    if (obj.action === 'apconsole') return handleApConsole(obj);
    if (obj.action === 'apviolation') {
      var sh = violationLogSheet();
      if (obj.op === 'declare') { sh.appendRow([String(obj.date || today), String(obj.violation || 'Violation Event'), 'Unresolved', '', '', '', '', '', '']); return jsonOut({ ok: true }); }
      if (obj.op === 'resolve' && obj.row) { sh.getRange(Number(obj.row), 3).setValue('Resolved · ' + today + (obj.note ? ' · ' + String(obj.note) : '')); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apcorrective') {
      var cor = correctiveSheet();
      if (obj.op === 'assign') { cor.appendRow([today, String(obj.assignment || ''), String(obj.due || ''), 'Assigned', '']); return jsonOut({ ok: true }); }
      if (obj.op === 'complete' && obj.row) { cor.getRange(Number(obj.row), 4, 1, 2).setValues([['Completed', today]]); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apabandon') {
      if (obj.op === 'presume') { stateSet('abandoned', 'presumed'); stateSet('abandoned_date', String(obj.date || today)); return jsonOut({ ok: true }); }
      if (obj.op === 'confirm') { stateSet('abandoned', 'confirmed'); if (!stateGet('abandoned_date')) stateSet('abandoned_date', today); return jsonOut({ ok: true }); }
      if (obj.op === 'clear') { stateSet('abandoned', ''); stateSet('abandoned_date', ''); return jsonOut({ ok: true }); }
      if (obj.op === 'statement') { stateSet('ap_statement', String(obj.text || '')); return jsonOut({ ok: true }); }
      if (obj.op === 'links') { stateSet('ap_links', String(obj.links || '[]')); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apcomplete') {
      if (obj.op === 'confirm') { stateSet('completed', 'confirmed'); if (!stateGet('completed_date')) stateSet('completed_date', today); return jsonOut({ ok: true }); }
      if (obj.op === 'clear') { stateSet('completed', ''); stateSet('completed_date', ''); return jsonOut({ ok: true }); }
      if (obj.op === 'statement') { stateSet('completion_statement', String(obj.text || '')); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apupdate') {
      tab('Updates').appendRow([today, 'official', String(obj.title || ''), String(obj.body || ''), String(obj.link || '')]);
      return jsonOut({ ok: true });
    }
    /* Weekly reviews and confirmations keep their own logs. Neither is a
       consequence, so neither is ever written to the Violation Log. */
    if (obj.action === 'apweekly') {
      var wk = tab('Weekly Log');
      wk.appendRow([new Date(), String(obj.date || ''), Number(obj.week) || '', Number(obj.documented) || 0,
        Number(obj.required) || 0, obj.weight || '', Number(obj.open) || 0, String(obj.url || '')]);
      return jsonOut({ ok: true });
    }
    if (obj.action === 'apconfirmation') {
      var cf = tab('Confirmations');
      var cdate = String(obj.date || '');
      cf.appendRow([new Date(), cdate, Number(obj.version) || AGREEMENT_EDITION,
        Number(obj.day) || '', String(obj.url || ''), confirmationSealFor(cdate)]);
      return jsonOut({ ok: true });
    }

    if (obj.action === 'apsupervision') {
      var sd = String(obj.date || today);
      var srow = supervisionRow(sd);
      var sst = obj.op === 'exception' ? 'EXCEPTION · ' + String(obj.reason || 'documented exception (§3.4)')
        : obj.op === 'complete' ? 'COMPLETED' : obj.op === 'missed' ? 'MISSED' : '';
      if (!sst) return jsonOut({ ok: false, error: 'op must be exception | complete | missed' });
      if (srow) supervisionSheet().getRange(srow.row, 3).setValue(sst);
      else supervisionSheet().appendRow([sd, supervisionScheduled(sd) ? 'yes' : 'no', sst, '', '', String(obj.url || ''), String(obj.note || '')]);
      return jsonOut({ ok: true });
    }
    if (obj.action === 'apdeploy') { triggerDeploy(); return jsonOut({ ok: true, deployed: true }); }
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ═════ BUILD HOOK (Netlify) ═════
   Netlify → Site configuration → Build & deploy → Build hooks → Add (branch
   main), copy the URL, then run setBuildHook. Host-neutral: any URL that
   accepts an empty POST works (Cloudflare Pages deploy hooks too). */

function setBuildHook(url) {
  PropertiesService.getScriptProperties().setProperty('BUILD_HOOK', String(url || '').trim());
  PropertiesService.getScriptProperties().deleteProperty('NETLIFY_HOOK');
  Logger.log('Build hook stored.');
}
function setNetlifyBuildHook(url) { setBuildHook(url); } // legacy name

/* Secondary hook — empty in the single-host stack. Kept so a second host can
   be rebuilt in lockstep if one is ever added again. */
function setSecondaryBuildHook(url) {
  PropertiesService.getScriptProperties().setProperty('BUILD_HOOK_2', String(url || '').trim());
  Logger.log(String(url || '').trim() ? 'Secondary build hook stored.' : 'Secondary build hook cleared.');
}

/* Triggers a rebuild of the live site. BUILD_HOOK holds the host's build
   hook. Silence used to mean "no hook set", which is indistinguishable
   from success when run by hand, so every path logs. */
function triggerDeploy() {
  var props = PropertiesService.getScriptProperties();
  var hooks = [
    { name: 'Netlify', url: props.getProperty('BUILD_HOOK') || props.getProperty('NETLIFY_HOOK') },
    { name: 'Secondary host (unused)', url: props.getProperty('BUILD_HOOK_2') },
  ].filter(function (x) { return !!x.url; });

  if (hooks.length) {
    var out = [];
    for (var i = 0; i < hooks.length; i++) {
      try {
        var resp = UrlFetchApp.fetch(hooks[i].url, { method: 'post', payload: '{}', contentType: 'application/json', muteHttpExceptions: true });
        var c = resp.getResponseCode();
        // 304: a build for this commit is already queued — a successful no-op.
        out.push(hooks[i].name + ': ' + (c === 304 ? 'already queued (304)'
          : (c >= 200 && c < 300 ? 'triggered (' + c + ')'
            : 'FAILED ' + c + ' — ' + resp.getContentText().slice(0, 140))));
      } catch (e) {
        out.push(hooks[i].name + ': FAILED — ' + e);
      }
    }
    if (hooks.length === 1) out.push('Single-host stack — one hook is correct.');
    Logger.log(out.join('\n'));
    return;
  }

  var h = null;
  if (!h) {
    Logger.log('NO BUILD HOOK SET — nothing was triggered.\n' +
      'Netlify → Site configuration → Build & deploy → Build hooks →\n' +
      'Add build hook (branch main), then run\n' +
      "setBuildHook('https://api.netlify.com/build_hooks/...')");
    return;
  }
  try {
    var r = UrlFetchApp.fetch(h, { method: 'post', payload: '{}', contentType: 'application/json', muteHttpExceptions: true });
    var code = r.getResponseCode();
    // 304: Cloudflare already has a build queued or running for this commit,
    // which is a successful no-op rather than a failure.
    Logger.log(code === 304
      ? 'Build already queued for the current commit (304) — nothing to do.'
      : (code >= 200 && code < 300
        ? 'Build triggered (' + code + '). Check Cloudflare → Deployments in about a minute.'
        : 'Build hook returned ' + code + ' — ' + r.getContentText().slice(0, 200)));
  } catch (e) {
    Logger.log('Build hook failed: ' + e);
  }
}

/* ═════ WITHINGS DIRECT — SCALE-SYNCED WEIGHT (primary) ═════
   The scale is Wi-Fi: it posts each reading to the Withings cloud by itself,
   no phone involved. This reads those measurements straight from the
   Withings API and files them as the official daily weight.

   One-time connect (AP, in this editor):
     1. https://developer.withings.com → create an app (public API).
        Callback URL: https://michealrayberry.com · copy Client ID + Secret.
     2. setWithingsCredentials('<clientId>', '<clientSecret>')
     3. withingsAuthUrl() — open the logged URL, sign in as MICHEAL'S
        Withings account, approve.
     4. You land on michealrayberry.com with ?code=... in the address bar —
        copy the code (valid ~30 s, be quick).
     5. withingsExchange('<code>') — stores the token, runs a first sync.
     6. setup() — installs the hourly withingsSync trigger.
   Weight rows land in Weigh-ins as 'scale-synced (Withings)' via autoWeighIn
   and in the Health tab weight_lb column. Weight only — nothing else. */

function setWithingsCredentials(id, secret) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('WITHINGS_ID', String(id || '').trim());
  p.setProperty('WITHINGS_SECRET', String(secret || '').trim());
  Logger.log('Withings credentials stored. Now run withingsAuthUrl().');
}

/* The OAuth redirect target: this deployment's own /exec URL, so the code
   lands back in this script and is exchanged instantly (no 30-second race).
   Must EXACTLY match the Callback URL saved in the Withings developer app. */
function withingsRedirectUri() {
  return ScriptApp.getService().getUrl() || 'https://michealrayberry.com';
}

function withingsAuthUrl() {
  var id = PropertiesService.getScriptProperties().getProperty('WITHINGS_ID');
  if (!id) { Logger.log('Run setWithingsCredentials() first.'); return; }
  var url = 'https://account.withings.com/oauth2_user/authorize2' +
    '?response_type=code&client_id=' + encodeURIComponent(id) +
    '&scope=user.metrics&state=mrb' +
    '&redirect_uri=' + encodeURIComponent(withingsRedirectUri());
  Logger.log('FIRST: set the Withings app Callback URL to exactly:\n' + withingsRedirectUri() +
    '\nTHEN open:\n' + url);
  return url;
}

/* Withings wraps OAuth in its own envelope: POST action=requesttoken, and the
   payload sits under body.{access_token,refresh_token,expires_in}. */
function withingsTokenCall(params) {
  var p = PropertiesService.getScriptProperties();
  params.client_id = p.getProperty('WITHINGS_ID');
  params.client_secret = p.getProperty('WITHINGS_SECRET');
  params.action = 'requesttoken';
  var resp = UrlFetchApp.fetch('https://wbsapi.withings.net/v2/oauth2', {
    method: 'post', payload: params, muteHttpExceptions: true,
  });
  var d = JSON.parse(resp.getContentText());
  if (d.status !== 0 || !d.body) { Logger.log('Withings token call failed: ' + resp.getContentText().slice(0, 300)); return null; }
  return d.body;
}

function withingsExchange(code) {
  var body = withingsTokenCall({
    grant_type: 'authorization_code',
    code: String(code || '').trim(),
    redirect_uri: withingsRedirectUri(),
  });
  if (!body || !body.refresh_token) { Logger.log('No refresh token — get a FRESH code (they expire in ~30 s) and retry.'); return; }
  var p = PropertiesService.getScriptProperties();
  p.setProperty('WITHINGS_REFRESH', body.refresh_token);
  p.setProperty('WITHINGS_ACCESS', body.access_token);
  p.setProperty('WITHINGS_ACCESS_EXP', String(Date.now() + (Number(body.expires_in) || 0) * 1000));
  Logger.log('Withings connected. Running a first sync…');
  withingsSync();
  Logger.log('Now run setup() to install the hourly trigger.');
}

function withingsToken() {
  var p = PropertiesService.getScriptProperties();
  var refresh = p.getProperty('WITHINGS_REFRESH');
  if (!refresh) return null;
  var exp = Number(p.getProperty('WITHINGS_ACCESS_EXP') || 0);
  var access = p.getProperty('WITHINGS_ACCESS');
  if (access && Date.now() < exp - 60000) return access;
  var body = withingsTokenCall({ grant_type: 'refresh_token', refresh_token: refresh });
  if (!body) return null;
  // Withings rotates the refresh token on every use — always store the new one.
  p.setProperty('WITHINGS_REFRESH', body.refresh_token || refresh);
  p.setProperty('WITHINGS_ACCESS', body.access_token);
  p.setProperty('WITHINGS_ACCESS_EXP', String(Date.now() + (Number(body.expires_in) || 0) * 1000));
  return body.access_token;
}

/* Pulls real weight measurements (type 1, category 1 — the scale's own
   readings, never user-entered goals) for the last 3 days and upserts the
   LATEST reading of each civil day (ET) into the Health tab + Weigh-ins. */
function withingsSync() {
  var tok = withingsToken();
  if (!tok) { Logger.log('Withings not connected — run the connect steps.'); return; }
  var resp = UrlFetchApp.fetch('https://wbsapi.withings.net/measure', {
    method: 'post',
    payload: {
      action: 'getmeas', meastype: '1', category: '1',
      startdate: String(Math.floor(Date.now() / 1000) - 3 * 86400),
      enddate: String(Math.floor(Date.now() / 1000) + 60),
    },
    headers: { Authorization: 'Bearer ' + tok },
    muteHttpExceptions: true,
  });
  var d = JSON.parse(resp.getContentText());
  if (d.status !== 0 || !d.body) { Logger.log('Withings getmeas failed: ' + resp.getContentText().slice(0, 300)); return; }
  var groups = d.body.measuregrps || [];
  var byDay = {}; // ET date → { ts, lb }
  groups.forEach(function (g) {
    if (Number(g.category) !== 1) return; // real measurement, not a goal
    (g.measures || []).forEach(function (m) {
      if (Number(m.type) !== 1) return; // weight
      var kg = Number(m.value) * Math.pow(10, Number(m.unit));
      var lb = Math.round(kg * 2.20462 * 10) / 10;
      var ds = Utilities.formatDate(new Date(Number(g.date) * 1000), 'America/New_York', 'yyyy-MM-dd');
      if (!byDay[ds] || Number(g.date) > byDay[ds].ts) byDay[ds] = { ts: Number(g.date), lb: lb };
    });
  });
  var synced = [];
  var sh = healthSheet();
  Object.keys(byDay).sort().forEach(function (ds) {
    if (ds < PROJECT_START) return;
    var lb = byDay[ds].lb;
    var vals = sh.getDataRange().getValues();
    var row = null;
    for (var i = 1; i < vals.length; i++) {
      var d0 = vals[i][0];
      var ds0 = d0 instanceof Date ? Utilities.formatDate(d0, 'America/New_York', 'yyyy-MM-dd') : String(d0).trim();
      if (ds0 === ds) { row = i + 1; break; }
    }
    var data = [ds, '', '', '', new Date(), '', '', lb];
    if (row) sh.getRange(row, 1, 1, 8).setValues([data]);
    else sh.appendRow(data);
    autoWeighIn(ds, lb, 'scale-synced (Withings)');
    synced.push(ds + ' → ' + lb + ' lb');
  });
  Logger.log(synced.length ? 'Withings sync: ' + synced.join(' · ') : 'Withings sync: no readings in the last 3 days — step on the scale.');
}

/* ═════ HEALTH TAB — weight_lb written by withingsSync ═════ */

function healthSheet() {
  var s = ss();
  var sh = s.getSheetByName('Health');
  if (!sh) {
    sh = s.insertSheet('Health');
    sh.appendRow(['date', 'steps', 'zone_minutes', 'active_minutes', 'synced_at', 'distance_mi', 'calories', 'weight_lb']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    var p = sh.protect().setDescription('Scale-synced weight (Withings) — script/AP only');
    p.removeEditors(p.getEditors().filter(function (ed) { return ed.getEmail() !== Session.getEffectiveUser().getEmail(); }));
    sh.setTabColor('#B3261E');
  }
  // Older sheets: extend with the distance/calories columns once.
  if (!sh.getRange(1, 6).getValue()) {
    sh.getRange(1, 6, 1, 2).setValues([['distance_mi', 'calories']]).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
  }
  if (!sh.getRange(1, 8).getValue()) {
    sh.getRange(1, 8).setValue('weight_lb').setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
  }
  return sh;
}

function autoWeighIn(ds, lb, label) {
  label = label || 'scale-synced';
  if (ds < WEIGHT_AUTO_START) return;
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var d0 = vals[i][0];
    var ds0 = d0 instanceof Date ? Utilities.formatDate(d0, 'America/New_York', 'yyyy-MM-dd') : String(d0).trim();
    if (ds0 === ds) {
      if (Number(vals[i][1]) !== Number(lb)) sh.getRange(i + 1, 2).setValue(lb);
      if (String(vals[i][2] || '').indexOf('scale-synced') === -1) sh.getRange(i + 1, 3).setValue(('' + (vals[i][2] || '')).trim() ? vals[i][2] + ' · ' + label : label);
      return;
    }
  }
  sh.appendRow([ds, lb, label]);
}

/* ═════ GITHUB PHOTO MIRROR ═════ */

var GH_REPO = 'ap-michealrayberry/michealrayberry.com';
var GH_BRANCH = 'main';

function setGithubToken(t) {
  PropertiesService.getScriptProperties().setProperty('GH_TOKEN', String(t || '').trim());
  Logger.log('GitHub token stored.');
}

function ghHeaders() {
  var t = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!t) throw new Error('No GH_TOKEN — run setGithubToken() first.');
  return { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' };
}

/* Commits one file. Returns 'created', 'exists' (identical path already
   there — never overwrite a published photo), or throws. */
function ghPutFile(repoPath, blob, message) {
  var api = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + repoPath;
  var probe = UrlFetchApp.fetch(api + '?ref=' + GH_BRANCH, { headers: ghHeaders(), muteHttpExceptions: true });
  if (probe.getResponseCode() === 200) return 'exists';
  var r = UrlFetchApp.fetch(api, {
    method: 'put',
    headers: ghHeaders(),
    contentType: 'application/json',
    payload: JSON.stringify({
      message: message,
      branch: GH_BRANCH,
      content: Utilities.base64Encode(blob.getBytes()),
    }),
    muteHttpExceptions: true,
  });
  var code = r.getResponseCode();
  if (code === 201 || code === 200) return 'created';
  throw new Error('GitHub ' + code + ': ' + r.getContentText().slice(0, 200));
}

/* Mirrors the daily photos into the site repo.

   Source of truth is the Weigh-ins tab, not a Drive folder: each row already
   holds the four photo URLs, so the mirror works no matter which folder (or
   which Google account) the files physically live in. Filenames are rebuilt
   in the exact shape the publisher looks for:

       micheal-ray-berry-day-003-front-2026-07-22.jpg

   A path already in the repo is never overwritten, so re-running is a no-op
   and a published photo can never be silently replaced. */

function driveIdFromUrl(url) {
  var m = String(url || '').match(/(?:\/d\/|id=|thumbnail\?id=|uc\?id=)([\w-]{20,})/);
  return m ? m[1] : '';
}

function githubMirrorPhotos() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GH_TOKEN')) {
    Logger.log('No GH_TOKEN — run setGithubToken() first. Nothing mirrored.');
    return;
  }
  var done = JSON.parse(props.getProperty('GH_MIRRORED') || '{}');
  var vals = weighinsSheet().getDataRange().getValues();
  var angles = ['front', 'left', 'rear', 'right'];
  var pushed = 0, skipped = 0, missing = 0, repointed = 0;

  for (var r = 1; r < vals.length && pushed < 20; r++) {
    var date = apDateStr(vals[r][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    var day = Math.floor((new Date(date) - new Date(PROJECT_START)) / 864e5) + 1;
    if (day < 1) continue;

    for (var a = 0; a < angles.length && pushed < 20; a++) {
      var url = String(vals[r][3 + a] || '').trim();
      if (!url) { missing++; continue; }
      var fromR2 = /^originals\//.test(url); // R2 key filed by the assistant
      if (!fromR2 && !/^https?:/i.test(url)) { missing++; continue; }

      var name = 'micheal-ray-berry-day-' + String(day).padStart(3, '0') + '-' + angles[a] + '-' + date + '.jpg';
      var repoPath = 'photos/' + date.slice(0, 4) + '/' + date.slice(5, 7) + '/' + date.slice(8, 10) + '/' + name;
      var publicUrl = 'https://michealrayberry.com/' + repoPath;
      if (done[repoPath]) {
        // Already in the repo. If the cell still points at Drive or R2, repoint it —
        // otherwise the sheet keeps a private reference the site cannot serve.
        if (fromR2 || driveIdFromUrl(url)) {
          weighinsSheet().getRange(r + 1, 4 + a).setValue(publicUrl);
          repointed++;
        }
        skipped++;
        continue;
      }

      try {
        // Drive links are read through DriveApp (works on private files);
        // anything else — e.g. an already-public michealrayberry.com URL from
        // the retired mirror — is fetched over HTTP.
        var id = fromR2 ? null : driveIdFromUrl(url);
        var blob;
        if (fromR2) {
          blob = r2Get_(url);
        } else if (id) {
          blob = DriveApp.getFileById(id).getBlob();
        } else {
          var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
          if (resp.getResponseCode() !== 200) { Logger.log('Unreachable (' + resp.getResponseCode() + '): ' + url); missing++; continue; }
          blob = resp.getBlob();
        }
        var result = ghPutFile(repoPath, blob, 'Mirror daily photo ' + name);
        done[repoPath] = date;
        if (result === 'created') pushed++; else skipped++;
      } catch (e) {
        Logger.log('Mirror failed for ' + name + ': ' + e);
        props.setProperty('GH_MIRRORED', JSON.stringify(done));
        return; // bad token, no Drive access, or rate limit — retry next run
      }
    }
  }

  props.setProperty('GH_MIRRORED', JSON.stringify(done));
  Logger.log('Mirror run: ' + pushed + ' pushed, ' + repointed + ' cell(s) repointed to michealrayberry.com, ' +
    skipped + ' already present, ' + missing + ' photo cell(s) empty or unreadable.');
  if (pushed === 20) Logger.log('Hit the 20-per-run cap — run again to continue the backlog.');
}

/* Shows what the mirror will do without writing anything. */
function githubMirrorPreview() {
  var vals = weighinsSheet().getDataRange().getValues();
  var angles = ['front', 'left', 'rear', 'right'];
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var date = apDateStr(vals[r][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    var day = Math.floor((new Date(date) - new Date(PROJECT_START)) / 864e5) + 1;
    if (day < 1) continue;
    var have = 0;
    for (var a = 0; a < 4; a++) if (/^(https?:|originals\/)/i.test(String(vals[r][3 + a] || '').trim())) have++;
    if (have) out.push('Day ' + day + ' · ' + date + ' · ' + have + '/4 photos' + (have === 4 ? '' : '  ← incomplete, will not publish'));
  }
  Logger.log(out.length ? out.join('\n') : 'No photo URLs found in the Weigh-ins tab.');
}

/* Confirms the token, repo, and branch are all usable. */
function githubMirrorTest() {
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/branches/' + GH_BRANCH,
    { headers: ghHeaders(), muteHttpExceptions: true });
  Logger.log(r.getResponseCode() === 200
    ? 'GitHub OK — ' + GH_REPO + '@' + GH_BRANCH + ' is writable.'
    : 'GitHub FAILED ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
}

/* ═════ MRB PORTAL STATE (device key) ═════
   What Micheal is allowed to see: today's packet status, the deadline, his
   assigned corrective sessions, and his own violation entries. Read-only —
   nothing here can edit, resolve, or remove a record. */

function handleMyState() {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var day = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  var out = { ok: true, today: today, day: day, serverTime: new Date().toISOString() };

  var vals = weighinsSheet().getDataRange().getValues();
  var row = null, weights = [];
  for (var i = 1; i < vals.length; i++) {
    var d = apDateStr(vals[i][0]);
    var w = parseFloat(vals[i][1]);
    if (!isNaN(w)) weights.push({ date: d, weight: w });
    if (d === today) row = vals[i];
  }
  out.packet = {
    weight: row ? String(row[1] || '') : '',
    front: !!(row && String(row[3] || '').trim()),
    left: !!(row && String(row[4] || '').trim()),
    rear: !!(row && String(row[5] || '').trim()),
    right: !!(row && String(row[6] || '').trim()),
    video: !!(row && String(row[7] || '').trim()),
  };
  weights.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  out.start = weights.length ? weights[0].weight : 340;
  out.latest = weights.length ? weights[weights.length - 1] : null;
  out.history = weights.slice(-30);

  // Attestation for today — proves the capture happened inside the window.
  var att = attestationSheet().getDataRange().getValues();
  out.attested = false;
  for (var a = 1; a < att.length; a++) {
    if (apDateStr(att[a][1]) === today && String(att[a][3]) === 'capture-attested') out.attested = true;
  }

  var pv = violationLogSheet().getDataRange().getValues();
  out.violations = [];
  for (var v = 1; v < pv.length; v++) {
    var pd = apDateStr(pv[v][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) continue;
    out.violations.push({ date: pd, what: String(pv[v][1] || ''), status: String(pv[v][2] || 'Unresolved') });
  }

  var cs = correctiveSheet().getDataRange().getValues();
  out.corrective = [];
  for (var c = 1; c < cs.length; c++) {
    if (!String(cs[c][1] || '').trim()) continue;
    out.corrective.push({
      date: apDateStr(cs[c][0]), assignment: String(cs[c][1] || ''),
      due: apDateStr(cs[c][2]), status: String(cs[c][3] || 'Assigned'),
      completed: apDateStr(cs[c][4]),
    });
  }

  out.siteState = siteStateAll();
  return jsonOut(out);
}

/* ═════ DEDUPE ═════
   Running the migration more than once appends a second copy of every row.
   This keeps the FIRST row for each date and deletes later duplicates,
   merging any cell that is filled in a duplicate but empty in the keeper, so
   nothing recorded is lost. Run dedupePreview() first — it changes nothing. */

function dedupePreview() { dedupeRecord(true); }

function dedupeRecord(previewOnly) {
  var report = ['', '════════ DEDUPE ' + (previewOnly ? '(PREVIEW — no changes)' : '(APPLIED)') + ' ════════'];
  [['Weigh-ins', 8], ['Violation Log', 3], ['Corrective Log', 5]].forEach(function (spec) {
    var sh = ss().getSheetByName(spec[0]);
    if (!sh || sh.getLastRow() < 3) return;
    var width = spec[1];
    var vals = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
    var seen = {}, dupRows = [], merges = 0;

    for (var r = 1; r < vals.length; r++) {
      // Weigh-ins is one row per date; the logs can legitimately repeat a
      // date, so those are keyed on date + text to avoid deleting real rows.
      var key = spec[0] === 'Weigh-ins'
        ? apDateStr(vals[r][0])
        : apDateStr(vals[r][0]) + '|' + String(vals[r][1] || '').trim();
      if (!key || key === '|') continue;

      if (seen[key] === undefined) { seen[key] = r; continue; }
      var keep = seen[key];
      for (var c = 0; c < width; c++) {
        var mine = String(vals[r][c] || '').trim();
        if (mine && !String(vals[keep][c] || '').trim()) { vals[keep][c] = vals[r][c]; merges++; }
      }
      dupRows.push(r + 1);
    }

    report.push(spec[0] + ': ' + dupRows.length + ' duplicate row(s), ' + merges + ' cell(s) merged into the keeper.');
    if (previewOnly || !dupRows.length) return;

    sh.getRange(1, 1, vals.length, width).setValues(vals);
    dupRows.sort(function (a, b) { return b - a; }).forEach(function (row) { sh.deleteRow(row); });
    report.push('  → deleted rows: ' + dupRows.slice().reverse().join(', '));
  });
  report.push('');
  report.push(previewOnly ? 'Nothing was changed. Run dedupeRecord() to apply.' : 'Done.');
  Logger.log(report.join('\n'));
}

/* ═════ PHOTO AUDIT ═════
   Checks every photo cell in Weigh-ins: is there a URL, does it actually
   load, and is the mirrored copy present in the repo under photos/. Prints
   one line per problem so a broken day can be fixed rather than guessed at. */

function photoAudit() {
  var vals = weighinsSheet().getDataRange().getValues();
  var angles = ['front', 'left', 'rear', 'right'];
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var out = ['', '════════ PHOTO AUDIT ════════'];
  var okDays = 0, badDays = 0, futureSkipped = 0;

  for (var r = 1; r < vals.length; r++) {
    var date = apDateStr(vals[r][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    var day = Math.floor((new Date(date) - new Date(PROJECT_START)) / 864e5) + 1;
    if (day < 1) continue;
    // The sheet is pre-filled with future dates; auditing them just floods
    // the log with rows that cannot have photos yet.
    if (date > today) { futureSkipped++; continue; }

    var problems = [];
    for (var a = 0; a < 4; a++) {
      var url = String(vals[r][3 + a] || '').trim();
      if (!url) { problems.push(angles[a] + ': EMPTY'); continue; }

      // The cell URL itself
      if (/^https?:/i.test(url) && !driveIdFromUrl(url)) {
        try {
          var resp = UrlFetchApp.fetch(url, { method: 'get', headers: { Range: 'bytes=0-0' }, muteHttpExceptions: true, followRedirects: true });
          var c = resp.getResponseCode();
          if (c !== 200 && c !== 206) problems.push(angles[a] + ': cell URL ' + c);
        } catch (e) { problems.push(angles[a] + ': cell URL unreachable'); }
      }

      // The mirrored copy the publisher actually reads
      var repoUrl = 'https://michealrayberry.com/photos/' + date.slice(0, 4) + '/' + date.slice(5, 7) + '/' +
        date.slice(8, 10) + '/micheal-ray-berry-day-' + ('00' + day).slice(-3) + '-' + angles[a] + '-' + date + '.jpg';
      try {
        var r2 = UrlFetchApp.fetch(repoUrl, { method: 'get', headers: { Range: 'bytes=0-0' }, muteHttpExceptions: true });
        var c2 = r2.getResponseCode();
        if (c2 !== 200 && c2 !== 206) problems.push(angles[a] + ': NOT MIRRORED');
      } catch (e) { problems.push(angles[a] + ': mirror unreachable'); }
    }

    if (problems.length) { badDays++; out.push('Day ' + day + ' (' + date + '): ' + problems.join(' · ')); }
    else okDays++;
  }

  out.push('');
  out.push(okDays + ' day(s) fully mirrored, ' + badDays + ' with problems, ' + futureSkipped + ' future date(s) skipped.');
  out.push('NOT MIRRORED entries are fixed by running githubMirrorPhotos() again.');
  Logger.log(out.join('\n'));
}


/* ═══════════════════ AUTOMATED MAIL ═══════════════════
   Two recipients, two registers. The AP's mail is administrative: what
   happened, what needs a decision, where to act. Micheal's is pointed —
   the email is itself part of the pressure, so it names the deadline, the
   assigned consequence, and the count of what is still missing, and it
   stops the moment the day is complete. Nothing here is public; these are
   private notifications about a record that is already public. */

var SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID;
var PORTAL_URL = 'https://michealrayberry.com/assistant/';
var AP_CONSOLE = 'the MRB menu in the record sheet — ' + SHEET_URL;

function mrbSign() {
  return '\n\n—\nAutomated from the record. Nothing in this message is published.\n' +
    'Portal: ' + PORTAL_URL + '\nRecord: https://michealrayberry.com/daily/';
}
function apSign() {
  return '\n\n—\nAutomated from the record.\nConsole: ' + AP_CONSOLE;
}
/* Sending never throws. Quota exhaustion is a delivery problem, not a reason
   to abort a nightly check or leave a watch marker unwritten — the record
   still has to be correct on a day the mailbox is full. */
function sendMail(to, subject, body) {
  try {
    if (MailApp.getRemainingDailyQuota() < 2) { Logger.log('MAIL QUOTA EXHAUSTED — not sent: ' + subject); return false; }
    MailApp.sendEmail(to, subject, body);
    return true;
  } catch (e) {
    Logger.log('MAIL FAILED (' + subject + '): ' + e);
    return false;
  }
}
function mailMRB(subject, body) { return sendMail(MRB_EMAIL, subject, body + mrbSign()); }
function mailAP(subject, body) { return sendMail(AP_EMAIL, subject, body + apSign()); }

function dayOf(dateStr) {
  return Math.floor((new Date(dateStr) - new Date(PROJECT_START)) / 864e5) + 1;
}

/* The single source of truth for "is the packet complete". The nightly check,
   the morning brief, and the evening warning all read it, so the three can
   never disagree about what is outstanding. */
function packetState(dateStr) {
  var vals = weighinsSheet().getDataRange().getValues();
  var row = null;
  for (var i = 1; i < vals.length; i++) {
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (ds === dateStr) { row = vals[i]; break; }
  }
  var missing = [];
  if (!row || !parseFloat(row[1])) missing.push('scale-synced weight (step on the Withings scale)');
  if (!row || !String(row[3] || '').trim()) missing.push('accountability photographs');
  if (!row || !String(row[7] || '').trim()) missing.push('four-angle inspection video');
  var attested = false;
  try {
    var av = attestationSheet().getDataRange().getValues();
    for (var a = av.length - 1; a >= 1; a--) {
      var ad = av[a][1];
      var ads = ad instanceof Date ? Utilities.formatDate(ad, 'America/New_York', 'yyyy-MM-dd') : String(ad).trim();
      if (ads === dateStr && String(av[a][3]) === 'capture-attested') { attested = true; break; }
    }
  } catch (e) { attested = true; }
  if (!attested) missing.push('capture attestation');
  return { missing: missing, complete: missing.length === 0, day: dayOf(dateStr), date: dateStr };
}

/* What the NEXT violation would cost, stated in the reminders so the deadline
   is never abstract. Level follows the accumulated count, capped at three. */
function openCorrectiveDeadline() {
  try {
    var sh = correctiveSheet();
    var vals = sh.getDataRange().getValues();
    var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    var soonest = null;
    for (var i = 1; i < vals.length; i++) {
      var status = String(vals[i][3] || '');
      if (/verified/i.test(status) || (/complete/i.test(status) && !/incomplete/i.test(status))) continue;
      var due = apDateStr(vals[i][2]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
      if (!soonest || due < soonest.due) soonest = { due: due, assignment: String(vals[i][1] || ''), days: Math.round((new Date(due) - new Date(today)) / 864e5) };
    }
    if (!soonest) return null;
    soonest.text = soonest.days < 0
      ? 'The deadline for the assigned corrective session passed ' + Math.abs(soonest.days) + ' day(s) ago (' + soonest.due + '). Every day past it is a new Violation Event.'
      : (soonest.days === 0
        ? 'The assigned corrective session is due TODAY (' + soonest.due + '). Missing it is a new Violation Event.'
        : soonest.days + ' day(s) remain to submit the assigned corrective session (due ' + soonest.due + '). Missing that deadline is a new Violation Event, entered separately and permanently.');
    return soonest;
  } catch (e) { return null; }
}

function nextConsequence() {
  var open = 0, total = 0;
  try {
    var v = violationLogSheet().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (!String(v[i][0] || '').trim() && !(v[i][0] instanceof Date)) continue;
      total++;
      var s = String(v[i][2] || '');
      if (!/^\s*(resolved|satisfied|closed)/i.test(s)) open++;
    }
  } catch (e) {}
  var level = Math.min(3, total + 1);
  var mins = { 1: 10, 2: 20, 3: 30 }[level];
  return { level: level, mins: mins, open: open, total: total,
    text: 'Level ' + level + ' — ' + mins + ' continuous minutes of corner time, recorded in one unbroken take and published beside the entry' };
}

/* 7 AM ET. States the day, the deadline, and the cost of missing it. */
function morningBrief() {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (today < PROJECT_START) return;
  if (stateGet('abandoned') === 'confirmed') return;
  var st = packetState(today);
  var c = nextConsequence();
  var body = 'Day ' + st.day + '. Everything below is due by 10:00 PM Eastern tonight.\n\n' +
    '  1. Four-angle inspection video, one continuous take\n' +
    '  2. Four accountability photographs\n' +
    '  3. Today\'s weight\n\n' +
    'All three are captured in one pass at ' + PORTAL_URL + '.\n\n' +
    'A packet finished at 10:01 PM is a miss. The server clock decides, not your phone,\n' +
    'and not your intention to do it later.\n\n' +
    'If tonight is missed: ' + c.text + '.\n';
  if (supervisionScheduled(today)) {
    var srx = supervisionRow(today);
    if (!(srx && /^EXCEPTION/i.test(String(srx.vals[2] || '')))) {
      body += '\nEVENING SUPERVISION tonight, 6:00–10:00 PM Eastern (\u00a73.4): full uniform, fixed camera,\n' +
        'water only, home-cooked dinner. File the archive link in the File tool before 10:20 PM.\n' +
        'Not filed = MISSED = a Violation Event, declared by the record at 10:20.\n';
    }
  }
  if (c.open) body += '\nYou currently have ' + c.open + ' unresolved ' + (c.open === 1 ? 'entry' : 'entries') + ' on the public record.\n';
  var dl = openCorrectiveDeadline();
  if (dl) body += '\n' + dl.text + '\n' + (dl.assignment ? 'Assigned: ' + dl.assignment + '\n' : '') + 'Record it at ' + PORTAL_URL + '\n';
  mailMRB('Day ' + st.day + ' — due by 10 PM ET tonight', body);
}

/* 8 PM ET, two hours out. Silent when the day is already complete — a warning
   that arrives after the work is done teaches the inbox to ignore it. */
function eveningWarning() {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (today < PROJECT_START) return;
  if (stateGet('abandoned') === 'confirmed') return;
  var st = packetState(today);
  if (st.complete) return;
  var c = nextConsequence();
  mailMRB('TWO HOURS LEFT — Day ' + st.day + ' packet incomplete',
    'Two hours to the 10:00 PM Eastern deadline. The record shows ' + st.missing.length + ' outstanding ' +
    (st.missing.length === 1 ? 'item' : 'items') + ':\n\n  - ' + st.missing.join('\n  - ') + '\n\n' +
    'Record it now: ' + PORTAL_URL + '\n\n' +
    (function () { var dl = openCorrectiveDeadline(); return dl ? dl.text + '\n\n' : ''; })() +
    'At 10 PM the check runs by itself and declares the violation without waiting for anyone.\n' +
    'What follows is not negotiable and is not delayed by an explanation:\n\n  ' + c.text + '.\n\n' +
    'The entry is permanent whether or not the consequence is completed. Completing it\n' +
    'closes the obligation; it never removes the entry.');
}

/* Sent the moment the nightly check declares. He should not learn it from the
   website in the morning. */
function mrbViolationNotice(dateStr, missing, autoDeclared) {
  var day = dayOf(dateStr);
  var c = nextConsequence();
  mailMRB('VIOLATION DECLARED — Day ' + day + ' — ' + dateStr,
    'The 10 PM Eastern check ran and the packet for Day ' + day + ' was incomplete.\n\n' +
    'Missing at the deadline:\n  - ' + missing.join('\n  - ') + '\n\n' +
    (autoDeclared
      ? 'A Violation Event has been entered on the public record for ' + dateStr + '. It is permanent.\n' +
        'The site states it in one factual line until the entry is resolved.\n\n'
      : 'A violation for this date was already on the log; no duplicate was added.\n\n') +
    'Assigned: ' + c.text + '.\n\n' +
    'Record it at ' + PORTAL_URL + '. The entry stays open until the Accountability Partner\n' +
    'verifies the session — submitting it is not the same as resolving it.\n\n' +
    (function () { var dl = openCorrectiveDeadline(); return dl ? dl.text + '\n\n' : ''; })() +
    'If a documented medical event or verified platform failure applies, say so to the AP.\n' +
    'He decides, and his decision is logged either way. You do not clear your own record.');
}

/* Hourly. Detects three things the moment they change: an AP verdict, a
   corrective submission awaiting review, and a milestone crossing. Each fires
   once — the last-seen marker lives in Site State, so a re-run is a no-op. */
function hourlyWatch() {
  try { verdictWatch(); } catch (e) {}
  try { correctiveSubmittedWatch(); } catch (e) {}
  try { milestoneWatch(); } catch (e) {}
}

function verdictWatch() {
  var v = violationLogSheet().getDataRange().getValues();
  var seen = {};
  try { seen = JSON.parse(stateGet('verdict_seen') || '{}'); } catch (e) { seen = {}; }
  var changed = false;
  for (var i = 1; i < v.length; i++) {
    var ds = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], 'America/New_York', 'yyyy-MM-dd') : String(v[i][0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    var status = String(v[i][2] || '').trim();
    var verdict = String(v[i][5] || '').trim(); // column F — AP verification result
    var fingerprint = status + '|' + verdict;
    if (seen[ds] === fingerprint) continue;
    var first = !(ds in seen);
    seen[ds] = fingerprint;
    changed = true;
    if (first) continue; // first sight of an entry is not a verdict change
    var what = String(v[i][1] || '').replace(/\s*\[auto-declared\]\s*/i, '');
    if (/^\s*(resolved|satisfied|closed)/i.test(status)) {
      mailMRB('RESOLVED — ' + ds + ' — verified by the Accountability Partner',
        'The entry for ' + ds + ' (' + what + ') has been verified and marked resolved.\n\n' +
        (verdict ? 'AP verification: ' + verdict + '\n\n' : '') +
        'The obligation is closed. The entry is not: it stays on the public record permanently,\n' +
        'now showing its resolution date. That is the whole point of it.');
    } else if (/reject|invalid|repeat|incomplete/i.test(verdict)) {
      mailMRB('SESSION REJECTED — ' + ds + ' — must be repeated',
        'The Accountability Partner has reviewed the session submitted against the entry for ' + ds + '\n' +
        '(' + what + ') and has not accepted it.\n\n' +
        'Result: ' + verdict + '\n\n' +
        'The entry remains open. The full assignment restarts from zero — a partial or invalid\n' +
        'session counts for nothing.\n\n' +
        'Record it again at ' + PORTAL_URL + '.');
    }
  }
  if (changed) stateSet('verdict_seen', JSON.stringify(seen));
}

function correctiveSubmittedWatch() {
  var v = violationLogSheet().getDataRange().getValues();
  var raw = stateGet('submitted_seen');
  var seen = {};
  try { seen = JSON.parse(raw || '{}'); } catch (e) { seen = {}; }
  // Cold start: adopt the current state silently. Without this the first run
  // treats the whole existing log as new activity and mails one per row.
  var priming = !raw;
  var changed = false;
  for (var i = 1; i < v.length; i++) {
    var ds = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], 'America/New_York', 'yyyy-MM-dd') : String(v[i][0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    var submitted = String(v[i][3] || '').trim(); // column D — submission timestamp
    // Must actually be a timestamp. On a sheet still using the pre-rewrite
    // layout, column D holds the consequence level — a bare '1' would read as
    // a submission on every row and mail the AP once per row, every hour.
    if (!/^\d{4}-\d{2}-\d{2}/.test(submitted)) continue;
    if (seen[ds] === submitted) continue;
    seen[ds] = submitted;
    changed = true;
    if (priming) continue;
    var verdict = String(v[i][5] || '').trim();
    if (verdict) continue; // already ruled on
    mailAP('Corrective session submitted — ' + ds + ' — awaiting your verification',
      'A corrective session has been submitted against the entry for ' + ds + '.\n\n' +
      'Submitted: ' + submitted + '\n' +
      'Requirement missed: ' + String(v[i][1] || '') + '\n\n' +
      'Submission RESOLVED the entry (§8 as amended) — the public posting is the\n' +
      'evidence, filed in column H and embedded beside the entry on the next build.\n' +
      'Review it for identity, attire, posture, elapsed time, and completion, and\n' +
      'record your result in column F. If it fails the standard, OVERRULE: set\n' +
      'status back to Unresolved, note why in corrections, and require a\n' +
      'replacement session.');
  }
  if (changed) stateSet('submitted_seen', JSON.stringify(seen));
}

var MILESTONES = [320, 300, 275, 250, 225, 200];

function milestoneWatch() {
  var vals = weighinsSheet().getDataRange().getValues();
  var latest = null, latestDate = '';
  for (var i = 1; i < vals.length; i++) {
    var w = parseFloat(vals[i][1]);
    if (isNaN(w)) continue;
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (ds > latestDate) { latestDate = ds; latest = w; }
  }
  if (latest === null) return;
  var rawHit = stateGet('milestones_hit');
  var hit = {};
  try { hit = JSON.parse(rawHit || '{}'); } catch (e) { hit = {}; }
  var priming = !rawHit; // adopt milestones already passed without announcing them
  var changed = false;
  for (var m = 0; m < MILESTONES.length; m++) {
    var target = MILESTONES[m];
    if (latest > target || hit[target]) continue;
    hit[target] = latestDate;
    changed = true;
    if (priming) continue;
    var day = dayOf(latestDate);
    var final = target === 200;
    mailMRB('MILESTONE — ' + target + ' lb reached on Day ' + day,
      'The weigh-in for ' + latestDate + ' recorded ' + latest + ' lb, crossing the ' + target + '-pound milestone.\n\n' +
      'A milestone requires a recorded weigh-in and a milestone video. Neither is optional,\n' +
      'and the milestone is not on the record until both are filed.\n\n' +
      (final
        ? 'This is 200. Completion requires holding it for 28 consecutive days — not touching it once.\n' +
          'The count starts from the first day at or below 200 and resets on any day above it.\n'
        : 'Next: ' + MILESTONES[m + 1] + ' lb.\n'));
    mailAP('Milestone reached — ' + target + ' lb (' + latestDate + ')',
      'The weigh-in for ' + latestDate + ' recorded ' + latest + ' lb, crossing ' + target + ' lb (Day ' + day + ').\n\n' +
      'A milestone weigh-in and milestone video are required. Verify both were filed and note\n' +
      'the milestone in the record.');
  }
  if (changed) stateSet('milestones_hit', JSON.stringify(hit));
}

/* Monday. The same seven days the AP is reviewing, from the other side. */
function mrbWeeklyBrief() {
  if (stateGet('abandoned') === 'confirmed') return;
  var today = new Date();
  var vals = weighinsSheet().getDataRange().getValues();
  var documented = 0, missed = [], weights = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(today); d.setDate(d.getDate() - i - 1);
    var ds = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
    if (ds < PROJECT_START) continue;
    var st = packetState(ds);
    if (st.complete) documented++; else missed.push('Day ' + st.day + ' (' + ds + ') — ' + st.missing.join(', '));
    for (var r = 1; r < vals.length; r++) {
      var rd = vals[r][0];
      var rds = rd instanceof Date ? Utilities.formatDate(rd, 'America/New_York', 'yyyy-MM-dd') : String(rd).trim();
      if (rds === ds && parseFloat(vals[r][1])) weights.push({ d: ds, w: parseFloat(vals[r][1]) });
    }
  }
  var c = nextConsequence();
  var trend = '';
  if (weights.length >= 2) {
    var delta = weights[weights.length - 1].w - weights[0].w;
    trend = 'Weight: ' + weights[0].w + ' → ' + weights[weights.length - 1].w + ' lb (' +
      (delta > 0 ? '+' : '') + delta.toFixed(1) + ' this week).\n' +
      'The number is not a violation and never has been. Only the documentation is.\n';
  } else if (weights.length === 1) {
    trend = 'Weight: ' + weights[0].w + ' lb — one entry all week.\n';
  } else {
    trend = 'No weight was recorded at all this week.\n';
  }
  mailMRB('Week in review — ' + documented + ' of 7 days documented',
    documented + ' of the last 7 days carry a complete record.\n\n' + trend + '\n' +
    (missed.length ? 'Incomplete:\n  - ' + missed.join('\n  - ') + '\n\n' : 'Nothing was missed. That is the standard, not an achievement.\n\n') +
    (c.open
      ? c.open + ' unresolved ' + (c.open === 1 ? 'entry remains' : 'entries remain') + ' on the public record.\n' +
        'Each one stays open until the Accountability Partner verifies a completed session.\n'
      : 'No entries are open. The record is current.\n') +
    '\n' + c.total + ' violation ' + (c.total === 1 ? 'entry has' : 'entries have') + ' been recorded since Day 1.\n' +
    'They are permanent. Resolution changes their status; it never removes them.');
}

/* Sends one of each to both addresses so the wording, links, and formatting can
   be checked without waiting for a trigger. Safe to run repeatedly: the watch
   functions are skipped here, since those fire on real record changes. */
function testEmails() {
  var before = MailApp.getRemainingDailyQuota();
  if (before < 5) {
    Logger.log('Only ' + before + ' emails left in today\'s quota — not sending the test set. ' +
      'The quota resets on a rolling 24-hour basis.');
    return;
  }
  morningBrief();
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var st = packetState(today);
  mailMRB('TWO HOURS LEFT — Day ' + st.day + ' packet incomplete (TEST)',
    'Test copy of the 8 PM warning. Outstanding right now: ' +
    (st.complete ? 'nothing — the real warning would not have been sent.' : st.missing.join(', ')) + '\n\n' +
    'Assigned if missed: ' + nextConsequence().text + '.');
  mrbViolationNotice(today, st.missing.length ? st.missing : ['weight entry'], false);
  mrbWeeklyBrief();
  Logger.log('Sent ' + (before - MailApp.getRemainingDailyQuota()) + ' message(s) to ' + MRB_EMAIL +
    '. Quota left: ' + MailApp.getRemainingDailyQuota());
}

/* ═════ PHOTO CELLS → OWN DOMAIN ═════

   importPhotos writes whatever Drive URL the file arrived with. The GitHub
   mirror that used to rewrite those cells to michealrayberry.com was dropped
   in the fresh-start rebuild, so from that point the photo columns kept
   pointing at Drive — which is why later days render Drive-hosted images on
   the site even though the same photographs are served from the project's own
   domain on the archive pages.

   This rewrites columns D-G to the canonical path, but only for a photo that
   actually resolves there: a cell is never pointed at a URL that 404s.

   relinkPhotosPreview()  — report only
   relinkPhotos()         — apply */

function relinkPhotosScan(apply) {
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var angles = ['front', 'left', 'rear', 'right'];
  var out = ['', '════════ PHOTO LINKS ' + (apply ? '— APPLYING' : '— PREVIEW') + ' ════════'];
  var fixed = 0, already = 0, missing = 0;
  for (var i = 1; i < vals.length; i++) {
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || ds > today) continue;
    var day = Math.floor((new Date(ds) - new Date(PROJECT_START)) / 864e5) + 1;
    if (day < 1) continue;
    for (var a = 0; a < 4; a++) {
      var col = 4 + a;
      var cur = String(vals[i][col - 1] || '').trim();
      if (!cur) continue;
      if (cur.indexOf('michealrayberry.com/photos/') !== -1) { already++; continue; }
      var target = 'https://michealrayberry.com/photos/' + ds.slice(0, 4) + '/' + ds.slice(5, 7) + '/' +
        ds.slice(8, 10) + '/micheal-ray-berry-day-' + ('00' + day).slice(-3) + '-' + angles[a] + '-' + ds + '.jpg';
      var ok = false;
      try {
        var r = UrlFetchApp.fetch(target, { method: 'get', headers: { Range: 'bytes=0-0' }, muteHttpExceptions: true });
        var code = r.getResponseCode();
        ok = (code === 200 || code === 206);
      } catch (e) {}
      if (!ok) { missing++; out.push('Day ' + day + ' ' + angles[a] + ': not on the domain yet — left on Drive'); continue; }
      fixed++;
      if (apply) sh.getRange(i + 1, col).setValue(target);
      else out.push('Day ' + day + ' ' + angles[a] + ': would relink');
    }
  }
  out.push('');
  out.push((apply ? fixed + ' relinked' : fixed + ' would be relinked') + ' · ' + already + ' already on the domain · ' + missing + ' not available there.');
  if (!apply && fixed) out.push('Run relinkPhotos() to apply.');
  Logger.log(out.join('\n'));
}

function relinkPhotosPreview() { relinkPhotosScan(false); }
function relinkPhotos() { relinkPhotosScan(true); }


/* Writes a known video URL (YouTube or Drive) straight into column H —
   the deterministic route when a link needs filing by hand.
   Example: setVideoUrl('2026-09-01', 'https://youtu.be/…') */
function setVideoUrl(date, pathOrUrl) {
  var d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { Logger.log('Date must be YYYY-MM-DD.'); return; }
  var url = String(pathOrUrl || '').trim();
  if (!/^https?:\/\//.test(url)) { Logger.log('Give the full https:// URL.'); return; }

  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();
  var row = 0;
  for (var i = 1; i < vals.length; i++) if (apDateStr(vals[i][0]) === d) { row = i + 1; break; }
  if (!row) { sh.appendRow([d]); row = sh.getLastRow(); }
  sh.getRange(row, 8).setValue(url);
  Logger.log('Row ' + row + ' (' + d + ') column H set to:\n' + url);
}

/* Copies a previous record into the one now in use — for the case where a
   second spreadsheet was created and the earlier one still holds the real
   history. Matches tabs by name and appends rows, so it can be run once
   without disturbing anything already filed.

   Preview first:  migrateRecordPreview('OLD_SHEET_ID')
   Then apply:     migrateRecordFrom('OLD_SHEET_ID') */
function migrateRecordPreview(oldId) {
  migrateRecordFrom(oldId, true);
}

function migrateRecordFrom(oldId, previewOnly) {
  var id = String(oldId || '').trim();
  if (!id) { Logger.log('Give the source spreadsheet ID.'); return; }
  var target = ss();
  if (id === target.getId()) { Logger.log('Source and destination are the same spreadsheet.'); return; }

  var old;
  try { old = SpreadsheetApp.openById(id); }
  catch (e) { Logger.log('Cannot open ' + id + ': ' + e); return; }

  var out = ['', (previewOnly ? '════ MIGRATION PREVIEW ════' : '════ MIGRATION ════'),
    'From: ' + old.getName(), 'To:   ' + target.getName(), ''];

  var names = Object.keys(TABS);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    var from = old.getSheetByName(name);
    var to = target.getSheetByName(name);
    if (!from || !to) { out.push(name + ': skipped (missing on one side)'); continue; }

    var vals = from.getDataRange().getValues();
    if (vals.length < 2) { out.push(name + ': nothing to copy'); continue; }

    // Rows already present are matched on the first column, so a second run
    // adds nothing rather than duplicating the history.
    var have = {};
    var cur = to.getDataRange().getValues();
    for (var c = 1; c < cur.length; c++) have[String(cur[c][0])] = true;

    var width = TABS[name].length;
    var rows = [];
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r].join('')).trim() === '') continue;
      var keyv = String(vals[r][0]);
      if (have[keyv]) continue;
      var row = vals[r].slice(0, width);
      while (row.length < width) row.push('');
      rows.push(row);
    }
    if (!rows.length) { out.push(name + ': already up to date'); continue; }
    out.push(name + ': ' + rows.length + ' row(s)' + (previewOnly ? ' would be copied' : ' copied'));
    if (!previewOnly) to.getRange(to.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  }

  out.push('');
  out.push(previewOnly ? 'Nothing was written. Run migrateRecordFrom(id) to apply.'
    : 'Done. Existing rows were left untouched; only missing ones were added.');
  Logger.log(out.join('\n'));
}


/* ═════ DATE NORMALISATION ═════

   The CSV export writes whatever a cell is FORMATTED as, so a real Date value
   comes out "7/31/2026" while the site, the archive publisher and both tools
   all expect "2026-08-31". The original record stored dates as text and read
   correctly; the migration copied Date objects into the new one, which is why
   the dashboard fell back to seed data and the corrective tool reported no
   open entry against a log holding three.

   This rewrites every date column as plain ISO text — fixing every consumer at
   once, with no redeploy — and pins the column format so new rows stay text. */
function normalizeDates() {
  var s = ss();
  var tabs = ['Weigh-ins', 'Violation Log', 'Attestation', 'Corrective Log', 'Health', 'Updates', 'Supervision'];
  var out = ['', '════════ DATE NORMALISATION ════════'];

  for (var t = 0; t < tabs.length; t++) {
    var sh = s.getSheetByName(tabs[t]);
    if (!sh) { out.push(tabs[t] + ': not present'); continue; }
    var last = sh.getLastRow();
    if (last < 2) { out.push(tabs[t] + ': empty'); continue; }

    var rng = sh.getRange(2, 1, last - 1, 1);
    var vals = rng.getValues();
    var changed = 0;
    for (var r = 0; r < vals.length; r++) {
      var v = vals[r][0];
      if (v instanceof Date) {
        vals[r][0] = Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
        changed++;
      } else {
        // Text already, but possibly in US order from an earlier paste.
        var m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          vals[r][0] = m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
          changed++;
        }
      }
    }
    // Plain text, so a future entry is not silently re-interpreted as a Date.
    rng.setNumberFormat('@');
    rng.setValues(vals);
    out.push(tabs[t] + ': ' + changed + ' date(s) rewritten as ISO text');
  }

  out.push('');
  out.push('Reload the site — no redeploy needed; every reader takes the sheet as it stands.');
  Logger.log(out.join('\n'));
}
