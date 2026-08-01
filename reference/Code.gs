/**
 * MICHEAL RAY BERRY — PUBLIC ACCOUNTABILITY PROJECT
 * Site endpoint script: capture attestation + automatic photo import from Drive.
 *
 * PHOTO FLOW
 *   Micheal captures the guided 4-angle sequence on the site (Record → Daily
 *   Photo) — it downloads four stamped photos, one per angle — and uploads
 *   them into the shared "MRB Daily Photos" Drive folder. Every 10 minutes
 *   this script scans the folder and files each angle into its column of the
 *   matching Weigh-ins row (D=front, E=left, F=rear, G=right).
 *
 * ═══════ SETUP (in the Weigh-ins spreadsheet's Apps Script, as the AP) ═══════
 * 1. Paste this whole file over any previous version.
 * 2. Run `setup` once — it clears old triggers, creates the 10-minute photo
 *    scan, and creates the "MRB Daily Photos" folder in this account's Drive.
 * 3. Run `showPhotosFolderUrl` — the execution log prints the folder URL.
 *    Open it and share the folder with Micheal (Editor) so he can upload.
 * 4. Deploy → Manage deployments → ✎ → New version → Deploy.
 * ══════════════════════════════════════════════════════════════════════════════
 */

var CONFIG = {
  WEIGHINS_ID: '1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM',
  PENALTIES_ID: '1wmyPT0vfuHrZfoTnnkIOsr7lHKNlr7Kro8L8dNxUkNM', // consolidated: Penalty Log is a TAB of the main spreadsheet
};

/* ─────────────────────── SUBSCRIBER SIGNUP ENDPOINT ─────────────────────── */

// Web endpoint GET: plain health check + one-click unsubscribe links from
// broadcast emails (?action=unsubscribe&email=..&t=..).
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'challenge') {
    if (!keyOk(e.parameter.key)) return jsonOut({ ok: false, error: 'unauthorized' });
    // One-time verification code. Issue time is GOOGLE SERVER TIME — a video
    // recorded earlier (or replayed at a screen) cannot contain a code that
    // did not exist until seconds before recording.
    var code = String(Math.floor(1000 + Math.random() * 9000));
    var now = new Date();
    var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
    var day = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
    attestationSheet().appendRow([now, today, day, 'challenge-issued', code, String(e.parameter.kind || 'daily'), '', '', '', '']);
    return jsonOut({ ok: true, code: code, day: day, issuedAt: now.toISOString() });
  }
  if (e && e.parameter && e.parameter.action === 'apstate') {
    return apOk(e.parameter.key) ? handleApState() : jsonOut({ ok: false, error: 'unauthorized' });
  }
  return jsonOut({ ok: true, service: 'MRB site endpoint' });
}

function doPost(e) {
  try {
    // JSON posts = capture attestations from the Recording Assistant.
    if (e && e.postData && e.postData.contents && String(e.postData.contents).charAt(0) === '{') {
      var obj = null;
      try { obj = JSON.parse(e.postData.contents); } catch (perr) {}
      if (obj && obj.action === 'attest') return keyOk(obj.key) ? handleAttest(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'packet') return keyOk(obj.key) ? handlePacket(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action && String(obj.action).indexOf('ap') === 0) return apOk(obj.key) ? handleApAction(obj) : jsonOut({ ok: false, error: 'unauthorized' });
    }
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ─────────────── SHEET FORMATTING (run `formatSheets` once) ───────────────
   One-time cleanup of the Weigh-ins sheet: proper headers, frozen header row,
   column sizing, date/number formats, alternating row banding, red/green
   highlight on weight change, and sheet protection. Safe to re-run. */

function formatSheets() {
  var sh = weighinsSheet();

  var headers = ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setBackground('#141412').setFontColor('#FAFAF7')
    .setFontFamily('IBM Plex Mono').setFontSize(10).setFontWeight('bold');

  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 260);
  for (var c = 4; c <= 8; c++) sh.setColumnWidth(c, 120);

  var maxRows = Math.max(sh.getMaxRows(), 400);
  sh.getRange(2, 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 2, maxRows, 1).setNumberFormat('0.0');
  sh.getRange(2, 1, maxRows, 8).setFontFamily('IBM Plex Mono').setFontSize(10);
  sh.getRange(2, 4, maxRows, 5).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  // Weight up vs previous day = soft red; down = soft green
  var range = sh.getRange('B3:B' + maxRows);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISNUMBER($B3), ISNUMBER($B2), $B3>$B2)')
      .setBackground('#F6DEDC').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISNUMBER($B3), ISNUMBER($B2), $B3<$B2)')
      .setBackground('#DFE9DF').setRanges([range]).build(),
  ]);

  if (!sh.getBandings().length) {
    sh.getRange(1, 1, maxRows, 8).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  }

  // Only the AP (owner) edits; the site + public read via the CSV endpoint
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    var p = sh.protect().setDescription('AP-administered record — view only');
    p.removeEditors(p.getEditors().filter(function (e) { return e.getEmail() !== Session.getEffectiveUser().getEmail(); }));
  }

  sh.setName('Weigh-ins');
  sh.setTabColor('#B3261E');
}

// Same treatment for the public Penalty Log sheet. Run `formatPenaltiesSheet` once.
// Public columns per §8 of the agreement: date · violation · status — never amounts.
function formatPenaltiesSheet() {
  var sh = penaltiesSheet();

  var headers = ['date', 'violation', 'status'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setBackground('#141412').setFontColor('#FAFAF7')
    .setFontFamily('IBM Plex Mono').setFontSize(10).setFontWeight('bold');

  sh.setColumnWidth(1, 110);   // date
  sh.setColumnWidth(2, 420);   // violation — the nature of the documentation failure
  sh.setColumnWidth(3, 180);   // status: 'Unresolved' or 'Resolved · 2026-07-25'

  var maxRows = Math.max(sh.getMaxRows(), 200);
  sh.getRange(2, 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 1, maxRows, 3).setFontFamily('IBM Plex Mono').setFontSize(10)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

  // Unresolved rows stand out red; resolved rows calm green
  var range = sh.getRange('A2:C' + maxRows);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"", ISNUMBER(SEARCH("unresolved", $C2)))')
      .setBackground('#F6DEDC').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"", ISNUMBER(SEARCH("resolved", $C2)))')
      .setBackground('#DFE9DF').setRanges([range]).build(),
  ]);

  if (!sh.getBandings().length) {
    sh.getRange(1, 1, maxRows, 3).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  }

  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    var p = sh.protect().setDescription('AP-administered penalty record — view only');
    p.removeEditors(p.getEditors().filter(function (e) { return e.getEmail() !== Session.getEffectiveUser().getEmail(); }));
  }

  sh.setName('Penalty Log');
  sh.setTabColor('#B3261E');
}

/* ───────────────────── AUTOMATIC PHOTO IMPORT (every 10 min) ─────────────────────
   Four photos per day, one per angle. Filenames carry the date and the angle
   (mrb-daily-photo-2026-07-20-front.jpg / -left / -rear / -right). Each angle
   goes to its own column: D=front, E=left, F=rear, G=right; the inspection
   video files into column H. The site's Progress Grid shows the front photo.
   First file per slot is final. */

var ANGLE_COLS = { front: 4, left: 5, rear: 6, right: 7 };

function importPhotos() {
  var folder = photosFolder();
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();

  // Index existing rows by date string.
  var byDate = {};
  for (var i = 1; i < vals.length; i++) {
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (ds) byDate[ds] = { row: i + 1 };
  }

  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var mt = String(f.getMimeType());
    var isImg = mt.indexOf('image/') === 0;
    var isVid = mt.indexOf('video/') === 0;
    if (!isImg && !isVid) continue;

    var name = f.getName().toLowerCase();
    var m = name.match(/(\d{4}-\d{2}-\d{2})/);
    var dateStr = m ? m[1] : Utilities.formatDate(f.getDateCreated(), 'America/New_York', 'yyyy-MM-dd');

    var col;
    var url;
    if (isVid) {
      col = 8; // column H = inspection video archive
      url = 'https://drive.google.com/file/d/' + f.getId() + '/view';
    } else {
      var angle = 'front';
      if (name.indexOf('corner') !== -1 || name.indexOf('corrective') !== -1) continue; // corrective-session photos are private verification material (Amendment No. 4) — not daily angle photos, never mirrored
      if (name.indexOf('meal') !== -1) continue;   // meal photos stay in the folder archive; not an angle column
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
    if (String(cell.getValue() || '').trim()) continue; // first file per slot is final
    cell.setValue(url);
  }
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

// NIGHTLY 10 PM COMPLIANCE CHECK
// Runs in the 10-11 PM ET hour: final photo-import scan, then checks today's
// Daily Compliance Packet in the Weigh-ins sheet - weight entry (col B) and
// front photo (col D). If either is missing, emails the AP so the miss can be
// logged as a Violation Event. The site needs no rebuild - it reads sheets live.

var AP_EMAIL = 'ap@michealrayberry.com';
var PROJECT_START = '2026-07-20';

function nightlyComplianceCheck() {
  // Environment follows the record: end-of-day state drives the home.
  importPhotos(); // final scan so a 9:58 PM upload still counts
  githubMirrorPhotos(); // move tonight's photos onto michealrayberry.com before deploying
  try { fitbitSync(); } catch (ef) {} // final activity pull so the day's numbers are on the record
  netlifyDeploy(); // the ONE production deploy of the day — photo commits are [skip netlify]

  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (today < PROJECT_START) return;

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
    if (!parseFloat(row[1])) missing.push('weight entry (column B)');
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
  // Fitbit sync (required packet item per AP-approved amendment): a Health row for today.
  if (PropertiesService.getScriptProperties().getProperty('HEALTH_REFRESH')) {
    var hOk = false;
    try {
      var hv = healthSheet().getDataRange().getValues();
      for (var h2 = hv.length - 1; h2 >= 1; h2--) {
        var hd = hv[h2][0];
        var hds = hd instanceof Date ? Utilities.formatDate(hd, 'America/New_York', 'yyyy-MM-dd') : String(hd).trim();
        if (hds === today) { hOk = true; break; }
      }
    } catch (e3) { hOk = true; }
    if (!hOk) missing.push('Fitbit activity sync (no Health-tab row for today — device not synced?)');
  }
  if (!missing.length) return;
  var autoDeclared = autoDeclareViolation(today, missing);
  if (autoDeclared) netlifyDeploy(); // violation mode goes live tonight, not tomorrow

  var dayNum = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  MailApp.sendEmail({
    to: AP_EMAIL,
    subject: 'MRB Day ' + dayNum + ' - 10 PM deadline check: packet incomplete' + (autoDeclared ? ' - VIOLATION V-AUTO DECLARED' : ''),
    body: 'Automated 10 PM ET compliance check for ' + today + ' (Day ' + dayNum + ').\n\n' +
      'Missing at deadline:\n- ' + missing.join('\n- ') + '\n\n' +
      (autoDeclared
        ? 'AUTO-DECLARATION (AP amendment A2): the system has logged a Violation Event for ' + today + ' on the public record and fired the violation consequence. ' +
          'The site enters violation mode on tonight\'s deploy. No action is required to uphold it.\n' +
          'If a documented medical event or verified platform failure (\u00a79) applies, resolve the entry in the AP Portal with a note; the reversal is itself logged.\n\n'
        : 'A violation for today is already on the log; no duplicate was added.\n\n') +
      'All times in this check are Google server time (America/New_York) - the device clock plays no part.\n' +
      'Cross-check file authenticity against the Attestation tab: hash the received file (shasum -a 256) and compare.\n\n' +
      'Tracker: https://docs.google.com/spreadsheets/d/' + CONFIG.WEIGHINS_ID + '\n' +
      'AP Portal: https://michealrayberry.com/ap\n' +
      'This is an automated message from the site Apps Script.',
  });
}

/* A2 (AP amendment): violations are declared BY THE SYSTEM, not by a click.
   An incomplete packet at the 22:00 ET check appends an Unresolved Violation
   Event itself — §7 documentation failures are unambiguous, so no human
   judgment is needed to declare; the AP reviews AFTER the fact and resolves
   with a note if §9 applies. One violation per day (multiple same-day misses
   = ONE violation), and never a duplicate if the AP already declared. */
function autoDeclareViolation(today, missing) {
  var sh = penaltiesSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    if (ds === today) return false; // already on the log for today
  }
  var what = missing.length === 1 ? missing[0] : 'Daily Compliance Packet incomplete (' + missing.length + ' items)';
  sh.appendRow([today, 'Missed 10 PM ET deadline — ' + what + ' [auto-declared]', 'Unresolved']);
  return true;
}

/* ─────────────────────────────── SETUP ─────────────────────────────── */

/* ─────────── CAPTURE ATTESTATION (challenge codes + file fingerprints) ───────────
   Every session: the tool fetches a one-time code (logged with server time,
   spoken + burned into the video), then posts back SHA-256 hashes of the
   finished video and photos. Rows are timestamped with GOOGLE SERVER TIME, so
   the device clock is irrelevant. If a Drive file is ever edited or replaced,
   its hash will not match the one logged at capture. AP verification: hash the
   received file (e.g. `shasum -a 256 file`) and compare to this sheet. */

/* ──────── FITBIT ACTIVITY SYNC via the GOOGLE HEALTH API ────────
   (Fitbit's legacy Web API stopped accepting new apps; Google Health API is
   its replacement — same Fitbit device data, served from health.googleapis.com.)
   Approved by the AP as a required packet item. Steps/zone-minutes are pulled
   from Google's servers (not self-reported) into the 'Health' tab; the site
   shows them on the Dashboard; the nightly check flags a missing sync.

   SETUP (once)
     1. console.cloud.google.com → create a project → APIs & Services → Library
        → enable "Google Health API".
     2. APIs & Services → Credentials → Create Credentials → OAuth client ID
        (configure the consent screen first: External). Application type:
        Web application. Authorized redirect URI: https://www.google.com
        Copy the Client ID + Client Secret.
     3. Auth Platform → Audience: add the Fitbit-account Google email as a TEST
        USER, then click PUBLISH APP (in Testing mode refresh tokens die after
        7 days; published-unverified they persist).
     4. Auth Platform → Data Access → Add scopes → Google Health API →
        googlehealth.activity_and_fitness.readonly → Save.
     5. Here: run setGoogleHealthCredentials('CLIENT_ID', 'CLIENT_SECRET'),
        then googleHealthAuthUrl() — open the logged URL in the browser signed
        in to the Fitbit/Google account, approve ("unverified app" warning is
        expected — Continue). You land on google.com with ?code=XXXX in the
        address bar. Copy the code (between "code=" and "&"), then run:
          googleHealthExchange('PASTE_CODE')
     6. Run `setup` (installs the 6-hour sync trigger). Done.

   NOTE: the Fitbit mobile app must be signed in WITH the Google account and
   syncing — data reaches the API only after the app syncs. */

function setGoogleHealthCredentials(id, secret) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('HEALTH_ID', String(id || '').trim());
  p.setProperty('HEALTH_SECRET', String(secret || '').trim());
  Logger.log('Google Health credentials stored. Now run googleHealthAuthUrl().');
}

function googleHealthAuthUrl() {
  var id = PropertiesService.getScriptProperties().getProperty('HEALTH_ID');
  var url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&access_type=offline&prompt=consent' +
    '&client_id=' + encodeURIComponent(id) +
    '&redirect_uri=' + encodeURIComponent('https://www.google.com') +
    '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly');
  Logger.log(url);
  return url;
}

function googleHealthExchange(code) {
  var p = PropertiesService.getScriptProperties();
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      code: String(code || '').trim(),
      client_id: p.getProperty('HEALTH_ID'),
      client_secret: p.getProperty('HEALTH_SECRET'),
      redirect_uri: 'https://www.google.com',
      grant_type: 'authorization_code',
    },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) { Logger.log('Exchange failed: ' + resp.getContentText().slice(0, 400)); return; }
  var d = JSON.parse(resp.getContentText());
  if (!d.refresh_token) { Logger.log('No refresh_token returned — re-run googleHealthAuthUrl() (it forces prompt=consent) and use a FRESH code.'); return; }
  p.setProperty('HEALTH_REFRESH', d.refresh_token);
  Logger.log('Google Health connected. Running a first sync…');
  fitbitSync();
  Logger.log('Now run `setup` to install the 6-hour trigger.');
}

function healthToken() {
  var p = PropertiesService.getScriptProperties();
  var refresh = p.getProperty('HEALTH_REFRESH');
  if (!refresh) return null;
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'refresh_token', refresh_token: refresh, client_id: p.getProperty('HEALTH_ID'), client_secret: p.getProperty('HEALTH_SECRET') },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) { Logger.log('Health token refresh failed: ' + resp.getContentText().slice(0, 300)); return null; }
  var d = JSON.parse(resp.getContentText());
  if (d.refresh_token) p.setProperty('HEALTH_REFRESH', d.refresh_token);
  return d.access_token;
}

function healthSheet() {
  var s = ss();
  var sh = s.getSheetByName('Health');
  if (!sh) {
    sh = s.insertSheet('Health');
    sh.appendRow(['date', 'steps', 'zone_minutes', 'active_minutes', 'synced_at', 'distance_mi', 'calories']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    var p = sh.protect().setDescription('Fitbit-synced activity — script/AP only');
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

// Pulls yesterday + today (upsert by date) so today's numbers stay near-live
// and yesterday's finals overwrite any partial row. Name kept from the legacy
// Fitbit integration so existing triggers keep working.
function fitbitSync() {
  var tok = healthToken();
  if (!tok) return;
  var tz = 'America/New_York';
  var sh = healthSheet();
  [1, 0].forEach(function (back) {
    var d = new Date();
    d.setDate(d.getDate() - back);
    var ds = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (ds < PROJECT_START) return;
    var n = new Date(d);
    n.setDate(n.getDate() + 1);
    var ns = Utilities.formatDate(n, tz, 'yyyy-MM-dd');
    var steps = ghDayTotal(tok, 'steps', 'steps', ds, ns, 'count');
    var zone = ghDayTotal(tok, 'active-zone-minutes', 'active_zone_minutes', ds, ns, 'count');
    var distM = ghDayTotal(tok, 'distance', 'distance', ds, ns, ['inMeters', 'meters', 'value']);
    // Calories: 'total-calories' is a derived, ROLLUP-ONLY type — plain list 400s.
    var cal = ghDailyRollUp(tok, 'total-calories', ds);
    if (steps === null && zone === null) return; // API error — leave the day untouched
    var vals = sh.getDataRange().getValues();
    var row = null;
    for (var i = 1; i < vals.length; i++) {
      var d0 = vals[i][0];
      var ds0 = d0 instanceof Date ? Utilities.formatDate(d0, tz, 'yyyy-MM-dd') : String(d0).trim();
      if (ds0 === ds) { row = i + 1; break; }
    }
    var data = [ds, steps || 0, zone || 0, '', new Date(), distM ? Math.round(distM / 16.0934) / 100 : 0, cal ? Math.round(cal) : 0, ghDayWeight(tok, ds, ns) || ''];
    if (row) sh.getRange(row, 1, 1, 8).setValues([data]);
    else sh.appendRow(data);
    if (data[7]) autoWeighIn(ds, data[7]);
  });
}

/* Scale-driven official weight (AP-approved cutover): from WEIGHT_AUTO_START the
   Weigh-ins weight column is written by the Google Health sync — the scale IS
   the entry; no more manual logging. Days before the cutover keep their manual
   entries untouched. The synced value always overwrites for cutover days (any
   manual edit is reverted on the next hourly sync — the record can't be typed).
   Note column marks the source. */
var WEIGHT_AUTO_START = '2026-07-30';
function autoWeighIn(ds, lb) {
  if (ds < WEIGHT_AUTO_START) return;
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var d0 = vals[i][0];
    var ds0 = d0 instanceof Date ? Utilities.formatDate(d0, 'America/New_York', 'yyyy-MM-dd') : String(d0).trim();
    if (ds0 === ds) {
      if (Number(vals[i][1]) !== Number(lb)) sh.getRange(i + 1, 2).setValue(lb);
      if (String(vals[i][2] || '').indexOf('scale-synced') === -1) sh.getRange(i + 1, 3).setValue(('' + (vals[i][2] || '')).trim() ? vals[i][2] + ' · scale-synced' : 'scale-synced (Withings via Google Health)');
      return;
    }
  }
  sh.appendRow([ds, lb, 'scale-synced (Withings via Google Health)']);
}

// Daily rollup for derived types (total-calories, active-minutes, …): POST
// dataPoints:dailyRollUp over one civil day, summing every numeric field in the
// result (schema example: steps → {countSum: "3822"}; calories → kcal fields).
function ghDailyRollUp(tok, kebab, ds) {
  try {
    var p = ds.split('-').map(Number);
    var body = {
      range: {
        start: { date: { year: p[0], month: p[1], day: p[2] }, time: { hours: 0, minutes: 0, seconds: 0 } },
        end: { date: { year: p[0], month: p[1], day: p[2] }, time: { hours: 23, minutes: 59, seconds: 59 } },
      },
      windowSizeDays: 1,
    };
    var resp = UrlFetchApp.fetch('https://health.googleapis.com/v4/users/me/dataTypes/' + kebab + '/dataPoints:dailyRollUp', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) { Logger.log('Health rollup ' + kebab + ' (' + ds + '): ' + resp.getContentText().slice(0, 300)); return null; }
    var pts = JSON.parse(resp.getContentText()).rollupDataPoints || [];
    var total = 0;
    pts.forEach(function (pt) {
      var o = JSON.parse(JSON.stringify(pt));
      delete o.civilStartTime; delete o.civilEndTime; delete o.dataSource;
      total += ghSumAllNumeric(o);
    });
    return total || null;
  } catch (e) { Logger.log('Health rollup error ' + kebab + ': ' + e); return null; }
}

// Sums every numeric (or numeric-string) leaf — rollup values arrive as strings.
function ghSumAllNumeric(o) {
  var total = 0;
  (function walk(x) {
    if (x === null || x === undefined) return;
    if (typeof x === 'number') { total += x; return; }
    if (typeof x === 'string') { if (x !== '' && !isNaN(x)) total += Number(x); return; }
    if (typeof x === 'object') for (var k in x) walk(x[k]);
  })(o);
  return total;
}

// Sums one data type over one civil day via the list endpoint. Returns null on
// API failure (so a bad call never zeroes out a recorded day). Points arrive
// from EVERY connected source (phone Health Connect, Fitbit tracker, …), each
// reporting the same activity — so totals are kept per source platform and the
// LARGEST platform total is returned, never the double-counting sum of all.
function ghDayTotal(tok, kebab, snake, ds, ns, sumKey) {
  var keys = Array.isArray(sumKey) ? sumKey : [sumKey];
  try {
    var filter = snake + '.interval.civil_start_time >= "' + ds + 'T00:00:00" AND ' + snake + '.interval.civil_start_time < "' + ns + 'T00:00:00"';
    var base = 'https://health.googleapis.com/v4/users/me/dataTypes/' + kebab + '/dataPoints?filter=' + encodeURIComponent(filter);
    var byPlatform = {}, pageToken = '', pages = 0;
    do {
      var resp = UrlFetchApp.fetch(base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), {
        headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
        muteHttpExceptions: true,
      });
      if (resp.getResponseCode() !== 200) { Logger.log('Health API ' + kebab + ' (' + ds + '): ' + resp.getContentText().slice(0, 300)); return null; }
      var data = JSON.parse(resp.getContentText());
      (data.dataPoints || []).forEach(function (pt) {
        var src = pt.dataSource || {};
        // Key by platform + reporting app/device: Health Connect aggregates several
        // writers (phone sensor, the Fitbit app writing back, …) that all describe
        // the same walking — summing across them overcounts.
        var key = (src.platform || 'UNKNOWN') + '|' +
          ((src.application && src.application.packageName) || (src.device && (src.device.displayName || src.device.manufacturer)) || '');
        var body = pt[snake.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); })] || pt;
        var v = 0;
        for (var ki = 0; ki < keys.length && !v; ki++) v = ghSum(body, keys[ki]);
        byPlatform[key] = (byPlatform[key] || 0) + v;
      });
      pageToken = data.nextPageToken || '';
      pages++;
    } while (pageToken && pages < 20);
    var best = 0;
    for (var k in byPlatform) if (byPlatform[k] > best) best = byPlatform[k];
    return best;
  } catch (e) {
    Logger.log('Health API error ' + kebab + ': ' + e);
    return null;
  }
}

// Latest scale/app weight for the civil day, in pounds. Weight is a SAMPLED type
// (a moment, not an interval) so the filter field differs; both spellings are
// tried. Needs the health_metrics_and_measurements.readonly scope.
// Weight for the civil day, in pounds. Filters are rejected for this type, so:
// preferred — unfiltered list matched on the civil date, LATEST sample wins
// (matches what the scale app displays); fallback — daily rollup day-average.
function ghDayWeight(tok, ds, ns) {
  try {
    var url = 'https://health.googleapis.com/v4/users/me/dataTypes/weight/dataPoints';
    var pageToken = '', pages = 0, bestT = '', bestG = 0, seen = [];
    do {
      var r = UrlFetchApp.fetch(url + (pageToken ? '?pageToken=' + encodeURIComponent(pageToken) : ''), {
        headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
        muteHttpExceptions: true,
      });
      if (r.getResponseCode() !== 200) { Logger.log('Health API weight (' + ds + '): ' + r.getContentText().slice(0, 300)); return null; }
      var data = JSON.parse(r.getContentText());
      (data.dataPoints || []).forEach(function (pt) {
        var w = pt.weight || {};
        var ct = w.sampleTime && w.sampleTime.civilTime && w.sampleTime.civilTime.date;
        if (!ct) return;
        var pds = ct.year + '-' + ('0' + ct.month).slice(-2) + '-' + ('0' + ct.day).slice(-2);
        if (pds !== ds) return;
        var tm = (w.sampleTime.civilTime && w.sampleTime.civilTime.time) || {};
        var t = ('0' + (tm.hours || 0)).slice(-2) + ':' + ('0' + (tm.minutes || 0)).slice(-2) + ':' + ('0' + (tm.seconds || 0)).slice(-2);
        var g = Number(w.weightGrams || 0);
        if (g > 0) {
          seen.push(t + ' → ' + Math.round(g / 453.592 * 10) / 10 + ' lb');
          if (t >= bestT) { bestT = t; bestG = g; }
        }
      });
      pageToken = data.nextPageToken || '';
      pages++;
    } while (pageToken && pages < 20);
    if (seen.length) Logger.log('Weight samples ' + ds + ' (latest wins): ' + seen.join(' · '));
    if (bestG > 0) return Math.round(bestG / 453.592 * 10) / 10;
  } catch (e) { Logger.log('Health API weight error: ' + e); }
  var pts = ghRollupPoints(tok, 'weight', ds);
  if (pts) {
    for (var i = 0; i < pts.length; i++) {
      var w = pts[i].weight || {};
      var g = Number(w.weightGramsAvg || w.weightGrams || 0);
      if (g > 0) return Math.round(g / 453.592 * 10) / 10;
    }
  }
  return null;
}

// Raw rollupDataPoints for one civil day (null on error).
function ghRollupPoints(tok, kebab, ds) {
  try {
    var p = ds.split('-').map(Number);
    var body = {
      range: {
        start: { date: { year: p[0], month: p[1], day: p[2] }, time: { hours: 0, minutes: 0, seconds: 0 } },
        end: { date: { year: p[0], month: p[1], day: p[2] }, time: { hours: 23, minutes: 59, seconds: 59 } },
      },
      windowSizeDays: 1,
    };
    var resp = UrlFetchApp.fetch('https://health.googleapis.com/v4/users/me/dataTypes/' + kebab + '/dataPoints:dailyRollUp', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) { Logger.log('Health rollup ' + kebab + ' (' + ds + '): ' + resp.getContentText().slice(0, 300)); return null; }
    return JSON.parse(resp.getContentText()).rollupDataPoints || [];
  } catch (e) { Logger.log('Health rollup error ' + kebab + ': ' + e); return null; }
}

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
  sh.appendRow([now, today, obj.day || '', 'capture-attested', code, String(obj.kind || ''),
    String(obj.video_sha256 || ''), (obj.photo_sha256s || []).join(' '), obj.weight || '', status]);
  return jsonOut({ ok: true, status: status });
}

/* AP-assigned meal plan (optional): add a row per date in the 'Meal Plan' tab —
   date (yyyy-MM-dd) · meal (free text, stamped on the photo) · labels (comma
   list the camera can recognize). Reliable label words: broccoli, cauliflower,
   cabbage, cucumber, zucchini, squash, bell pepper, mushroom, artichoke, corn,
   banana, orange, lemon, strawberry, pineapple, fig, pomegranate, pizza,
   cheeseburger, hotdog, burrito, meat loaf, mashed potato, carbonara, spaghetti,
   bagel, pretzel, dough, potpie, soup, plate, tray, frying pan, wok. */
function mealPlanSheet() {
  var s = ss();
  var sh = s.getSheetByName('Meal Plan');
  if (!sh) {
    sh = s.insertSheet('Meal Plan');
    sh.appendRow(['date', 'meal', 'labels']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    var p = sh.protect().setDescription('AP-assigned meal plan');
    p.removeEditors(p.getEditors().filter(function (ed) { return ed.getEmail() !== Session.getEffectiveUser().getEmail(); }));
    sh.setTabColor('#B3261E');
  }
  return sh;
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importPhotos').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('abandonmentCheck').timeBased().atHour(23).everyDays(1).create();
  ScriptApp.newTrigger('nightlyComplianceCheck').timeBased()
    .everyDays(1).atHour(22).inTimezone('America/New_York').create();
  // Fitbit activity sync via Google Health API — every 6 hours once connected.
  if (PropertiesService.getScriptProperties().getProperty('HEALTH_REFRESH')) {
    ScriptApp.newTrigger('fitbitSync').timeBased().everyHours(6).create();
  }
  // GitHub photo mirror — own-domain image hosting (replaces the Wix mirror).
  if (PropertiesService.getScriptProperties().getProperty('GH_TOKEN')) {
    ScriptApp.newTrigger('githubMirrorPhotos').timeBased().everyMinutes(15).create();
  }
  // Record backup — monthly snapshot of all record sheets into a dated Drive folder.
  ScriptApp.newTrigger('backupRecord').timeBased()
    .onMonthDay(1).atHour(3).inTimezone('America/New_York').create();
  // AP weekly review — Sunday morning digest + checklist email.
  ScriptApp.newTrigger('apWeeklyReview').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(9).inTimezone('America/New_York').create();
  photosFolder();
  mealPlanSheet();
}

/* ──────────── RECORD BACKUP (monthly, 1st @ 3 AM ET) ────────────
   Copies every record spreadsheet into "MRB Record Backups/YYYY-MM" in the
   AP's Drive. Photos/videos already live in Drive (the archive of record);
   this protects the SHEETS — the part that could be corrupted by a bad edit
   or script bug — with immutable dated snapshots. Emails the AP a receipt,
   including a reminder to pull a quarterly OFFLINE copy (Google Takeout) so
   the record also survives account loss. Run `backupRecord` once to test. */

function backupRecord() {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty('BACKUP_FOLDER_ID');
  var root;
  if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (e) { root = null; } }
  if (!root) {
    root = DriveApp.createFolder('MRB Record Backups');
    props.setProperty('BACKUP_FOLDER_ID', root.getId());
  }
  var stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM');
  var folder = root.createFolder(stamp + ' — ' + Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm'));

  var ids = {
    'MRB Accountability (all record tabs)': CONFIG.WEIGHINS_ID,
  };
  var lines = [];
  Object.keys(ids).forEach(function (name) {
    try {
      DriveApp.getFileById(ids[name]).makeCopy(name + ' — ' + stamp, folder);
      lines.push('✓ ' + name);
    } catch (err) {
      lines.push('✗ ' + name + ' — ' + err);
    }
  });

  var photoCount = 0;
  try {
    var it = photosFolder().getFiles();
    while (it.hasNext()) { it.next(); photoCount++; }
  } catch (e) {}

  MailApp.sendEmail({
    to: AP_EMAIL,
    subject: 'MRB record backup — ' + stamp,
    body: 'Monthly snapshot complete.\n\n' + lines.join('\n') +
      '\n\nPhoto archive: ' + photoCount + ' file(s) in the Drive folder (already the archive of record — not copied).\n' +
      'Backup folder: ' + folder.getUrl() +
      '\n\nQUARTERLY REMINDER: once a quarter, download an offline copy of the backup folder + photo folder (Drive → right-click → Download, or Google Takeout) and keep it somewhere outside this Google account. The record should survive even account loss.\n\nAutomated message from the site Apps Script.',
  });
}

/* ──────────── AP WEEKLY REVIEW (Sundays 9 AM ET) ────────────
   The governance heartbeat: a digest of the week's record plus the standing
   checklist, so AP review is a 5-minute ritual instead of a vague duty.
   Run `apWeeklyReview` once to test. */

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
    var pv = penaltiesSheet().getDataRange().getValues();
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
      '2. Unresolved violations: administer per the Penalty Schedule; mark resolved when done.\n' +
      '3. Spot-check one day\u2019s video + photos for documentation standard (§4).\n' +
      '4. Confirm the site is up and showing current data: https://michealrayberry.com\n' +
      '5. Note anything worth recording in the Updates log.\n\n' +
      'Tracker: https://docs.google.com/spreadsheets/d/' + CONFIG.WEIGHINS_ID +
      '\nAutomated message from the site Apps Script.',
  });
}

/* ──────── GITHUB MEDIA MIRROR — SEO photo hosting on michealrayberry.com ────────
   Replaces the Wix Media mirror (kept below, dormant). Photos are committed to
   the site's GitHub repo under /photos/ with descriptive filenames; Netlify
   auto-deploys, so each photo serves from https://michealrayberry.com/photos/...
   — own-domain image URLs (best for image SEO) and a permanent, versioned
   photo archive in the repo. Videos are NOT mirrored (GitHub file-size limits);
   they stay on Drive/YouTube.

   SETUP (AP, once)
     1. github.com → Settings → Developer settings → Fine-grained tokens →
        Generate: repository access = michealrayberry/michealrayberry.com only,
        Permissions → Contents: Read and write.
     2. In the Apps Script editor run:  setGithubToken('PASTE_TOKEN')
     3. Run `githubMirrorTest` — it mirrors ONE photo and logs the result.
     4. Run `setup` to refresh triggers (installs the 15-min github mirror). */

var GH_REPO = 'michealrayberry/michealrayberry.com';
var GH_BRANCH = 'main';
var GH_MAX_PER_RUN = 6;

function setGithubToken(token) {
  PropertiesService.getScriptProperties().setProperty('GH_TOKEN', String(token || '').trim());
  Logger.log('GitHub token stored.');
}

/* Photo commits carry [skip netlify] so they do NOT each burn a Netlify build.
   Instead, ONE production deploy per day is triggered by the nightly check via
   a Netlify Build Hook. Setup: Netlify → Project configuration → Build & deploy
   → Continuous deployment → Build hooks → Add (name: nightly, branch: main),
   copy the URL, then run:  setNetlifyBuildHook('https://api.netlify.com/build_hooks/…') */
function setNetlifyBuildHook(url) {
  PropertiesService.getScriptProperties().setProperty('NETLIFY_HOOK', String(url || '').trim());
  Logger.log('Netlify build hook stored.');
}

function netlifyDeploy() {
  var h = PropertiesService.getScriptProperties().getProperty('NETLIFY_HOOK');
  if (!h) return;
  try {
    UrlFetchApp.fetch(h, { method: 'post', payload: '{}', muteHttpExceptions: true });
    Logger.log('Netlify deploy triggered.');
  } catch (e) {
    Logger.log('Netlify deploy hook failed: ' + e);
  }
}

function githubPutPhoto(path, bytes, message) {
  var token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!token) return null;
  var resp = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/contents/' + encodeURIComponent(path).replace(/%2F/g, '/'), {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
    payload: JSON.stringify({ message: message + ' [skip netlify]', content: Utilities.base64Encode(bytes), branch: GH_BRANCH }),
  });
  var code = resp.getResponseCode();
  if (code === 201 || code === 200) return true;
  if (code === 422 && resp.getContentText().indexOf('sha') !== -1) return true; // already exists — first file per slot is final
  Logger.log('GitHub put failed (' + code + ') for ' + path + ': ' + resp.getContentText().slice(0, 300));
  return false;
}

function githubMirrorPhotos() {
  if (!PropertiesService.getScriptProperties().getProperty('GH_TOKEN')) return;
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();
  var sent = 0;
  for (var i = 1; i < vals.length && sent < GH_MAX_PER_RUN; i++) {
    var d = vals[i][0];
    var dateStr = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (!dateStr) continue;
    for (var col in WIX_ANGLE_BY_COL) {
      if (sent >= GH_MAX_PER_RUN) break;
      col = Number(col);
      var url = String(vals[i][col - 1] || '').trim();
      if (!url || url.indexOf('drive.google.com') === -1) continue; // empty or already mirrored
      var fileId = wixDriveIdFromUrl(url);
      if (!fileId) continue;
      var angle = WIX_ANGLE_BY_COL[col];
      var name = 'micheal-ray-berry-day-' + String(wixDayNum(dateStr)).padStart(3, '0') + '-' + angle + '-' + dateStr + '.jpg';
      try {
        var bytes = DriveApp.getFileById(fileId).getBlob().getBytes();
        if (githubPutPhoto('photos/' + name, bytes, 'Daily photo: ' + name)) {
          var publicUrl = 'https://michealrayberry.com/photos/' + name;
          sh.getRange(i + 1, col).setValue(publicUrl);
          mirrorLogSheet().appendRow([dateStr, angle, url, publicUrl, new Date()]);
          sent++;
        }
      } catch (err) {
        Logger.log('GitHub mirror error for ' + name + ': ' + err);
      }
    }
  }
  if (sent) Logger.log('GitHub mirror: ' + sent + ' photo(s) committed.');
}

// Mirrors exactly one photo and logs everything — run before enabling the trigger.
function githubMirrorTest() {
  if (!PropertiesService.getScriptProperties().getProperty('GH_TOKEN')) { Logger.log('Run setGithubToken first.'); return; }
  var vals = weighinsSheet().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var url = String(vals[i][3] || '').trim();
    if (!url || url.indexOf('drive.google.com') === -1) continue;
    var d = vals[i][0];
    var dateStr = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    var name = 'micheal-ray-berry-day-' + String(wixDayNum(dateStr)).padStart(3, '0') + '-front-' + dateStr + '.jpg';
    Logger.log('Committing ' + name);
    var ok = githubPutPhoto('photos/' + name, DriveApp.getFileById(wixDriveIdFromUrl(url)).getBlob().getBytes(), 'Daily photo (test): ' + name);
    Logger.log(ok ? 'OK — will serve at https://michealrayberry.com/photos/' + name + ' after the Netlify deploy.' : 'FAILED — see log above.');
    return;
  }
  Logger.log('No un-mirrored Drive photo found to test with.');
}

// Mirror Log: date · angle · Drive URL · public URL · timestamp (used by the GitHub mirror).
// Filename helpers (kept from the retired Wix mirror — same names, same output).
var WIX_ANGLE_BY_COL = { 4: 'front', 5: 'left', 6: 'rear', 7: 'right' };
function wixDayNum(dateStr) {
  var start = new Date('2026-07-20T00:00:00');
  var d = new Date(dateStr + 'T00:00:00');
  return Math.floor((d - start) / 864e5) + 1;
}
function wixDriveIdFromUrl(url) {
  var m = String(url).match(/[?&]id=([\w-]+)/) || String(url).match(/\/d\/([\w-]+)/);
  return m ? m[1] : null;
}
function mirrorLogSheet() {
  var s = ss();
  var sh = s.getSheetByName('Mirror Log');
  if (!sh) {
    sh = s.insertSheet('Mirror Log');
    sh.appendRow(['date', 'angle', 'drive_url', 'wix_url', 'mirrored_at']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  return sh;
}
/* ─────────────────────────────── HELPERS ─────────────────────────────── */


function ss() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(CONFIG.WEIGHINS_ID);
}
function weighinsSheet() { return ss().getSheetByName('Weigh-ins') || ss().getSheets()[0]; }
function penaltiesSheet() { return ss().getSheetByName('Penalty Log'); }

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────── AP PORTAL (michealrayberry.com/ap) ─────────────────────────
   Operator console for the Accountability Partner: daily packet review, violation
   declare/resolve, position grading, corrective assignments, one-tap deploy.
   Auth: a SEPARATE key from Micheal's record key. Unlike the packet key, the AP
   endpoints are CLOSED until a key is set — run setApKey('LONG-RANDOM-STRING')
   here once, then enter that key in the portal on the AP's device. Never give
   this key to Micheal. */
function setApKey(k) {
  PropertiesService.getScriptProperties().setProperty('AP_KEY', String(k || '').trim());
  Logger.log('AP key stored.');
}
function apOk(k) {
  var stored = PropertiesService.getScriptProperties().getProperty('AP_KEY');
  return !!stored && String(k || '').trim() === stored;
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

function apDateStr(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd') : String(v || '').trim();
}

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
      out.health = { steps: hv[h][1] || 0, zone: hv[h][2] || 0, mi: hv[h][5] || 0, cal: hv[h][6] || 0, wt: hv[h][7] || '' };
      break;
    }
  }
  var pv = penaltiesSheet().getDataRange().getValues();
  out.violations = [];
  for (var p = 1; p < pv.length; p++) {
    if (!pv[p][0]) continue;
    out.violations.push({ row: p + 1, date: apDateStr(pv[p][0]), violation: String(pv[p][1] || ''), status: String(pv[p][2] || '') });
  }
  out.mealLibrary = mealLibrary();
  out.mealPlan = [];
  var mpv = mealPlanSheet().getDataRange().getValues();
  var mpByDate = {};
  for (var m2 = 1; m2 < mpv.length; m2++) { var mds2 = apDateStr(mpv[m2][0]); if (mds2) mpByDate[mds2] = String(mpv[m2][1] || ''); }
  for (var k2 = 0; k2 < 7; k2++) {
    var dd = new Date(); dd.setDate(dd.getDate() + k2);
    var dds2 = Utilities.formatDate(dd, 'America/New_York', 'yyyy-MM-dd');
    out.mealPlan.push({ date: dds2, meal: mpByDate[dds2] || '' });
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

function handleApAction(obj) {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  try {
    if (obj.action === 'apviolation') {
      var sh = penaltiesSheet();
      if (obj.op === 'declare') { sh.appendRow([String(obj.date || today), String(obj.violation || 'Violation Event'), 'Unresolved']); return jsonOut({ ok: true }); }
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
      updatesSheetByGid().appendRow([today, 'official', String(obj.title || ''), String(obj.body || ''), String(obj.link || '')]);
      return jsonOut({ ok: true });
    }
    if (obj.action === 'apmeal') {
      if (obj.op === 'assign' && obj.date) {
        var lib2 = mealLibrary(), labels = 'plate';
        for (var li = 0; li < lib2.length; li++) if (lib2[li].name === obj.meal) labels = lib2[li].labels;
        var mp = mealPlanSheet(), mv = mp.getDataRange().getValues(), done = false;
        for (var mi = 1; mi < mv.length; mi++) {
          var mds = mv[mi][0] instanceof Date ? Utilities.formatDate(mv[mi][0], 'America/New_York', 'yyyy-MM-dd') : String(mv[mi][0]).trim();
          if (mds === String(obj.date)) { mp.getRange(mi + 1, 1, 1, 3).setValues([[String(obj.date), String(obj.meal || ''), obj.meal ? labels : '']]); done = true; break; }
        }
        if (!done && obj.meal) mp.appendRow([String(obj.date), String(obj.meal), labels]);
        return jsonOut({ ok: true });
      }
      if (obj.op === 'regen') { assignWeeklyMeals(true); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apdeploy') { netlifyDeploy(); return jsonOut({ ok: true, deployed: true }); }
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ─────────────────── ABANDONMENT (§11) — staged dead-man's switch ───────────────────
   §11: thirty consecutive Project Days without required documentation, or any
   attempt to delete/conceal the record, terminates the project as ABANDONED.
   Stages: '' (normal) → 'presumed' (auto at 30 missed days, or AP-set) →
   'confirmed' (AP ONLY — permanent takeover on the site). The medical exception
   (§9) is why confirmation is manual: presumed pauses the record's face; only
   the AP makes it permanent. State lives in the key/value 'Site State' tab,
   which the site reads live — no deploy needed for stage changes. */
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
function stateSet(k, val) {
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
    MailApp.sendEmail(AP_EMAIL, 'ABANDONMENT PRESUMED — 30 consecutive missed days (§11)',
      'The record has had ' + streak + ' consecutive days without a complete Daily Compliance Packet.\n\n' +
      'The site now shows PRESUMED ABANDONED. Per §11 this becomes permanent only on your confirmation ' +
      '(medical exception, §9, is the reason confirmation is manual).\n\n' +
      'Confirm or clear in the AP Portal: https://michealrayberry.com/ap');
    return;
  }
  if ((streak === 7 || streak === 14 || streak === 21) && stage !== 'presumed') {
    MailApp.sendEmail(AP_EMAIL, 'Abandonment warning — ' + streak + ' consecutive missed days',
      streak + ' consecutive days without a complete packet. At 30, the site automatically enters ' +
      'PRESUMED ABANDONED (§11). Portal: https://michealrayberry.com/ap');
  }
}

/* Updates tab is targeted by gid (the site reads gid=742923954) so AP posts
   land on the exact tab the site renders, whatever it was named. */
function updatesSheetByGid() {
  var sheets = ss().getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getSheetId() === 742923954) return sheets[i];
  var sh = ss().getSheetByName('Updates');
  if (!sh) { sh = ss().insertSheet('Updates'); sh.appendRow(['date', 'type', 'title', 'body', 'link']); sh.setFrozenRows(1); }
  return sh;
}

/* §6.3 watcher: consecutive days at or under 175.0. Emails the AP at 14, 21,
   and 28 — at 28 the completion condition is met pending the official weigh-in
   (declared manually in the AP Portal, never automatically). */
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
    if (w2 === undefined || w2 > 175.0) { if (k === 0) { d.setDate(d.getDate() - 1); continue; } break; } // today may not be filed yet
    streak++;
    d.setDate(d.getDate() - 1);
  }
  if (streak === 14 || streak === 21 || streak >= 28) {
    var key = 'COMPLETION_ALERT_' + (streak >= 28 ? 28 : streak);
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(key)) return;
    props.setProperty(key, '1');
    MailApp.sendEmail(AP_EMAIL,
      streak >= 28 ? 'COMPLETION CONDITION MET — 28 days at/under 175 (§6.3)' : 'Completion watch — ' + streak + ' days at/under 175',
      streak >= 28
        ? 'The tracker shows 28 consecutive days at or under 175.0 lbs.\n\nSchedule the official on-camera completion weigh-in (§6.3). Once verified, declare completion in the AP Portal: https://michealrayberry.com/ap'
        : streak + ' consecutive days at or under 175.0 lbs. At 28, the completion condition is met pending the official weigh-in.');
  }
}

/* ─────────────── PREAPPROVED DINNER PLAN ───────────────
   'Meal Library' = the AP-curated approved dinners (labels must be classes the
   recorder's on-device food check can detect). assignWeeklyMeals rotates the
   library across the coming week every Sunday 5 PM; the AP overrides any day
   from the portal. The recorder already reads the Meal Plan tab and attests
   plan-confirmed / plan-NOT-confirmed — off-plan is EVIDENCE for the AP (§8),
   not an automatic violation (§7 covers documentation failures only). */
function mealLibrarySheet() {
  var s = ss();
  var sh = s.getSheetByName('Meal Library');
  if (!sh) {
    sh = s.insertSheet('Meal Library');
    sh.appendRow(['meal', 'labels', 'portion_note', 'active']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    [['Grilled chicken breast, steamed vegetables', 'plate', 'physician-guided portion', 'yes'],
     ['Baked fish, roasted vegetables', 'plate', 'physician-guided portion', 'yes'],
     ['Vegetable soup, side salad', 'soup, plate', 'one bowl', 'yes'],
     ['Lean meat loaf, mashed potatoes', 'meat loaf, mashed potato, plate', 'small portion', 'yes'],
     ['Turkey chili', 'soup', 'one bowl', 'yes'],
     ['Lean-protein stir-fry', 'wok, frying pan, plate', 'physician-guided portion', 'yes'],
     ['Grilled steak, side salad', 'plate', 'physician-guided portion', 'yes']].forEach(function (r) { sh.appendRow(r); });
    sh.setTabColor('#141412');
  }
  return sh;
}
function mealLibrary() {
  var v = mealLibrarySheet().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] && String(v[i][3]).toLowerCase() !== 'no') out.push({ name: String(v[i][0]), labels: String(v[i][1] || 'plate'), note: String(v[i][2] || '') });
  }
  return out;
}
// Fills the next 7 days' dinner from the library rotation (keyed to project day,
// so the sequence is stable). force=true also re-applies to FUTURE days that
// already have an assignment (today and past are never touched by force).
function assignWeeklyMeals(force) {
  var lib = mealLibrary();
  if (!lib.length) return;
  var sh = mealPlanSheet();
  var vals = sh.getDataRange().getValues();
  var rowByDate = {};
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    if (ds) rowByDate[ds] = i + 1;
  }
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  for (var k = 0; k < 7; k++) {
    var d = new Date(); d.setDate(d.getDate() + k);
    var ds2 = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
    var dayNum = Math.floor((new Date(ds2) - new Date(PROJECT_START)) / 864e5);
    var pick = lib[((dayNum % lib.length) + lib.length) % lib.length];
    if (rowByDate[ds2]) {
      if (force && ds2 > today) sh.getRange(rowByDate[ds2], 1, 1, 3).setValues([[ds2, pick.name, pick.labels]]);
    } else {
      sh.appendRow([ds2, pick.name, pick.labels]);
      rowByDate[ds2] = sh.getLastRow();
    }
  }
}

// True if today's Weigh-ins row has a weight and all four angle photos.
function isPacketComplete() {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var vals = weighinsSheet().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    if (ds === today) {
      var photos = 0; for (var c = 3; c <= 6; c++) if (vals[i][c]) photos++;
      return !!(parseFloat(vals[i][1]) && photos === 4);
    }
  }
  return false;
}
