/* PROJECT_CONFIG:BEGIN — generated; edit project-config-v2.json, then npm run sync-config. */
var PROJECT_FACTS = {
  "schemaVersion": 1,
  "edition": 2,
  "person": "Micheal Ray Berry",
  "siteOrigin": "https://michealrayberry.com",
  "startDate": "2026-10-11",
  "testStartDate": "2026-10-03",
  "startWeightLb": 340,
  "goalWeightLb": 200,
  "completionDays": 28,
  "milestonesLb": [
    320,
    300,
    275,
    250,
    225,
    200
  ],
  "deadlineEt": "22:00",
  "supervision": {
    "section": "3.4",
    "startDate": "2026-10-11",
    "nights": [
      0,
      1,
      2,
      3,
      4
    ],
    "startEt": "18:00",
    "endEt": "22:00",
    "publicLiveEnabled": true,
    "twitchChannel": "michealrayberry"
  },
  "amendmentSection": "12.1",
  "correctionMinutes": [
    10,
    20,
    30
  ]
};
/* PROJECT_CONFIG:END */

/**
 * MRB Public Accountability Project — record engine
 * ═══════════════════════════════════════════════════════════════════
 * ONE private operations workbook holds the mixed record; this script writes
 * to it, guards it with two keys, and runs every scheduled check. The website
 * never reads that workbook directly: the build emits minimized, validated,
 * same-origin feeds and separately verified public derivatives.
 *
 * FIRST RUN (fresh start)
 *   1. Open this script in the AP's Google account and paste this file in.
 *   2. Run  createRecordSpreadsheet()  — builds a brand-new PRIVATE operations
 *      workbook with every tab, header, and format. Never publish that mixed
 *      workbook or give the browser its identifier.
 *   3. Run  setApKey('LONG-RANDOM')  and  setDeviceKey('LONG-RANDOM').
 *   4. Run  setup()  — installs all triggers.
 *   5. Run  showPhotosFolderUrl()  and put the URL only in the private runbook.
 *      Add only named collaborators; the script enforces PRIVATE sharing and
 *      disables editor resharing for raw intake.
 *   6. Configure the deployed /exec URL, workbook identifier, and keys only in
 *      the private runbook/host environment. Public clients consume same-origin
 *      sanitized build feeds and published derivatives, never raw Drive links
 *      or direct CSV exports from the operations workbook.
 * ═══════════════════════════════════════════════════════════════════
 */

var CONFIG = {
  /* Operational identifiers do not belong in this public source file.
     createRecordSpreadsheet()/setSheetId() stores this in Script Properties. */
  SHEET_ID: '',
};

var AP_EMAIL = 'ap@michealrayberry.com';
var MRB_EMAIL = 'contact@michealrayberry.com';
var PROJECT_START_FALLBACK = PROJECT_FACTS.startDate;
var TEST_START_FALLBACK = PROJECT_FACTS.testStartDate;
var AGREEMENT_EDITION = PROJECT_FACTS.edition;
/* Public supervision video switch. ON by user ruling, Oct 3 2026: /live/ embeds
   the Twitch live stream (twitch.tv/michealrayberry) during a confirmed session and the homepage carries
   the Evening Supervision module. Agreement execution still gates whether any
   session is REQUIRED. */
var PUBLIC_SUPERVISION_VIDEO_ENABLED = PROJECT_FACTS.supervision.publicLiveEnabled;
/* Day 1 of the CURRENT attempt. The Site State key `start_date` overrides the
   fallback (cached 5 min), so a restart is ONE sheet edit — script, publisher,
   and SPA all read the same cell. */
var PROJECT_LAUNCH = (function () {
  try {
    var c = CacheService.getScriptCache().get('mrb_start_date');
    if (c === PROJECT_START_FALLBACK) return c;
    // Module loading must be read-only. Setup/migration helpers create and
    // protect sheets deliberately; a gate-adjacent read never does so.
    var stateSheet = ssReadOnly().getSheetByName('Site State');
    if (!stateSheet) return PROJECT_START_FALLBACK;
    var vals = stateSheet.getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() !== 'start_date') continue;
      var v = vals[i][1];
      var ds = v instanceof Date ? Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd') : String(v || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) { CacheService.getScriptCache().put('mrb_start_date', ds, 300); return ds; }
    }
  } catch (e) {}
  return PROJECT_START_FALLBACK;
})();
/* Testing phase (Oct 2026). While today < start_date (official Day 1) and
   Site State test_mode is not "off", the system runs from test_start_date as
   if the agreement were active: checks run, violations are declared, emails
   are sent with a [TEST] prefix and T-n day labels. It ends by itself on the
   launch date — PROJECT_START becomes the official Day 1 and every earlier row
   moves to the permanent public test archive (never counted in official totals). */
var TEST_STATE = (function () {
  var out = { mode: '', start: TEST_START_FALLBACK };
  try {
    var c = CacheService.getScriptCache().get('mrb_test_state');
    if (c) return JSON.parse(c);
    var sh = ssReadOnly().getSheetByName('Site State');
    if (sh) {
      var vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) {
        var k = String(vals[i][0]).trim(), v = vals[i][1];
        var s = v instanceof Date ? Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd') : String(v || '').trim();
        if (k === 'test_mode') out.mode = s.toLowerCase();
        if (k === 'test_start_date' && /^\d{4}-\d{2}-\d{2}$/.test(s)) out.start = s;
      }
    }
    CacheService.getScriptCache().put('mrb_test_state', JSON.stringify(out), 300);
  } catch (e) {}
  return out;
})();
function testPhaseActive(today) {
  today = today || Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  return PROJECT_LAUNCH === PROJECT_FACTS.startDate && TEST_STATE.start === PROJECT_FACTS.testStartDate && TEST_STATE.mode !== 'off' && TEST_STATE.start < PROJECT_LAUNCH &&
    TEST_STATE.start <= today && today < PROJECT_LAUNCH;
}
var TEST_PHASE = testPhaseActive();
var PROJECT_START = TEST_PHASE ? TEST_STATE.start : PROJECT_LAUNCH;
var TEST_SPAN = Math.round((new Date(PROJECT_LAUNCH) - new Date(TEST_STATE.start)) / 864e5);
function testLabels(text) {
  if (!TEST_PHASE) return text;
  return String(text).replace(/\b(Day|DAY) (\d{1,3})\b/g, function (m, w, d) {
    var n = Number(d);
    if (n < 1 || n > TEST_SPAN) return m;
    var t = 'T-' + (TEST_SPAN - n + 1);
    return w === 'DAY' ? t.toUpperCase() : t;
  });
}
var WEIGHT_AUTO_START = '2026-07-30'; // date the scale began writing weights

/* Tabs, in creation order. The headers are the contract between this
   script and the website — never reorder columns, only append. */
var TABS = {
  'Weigh-ins':      ['date', 'weight_lb', 'note', 'photo_front', 'photo_left', 'photo_rear', 'photo_right', 'video', 'video_sec'],
  /* The public record, exactly as the site renders it. Status is normalised
     on the site to open / corrected / resolved, so column C may hold the AP's
     own phrasing. 'corrections' is an append-only, semicolon-separated
     history — never rewrite an earlier note, add another. 'recording' holds
     the public URL of the corrective session filed against the entry; the
     site publishes it beside the entry (§8). */
  'Violation Log':  ['date', 'violation', 'status', 'submitted', 'resolved', 'ap_verification', 'corrections', 'recording', 'event_verification'],
  'Attestation':    ['logged_at_server', 'date', 'day', 'event', 'code', 'kind', 'video_sha256', 'photo_sha256s', 'weight', 'status', 'chunk_chain', 'chunk_count', 'server_seal', 'sealed_at'],
  'Corrective Log': ['date', 'assignment', 'due', 'status', 'completed', 'assignment_id'],
  /* type: official (AP entry) | personal (Micheal's note) | amendment (\u00a712.1 — also
     rendered on the agreement page's amendment log). */
  'Updates':        ['date', 'type', 'title', 'body', 'link'],
  'Site State':     ['key', 'value'],
  /* Written by withingsSync (weight only). The activity columns are legacy
     spacing kept so weight_lb stays column H for the site's readers. */
  'Health':         ['date', 'steps', 'zone_minutes', 'active_minutes', 'synced_at', 'distance_mi', 'calories', 'weight_lb'],
  'Weekly Log':     ['logged_at', 'date', 'week', 'documented', 'required', 'weight_lb', 'open_entries', 'url'],
  'Confirmations':  ['logged_at', 'date', 'version', 'day', 'url', 'attestation_seal'],
  /* §3.4 Evening Supervision — one row per scheduled night once filed or ruled.
     status: SUBMITTED · COMPLETED · MISSED · EXCEPTION · <reason>.
     The legacy File-tool path may write only SUBMITTED + stream_url when its
     independent safety switch is deliberately enabled; only an AP ruling may
     verify COMPLETED. Public output receives sanitized status only. */
  'Supervision':    ['date', 'required', 'status', 'start', 'end', 'stream_url', 'note'],
  /* Observer submissions relayed by action 'observer' (shared secret
     OBSERVER_SECRET). The Cloudflare /api/observer relay accepts validated Turnstile submissions. AP-only; never read
     by the site. review = received | dismissed | verified | published | actioned. */
  'Observer':       ['received_at', 'type', 'message', 'name', 'email', 'source_url', 'quotable', 'review', 'ap_note'],
};

/* §3.4: nights preceding a scheduled workday — Sun–Thu — 18:00–22:00 ET,
   from the versioned Edition 2 start date, or the explicit test start while testing. The nightly check at 22:20 rules on the night. */
var SUPERVISION_START = TEST_PHASE ? TEST_STATE.start : PROJECT_FACTS.supervision.startDate;
var SUPERVISION_NIGHTS = PROJECT_FACTS.supervision.nights; // JS getDay: Sun=0 … Thu=4
function supervisionScheduled(ds) {
  if (ds < SUPERVISION_START) return false;
  var a = ds.split('-').map(Number);
  var dow = new Date(Date.UTC(a[0], a[1] - 1, a[2], 12)).getUTCDay();
  return SUPERVISION_NIGHTS.indexOf(dow) !== -1;
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
  requirePrivateDriveItem(DriveApp.getFileById(id), 'operations workbook');

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
    'Confirmations': '#6B6A64', 'Health': '#6B6A64', 'Site State': '#141412', 'Supervision': '#B3261E', 'Observer': '#6B6A64' };
  for (var tc in TAB_COLORS) { var tsh = file.getSheetByName(tc); if (tsh) tsh.setTabColor(TAB_COLORS[tc]); }
  file.getSheetByName('Weigh-ins').setColumnWidth(1, 110);
  file.getSheetByName('Violation Log').setColumnWidth(2, 460);
  file.getSheetByName('Corrective Log').setColumnWidth(2, 380);
  // Fresh records receive an explicit start_date row. Existing workbooks must
  // add or verify this value deliberately; the execution gate never falls
  // back to a code constant when the state row is missing or malformed.
  file.getSheetByName('Site State').appendRow(['start_date', PROJECT_START_FALLBACK]);

  PropertiesService.getScriptProperties().setProperty('SHEET_ID', id);
  protectAgreementControlSheets();

  var lines = ['', '════════ NEW PRIVATE OPERATIONS WORKBOOK ════════',
    'SHEET ID: ' + id,
    'URL:      ' + file.getUrl(),
    '',
    'Store these details only in the private operations runbook.',
    'Do not paste this ID or a direct workbook export into browser code.',
    'Configure the build to publish only schema-validated, minimized same-origin feeds.'];
  var shs = file.getSheets();
  for (var s = 0; s < shs.length; s++) lines.push('  gid ' + shs[s].getSheetId() + '  → ' + shs[s].getName());
  lines.push('', 'Next: setApKey(...) · setDeviceKey(...) · setup() · showPhotosFolderUrl()');
  Logger.log(lines.join('\n'));
  return id;
}

/* ═════════════════════ CORE ACCESS ═════════════════════ */

function recordSheetId() {
  return PropertiesService.getScriptProperties().getProperty('SHEET_ID') || CONFIG.SHEET_ID;
}

function privateRecordUrl() {
  var id = recordSheetId();
  return id ? 'https://docs.google.com/spreadsheets/d/' + id : '';
}

function ss() {
  var id = recordSheetId();
  if (!id) throw new Error('No SHEET_ID — run createRecordSpreadsheet() first.');
  var recordFile;
  try { recordFile = DriveApp.getFileById(id); }
  catch (e) { throw new Error('Private Drive boundary unavailable; operations workbook cannot be verified'); }
  requirePrivateDriveItem(recordFile, 'operations workbook');
  return SpreadsheetApp.openById(id);
}

/* Authorization checks use a strictly read-only workbook accessor. A privacy
   mismatch fails closed and is repaired only by an explicit setup/diagnostic
   operation, never as a side effect of evaluating the agreement gate. */
function ssReadOnly() {
  var id = recordSheetId();
  if (!id) throw new Error('No SHEET_ID — run createRecordSpreadsheet() first.');
  var recordFile;
  try { recordFile = DriveApp.getFileById(id); }
  catch (e) { throw new Error('Private Drive boundary unavailable; operations workbook cannot be verified'); }
  try {
    if (recordFile.getSharingAccess() !== DriveApp.Access.PRIVATE || recordFile.isShareableByEditors()) {
      throw new Error('operations workbook is not already private with editor resharing disabled');
    }
  } catch (privacyError) {
    throw new Error('Private Drive boundary unavailable; refusing to authorize from the operations workbook: ' +
      String(privacyError && privacyError.message ? privacyError.message : privacyError));
  }
  return SpreadsheetApp.openById(id);
}

function readOnlyExactSheet(name) {
  var expected = TABS[name];
  if (!expected) throw new Error('unknown record sheet: ' + name);
  var sh = ssReadOnly().getSheetByName(name);
  if (!sh) throw new Error(name + ' sheet is missing; run setup before evaluating the agreement gate');
  var usedColumns = sh.getDataRange().getNumColumns();
  if (usedColumns !== expected.length) {
    throw new Error(name + ' schema requires exactly ' + expected.length + ' columns; run setup migration first');
  }
  var actual = sh.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] || '').trim() !== expected[i]) {
      throw new Error(name + ' schema mismatch at column ' + (i + 1));
    }
  }
  return sh;
}

/* Verify the setup-created agreement control without repairing it. Protection
   reads are part of the authorization boundary, so ambiguity (including two
   protections with the expected description) fails closed. Apps Script can
   omit the file owner from getEditors(); therefore the owner is allowlisted
   when present but is not required to appear in that returned list. */
function requireOwnerOnlyProtection(sh, firstColumn, numColumns, description) {
  if (!sh) throw new Error(description + ' protection sheet is unavailable');
  var expectedFirstColumn = Number(firstColumn);
  var expectedNumColumns = Number(numColumns);
  if (!isFinite(expectedFirstColumn) || Math.floor(expectedFirstColumn) !== expectedFirstColumn || expectedFirstColumn < 1 ||
      !isFinite(expectedNumColumns) || Math.floor(expectedNumColumns) !== expectedNumColumns || expectedNumColumns < 1) {
    throw new Error(description + ' protection range is invalid');
  }

  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(function (candidate) {
    return String(candidate.getDescription() || '') === description;
  });
  if (protections.length !== 1) {
    throw new Error(description + ' protection must exist exactly once; run setup before evaluating the agreement gate');
  }

  var protection = protections[0];
  var protectedRange = protection.getRange();
  if (!protectedRange || protectedRange.getSheet().getSheetId() !== sh.getSheetId() ||
      protectedRange.getRow() !== 1 || protectedRange.getColumn() !== expectedFirstColumn ||
      protectedRange.getNumRows() !== sh.getMaxRows() || protectedRange.getNumColumns() !== expectedNumColumns) {
    throw new Error(description + ' protection is bound to an unexpected range');
  }
  if (protection.isWarningOnly()) throw new Error(description + ' protection is warning-only');
  if (protection.canDomainEdit()) throw new Error(description + ' protection permits domain editing');

  var owner;
  try { owner = DriveApp.getFileById(sh.getParent().getId()).getOwner(); }
  catch (ownerLookupError) {
    throw new Error(description + ' protection owner cannot be verified');
  }
  var ownerEmail = owner && String(owner.getEmail() || '').trim().toLowerCase();
  if (!ownerEmail) throw new Error(description + ' protection owner cannot be verified');
  var editors = protection.getEditors();
  for (var i = 0; i < editors.length; i++) {
    var editorEmail = String(editors[i].getEmail() || '').trim().toLowerCase();
    if (!editorEmail || editorEmail !== ownerEmail) {
      throw new Error(description + ' protection grants an unexpected editor');
    }
  }
  return protection;
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

/* An adverse Violation Log row is operative only after a deliberate AP action
   writes a marker that is bound to the exact dated allegation. The digest is
   not a secret or an identity proof; it makes a copied marker or a later edit
   to the date/text fail closed. The AP-authenticated action remains the trust
   boundary. Columns E/F separately hold a bound AP resolution decision. */
var VIOLATION_EVENT_MARKER_VERSION = 'APV1';
function violationEventDigest(dateStr, violationText) {
  var date = isoDateInput(dateStr, 'violation date');
  var text = String(violationText == null ? '' : violationText).trim();
  if (!text) throw new Error('violation text is required');
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'violation-v1\n' + date + '\n' + text,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function violationEventMarker(dateStr, violationText, verifiedDate) {
  var date = isoDateInput(dateStr, 'violation date');
  var verified = isoDateInput(verifiedDate, 'event verification date');
  if (verified < date) throw new Error('event verification date precedes the violation date');
  return VIOLATION_EVENT_MARKER_VERSION + '|' + verified + '|' + violationEventDigest(date, violationText);
}

function publicViolationToken(marker) {
  var parts = String(marker || '').split('|');
  if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(parts[2])) return '';
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'public-violation-id-v1\n' + parts[2],
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('').slice(0, 12).toUpperCase();
}

function verifiedViolationDetails(row, gate) {
  if (!row || row.length < 9) return null;
  var date = apDateStr(row[0]);
  var text = String(row[1] == null ? '' : row[1]).trim();
  var marker = String(row[8] == null ? '' : row[8]).trim();
  if (!text || !/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(marker)) return null;
  var verified = marker.split('|')[1];
  try {
    date = isoDateInput(date, 'violation date');
    verified = isoDateInput(verified, 'event verification date');
  } catch (e) { return null; }
  if (verified < date) return null;
  if (gate && (!dateWithinAgreement(date, gate) || verified > gate.today)) return null;
  var expected;
  try { expected = violationEventMarker(date, text, verified); }
  catch (markerError) { return null; }
  return marker === expected ? { date: date, text: text, verifiedDate: verified, marker: marker } : null;
}

function isVerifiedViolationRow(row, gate) {
  return !!verifiedViolationDetails(row, gate);
}

/* Resolution is a second, AP-only decision. A status cell on its own is not
   evidence that an event was resolved: columns E and F must carry a valid
   resolution date and a marker bound to the immutable APV1 event marker.

   APR1 digest payload (UTF-8, exact newlines):
     violation-resolution-v1\n<APV1 marker>\n<YYYY-MM-DD resolution date> */
var VIOLATION_RESOLUTION_MARKER_VERSION = 'APR1';
function violationResolutionDigest(eventMarker, resolutionDate) {
  var marker = String(eventMarker || '').trim();
  if (!/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(marker)) {
    throw new Error('invalid event marker for resolution');
  }
  var date = isoDateInput(resolutionDate, 'resolution date');
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'violation-resolution-v1\n' + marker + '\n' + date,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function violationResolutionMarker(eventMarker, resolutionDate) {
  var date = isoDateInput(resolutionDate, 'resolution date');
  return VIOLATION_RESOLUTION_MARKER_VERSION + '|' + date + '|' +
    violationResolutionDigest(eventMarker, date);
}

function verifiedResolutionDetails(row, gate) {
  var event = verifiedViolationDetails(row, gate);
  // The protected APR1 evidence is authoritative. Column C is display text and
  // may be edited without being allowed to reopen or resolve the obligation.
  if (!event) return null;
  var date = apDateStr(row[4]);
  var marker = String(row[5] || '').trim();
  if (!/^APR1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(marker)) return null;
  try { date = isoDateInput(date, 'resolution date'); }
  catch (e) { return null; }
  if (date < event.date || date < event.verifiedDate) return null;
  if (gate && (date < gate.effectiveDate || date > gate.today)) return null;
  var expected;
  try { expected = violationResolutionMarker(event.marker, date); }
  catch (markerError) { return null; }
  return marker === expected ? { date: date, marker: marker, event: event } : null;
}

function isResolvedViolationRow(row, gate) {
  return !!verifiedResolutionDetails(row, gate);
}

/* Every server-side Violation Log check/write transition uses this one lock
   boundary. Callers must perform notifications and deploys only after it
   returns; calling another ScriptLock-taking helper from the callback would
   deadlock. A changed mutation is flushed before the lock is released. */
function withViolationLogMutation(mutator) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('violation log is busy; retry');
  try {
    var sh = violationLogSheet();
    var rows = sh.getDataRange().getValues();
    var result = mutator(sh, rows) || {};
    if (result.changed) SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* Shared lock boundary for mutations that are legal only while the agreement
   is active. The gate is re-read after acquiring the same ScriptLock used by
   activation/revocation, so a caller can never commit from a stale pre-prompt
   gate. Callbacks must not invoke another ScriptLock-taking helper. */
function withActiveAgreementMutation(context, mutator) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('agreement record is busy; retry');
  try {
    var gate = agreementExecutionState();
    if (!gate.active) throw new Error('agreement execution became inactive before ' + context);
    var result = mutator(gate) || {};
    if (result.changed) SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* Duplicate valid APV1 markers make ordering and consequence levels
   ambiguous. Reject the entire count instead of treating duplicate rows as
   separate violations or silently choosing one by sheet order. */
function verifiedViolationSummary(rows, gate) {
  var seen = {};
  var rankByMarker = {};
  var total = 0;
  var open = 0;
  for (var i = 1; i < rows.length; i++) {
    var details = verifiedViolationDetails(rows[i], gate);
    if (!details) continue;
    // The digest is the dated-event identity. A later verification date can
    // produce a different full APV1 string for the same event, but it must not
    // create another consequence or public identity.
    var eventIdentity = details.marker.split('|')[2];
    if (Object.prototype.hasOwnProperty.call(seen, eventIdentity)) {
      throw new Error('duplicate verified violation identity at rows ' + seen[eventIdentity] + ' and ' + (i + 1) + '; AP repair required');
    }
    total++;
    seen[eventIdentity] = i + 1;
    rankByMarker[details.marker] = total;
    if (!isResolvedViolationRow(rows[i], gate)) open++;
  }
  return { total: total, open: open, rankByMarker: rankByMarker };
}

/* Serialize AP declarations so a retry or two concurrent requests cannot
   create two public identities for the same exact dated event. */
function appendVerifiedViolation(dateStr, violationText, gate) {
  var text = sheetText(violationText, 1000, 'violation');
  if (!text) throw new Error('violation text is required');
  return withViolationLogMutation(function (sh, rows) {
    // The caller's gate may predate an AP prompt. Re-read it only after the
    // lock is held so revocation cannot race this authorization or marker.
    var lockedGate = agreementExecutionState();
    if (!lockedGate.active) throw new Error('agreement execution became inactive before the violation could be recorded');
    var date = agreementDateInput(dateStr, 'violation date', lockedGate);
    var marker = violationEventMarker(date, text, lockedGate.today);
    verifiedViolationSummary(rows, lockedGate);
    var exact = [];
    for (var i = 1; i < rows.length; i++) {
      if (apDateStr(rows[i][0]) === date && String(rows[i][1] || '').trim() === text) exact.push(i + 1);
    }
    if (exact.length > 1) throw new Error('duplicate matching violation rows require AP repair before declaration');
    if (exact.length === 1) {
      var existing = sh.getRange(exact[0], 1, 1, 9).getValues()[0];
      var details = verifiedViolationDetails(existing, lockedGate);
      if (!details) throw new Error('a matching unverified row already exists; verify that review row instead');
      return { changed: false, row: exact[0], appended: false, marker: details.marker, ref: 'V-' + publicViolationToken(details.marker) };
    }
    for (var markerIndex = 1; markerIndex < rows.length; markerIndex++) {
      if (String(rows[markerIndex][8] || '').trim() === marker) {
        throw new Error('the APV1 marker is already present at row ' + (markerIndex + 1) + '; AP repair required');
      }
    }
    sh.appendRow([date, text, 'Unresolved · AP verified ' + lockedGate.today, '', '', '', '', '', marker]);
    return { changed: true, row: sh.getLastRow(), appended: true, marker: marker, ref: 'V-' + publicViolationToken(marker) };
  });
}

function correctiveSourceMarker(value) {
  var match = String(value == null ? '' : value).match(
    /(?:^| · )(APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64})(?:$| · )/
  );
  return match ? match[1] : '';
}

function correctiveAssignmentIdInput(value) {
  var id = sheetText(value, 26, 'corrective assignment id').toUpperCase();
  if (!/^C-[A-F0-9]{24}$/.test(id)) throw new Error('invalid corrective assignment id');
  return id;
}

function correctiveRequestIdInput(value) {
  var id = sheetText(value, 128, 'corrective assignment request id');
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(id)) {
    throw new Error('corrective assignment requires a 16–128 character request_id');
  }
  return id;
}

function correctiveAssignmentIdForRequest(marker, requestIdValue) {
  if (!/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(String(marker || ''))) {
    throw new Error('corrective assignment source marker is invalid');
  }
  var requestId = correctiveRequestIdInput(requestIdValue);
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'corrective-assignment-v1\n' + marker + '\n' + requestId,
    Utilities.Charset.UTF_8
  );
  var hex = bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('').toUpperCase();
  return 'C-' + hex.slice(0, 24);
}

/* APJ1 is protected rejection evidence stored in Violation Log column F. It
   authorizes a full retry of the same assignment after its initial due date
   and carries a signed chain of every rejected recording URL hash. Display
   text in column C/G is never authority for either decision. */
var CORRECTIVE_REJECTION_MARKER_VERSION = 'APJ1';

function correctiveRecordingUrlHash(urlValue) {
  var url = youtubeUrlInput(urlValue, 'submitted corrective recording');
  var idMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})$/);
  if (!idMatch) throw new Error('submitted corrective recording identity is invalid');
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'corrective-recording-video-id-v1\n' + idMatch[1],
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function correctiveRejectionDigest(eventMarker, dateStr, assignmentIdValue, rejectionId, urlHashes) {
  var date = isoDateInput(dateStr, 'corrective rejection date');
  var assignmentId = correctiveAssignmentIdInput(assignmentIdValue);
  if (!/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(String(eventMarker || ''))) {
    throw new Error('corrective rejection source marker is invalid');
  }
  if (!/^J-[A-F0-9]{24}$/.test(String(rejectionId || ''))) throw new Error('corrective rejection identity is invalid');
  if (!Array.isArray(urlHashes) || !urlHashes.length || urlHashes.length > 50 ||
      urlHashes.some(function (hash) { return !/^[a-f0-9]{64}$/.test(String(hash || '')); })) {
    throw new Error('corrective rejection URL evidence is invalid');
  }
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    ['corrective-rejection-v1', eventMarker, date, assignmentId, rejectionId, urlHashes.join(',')].join('\n'),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function verifiedCorrectiveRejectionDetails(row, gate) {
  var event = verifiedViolationDetails(row, gate);
  if (!event) return null;
  var marker = String(row && row[5] || '').trim();
  var match = marker.match(/^APJ1\|(\d{4}-\d{2}-\d{2})\|(C-[A-F0-9]{24})\|(J-[A-F0-9]{24})\|([a-f0-9]{64}(?:,[a-f0-9]{64})*)\|([a-f0-9]{64})$/);
  if (!match) return null;
  var date;
  try { date = isoDateInput(match[1], 'corrective rejection date'); }
  catch (e) { return null; }
  if (date < event.date || date < event.verifiedDate || (gate && (date < gate.effectiveDate || date > gate.today))) return null;
  var hashes = match[4].split(',');
  var seen = {};
  for (var i = 0; i < hashes.length; i++) {
    if (seen[hashes[i]]) return null;
    seen[hashes[i]] = true;
  }
  var expected;
  try { expected = correctiveRejectionDigest(event.marker, date, match[2], match[3], hashes); }
  catch (digestError) { return null; }
  return secureTextEquals(expected, match[5]) ? {
    marker: marker,
    date: date,
    assignmentId: match[2],
    rejectionId: match[3],
    urlHashes: hashes,
    event: event,
  } : null;
}

function newCorrectiveRejectionMarker(eventMarker, assignmentIdValue, dateStr, rejectedUrl, priorDetails) {
  var assignmentId = correctiveAssignmentIdInput(assignmentIdValue);
  var date = isoDateInput(dateStr, 'corrective rejection date');
  var hashes = priorDetails && priorDetails.assignmentId === assignmentId
    ? priorDetails.urlHashes.slice() : [];
  var urlHash = correctiveRecordingUrlHash(rejectedUrl);
  if (hashes.indexOf(urlHash) !== -1) throw new Error('that corrective recording was already rejected');
  if (hashes.length >= 50) throw new Error('corrective rejection history requires AP archival repair before another retry');
  hashes.push(urlHash);
  var rejectionId = 'J-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24).toUpperCase();
  var digest = correctiveRejectionDigest(eventMarker, date, assignmentId, rejectionId, hashes);
  return [CORRECTIVE_REJECTION_MARKER_VERSION, date, assignmentId, rejectionId, hashes.join(','), digest].join('|');
}

function correctiveAttemptIdInput(value) {
  var id = sheetText(value, 26, 'corrective attempt id').toUpperCase();
  if (!/^A-[A-F0-9]{24}$/.test(id)) throw new Error('invalid corrective attempt id');
  return id;
}

function correctiveAttemptId(assignmentIdValue, rejectionDetails) {
  var assignmentId = correctiveAssignmentIdInput(assignmentIdValue);
  var generation = rejectionDetails && rejectionDetails.marker
    ? String(rejectionDetails.marker) : 'INITIAL';
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'corrective-attempt-v1\n' + assignmentId + '\n' + generation,
    Utilities.Charset.UTF_8
  );
  var hex = bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('').toUpperCase();
  return 'A-' + hex.slice(0, 24);
}

/* A Corrective Log row is operative only when its status carries the exact
   marker of one unique, still-valid AP-verified source event. This makes
   copied, edited, legacy, and orphaned assignments fail closed. */
function verifiedViolationForMarker(marker, gate) {
  if (!/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(String(marker || ''))) return null;
  var eventIdentity = String(marker).split('|')[2];
  var rows = violationLogSheet().getDataRange().getValues();
  var found = null;
  for (var i = 1; i < rows.length; i++) {
    var details = verifiedViolationDetails(rows[i], gate);
    if (!details || details.marker.split('|')[2] !== eventIdentity) continue;
    if (found) return null; // an ambiguous duplicate must never become operative
    found = { row: i + 1, values: rows[i], details: details };
  }
  return found && found.details.marker === marker ? found : null;
}

function verifiedCorrectiveDetails(row, gate, allowResolvedSource) {
  if (!row || row.length < 6) return null;
  var marker = correctiveSourceMarker(row[3]);
  var source = verifiedViolationForMarker(marker, gate);
  if (!source) return null;
  if (!allowResolvedSource && isResolvedViolationRow(source.values, gate)) return null;
  var assigned, due, assignmentId;
  try {
    assigned = isoDateInput(apDateStr(row[0]), 'corrective assignment date');
    due = isoDateInput(apDateStr(row[2]), 'corrective due date');
    assignmentId = correctiveAssignmentIdInput(row[5]);
  } catch (e) { return null; }
  if (!dateWithinAgreement(assigned, gate) || assigned < source.details.verifiedDate || due < assigned) return null;
  return { marker: marker, source: source, assigned: assigned, due: due, assignmentId: assignmentId };
}

function openCorrectiveAssignmentsForMarker(marker, gate) {
  var rows = correctiveSheet().getDataRange().getValues();
  var found = [];
  var linkedCount = 0;
  for (var i = 1; i < rows.length; i++) {
    var details = verifiedCorrectiveDetails(rows[i], gate);
    if (!details || details.marker !== marker) continue;
    linkedCount++;
    // Only a completion that validates all the way back to its exact sealed
    // filing closes an assignment. Free-form or legacy status text is never
    // closure authority and therefore remains operative for AP repair.
    if (verifiedCorrectiveCompletion(rows[i], gate)) continue;
    found.push({ row: i + 1, values: rows[i], details: details });
  }
  if (linkedCount > 1) throw new Error('source event has multiple corrective assignments; AP repair required');
  return found;
}

function correctiveCompletionStatus(marker, attemptIdValue) {
  if (!/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(String(marker || ''))) {
    throw new Error('corrective completion source marker is invalid');
  }
  return 'Completed · ' + marker + ' · ' + correctiveAttemptIdInput(attemptIdValue);
}

function verifiedCompletedCorrectiveDetails(row, gate) {
  var details = verifiedCorrectiveDetails(row, gate, true);
  if (!details) return null;
  var status = String(row[3] || '').trim();
  var prefix = 'Completed · ' + details.marker + ' · ';
  if (status.indexOf(prefix) !== 0) return null;
  var attemptId, completed;
  try {
    attemptId = correctiveAttemptIdInput(status.slice(prefix.length));
    completed = isoDateInput(apDateStr(row[4]), 'corrective completion date');
  } catch (e) { return null; }
  if (completed < details.assigned || completed > gate.today) return null;
  return {
    marker: details.marker,
    source: details.source,
    assigned: details.assigned,
    due: details.due,
    assignmentId: details.assignmentId,
    attemptId: attemptId,
    completed: completed,
  };
}

function verifiedCorrectiveCompletion(row, gate) {
  var completed = verifiedCompletedCorrectiveDetails(row, gate);
  if (!completed) return null;
  if (!isResolvedViolationRow(completed.source.values, gate)) {
    var rejection = verifiedCorrectiveRejectionDetails(completed.source.values, gate);
    if ((/^APJ1\|/.test(String(completed.source.values[5] || '').trim()) && !rejection) ||
        (rejection && rejection.assignmentId !== completed.assignmentId) ||
        correctiveAttemptId(completed.assignmentId, rejection) !== completed.attemptId) {
      return null;
    }
  }
  var review;
  try {
    review = correctiveReviewSnapshot({
      ref: 'V-' + publicViolationToken(completed.marker),
      assignmentId: completed.assignmentId,
      attemptId: completed.attemptId,
    }, completed.source.values, gate);
  } catch (e) { return null; }
  if (completed.completed < review.submitted) return null;
  completed.review = review;
  return completed;
}

function correctiveReviewSnapshot(target, sourceRow, gate) {
  var evidence = requireCorrectiveFilingEvidence(target, sourceRow, gate);
  return {
    ref: target.ref,
    assignmentId: target.assignmentId,
    attemptId: target.attemptId,
    submitted: evidence.date,
    urlHash: evidence.urlHash,
  };
}

function sameCorrectiveReviewSnapshot(left, right) {
  return !!left && !!right && left.ref === right.ref &&
    left.assignmentId === right.assignmentId && left.attemptId === right.attemptId &&
    left.submitted === right.submitted && left.urlHash === right.urlHash &&
    String(left.completed || '') === String(right.completed || '');
}

function pendingCorrectiveReviewForSource(sourceRow, gate) {
  var event = verifiedViolationDetails(sourceRow, gate);
  if (!event || isResolvedViolationRow(sourceRow, gate)) {
    throw new Error('corrective review requires one unresolved AP-verified source event');
  }
  var assignments = openCorrectiveAssignmentsForMarker(event.marker, gate);
  if (assignments.length !== 1) {
    throw new Error(assignments.length
      ? 'source event has multiple open corrective assignments; AP repair required'
      : 'source event has no open corrective assignment to review');
  }
  var assignmentId = assignments[0].details.assignmentId;
  var rejection = verifiedCorrectiveRejectionDetails(sourceRow, gate);
  if (rejection && rejection.assignmentId !== assignmentId) {
    throw new Error('protected corrective rejection evidence belongs to a different assignment; AP repair required');
  }
  var target = {
    ref: 'V-' + publicViolationToken(event.marker),
    assignmentId: assignmentId,
    attemptId: correctiveAttemptId(assignmentId, rejection),
  };
  if (!/^\s*(submitted|corrected|pending)/i.test(String(sourceRow[2] || '').trim())) {
    throw new Error('that open event has no submitted corrective session to review');
  }
  var review = correctiveReviewSnapshot(target, sourceRow, gate);
  review.rejection = rejection;
  review.assignmentRow = assignments[0].row;
  return review;
}

function completedCorrectiveReviewForSource(sourceRow, gate, assignmentIdValue, attemptIdValue) {
  var event = verifiedViolationDetails(sourceRow, gate);
  if (!event) throw new Error('resolution requires one AP-verified source event');
  var hasRequestedIdentity = assignmentIdValue != null || attemptIdValue != null;
  if (hasRequestedIdentity && (!String(assignmentIdValue || '').trim() || !String(attemptIdValue || '').trim())) {
    throw new Error('resolution requires both assignment_id and attempt_id');
  }
  var requestedAssignmentId = hasRequestedIdentity ? correctiveAssignmentIdInput(assignmentIdValue) : '';
  var requestedAttemptId = hasRequestedIdentity ? correctiveAttemptIdInput(attemptIdValue) : '';
  var rows = correctiveSheet().getDataRange().getValues();
  var linked = [];
  for (var i = 1; i < rows.length; i++) {
    var details = verifiedCorrectiveDetails(rows[i], gate, true);
    if (details && details.marker === event.marker) linked.push({ row: i + 1, values: rows[i], details: details });
  }
  if (linked.length !== 1) {
    throw new Error(linked.length
      ? 'source event has multiple corrective assignments; AP repair required'
      : 'source event has no valid corrective assignment');
  }
  var completed = verifiedCorrectiveCompletion(linked[0].values, gate);
  if (!completed) throw new Error('corrective assignment must be completed with protected attempt evidence before resolution');
  if (hasRequestedIdentity &&
      (completed.assignmentId !== requestedAssignmentId || completed.attemptId !== requestedAttemptId)) {
    throw new Error('resolution target does not match the exact completed corrective attempt');
  }
  var review = correctiveReviewSnapshot({
    ref: 'V-' + publicViolationToken(event.marker),
    assignmentId: completed.assignmentId,
    attemptId: completed.attemptId,
  }, sourceRow, gate);
  if (completed.completed < review.submitted) {
    throw new Error('corrective completion predates the server-bound filing evidence');
  }
  review.assignmentRow = linked[0].row;
  review.completed = completed.completed;
  return review;
}

function correctiveReferenceInput(value) {
  var ref = sheetText(value, 14, 'corrective violation reference').toUpperCase();
  if (!/^V-[A-F0-9]{12}$/.test(ref)) throw new Error('invalid corrective violation reference');
  return ref;
}

/* Resolve every corrective operation through the same authoritative source
   event and unique open assignment. References are always digest-derived
   opaque public ids and are never physical sheet row numbers. */
function correctiveTargetForRef(value, gate, assignmentIdValue, attemptIdValue, sealedCaptureDate) {
  if (!gate || !gate.active) throw new Error('agreement execution inactive');
  var ref = correctiveReferenceInput(value);
  var assignmentId = correctiveAssignmentIdInput(assignmentIdValue);
  var rows = violationLogSheet().getDataRange().getValues();
  var matches = [];
  var opaque = ref.match(/^V-([A-F0-9]{12})$/);
  for (var i = 1; i < rows.length; i++) {
    var details = verifiedViolationDetails(rows[i], gate);
    if (details && publicViolationToken(details.marker) === opaque[1]) {
      matches.push({ row: i + 1, values: rows[i], details: details });
    }
  }
  if (matches.length !== 1) {
    throw new Error(matches.length ? 'corrective reference is ambiguous; AP repair required' : 'corrective reference is not an AP-verified event');
  }
  var source = matches[0];
  if (isResolvedViolationRow(source.values, gate)) throw new Error('entry is already resolved');
  var assignments = openCorrectiveAssignmentsForMarker(source.details.marker, gate);
  if (assignments.length !== 1) {
    throw new Error(assignments.length
      ? 'corrective entry has multiple open assignments; the Accountability Partner must repair the record'
      : 'corrective entry has no open AP assignment');
  }
  if (assignments[0].details.assignmentId !== assignmentId) {
    throw new Error('corrective assignment identity does not match the unique open AP assignment');
  }
  var retryEvidence = verifiedCorrectiveRejectionDetails(source.values, gate);
  if (/^APJ1\|/.test(String(source.values[5] || '').trim()) && !retryEvidence) {
    throw new Error('protected corrective rejection evidence is invalid; AP repair required');
  }
  if (retryEvidence && retryEvidence.assignmentId !== assignmentId) {
    throw new Error('protected corrective rejection evidence belongs to a different assignment; AP repair required');
  }
  var attemptId = correctiveAttemptId(assignments[0].details.assignmentId, retryEvidence);
  if (correctiveAttemptIdInput(attemptIdValue) !== attemptId) {
    throw new Error('corrective attempt identity is stale or does not match the protected AP decision state');
  }
  var eligibilityDate = sealedCaptureDate == null ? gate.today :
    agreementDateInput(sealedCaptureDate, 'sealed corrective capture date', gate);
  if (eligibilityDate < assignments[0].details.assigned ||
      (retryEvidence && eligibilityDate < retryEvidence.date)) {
    throw new Error('corrective capture predates the current assignment or attempt');
  }
  if (assignments[0].details.due < eligibilityDate &&
      (!retryEvidence || retryEvidence.assignmentId !== assignmentId)) {
    throw new Error('the recorded corrective filing window is closed; contact the Accountability Partner');
  }
  return {
    ref: 'V-' + publicViolationToken(source.details.marker),
    assignmentId: assignmentId,
    attemptId: attemptId,
    row: source.row,
    source: source,
    assignment: assignments[0],
  };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Values received from public/device endpoints must never be handed to Sheets
   as formulas. Reject instead of escaping with a leading apostrophe: Sheets can
   remove that apostrophe again when exporting CSV, recreating the payload. */
function sheetText(value, maxLength, fieldName) {
  var s = String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (maxLength && s.length > maxLength) throw new Error((fieldName || 'field') + ' is too long');
  if (/^[\s\u200B-\u200D\u2060\uFEFF]*(?:[=+\-@]|'[\s\u200B-\u200D\u2060\uFEFF]*[=+\-@])/.test(s)) {
    throw new Error('unsafe spreadsheet value for ' + (fieldName || 'field'));
  }
  return s;
}

function isoDateInput(value, fieldName) {
  var s = sheetText(value, 10, fieldName || 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('invalid ' + (fieldName || 'date'));
  var d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error('invalid ' + (fieldName || 'date'));
  return s;
}

function isoDateOffset(value, days) {
  var s = isoDateInput(value, 'date');
  var n = Number(days);
  if (!isFinite(n) || Math.floor(n) !== n) throw new Error('invalid date offset');
  var d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function sheetRowInput(value, lastRow, fieldName) {
  var n = Number(value);
  if (!isFinite(n) || Math.floor(n) !== n || n < 2 || n > lastRow) {
    throw new Error('invalid ' + (fieldName || 'sheet row'));
  }
  return n;
}

function httpsUrlInput(value, fieldName) {
  var s = sheetText(value, 2048, fieldName || 'URL');
  if (!/^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?::\d{1,5})?(?:[\/?#]|$)/i.test(s)) {
    throw new Error('invalid HTTPS ' + (fieldName || 'URL'));
  }
  return s;
}

function youtubeUrlInput(value, fieldName) {
  var label = fieldName || 'YouTube URL';
  var s = sheetText(value, 2048, label);
  var watch = s.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/);
  if (watch) return 'https://www.youtube.com/watch?v=' + watch[1];
  var shortLink = s.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})$/);
  if (shortLink) return 'https://youtu.be/' + shortLink[1];
  throw new Error('invalid canonical ' + label);
}

function confirmationUrlInput(value) {
  return youtubeUrlInput(value, 'consent confirmation YouTube URL');
}

function captureKindInput(value) {
  var kind = sheetText(value, 32, 'capture kind');
  var allowed = ['daily', 'corrective', 'weekly', 'confirmation', 'demo', 'announcement'];
  if (allowed.indexOf(kind) === -1) throw new Error('invalid capture kind');
  return kind;
}

function filingKindInput(value) {
  var kind = sheetText(value, 32, 'filing kind');
  var allowed = ['daily', 'corrective', 'weekly', 'confirmation', 'consent', 'supervision', 'demo', 'announcement'];
  if (allowed.indexOf(kind) === -1) throw new Error('invalid filing kind');
  return kind;
}

function sha256Input(value, fieldName) {
  var s = sheetText(value, 64, fieldName || 'SHA-256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(s)) throw new Error('invalid ' + (fieldName || 'SHA-256'));
  return s;
}

var ATTESTATION_SEAL_DOMAIN = 'MRB_ATTESTATION_SEAL_V2';

function attestationSealPayload(fields) {
  // JSON array + a versioned domain separator makes column boundaries
  // unambiguous and deliberately invalidates the earlier partial-field seal.
  return JSON.stringify([
    ATTESTATION_SEAL_DOMAIN,
    fields.loggedAt,
    fields.date,
    String(fields.day),
    fields.event,
    fields.code,
    fields.kind,
    fields.videoHash,
    fields.photoHashes,
    fields.weight,
    fields.status,
    fields.chunkChain,
    String(fields.chunkCount),
    fields.sealedAt,
  ]);
}

/* Only the stronger, challenge-consumed rows written by handleAttest count.
   Legacy VALID rows were not bound to a kind/date and therefore fail closed. */
function acceptedAttestationRow(row, dateStr, kind, existingSecret) {
  try {
    if (!row || row.length < TABS.Attestation.length) return false;
    var date = isoDateInput(dateStr, 'attestation record date');
    if (String(row[3] || '') !== 'capture-attested' || apDateStr(row[1]) !== date) return false;
    var rowKind = String(row[5] || '');
    if (kind && rowKind !== kind) return false;
    if (['daily', 'corrective', 'weekly', 'confirmation', 'demo', 'announcement'].indexOf(rowKind) === -1) return false;
    if (String(row[9] || '').trim() !== 'VALID-CONSUMED') return false;

    var code = String(row[4] || '').trim();
    if (!/^\d{4}$/.test(code)) return false;
    var day = Number(row[2]);
    if (!isFinite(day) || Math.floor(day) !== day || day < 1 || day !== dayOf(date)) return false;
    var videoHash = String(row[6] || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(videoHash)) return false;
    var photoHashText = String(row[7] || '').trim().toLowerCase();
    var photoHashes = photoHashText ? photoHashText.split(/\s+/) : [];
    for (var p = 0; p < photoHashes.length; p++) if (!/^[a-f0-9]{64}$/.test(photoHashes[p])) return false;
    if (rowKind === 'daily' && photoHashes.length !== 4) return false;
    var weightText = String(row[8] == null ? '' : row[8]).trim();
    if (weightText) {
      var weight = Number(weightText);
      if (!isFinite(weight) || weight <= 0 || weight > 1500) return false;
    }
    var chain = String(row[10] || '').trim().toLowerCase();
    var chunks = Number(row[11]);
    var serverSeal = String(row[12] || '').trim().toLowerCase();
    var stamped = String(row[13] || '').trim();
    if (!/^[a-f0-9]{64}$/.test(chain) || !isFinite(chunks) || Math.floor(chunks) !== chunks || chunks < 1 || chunks > 21600) return false;
    if (!/^[a-f0-9]{64}$/.test(serverSeal) || !stamped) return false;

    var loggedAt = new Date(row[0]);
    var sealedAt = new Date(stamped);
    if (isNaN(loggedAt.getTime()) || isNaN(sealedAt.getTime())) return false;
    if (Utilities.formatDate(loggedAt, 'America/New_York', 'yyyy-MM-dd') !== date) return false;
    if (Utilities.formatDate(sealedAt, 'America/New_York', 'yyyy-MM-dd') !== date) return false;
    if (sealedAt.getTime() < loggedAt.getTime() || sealedAt.getTime() - loggedAt.getTime() > 5 * 60000) return false;
    var normalizedWeight = weightText ? String(Number(weightText)) : '';
    var payload = attestationSealPayload({
      loggedAt: loggedAt.toISOString(),
      date: date,
      day: day,
      event: 'capture-attested',
      code: code,
      kind: rowKind,
      videoHash: videoHash,
      photoHashes: photoHashes.join(' '),
      weight: normalizedWeight,
      status: 'VALID-CONSUMED',
      chunkChain: chain,
      chunkCount: chunks,
      sealedAt: sealedAt.toISOString(),
    });
    var expectedSeal = existingSecret == null
      ? sealFor(payload)
      : sealWithSecret(payload, existingSecret);
    return secureTextEquals(expectedSeal, serverSeal);
  } catch (e) {
    return false;
  }
}

function acceptedAttestationDetails(row, dateStr, kind, existingSecret) {
  if (!acceptedAttestationRow(row, dateStr, kind, existingSecret)) return null;
  var weightText = String(row[8] == null ? '' : row[8]).trim();
  return {
    date: isoDateInput(dateStr, 'attestation record date'),
    day: Number(row[2]),
    kind: String(row[5] || ''),
    videoHash: String(row[6] || '').trim().toLowerCase(),
    weight: weightText ? String(Number(weightText)) : '',
    seal: String(row[12] || '').trim().toLowerCase(),
    sealedAt: new Date(String(row[13] || '').trim()),
  };
}

function attestationSealInput(value, fieldName) {
  var seal = sheetText(value, 64, fieldName || 'attestation seal');
  if (!/^[a-f0-9]{64}$/.test(seal)) throw new Error('invalid ' + (fieldName || 'attestation seal'));
  return seal;
}

function acceptedAttestationsFor(dateStr, kind, existingRows, existingSecret) {
  var date = isoDateInput(dateStr, kind + ' attestation date');
  var rows = existingRows || attestationSheet().getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < rows.length; i++) {
    var details = acceptedAttestationDetails(rows[i], date, kind, existingSecret);
    if (details) matches.push(details);
  }
  return matches;
}

function acceptedAttestationForSeal(dateStr, kind, suppliedSeal, existingRows, existingSecret) {
  var seal = attestationSealInput(suppliedSeal, kind + ' attestation seal');
  var matches = acceptedAttestationsFor(dateStr, kind, existingRows, existingSecret).filter(function (entry) {
    return secureTextEquals(entry.seal, seal);
  });
  if (!matches.length) throw new Error('no accepted same-date ' + kind + ' attestation matches the supplied seal');
  if (matches.length > 1) throw new Error('duplicate accepted ' + kind + ' attestations share the supplied seal; AP repair required');
  return matches[0];
}

/* A later network retry is allowed only when server-sealed capture provenance
   proves the session was completed before the 10 PM Eastern deadline. */
function filingAttestation(dateStr, kind, suppliedSeal) {
  var date = isoDateInput(dateStr, kind + ' filing date');
  var matches = [acceptedAttestationForSeal(date, kind, suppliedSeal)];
  var preDeadline = matches.filter(function (entry) {
    return Utilities.formatDate(entry.sealedAt, 'America/New_York', 'HH:mm:ss') < '22:00:00';
  });
  var now = new Date();
  var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  var afterDeadline = date < today ||
    (date === today && Utilities.formatDate(now, 'America/New_York', 'HH:mm:ss') >= '22:00:00');
  if (afterDeadline && !preDeadline.length) {
    throw new Error(kind + ' filing retry rejected: no accepted attestation was sealed before 10:00 PM ET');
  }
  return preDeadline[0] || matches[0];
}

/* Corrective capture provenance has a second, server-authenticated binding to
   its unique AP-issued source event. The public Attestation schema remains
   fixed at fourteen columns; this private property cannot be forged merely by
   reusing a same-day corrective seal against another violation reference. */
var CORRECTIVE_ATTESTATION_CONTEXT_PROPERTY_PREFIX = 'CORRECTIVE_ATTESTATION_CONTEXT_V3_';

function canonicalCorrectiveContextRef(value) {
  var ref = sheetText(value, 14, 'corrective attestation reference').toUpperCase();
  if (!/^V-[A-F0-9]{12}$/.test(ref)) throw new Error('corrective attestation requires an opaque AP-issued violation reference');
  return ref;
}

function canonicalCorrectiveContextAssignmentId(value) {
  try { return correctiveAssignmentIdInput(value); }
  catch (e) { throw new Error('corrective attestation requires an opaque AP-issued assignment id'); }
}

function canonicalCorrectiveContextAttemptId(value) {
  try { return correctiveAttemptIdInput(value); }
  catch (e) { throw new Error('corrective attestation requires the current opaque attempt id'); }
}

function correctiveChallengeContextMarker(ref, assignmentId, attemptId) {
  return 'CTX3|' + canonicalCorrectiveContextRef(ref) + '|' +
    canonicalCorrectiveContextAssignmentId(assignmentId) + '|' +
    canonicalCorrectiveContextAttemptId(attemptId);
}

function correctiveChallengeContext(row) {
  var match = String(row && row[7] || '').trim().match(
    /^CTX3\|(V-[A-F0-9]{12})\|(C-[A-F0-9]{24})\|(A-[A-F0-9]{24})$/
  );
  return match ? { ref: match[1], assignmentId: match[2], attemptId: match[3] } : null;
}

function correctiveAttestationContextSignature(seal, date, ref, assignmentId, attemptId, videoHash) {
  return sealFor(['corrective-attestation-context-v3', seal, date, ref, assignmentId, attemptId, videoHash].join('\n'));
}

function storeCorrectiveAttestationContext(seal, dateStr, refValue, assignmentIdValue, attemptIdValue, videoHashValue) {
  var normalizedSeal = attestationSealInput(seal, 'corrective attestation seal');
  var date = isoDateInput(dateStr, 'corrective attestation date');
  var ref = canonicalCorrectiveContextRef(refValue);
  var assignmentId = canonicalCorrectiveContextAssignmentId(assignmentIdValue);
  var attemptId = canonicalCorrectiveContextAttemptId(attemptIdValue);
  var videoHash = sha256Input(videoHashValue, 'corrective video SHA-256');
  var record = {
    version: 3,
    date: date,
    ref: ref,
    assignmentId: assignmentId,
    attemptId: attemptId,
    videoHash: videoHash,
    signature: correctiveAttestationContextSignature(normalizedSeal, date, ref, assignmentId, attemptId, videoHash),
  };
  var props = PropertiesService.getScriptProperties();
  var propertyKey = CORRECTIVE_ATTESTATION_CONTEXT_PROPERTY_PREFIX + normalizedSeal;
  var existing = props.getProperty(propertyKey);
  if (existing) {
    var parsed;
    try { parsed = JSON.parse(existing); }
    catch (parseError) { throw new Error('corrective attestation context is corrupt; AP repair required'); }
    var valid = parsed && Number(parsed.version) === 3 && parsed.date === date && parsed.ref === ref &&
      parsed.assignmentId === assignmentId && parsed.attemptId === attemptId &&
      parsed.videoHash === videoHash && secureTextEquals(
        String(parsed.signature || ''),
        correctiveAttestationContextSignature(normalizedSeal, date, ref, assignmentId, attemptId, videoHash)
      );
    if (!valid) throw new Error('corrective attestation seal is already bound to different or invalid context');
    return record;
  }
  props.setProperty(propertyKey, JSON.stringify(record));
  return record;
}

function requireCorrectiveAttestationContext(attestation, refValue, assignmentIdValue, attemptIdValue) {
  if (!attestation || attestation.kind !== 'corrective') throw new Error('missing exact corrective attestation');
  var ref = canonicalCorrectiveContextRef(refValue);
  var assignmentId = canonicalCorrectiveContextAssignmentId(assignmentIdValue);
  var attemptId = canonicalCorrectiveContextAttemptId(attemptIdValue);
  var propertyKey = CORRECTIVE_ATTESTATION_CONTEXT_PROPERTY_PREFIX + attestation.seal;
  var raw = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!raw) throw new Error('corrective attestation is not bound to this AP-issued violation reference');
  var parsed;
  try { parsed = JSON.parse(raw); }
  catch (parseError) { throw new Error('corrective attestation context is corrupt; AP repair required'); }
  if (!parsed || Number(parsed.version) !== 3 || parsed.date !== attestation.date || parsed.ref !== ref ||
      parsed.assignmentId !== assignmentId || parsed.attemptId !== attemptId ||
      parsed.videoHash !== attestation.videoHash || !secureTextEquals(
        String(parsed.signature || ''),
        correctiveAttestationContextSignature(attestation.seal, attestation.date, ref, assignmentId, attemptId, attestation.videoHash)
      )) {
    throw new Error('corrective attestation context does not match this filing');
  }
  return parsed;
}

var CORRECTIVE_FILING_EVIDENCE_PROPERTY_PREFIX = 'CORRECTIVE_FILING_EVIDENCE_V1_';

function correctiveFilingEvidenceKey(assignmentId, attemptId) {
  return CORRECTIVE_FILING_EVIDENCE_PROPERTY_PREFIX +
    correctiveAssignmentIdInput(assignmentId) + '_' + correctiveAttemptIdInput(attemptId);
}

function correctiveFilingEvidenceSignature(record) {
  return sealFor([
    'corrective-filing-evidence-v1',
    record.ref,
    record.assignmentId,
    record.attemptId,
    record.date,
    record.urlHash,
    record.attestationSeal,
  ].join('\n'));
}

function storeCorrectiveFilingEvidence(attestation, target, dateStr, urlValue) {
  var record = {
    version: 1,
    ref: canonicalCorrectiveContextRef(target.ref),
    assignmentId: correctiveAssignmentIdInput(target.assignmentId),
    attemptId: correctiveAttemptIdInput(target.attemptId),
    date: isoDateInput(dateStr, 'corrective filing date'),
    urlHash: correctiveRecordingUrlHash(urlValue),
    attestationSeal: attestationSealInput(attestation && attestation.seal, 'corrective filing attestation seal'),
  };
  record.signature = correctiveFilingEvidenceSignature(record);
  var props = PropertiesService.getScriptProperties();
  var key = correctiveFilingEvidenceKey(record.assignmentId, record.attemptId);
  var existing = props.getProperty(key);
  if (existing) {
    var parsed;
    try { parsed = JSON.parse(existing); }
    catch (parseError) { throw new Error('corrective filing evidence is corrupt; AP repair required'); }
    var valid = parsed && Number(parsed.version) === 1 && parsed.ref === record.ref &&
      parsed.assignmentId === record.assignmentId && parsed.attemptId === record.attemptId &&
      parsed.date === record.date && parsed.urlHash === record.urlHash &&
      secureTextEquals(String(parsed.attestationSeal || ''), record.attestationSeal) &&
      secureTextEquals(String(parsed.signature || ''), correctiveFilingEvidenceSignature(parsed));
    if (!valid) throw new Error('corrective attempt is already bound to different or invalid filing evidence');
    return parsed;
  }
  props.setProperty(key, JSON.stringify(record));
  return record;
}

function requireCorrectiveFilingEvidence(target, sourceRow, gate) {
  var submitted = agreementDateInput(apDateStr(sourceRow[3]), 'corrective submission date', gate);
  var url = youtubeUrlInput(sourceRow[7], 'submitted corrective recording');
  var key = correctiveFilingEvidenceKey(target.assignmentId, target.attemptId);
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) throw new Error('corrective completion requires server-bound filing evidence');
  var record;
  try { record = JSON.parse(raw); }
  catch (parseError) { throw new Error('corrective filing evidence is corrupt; AP repair required'); }
  var valid = record && Number(record.version) === 1 && record.ref === target.ref &&
    record.assignmentId === target.assignmentId && record.attemptId === target.attemptId &&
    record.date === submitted && record.urlHash === correctiveRecordingUrlHash(url) &&
    /^[a-f0-9]{64}$/.test(String(record.attestationSeal || '')) &&
    secureTextEquals(String(record.signature || ''), correctiveFilingEvidenceSignature(record));
  if (!valid) throw new Error('corrective filing evidence does not match the current submitted recording');
  var attestation = acceptedAttestationForSeal(submitted, 'corrective', record.attestationSeal);
  requireCorrectiveAttestationContext(attestation, target.ref, target.assignmentId, target.attemptId);
  return record;
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
  Logger.log('SHEET_ID stored.');
}

/* Read-only self-test: run it and the log tells you exactly what is wrong. */
function diagnose() {
  var p = PropertiesService.getScriptProperties();
  var out = ['', '════════ DIAGNOSE ════════'];
  out.push('SHEET_ID property: ' + (p.getProperty('SHEET_ID') || '(unset — run createRecordSpreadsheet() or setSheetId())'));
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
  var raw = String(c == null ? '' : c);
  var value = raw.trim();
  if (raw !== value || value.length < 20 || value.length > 128) {
    throw new Error('unlock code must be 20–128 non-whitespace-padded characters from a cryptographically random generator');
  }
  PropertiesService.getScriptProperties().setProperty('UNLOCK_CODE', value);
  Logger.log('Unlock code stored.');
}
function unlockOk(c) {
  var stored = PropertiesService.getScriptProperties().getProperty('UNLOCK_CODE');
  return !!stored && stored.length >= 20 && secureTextEquals(String(c || '').trim(), stored);
}

var ASSISTANT_UNLOCK_TOKEN_VERSION = 'MRBU1';
var ASSISTANT_UNLOCK_TOKEN_MS = 2 * 60 * 60 * 1000;
var ASSISTANT_UNLOCK_CLOCK_SKEW_MS = 5 * 60 * 1000;

function sha256Text(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value == null ? '' : value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function secureTextEquals(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  var different = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var i = 0; i < length; i++) {
    different |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return different === 0;
}

function assistantUnlockBinding() {
  var props = PropertiesService.getScriptProperties();
  var deviceKey = props.getProperty('PACKET_KEY') || '';
  var unlockCode = props.getProperty('UNLOCK_CODE') || '';
  if (!deviceKey || !unlockCode) return '';
  return sha256Text('assistant-unlock-binding-v1\n' + deviceKey + '\n' + unlockCode);
}

function assistantUnlockSignature(issuedMs, expiresMs, nonce, binding) {
  return sealFor([
    'assistant-unlock-token-v1',
    ASSISTANT_UNLOCK_TOKEN_VERSION,
    String(issuedMs),
    String(expiresMs),
    nonce,
    binding,
  ].join('\n'));
}

function unlockTokenOk(obj) {
  var token = String(obj && obj.unlock || '').trim();
  var match = token.match(/^MRBU1\.(\d{13})\.(\d{13})\.([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!match) return false;
  var issuedMs = Number(match[1]);
  var expiresMs = Number(match[2]);
  var nonce = match[3];
  var supplied = match[4];
  var nowMs = Date.now();
  if (!isFinite(issuedMs) || !isFinite(expiresMs) || Math.floor(issuedMs) !== issuedMs ||
      Math.floor(expiresMs) !== expiresMs || expiresMs - issuedMs !== ASSISTANT_UNLOCK_TOKEN_MS ||
      issuedMs > nowMs + ASSISTANT_UNLOCK_CLOCK_SKEW_MS || expiresMs <= nowMs) return false;
  var binding = assistantUnlockBinding();
  if (!binding) return false;
  return secureTextEquals(supplied, assistantUnlockSignature(issuedMs, expiresMs, nonce, binding));
}

function deviceAuthorized(obj) {
  return !!obj && keyOk(obj.key) && unlockTokenOk(obj);
}

function handleUnlock(obj) {
  // An unauthenticated caller must not be able to exhaust the legitimate
  // device's unlock budget. Only a request that already proves possession of
  // the device key participates in the unlock-code throttle.
  if (!keyOk(obj && obj.key)) {
    return jsonOut({ ok: false, error: 'keys not accepted' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonOut({ ok: false, error: 'unlock busy — retry' });
  try {
    // CacheService has no atomic increment. Serialize the read/check/write so
    // parallel guesses cannot share one miss count and evade the throttle.
    var cache = CacheService.getScriptCache();
    var misses = Number(cache.get('unlock_misses') || 0);
    if (misses >= 5) return jsonOut({ ok: false, error: 'locked out — try again in 15 minutes' });
    if (!unlockOk(obj.code)) {
      cache.put('unlock_misses', String(misses + 1), 900);
      return jsonOut({ ok: false, error: 'keys not accepted' });
    }
    cache.remove('unlock_misses');
    var binding = assistantUnlockBinding();
    if (!binding) return jsonOut({ ok: false, error: 'unlock is not configured' });
    var issuedMs = Date.now();
    var expiresMs = issuedMs + ASSISTANT_UNLOCK_TOKEN_MS;
    var nonce = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
    var signature = assistantUnlockSignature(issuedMs, expiresMs, nonce, binding);
    return jsonOut({
      ok: true,
      token: [ASSISTANT_UNLOCK_TOKEN_VERSION, issuedMs, expiresMs, nonce, signature].join('.'),
      issued: new Date(issuedMs).toISOString(),
      expires: expiresMs,
      expires_at: new Date(expiresMs).toISOString(),
    });
  } finally {
    lock.releaseLock();
  }
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
  var TYPES = ['Encouragement', 'I know Micheal personally', 'Possible compliance issue', 'Found/shared elsewhere', 'Question', 'Other'];
  var type, message, name, email, src;
  try {
    type = sheetText(obj.type, 60, 'observer type');
    if (TYPES.indexOf(type) === -1) type = 'Other';
    message = sheetText(obj.message, 4000, 'observer message');
    name = sheetText(obj.name, 120, 'observer name');
    email = sheetText(obj.email, 200, 'observer email');
    src = obj.source_url ? httpsUrlInput(obj.source_url, 'observer source URL') : '';
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  }
  if (!message) return jsonOut({ ok: false, error: 'empty message' });
  var quotable = /^(yes|true|on|1)$/i.test(String(obj.quotable || '')) ? 'yes' : 'no';
  var stamp = Utilities.formatDate(new Date(), 'America/New_York', "yyyy-MM-dd HH:mm 'ET'");
  var sh = tab('Observer');
  sh.appendRow([stamp, type, message, name, email, src, quotable, 'received', '']);
  var n = sh.getLastRow() - 1;
  try {
    sendMail(AP_EMAIL, 'Observer submission #' + n + ' — ' + type,
      'Received ' + stamp + '\nType: ' + type + '\nQuotable anonymously: ' + quotable +
      (name ? '\nName/nickname: ' + name : '') + (email ? '\nEmail: ' + email : '') + (src ? '\nSource URL: ' + src : '') +
      '\n\n' + message +
      '\n\n— Review on the Observer tab (col H: received → dismissed / verified / published / actioned). ' +
      'A substantiated compliance issue is logged through the MRB menu; nothing publishes from this tab.' + apSign());
  } catch (e) { Logger.log('Observer mail failed: ' + e); }
  return jsonOut({ ok: true, n: n });
}

function keyOk(k) {
  var stored = PropertiesService.getScriptProperties().getProperty('PACKET_KEY');
  return !!stored && String(k || '').trim() === stored;
}

/* ═════════════════════ WEB ENDPOINT ═════════════════════
   GET accepts only the one-shot Withings OAuth callback or a health response;
   credentials are never accepted in query strings. Participant POST actions
   require both the device key and a current server-issued unlock token;
   unlock requires the device key + AP-supplied code; ap* requires the AP key. */

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
  if (e && e.parameter && e.parameter.code) {
    // One-shot: once the scale is bound, an unauthenticated visit cannot
    // rebind the weight feed to another Withings account. To reconnect, the
    // AP clears WITHINGS_REFRESH in Script Properties first.
    var oauthProps = PropertiesService.getScriptProperties();
    if (oauthProps.getProperty('WITHINGS_REFRESH')) {
      return ContentService.createTextOutput('Withings is already connected. Reconnect requires the AP to clear WITHINGS_REFRESH first.');
    }
    var oauthLock = LockService.getScriptLock();
    if (!oauthLock.tryLock(5000)) return ContentService.createTextOutput('Withings connection busy. Generate a fresh authorization URL and retry.');
    try {
      var expectedState = oauthProps.getProperty('WITHINGS_OAUTH_STATE');
      var stateExpires = Number(oauthProps.getProperty('WITHINGS_OAUTH_STATE_EXP') || 0);
      var suppliedState = String(e.parameter.state || '');
      if (!expectedState || stateExpires < Date.now() || suppliedState !== expectedState) {
        return ContentService.createTextOutput('Withings connection refused: invalid or expired OAuth state. Generate a fresh authorization URL in Apps Script.');
      }
      // Consume under a lock before exchange so a callback cannot be replayed.
      oauthProps.deleteProperty('WITHINGS_OAUTH_STATE');
      oauthProps.deleteProperty('WITHINGS_OAUTH_STATE_EXP');
    } finally {
      oauthLock.releaseLock();
    }
    withingsExchange(e.parameter.code);
    var ok = !!oauthProps.getProperty('WITHINGS_REFRESH');
    return ContentService.createTextOutput(ok
      ? 'Withings connected. First sync has run — close this tab, then run setup() in the editor for the hourly trigger.'
      : 'Exchange failed — check the execution log in the Apps Script editor.');
  }
  // All keys travel only in POST bodies — GET URLs are routinely logged.
  return jsonOut({ ok: true, service: 'MRB record endpoint' });
}

/* One-time code stamped with GOOGLE SERVER TIME: a video recorded earlier
   cannot contain a code that did not exist until seconds ago. Today's
   scale-synced weight rides along so the assistant burns the OFFICIAL figure
   into the overlay instead of asking for a typed one. */
function issueChallenge(kind, contextRef, contextAssignmentId, contextAttemptId) {
  var gate = null;
  try {
    kind = captureKindInput(kind || 'daily');
    if (['confirmation', 'demo', 'announcement'].indexOf(kind) === -1) {
      gate = activeAgreementGate('challenge ' + kind);
      if (!gate) return inactiveEnforcementJson('challenge ' + kind);
    }
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  }
  var now = new Date();
  var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  var day = Math.floor((new Date(today) - new Date(gate ? gate.projectStart : PROJECT_START)) / 864e5) + 1;
  var canonicalContext = '';
  var contextMarker = '';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonOut({ ok: false, error: 'challenge service is busy; retry' });
  var code = '';
  var challengeSheetChanged = false;
  try {
    if (['confirmation', 'demo', 'announcement'].indexOf(kind) === -1) {
      var lockedGate = agreementExecutionState();
      if (!lockedGate.active) return inactiveEnforcementJson('challenge ' + kind);
      gate = lockedGate;
      today = lockedGate.today;
      day = Math.floor((new Date(today) - new Date(lockedGate.projectStart)) / 864e5) + 1;
    }
    if (kind === 'corrective') {
      var target = correctiveTargetForRef(contextRef, gate, contextAssignmentId, contextAttemptId);
      if (String(target.source.values[7] || '').trim()) throw new Error('a corrective recording is already on file');
      canonicalContext = target.ref;
      contextAssignmentId = target.assignmentId;
      contextAttemptId = target.attemptId;
      contextMarker = correctiveChallengeContextMarker(canonicalContext, contextAssignmentId, contextAttemptId);
    } else if ((contextRef != null && String(contextRef).trim()) ||
               (contextAssignmentId != null && String(contextAssignmentId).trim()) ||
               (contextAttemptId != null && String(contextAttemptId).trim())) {
      throw new Error('challenge context is valid only for corrective capture');
    }

    /* Four digits are retained for spoken/video usability. Within each
       date+kind namespace, however, a code is never reissued, so identical
       codes cannot cross-bind two corrective contexts. */
    var challengeSheet = attestationSheet();
    var rows = challengeSheet.getDataRange().getValues();
    var used = {};
    for (var ci = 1; ci < rows.length; ci++) {
      if (String(rows[ci][3] || '') !== 'challenge-issued' || apDateStr(rows[ci][1]) !== today ||
          String(rows[ci][5] || '') !== kind) continue;
      var usedCode = String(rows[ci][4] || '').trim();
      if (/^\d{4}$/.test(usedCode)) used[usedCode] = true;
    }
    var start = Math.floor(Math.random() * 9000);
    for (var offset = 0; offset < 9000; offset++) {
      var candidate = String(1000 + ((start + offset) % 9000));
      if (!used[candidate]) { code = candidate; break; }
    }
    if (!code) throw new Error('all challenge codes for this capture kind are exhausted today');
    challengeSheetChanged = true;
    challengeSheet.appendRow([now, today, day, 'challenge-issued', code, kind, '', contextMarker, '', '']);
  } catch (challengeError) {
    return jsonOut({ ok: false, error: String(challengeError.message || challengeError) });
  } finally {
    try {
      if (challengeSheetChanged) SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
  var syncedW = '';
  try {
    var wv = weighinsSheet().getDataRange().getValues();
    for (var wi = 1; wi < wv.length; wi++) {
      if (apDateStr(wv[wi][0]) === today) { syncedW = parseFloat(wv[wi][1]) || ''; break; }
    }
  } catch (we) {}
  return jsonOut({ ok: true, code: code, day: day, issuedAt: now.toISOString(), weight: syncedW,
    ref: canonicalContext || undefined, assignment_id: contextAssignmentId || undefined,
    attempt_id: contextAttemptId || undefined });
}

function doPost(e) {
  try {
    if (e && e.postData && e.postData.contents && String(e.postData.contents).charAt(0) === '{') {
      var obj = null;
      try { obj = JSON.parse(e.postData.contents); } catch (perr) {}
      if (obj && obj.action === 'subscribe' && /^(subscribe|confirm|unsubscribe)$/.test(String(obj.sub || ''))) return handleSubscribeAction(obj);
      if (obj && obj.action === 'unlock') return handleUnlock(obj);
      if (obj && obj.action === 'attest') return deviceAuthorized(obj) ? handleAttest(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'packet') return deviceAuthorized(obj) ? handlePacket(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'correctivefiled') return deviceAuthorized(obj) ? handleCorrectiveFiled(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'weeklyfiled') return deviceAuthorized(obj) ? handleWeeklyFiled(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'ytfiled') return deviceAuthorized(obj) ? handleYtFiled(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'confirmationfiled') return deviceAuthorized(obj) ? handleParticipantConfirmationFiled(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'challenge') return deviceAuthorized(obj) ? issueChallenge(String(obj.kind || 'daily'), obj.ref, obj.assignment_id, obj.attempt_id) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'ping') return deviceAuthorized(obj) ? jsonOut({ ok: true }) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'mystate') return deviceAuthorized(obj) ? handleMyState() : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'observer') return observerOk(obj.secret) ? handleObserver(obj) : jsonOut({ ok: false, error: 'unauthorized' });
      if (obj && obj.action === 'vidinit') return deviceAuthorized(obj) ? handleVidInit(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
      if (obj && obj.action === 'vidchunk') return deviceAuthorized(obj) ? handleVidChunk(obj) : jsonOut({ ok: false, error: 'unauthorized or unlock expired' });
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

/* Append-only migration for existing private workbooks. Legacy rows receive
   no marker and therefore stay non-operative until the AP reviews each one. */
function ensureViolationColumns() {
  var sh = violationLogSheet();
  if (sh.getMaxColumns() < 9) sh.insertColumnsAfter(sh.getMaxColumns(), 9 - sh.getMaxColumns());
  var current = String(sh.getRange(1, 9).getValue() || '').trim();
  if (current && current !== 'event_verification') {
    throw new Error('Violation Log column I is not event_verification; refusing to overwrite an unexpected schema');
  }
  if (!current) {
    sh.getRange(1, 9).setValue('event_verification').setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10)
      .setBackground('#141412').setFontColor('#FAFAF7');
    Logger.log('Violation Log: added column I event_verification; legacy rows remain pending AP review.');
  }
  protectViolationEventVerification(sh);
  protectViolationResolutionFields(sh);
}

/* Explicit append-only migration for stable corrective assignment identities.
   The sixth column is private machine evidence: public/device calls receive
   only its opaque C-… value. Existing rows get an ID only when setup() is run,
   never as a side effect of an authorization read. */
function ensureCorrectiveColumns() {
  var sh = ss().getSheetByName('Corrective Log');
  if (!sh) {
    sh = ss().insertSheet('Corrective Log');
    sh.getRange(1, 1, 1, TABS['Corrective Log'].length).setValues([TABS['Corrective Log']]);
    sh.setFrozenRows(1);
  }
  var usedColumns = sh.getDataRange().getNumColumns();
  if (usedColumns !== 5 && usedColumns !== 6) {
    throw new Error('Corrective Log schema must use exactly five legacy columns or six current columns');
  }
  var actual = sh.getRange(1, 1, 1, usedColumns).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
  var currentFive = TABS['Corrective Log'].slice(0, 5);
  var legacyFive = ['assigned_date', 'assignment', 'due', 'status', 'completed_date'];
  var matchesCurrent = currentFive.every(function (header, index) { return actual[index] === header; });
  var matchesLegacy = legacyFive.every(function (header, index) { return actual[index] === header; });
  if (!matchesCurrent && !matchesLegacy) {
    throw new Error('Corrective Log first five columns do not match a recognized schema');
  }
  if (usedColumns === 6 && actual[5] && actual[5] !== 'assignment_id') {
    throw new Error('Corrective Log column F is not assignment_id; refusing to overwrite an unexpected schema');
  }
  if (sh.getMaxColumns() < 6) sh.insertColumnsAfter(sh.getMaxColumns(), 6 - sh.getMaxColumns());
  sh.getRange(1, 1, 1, 6).setValues([TABS['Corrective Log']])
    .setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10)
    .setBackground('#141412').setFontColor('#FAFAF7');

  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var rows = sh.getRange(2, 1, lastRow - 1, 6).getValues();
    var seen = {};
    var changed = false;
    for (var i = 0; i < rows.length; i++) {
      var populated = rows[i].slice(0, 5).some(function (value) { return String(value || '').trim(); });
      var id = String(rows[i][5] || '').trim().toUpperCase();
      if (!populated && !id) continue;
      if (!id) {
        do { id = 'C-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24).toUpperCase(); }
        while (seen[id]);
        rows[i][5] = id;
        changed = true;
      }
      if (!/^C-[A-F0-9]{24}$/.test(id)) {
        throw new Error('Corrective Log row ' + (i + 2) + ' has an invalid assignment_id');
      }
      if (seen[id]) throw new Error('Corrective Log has duplicate assignment_id values at rows ' + seen[id] + ' and ' + (i + 2));
      seen[id] = i + 2;
    }
    if (changed) sh.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  protectOwnerOnlyColumns(sh, 1, 6, 'AP-only corrective assignment evidence');
  return sh;
}

function protectViolationEventVerification(sh) {
  var description = 'AP-only event verification markers';
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var protection = null;
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) { protection = protections[i]; break; }
  }
  if (protection) {
    var protectedRange = protection.getRange();
    if (protectedRange.getSheet().getSheetId() !== sh.getSheetId() ||
        protectedRange.getColumn() !== 9 || protectedRange.getNumColumns() !== 1 ||
        protectedRange.getRow() !== 1 || protectedRange.getNumRows() !== sh.getMaxRows()) {
      throw new Error('AP-only event-verification protection is bound to an unexpected range; refusing to continue');
    }
  }
  if (!protection) protection = sh.getRange('I:I').protect().setDescription(description);
  protection.setWarningOnly(false);
  var ownerEmail = '';
  try { ownerEmail = String(DriveApp.getFileById(sh.getParent().getId()).getOwner().getEmail() || '').trim(); }
  catch (ownerError) { throw new Error('AP-only event-verification owner cannot be verified'); }
  if (!ownerEmail) throw new Error('AP-only event-verification owner cannot be verified');
  protection.addEditor(ownerEmail);
  var editors = protection.getEditors();
  var remove = editors.filter(function (editor) {
    return String(editor.getEmail() || '').trim().toLowerCase() !== ownerEmail.toLowerCase();
  });
  if (remove.length) protection.removeEditors(remove);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  return protection;
}

function protectViolationResolutionFields(sh) {
  var description = 'AP-only violation resolution evidence';
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var protection = null;
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) { protection = protections[i]; break; }
  }
  if (protection) {
    var protectedRange = protection.getRange();
    if (protectedRange.getSheet().getSheetId() !== sh.getSheetId() ||
        protectedRange.getColumn() !== 5 || protectedRange.getNumColumns() !== 2 ||
        protectedRange.getRow() !== 1 || protectedRange.getNumRows() !== sh.getMaxRows()) {
      throw new Error('AP-only resolution protection is bound to an unexpected range; refusing to continue');
    }
  }
  if (!protection) protection = sh.getRange('E:F').protect().setDescription(description);
  protection.setWarningOnly(false);
  var ownerEmail = '';
  try { ownerEmail = String(DriveApp.getFileById(sh.getParent().getId()).getOwner().getEmail() || '').trim(); }
  catch (ownerError) { throw new Error('AP-only resolution owner cannot be verified'); }
  if (!ownerEmail) throw new Error('AP-only resolution owner cannot be verified');
  protection.addEditor(ownerEmail);
  var editors = protection.getEditors();
  var remove = editors.filter(function (editor) {
    return String(editor.getEmail() || '').trim().toLowerCase() !== ownerEmail.toLowerCase();
  });
  if (remove.length) protection.removeEditors(remove);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  return protection;
}

/* Agreement execution depends on these small evidence/control tables. Keep them writable
   by the AP-owned script while preventing workbook collaborators from
   directly replacing confirmation evidence or activation state. */
function protectOwnerOnlyColumns(sh, firstColumn, numColumns, description) {
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var protection = null;
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) { protection = protections[i]; break; }
  }
  if (protection) {
    var protectedRange = protection.getRange();
    var sameAnchor = protectedRange.getSheet().getSheetId() === sh.getSheetId() &&
      protectedRange.getColumn() === firstColumn && protectedRange.getRow() === 1 &&
      protectedRange.getNumRows() === sh.getMaxRows();
    // A schema migration may append protected columns. Expanding an otherwise
    // exact owner-only range is safe; every other mismatch is ambiguous.
    if (sameAnchor && protectedRange.getNumColumns() < numColumns) {
      protection.remove();
      protection = null;
    } else if (!sameAnchor || protectedRange.getNumColumns() !== numColumns) {
      throw new Error(description + ' protection is bound to an unexpected range; refusing to continue');
    }
  }
  if (!protection) protection = sh.getRange(1, firstColumn, sh.getMaxRows(), numColumns).protect().setDescription(description);
  protection.setWarningOnly(false);
  var ownerEmail = '';
  try { ownerEmail = String(DriveApp.getFileById(sh.getParent().getId()).getOwner().getEmail() || '').trim(); }
  catch (ownerError) { throw new Error(description + ' owner cannot be verified'); }
  if (!ownerEmail) throw new Error(description + ' owner cannot be verified');
  protection.addEditor(ownerEmail);
  var editors = protection.getEditors();
  var remove = editors.filter(function (editor) {
    return String(editor.getEmail() || '').trim().toLowerCase() !== ownerEmail.toLowerCase();
  });
  if (remove.length) protection.removeEditors(remove);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  return protection;
}

function protectAgreementControlSheets() {
  // These helpers validate/migrate their schemas before applying hard range
  // protection. The AP-owned web app can still append through its server-side
  // execution identity; named workbook collaborators cannot edit the evidence.
  attestationSheet();
  confirmationsSheet();
  protectOwnerOnlyColumns(siteStateSheet(), 1, 2, 'AP-only agreement and publication state');
  var corrective = ss().getSheetByName('Corrective Log');
  if (!corrective) throw new Error('Corrective Log is missing; run setup migration first');
  protectOwnerOnlyColumns(corrective, 1, 6, 'AP-only corrective assignment evidence');
}

function setup() {
  ensureWeighinsColumns();
  ensureViolationColumns();
  ensureCorrectiveColumns();
  protectAgreementControlSheets();
  // Create the private seal key during explicit setup so later gate reads are
  // pure and can fail closed if setup was never completed.
  sealSecret();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importPhotos').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('mirrorToMicheal').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('githubMirrorPhotos').timeBased().everyMinutes(15).create();
  // During the 22:00 hour, refresh public file presence and privately queue
  // any apparent gap for AP review. The trigger does not make a deadline
  // ruling, declare a violation, or assign a consequence.
  ScriptApp.newTrigger('nightlyComplianceCheck').timeBased().everyDays(1).atHour(22).inTimezone('America/New_York').create();
  ScriptApp.newTrigger('abandonmentCheck').timeBased().everyDays(1).atHour(23).inTimezone('America/New_York').create();
  // §3.4 Evening Supervision presence review, normally near minute 20. Any
  // apparent gap remains private until an explicit AP ruling.
  ScriptApp.newTrigger('supervisionNightlyCheck').timeBased().everyDays(1).atHour(22).nearMinute(20).inTimezone('America/New_York').create();
  // Monday: project weeks run Monday→Sunday from Day 1 (Mon Aug 31); the
  // weekly review is recorded Monday, so both mails land Monday morning.
  ScriptApp.newTrigger('subscriberWeeklyAudit').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(30).inTimezone('America/New_York').create();
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
  var gate = agreementExecutionState();
  Logger.log('Triggers installed. Enforcement gate: ' + (gate.active ? 'ACTIVE' : 'INACTIVE — ' + (gate.error || gate.missing.join(', '))));
}

/* ═════════════════ DRIVE: PHOTO + VIDEO INTAKE ═════════════════
   Raw media is quarantine material: the intake folder and every child remain
   PRIVATE in Drive. Daily photos land in the private folder's root; videos are filed into
   per-kind subfolders (Inspection Videos / Weekly Reviews / Consent
   Confirmations / Announcements & Demos) so the retained record stays legible.
   importPhotos scans the root and Inspection Videos and files everything
   into the Weigh-ins row by filename. A raw Drive URL is an internal pointer,
   never a public artifact. Corrective media use a separate PRIVATE folder and
   never touch the public record. */

var ANGLE_COLS = { front: 4, left: 5, rear: 6, right: 7 };

/* Fail closed if link/domain sharing cannot be removed. PRIVATE still permits
   the owner and explicitly named collaborators; disabling editor resharing
   keeps a named editor from turning the quarantine public again. */
function requirePrivateDriveItem(item, label) {
  if (!item) throw new Error('Private Drive boundary unavailable: missing ' + (label || 'Drive item'));
  try {
    if (item.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      // Permission.NONE cannot be used here; Apps Script only allows NONE with
      // Access.ANYONE. VIEW is irrelevant to unnamed users once access is PRIVATE.
      item.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    }
    if (item.isShareableByEditors()) item.setShareableByEditors(false);
    if (item.getSharingAccess() !== DriveApp.Access.PRIVATE || item.isShareableByEditors()) {
      throw new Error('Drive did not retain the required private sharing state');
    }
  } catch (e) {
    throw new Error('Private Drive boundary unavailable; refusing to read or write ' +
      (label || 'Drive item') + ': ' + String(e && e.message ? e.message : e));
  }
  return item;
}

/* Legacy function name retained for callers. Every child is private. */
function publicSubfolder(name) {
  var root = photosFolder();
  var it = root.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : root.createFolder(name);
  return requirePrivateDriveItem(folder, 'media subfolder');
}

/* Root files plus one level of subfolders — the intake and mirror view. */
function publicFiles(cb) {
  var root = photosFolder();
  var files = root.getFiles();
  while (files.hasNext()) cb(requirePrivateDriveItem(files.next(), 'raw media file'));
  var subs = root.getFolders();
  while (subs.hasNext()) {
    var privateSubfolder = requirePrivateDriveItem(subs.next(), 'media subfolder');
    var sf = privateSubfolder.getFiles();
    while (sf.hasNext()) cb(requirePrivateDriveItem(sf.next(), 'raw media file'));
  }
}

function mediaFileAgreementDate(file, gate) {
  var name = String(file.getName() || '').toLowerCase();
  var match = name.match(/(\d{4}-\d{2}-\d{2})/);
  var date = match ? match[1] : Utilities.formatDate(file.getDateCreated(), 'America/New_York', 'yyyy-MM-dd');
  return dateWithinAgreement(date, gate) ? date : '';
}

function importPhotos() {
  var gate = activeAgreementGate('importPhotos');
  if (!gate) return;
  var candidates = [];
  publicFiles(function (f) {
    var mt = String(f.getMimeType());
    var isImg = mt.indexOf('image/') === 0;
    var isVid = mt.indexOf('video/') === 0;
    if (!isImg && !isVid) return;

    var name = f.getName().toLowerCase();
    var dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    var dateStr = dateMatch ? dateMatch[1] : Utilities.formatDate(f.getDateCreated(), 'America/New_York', 'yyyy-MM-dd');

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

    candidates.push({ date: dateStr, col: col, url: url });
  });

  withActiveAgreementMutation('imported photos could be recorded', function (lockedGate) {
    var sh = weighinsSheet();
    var vals = sh.getDataRange().getValues();
    var byDate = {};
    for (var i = 1; i < vals.length; i++) {
      var d = vals[i][0];
      var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
      if (ds) byDate[ds] = { row: i + 1 };
    }
    var changed = false;
    candidates.forEach(function (candidate) {
      if (!dateWithinAgreement(candidate.date, lockedGate)) return;
      var rec = byDate[candidate.date];
      if (!rec) {
        sh.appendRow([candidate.date]);
        rec = { row: sh.getLastRow() };
        byDate[candidate.date] = rec;
        changed = true;
      }
      var cell = sh.getRange(rec.row, candidate.col);
      if (String(cell.getValue() || '').trim()) return; // first file per slot is final
      cell.setValue(candidate.url);
      changed = true;
    });
    return { changed: changed };
  });
}

function photosFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTOS_FOLDER_ID');
  if (id) {
    try { return requirePrivateDriveItem(DriveApp.getFolderById(id), 'media intake folder'); }
    catch (err) {
      // An existing folder that cannot be made private is a hard stop. Only a
      // stale/deleted identifier falls through to creation of a replacement.
      if (String(err && err.message || err).indexOf('Private Drive boundary unavailable') !== -1) throw err;
    }
  }
  var folder = requirePrivateDriveItem(DriveApp.createFolder('MRB Private Media Intake'), 'media intake folder');
  // Store the identifier only after the privacy state has been verified.
  props.setProperty('PHOTOS_FOLDER_ID', folder.getId());
  return folder;
}

// Run from the editor; put the private folder URL only in the operations runbook.
function showPhotosFolderUrl() {
  Logger.log(photosFolder().getUrl());
}

/* ═════ MICHEAL'S DRIVE MIRROR (optional) ═════

   Auto-copies explicitly selected raw files (daily photos + inspection videos) into a
   folder in MICHEAL'S OWN Drive, so he holds his own archive. Setup:
     1. Micheal creates a folder in his Drive and shares it with the AP's
        Google account as Editor.
     2. AP runs setMirrorFolder('<that folder id>').
   The hourly trigger then copies anything new. The private corrective /
   verification folder is NEVER mirrored — this reads only the private media
   intake. Clearing the property stops the mirror.  */

function setMirrorFolder(id) {
  PropertiesService.getScriptProperties().setProperty('MIRROR_FOLDER_ID', String(id || '').trim());
  Logger.log(String(id || '').trim() ? 'Mirror folder stored — mirrorToMicheal() will copy selected private-intake files hourly.' : 'Mirror folder cleared — mirroring stopped.');
}

function mirrorToMicheal() {
  var gate = activeAgreementGate('mirrorToMicheal');
  if (!gate) return;
  var id = PropertiesService.getScriptProperties().getProperty('MIRROR_FOLDER_ID');
  if (!id) return; // not configured — mirroring is optional
  var dst;
  try { dst = requirePrivateDriveItem(DriveApp.getFolderById(id), 'archive mirror folder'); }
  catch (e) { Logger.log('Private mirror folder unavailable: ' + e); return; }
  var cutoff = Date.now() - 48 * 3600 * 1000; // only look at recent files; older ones were mirrored on earlier runs
  var copied = 0, skipped = 0;
  publicFiles(function (f) {
    if (f.getDateCreated().getTime() < cutoff) return;
    if (dst.getFilesByName(f.getName()).hasNext()) { skipped++; return; }
    try {
      var authorized = withActiveAgreementMutation('a private archive mirror copy could start', function (lockedGate) {
        return { changed: false, allowed: !!mediaFileAgreementDate(f, lockedGate) };
      });
      if (!authorized.allowed) return;
      requirePrivateDriveItem(f.makeCopy(f.getName(), dst), 'mirrored raw media file'); copied++;
    }
    catch (e) { Logger.log('Mirror copy failed for ' + f.getName() + ': ' + e); }
  });
  if (copied) Logger.log('Mirrored ' + copied + ' new file(s) to Micheal\u2019s Drive (' + skipped + ' already there).');
}

/* One-time backfill: copies EVERYTHING in the private intake regardless of
   age. Run once after setMirrorFolder(); the hourly mirror handles the rest. */
function mirrorBackfill() {
  var gate = activeAgreementGate('mirrorBackfill');
  if (!gate) return;
  var id = PropertiesService.getScriptProperties().getProperty('MIRROR_FOLDER_ID');
  if (!id) { Logger.log('Run setMirrorFolder() first.'); return; }
  var dst = requirePrivateDriveItem(DriveApp.getFolderById(id), 'archive mirror folder');
  var copied = 0;
  publicFiles(function (f) {
    if (!dst.getFilesByName(f.getName()).hasNext()) {
      var authorized = withActiveAgreementMutation('a private archive backfill copy could start', function (lockedGate) {
        return { changed: false, allowed: !!mediaFileAgreementDate(f, lockedGate) };
      });
      if (authorized.allowed) {
        requirePrivateDriveItem(f.makeCopy(f.getName(), dst), 'mirrored raw media file');
        copied++;
      }
    }
  });
  Logger.log('Backfilled ' + copied + ' file(s).');
}

function correctiveFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CORRECTIVE_FOLDER_ID');
  if (id) {
    try { return requirePrivateDriveItem(DriveApp.getFolderById(id), 'corrective media folder'); }
    catch (err) {
      if (String(err && err.message || err).indexOf('Private Drive boundary unavailable') !== -1) throw err;
    }
  }
  var folder = requirePrivateDriveItem(DriveApp.createFolder('MRB Corrective Sessions'), 'corrective media folder');
  props.setProperty('CORRECTIVE_FOLDER_ID', folder.getId());
  return folder;
}

/* ═════ AUTO VIDEO UPLOAD (chunked relay to a Drive resumable session) ═════
   The tools post the finished file in ~4 MB base64 chunks, each relayed
   straight into Drive — no whole-file blob ever exists here, so file
   size is unlimited. Destination by kind:
     corrective                    → private archive (never public, never mirrored)
     daily                         → Inspection Videos (private intake)
     weekly                        → Weekly Reviews
     confirmation                  → Consent Confirmations
     demo / announcement / other   → Announcements & Demos */

/* Filed when the corrective session's public posting is submitted: stamps the
   submission timestamp (col D, if empty), files the public recording URL
   (col H), and leaves the entry pending until the AP verifies it. A device
   submission must never resolve its own violation. */
function handleCorrectiveFiled(obj) {
  var gate = activeAgreementGate('corrective filing');
  if (!gate) return inactiveEnforcementJson('corrective filing');
  var ref = obj.ref || obj.id || '';
  var assignmentId = obj.assignment_id || '';
  var attemptId = obj.attempt_id || '';
  try {
    var filing = withActiveAgreementMutation('the corrective filing could be recorded', function (lockedGate) {
      var filingDate = agreementDateInput(obj.date || lockedGate.today, 'corrective filing date', lockedGate);
      var url = youtubeUrlInput(obj.url);
      var correctiveAttestation = filingAttestation(filingDate, 'corrective', obj.attestation_seal || obj.seal);
      var sh = violationLogSheet();
      var sourceRows = sh.getDataRange().getValues();
      var sourceRow = violationRowForIdentity(
        sourceRows, apiViolationRefIdentity(ref), 0, sourceRows.length, 'source violation'
      );
      var existingSource = sourceRows[sourceRow - 1];
      var hasCompletedAssignment = correctiveSheet().getDataRange().getValues().slice(1).some(function (values) {
        var completed = verifiedCorrectiveCompletion(values, lockedGate);
        return completed && completed.marker === String(existingSource[8] || '');
      });
      if (isResolvedViolationRow(existingSource, lockedGate) || hasCompletedAssignment) {
        var completedReview = completedCorrectiveReviewForSource(existingSource, lockedGate, assignmentId, attemptId);
        var completedReceipt = requireCorrectiveFilingEvidence(completedReview, existingSource, lockedGate);
        if (completedReceipt.date !== filingDate ||
            completedReceipt.urlHash !== correctiveRecordingUrlHash(url) ||
            !secureTextEquals(completedReceipt.attestationSeal, correctiveAttestation.seal)) {
          throw new Error('retry does not match the exact completed corrective filing');
        }
        return { changed: false, idempotent: true, status: isResolvedViolationRow(existingSource, lockedGate)
          ? 'resolved' : 'completed-awaiting-resolution' };
      }
      // Only the accepted, server-sealed capture date may carry eligibility
      // across midnight. New challenge requests still use the current day.
      var target = correctiveTargetForRef(ref, lockedGate, assignmentId, attemptId, correctiveAttestation.date);
      requireCorrectiveAttestationContext(
        correctiveAttestation, target.ref, target.assignmentId, target.attemptId
      );
      var row = target.row;
      var sourceViolation = target.source.values;
      var rejectionEvidence = verifiedCorrectiveRejectionDetails(sourceViolation, lockedGate);
      if (rejectionEvidence && rejectionEvidence.assignmentId !== target.assignmentId) {
        throw new Error('protected corrective rejection evidence belongs to a different assignment; AP repair required');
      }
      if (rejectionEvidence && rejectionEvidence.urlHashes.indexOf(correctiveRecordingUrlHash(url)) !== -1) {
        throw new Error('this public recording was already rejected and cannot be filed again');
      }
      var currentStatus = String(sourceViolation[2] || '').trim();
      var existingRecording = String(sourceViolation[7] || '').trim();
      if (existingRecording && correctiveRecordingUrlHash(existingRecording) !== correctiveRecordingUrlHash(url)) {
        throw new Error('a corrective recording is already on file; the device endpoint cannot replace it');
      }
      if (String(sourceViolation[3] || '').trim() && apDateStr(sourceViolation[3]) !== filingDate) {
        throw new Error('corrective filing date conflicts with the existing immutable submission');
      }
      // Commit the immutable receipt first; a failed sheet write can retry the
      // same receipt, but a conflicting seal must never partially change a row.
      storeCorrectiveFilingEvidence(correctiveAttestation, target, filingDate, url);
      var changed = false;
      var replacement = sourceViolation.slice(2, 8); // columns C:H
      if (!String(sourceViolation[3] || '').trim()) { replacement[1] = filingDate; changed = true; }
      if (!existingRecording) { replacement[5] = url; changed = true; }
      if (!/^\s*(submitted|corrected|pending)/i.test(currentStatus)) {
        replacement[0] = 'Submitted · awaiting AP verification';
        changed = true;
      }
      if (changed) sh.getRange(row, 3, 1, 6).setValues([replacement]);
      return { changed: changed, idempotent: !!existingRecording };
    });
    return jsonOut({ ok: true, status: filing.status || 'submitted-awaiting-ap-verification',
      assignment_id: correctiveAssignmentIdInput(assignmentId),
      attempt_id: correctiveAttemptIdInput(attemptId), idempotent: filing.idempotent });
  } catch (inputError) {
    return jsonOut({ ok: false, error: String(inputError.message || inputError) });
  }
}

function explicitProjectStartDate() {
  return isoDateInput(siteStateAll().start_date, 'explicit Site State start_date');
}

function confirmationDayForDate(date) {
  var start = explicitProjectStartDate();
  var day = Math.floor((new Date(date) - new Date(start)) / 864e5) + 1;
  if (day < 1) throw new Error('confirmation precedes project start');
  return day;
}

function confirmationsSheet() {
  var sh = tab('Confirmations');
  var expected = TABS.Confirmations;
  var usedColumns = sh.getDataRange().getNumColumns();
  if (usedColumns !== expected.length - 1 && usedColumns !== expected.length) {
    throw new Error('Confirmations schema must use exactly five legacy columns or six current columns');
  }
  if (sh.getMaxColumns() < expected.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), expected.length - sh.getMaxColumns());
  }
  var actual = sh.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var i = 0; i < expected.length - 1; i++) {
    if (String(actual[i] || '').trim() !== expected[i]) {
      throw new Error('Confirmations schema mismatch at column ' + (i + 1) + '; refusing to read or write confirmation evidence');
    }
  }
  var sealHeader = String(actual[expected.length - 1] || '').trim();
  if (usedColumns === expected.length && sealHeader !== 'attestation_seal') {
    throw new Error('Confirmations attestation-seal column is shifted or unexpected; refusing to overwrite it');
  }
  if (usedColumns === expected.length - 1) {
    sh.getRange(1, expected.length).setValue('attestation_seal')
      .setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
  }
  protectOwnerOnlyColumns(sh, 1, expected.length, 'AP-only agreement confirmation evidence');
  return sh;
}

function confirmationRowsFor(version, date) {
  var sh = confirmationsSheet();
  var rows = sh.getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][2]) !== Number(version) || apDateStr(rows[i][1]) !== date) continue;
    matches.push({ row: i + 1, values: rows[i] });
  }
  return { sheet: sh, matches: matches };
}

function unambiguousConfirmationAttestation(date, suppliedSeal) {
  if (suppliedSeal) return acceptedAttestationForSeal(date, 'confirmation', suppliedSeal);
  var matches = acceptedAttestationsFor(date, 'confirmation');
  if (!matches.length) throw new Error('no accepted same-date confirmation attestation');
  if (matches.length > 1) throw new Error('multiple accepted same-date confirmation attestations; supply the exact attestation seal');
  return matches[0];
}

var AGREEMENT_CONFIRMATION_FINGERPRINT_DOMAIN = 'agreement-confirmation-v1';
function agreementConfirmationFingerprint(version, dateStr, url, attestation) {
  var edition = Number(version);
  if (!isFinite(edition) || Math.floor(edition) !== edition || edition < 1) throw new Error('invalid confirmation edition');
  var date = isoDateInput(dateStr, 'confirmation fingerprint date');
  var canonicalUrl = confirmationUrlInput(url);
  var seal = attestationSealInput(attestation && attestation.seal, 'confirmation fingerprint attestation seal');
  var videoHash = sha256Input(attestation && attestation.videoHash, 'confirmation fingerprint video SHA-256');
  return sha256Text([
    AGREEMENT_CONFIRMATION_FINGERPRINT_DOMAIN,
    String(edition),
    date,
    canonicalUrl,
    seal,
    videoHash,
  ].join('\n'));
}

function participantAgreementStillAcceptsConfirmation() {
  var gate = agreementExecutionState();
  if (gate.error) throw new Error('agreement gate state is invalid: ' + gate.error);
  if (gate.active) throw new Error('Edition ' + AGREEMENT_EDITION + ' is already active; a new participant confirmation cannot replace its evidence');
}

/* The capture queue records a server-stamped, pending confirmation row after
   its attestation is consumed. The later YouTube filing may fill the blank URL
   exactly once; it cannot create or replace execution evidence silently. */
function handleParticipantConfirmationFiled(obj) {
  var lock = LockService.getScriptLock();
  var confirmationSheetChanged = false;
  try {
    if (!lock.tryLock(5000)) throw new Error('confirmation log is busy; retry');
    var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    var date = isoDateInput(obj.date || today, 'confirmation date');
    if (date !== today) throw new Error('confirmation must be filed on its capture date');
    var version = Number(obj.version);
    if (version !== AGREEMENT_EDITION || Math.floor(version) !== version) {
      throw new Error('participant confirmation must use the current agreement edition');
    }
    var day = confirmationDayForDate(date);
    if (obj.day != null && obj.day !== '' && Number(obj.day) !== day) throw new Error('confirmation project day mismatch');
    var suppliedSeal = attestationSealInput(obj.attestation_seal || obj.seal, 'confirmation attestation seal');
    acceptedAttestationForSeal(date, 'confirmation', suppliedSeal);
    var found = confirmationRowsFor(version, date);
    if (found.matches.length > 1) throw new Error('duplicate confirmation records require AP repair');
    if (found.matches.length === 1) {
      var confirmationChanged = false;
      var existingSeal = String(found.matches[0].values[5] || '').trim();
      if (existingSeal) {
        existingSeal = attestationSealInput(existingSeal, 'stored confirmation attestation seal');
        if (!secureTextEquals(existingSeal, suppliedSeal)) {
          throw new Error('confirmation evidence is immutable; conflicting attestation seal rejected');
        }
        acceptedAttestationForSeal(date, 'confirmation', existingSeal);
      } else {
        participantAgreementStillAcceptsConfirmation();
        confirmationSheetChanged = true;
        found.sheet.getRange(found.matches[0].row, 6).setValue(suppliedSeal);
        confirmationChanged = true;
      }
      return jsonOut({ ok: true, idempotent: !confirmationChanged, pending_url: !String(found.matches[0].values[4] || '').trim() });
    }
    participantAgreementStillAcceptsConfirmation();
    confirmationSheetChanged = true;
    found.sheet.appendRow([new Date(), date, version, day, '', suppliedSeal]);
    return jsonOut({ ok: true, pending_url: true });
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  } finally {
    if (lock.hasLock()) {
      try {
        if (confirmationSheetChanged) SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
  }
}

/* Fill a participant confirmation URL once. An exact retry is idempotent;
   any conflicting URL, duplicate row, missing attestation, or post-activation
   attempt fails closed. */
function fileParticipantConfirmationUrl(date, version, url, allowAppend, suppliedSeal) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('confirmation log is busy; retry');
  var confirmationSheetChanged = false;
  try {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (date !== today) throw new Error('confirmation URL must be filed on its capture date');
  var day = confirmationDayForDate(date);
  var found = confirmationRowsFor(version, date);
  if (found.matches.length > 1) throw new Error('duplicate confirmation records require AP repair');
  if (found.matches.length === 1) {
    var storedSeal = String(found.matches[0].values[5] || '').trim();
    if (!storedSeal) {
      if (!suppliedSeal) throw new Error('pending confirmation record has no bound attestation seal');
      storedSeal = attestationSealInput(suppliedSeal, 'confirmation attestation seal');
      acceptedAttestationForSeal(date, 'confirmation', storedSeal);
      participantAgreementStillAcceptsConfirmation();
      confirmationSheetChanged = true;
      found.sheet.getRange(found.matches[0].row, 6).setValue(storedSeal);
    } else {
      storedSeal = attestationSealInput(storedSeal, 'stored confirmation attestation seal');
      if (suppliedSeal && !secureTextEquals(storedSeal, attestationSealInput(suppliedSeal, 'confirmation attestation seal'))) {
        throw new Error('confirmation evidence is immutable; conflicting attestation seal rejected');
      }
      acceptedAttestationForSeal(date, 'confirmation', storedSeal);
    }
    var current = String(found.matches[0].values[4] || '').trim();
    if (current) {
      var normalized = confirmationUrlInput(current);
      if (normalized === url) return { idempotent: true };
      throw new Error('confirmation evidence is immutable; conflicting URL rejected');
    }
    participantAgreementStillAcceptsConfirmation();
    confirmationSheetChanged = true;
    found.sheet.getRange(found.matches[0].row, 5).setValue(url);
    return { idempotent: false };
  }
  if (!allowAppend) throw new Error('no pending confirmation record for ' + date);
  var appendSeal = attestationSealInput(suppliedSeal, 'confirmation attestation seal');
  acceptedAttestationForSeal(date, 'confirmation', appendSeal);
  participantAgreementStillAcceptsConfirmation();
  confirmationSheetChanged = true;
  found.sheet.appendRow([new Date(), date, version, day, url, appendSeal]);
  return { idempotent: false };
  } finally {
    try {
      if (confirmationSheetChanged) SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

/* AP filing uses the same write-once identity (edition + date). It may finish
   a pending participant row, but never overwrite a non-empty URL. */
function fileApConfirmationRecord(date, version, url, suppliedSeal) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('confirmation log is busy; retry');
  var confirmationSheetChanged = false;
  try {
  var day = confirmationDayForDate(date);
  var found = confirmationRowsFor(version, date);
  if (found.matches.length > 1) throw new Error('duplicate confirmation records require AP repair');
  if (found.matches.length === 1) {
    var storedSeal = String(found.matches[0].values[5] || '').trim();
    var attestation;
    if (storedSeal) {
      storedSeal = attestationSealInput(storedSeal, 'stored confirmation attestation seal');
      if (suppliedSeal && !secureTextEquals(storedSeal, attestationSealInput(suppliedSeal, 'confirmation attestation seal'))) {
        throw new Error('confirmation evidence is immutable; conflicting attestation seal rejected');
      }
      attestation = acceptedAttestationForSeal(date, 'confirmation', storedSeal);
    } else {
      attestation = unambiguousConfirmationAttestation(date, suppliedSeal);
      storedSeal = attestation.seal;
    }
    var current = String(found.matches[0].values[4] || '').trim();
    if (current) {
      var normalized = confirmationUrlInput(current);
      if (normalized === url) {
        if (!String(found.matches[0].values[5] || '').trim()) {
          confirmationSheetChanged = true;
          found.sheet.getRange(found.matches[0].row, 6).setValue(storedSeal);
        }
        return { row: found.matches[0].row, idempotent: true, seal: storedSeal };
      }
      throw new Error('confirmation evidence is immutable; conflicting URL rejected');
    }
    confirmationSheetChanged = true;
    found.sheet.getRange(found.matches[0].row, 5, 1, 2).setValues([[url, storedSeal]]);
    return { row: found.matches[0].row, idempotent: false, seal: storedSeal };
  }
  var newAttestation = unambiguousConfirmationAttestation(date, suppliedSeal);
  confirmationSheetChanged = true;
  found.sheet.appendRow([new Date(), date, version, day, url, newAttestation.seal]);
  return { row: found.sheet.getLastRow(), idempotent: false, seal: newAttestation.seal };
  } finally {
    try {
      if (confirmationSheetChanged) SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

function privateDriveBackupUrlInput(value, fieldName) {
  var label = fieldName || 'private Drive backup URL';
  var url = sheetText(value, 2048, label);
  var match = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})\/view$/);
  if (!match) throw new Error('invalid ' + label);
  var file;
  try {
    file = DriveApp.getFileById(match[1]);
    requirePrivateDriveItem(file, label);
  } catch (e) {
    throw new Error(label + ' is unavailable or not private: ' + String(e && e.message ? e.message : e));
  }
  return 'https://drive.google.com/file/d/' + match[1] + '/view';
}

function weeklyIntegerInput(value, minimum, maximum, fieldName) {
  if (value == null || value === '') throw new Error('missing ' + fieldName);
  var number = Number(value);
  if (!isFinite(number) || Math.floor(number) !== number || number < minimum || number > maximum) {
    throw new Error('invalid ' + fieldName);
  }
  return number;
}

function weeklyFilingFields(obj, gate) {
  var date = isoDateInput(obj.date, 'weekly review date');
  if (date !== gate.today) throw new Error('weekly review date must match the server date');
  var expectedDay = Math.floor((new Date(date) - new Date(gate.projectStart)) / 864e5) + 1;
  if (expectedDay < 8) throw new Error('no project week has been completed yet');
  if ((expectedDay - 1) % 7 !== 0) {
    throw new Error('weekly review may be filed only on the completed-week review day');
  }
  var day = weeklyIntegerInput(obj.day, 1, 100000, 'weekly project day');
  if (day !== expectedDay) throw new Error('weekly project day mismatch');
  var expectedWeek = (expectedDay - 1) / 7;
  var week = weeklyIntegerInput(obj.week, 1, 10000, 'weekly review week');
  if (week !== expectedWeek) throw new Error('weekly review week mismatch');
  var documented = weeklyIntegerInput(obj.documented, 0, 7, 'documented-day count');
  var required = weeklyIntegerInput(obj.required, 7, 7, 'required-day count');
  var openEntries = weeklyIntegerInput(obj.open, 0, 1000000, 'open-entry count');
  var weight = '';
  if (obj.weight != null && obj.weight !== '') {
    weight = Number(obj.weight);
    if (!isFinite(weight) || weight <= 0 || weight > 1500) throw new Error('invalid weekly weight');
  }
  var backupUrl = obj.url ? privateDriveBackupUrlInput(obj.url, 'weekly private Drive backup URL') : '';
  return {
    date: date,
    day: day,
    week: week,
    documented: documented,
    required: required,
    weight: weight,
    openEntries: openEntries,
    backupUrl: backupUrl,
  };
}

function authoritativeWeeklyFigures(fields, gate) {
  var weekStart = isoDateOffset(gate.projectStart, (fields.week - 1) * 7);
  var weekEnd = isoDateOffset(weekStart, 6);
  if (isoDateOffset(weekEnd, 1) !== fields.date) throw new Error('weekly review period does not match the authoritative project schedule');

  var rows = weighinsSheet().getDataRange().getValues();
  var byDate = {};
  for (var i = 1; i < rows.length; i++) {
    var rowDate = apDateStr(rows[i][0]);
    if (rowDate < weekStart || rowDate > weekEnd) continue;
    if (Object.prototype.hasOwnProperty.call(byDate, rowDate)) {
      throw new Error('duplicate weigh-in rows in the completed week require AP repair');
    }
    byDate[rowDate] = rows[i];
  }
  var documented = 0;
  var closingWeight = '';
  for (var dayOffset = 0; dayOffset < 7; dayOffset++) {
    var date = isoDateOffset(weekStart, dayOffset);
    var row = byDate[date];
    if (!row) continue;
    var weight = Number(row[1]);
    if (!isFinite(weight) || weight <= 0 || weight > 1500) continue;
    documented++;
    closingWeight = weight;
  }

  var violations = violationLogSheet().getDataRange().getValues();
  var openEntries = verifiedViolationSummary(violations, gate).open;
  return {
    documented: documented,
    required: 7,
    weight: closingWeight,
    openEntries: openEntries,
  };
}

function weeklyRowsForDate(sheet, date) {
  var values = sheet.getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (apDateStr(values[i][1]) === date) matches.push({ row: i + 1, values: values[i] });
  }
  return matches;
}

function weeklyRowsForWeek(sheet, week) {
  var values = sheet.getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (storedWeeklyIntegerEquals(values[i][2], week)) matches.push({ row: i + 1, values: values[i] });
  }
  return matches;
}

function storedWeeklyIntegerEquals(value, expected) {
  var text = String(value == null ? '' : value).trim();
  return /^\d+$/.test(text) && Number(text) === expected;
}

/* Participant filing is permitted only after the matching weekly capture was
   challenge-attested. It stores the private disaster-recovery link once; a
   later canonical YouTube filing may replace only that private link. */
function handleWeeklyFiled(obj) {
  var gate = activeAgreementGate('participant weekly filing');
  if (!gate) return inactiveEnforcementJson('participant weekly filing');
  try {
    var filed = withActiveAgreementMutation('the participant weekly filing could be recorded', function (lockedGate) {
      var fields = weeklyFilingFields(obj, lockedGate);
      var weeklyAttestation = filingAttestation(fields.date, 'weekly', obj.attestation_seal || obj.seal);
      if (weeklyAttestation.day !== fields.day) throw new Error('weekly attestation project day mismatch');
      var authoritative = authoritativeWeeklyFigures(fields, lockedGate);
      var sameWeight = fields.weight === '' ? authoritative.weight === '' :
        authoritative.weight !== '' && Number(fields.weight) === Number(authoritative.weight);
      if (fields.documented !== authoritative.documented || fields.required !== authoritative.required ||
          fields.openEntries !== authoritative.openEntries || !sameWeight) {
        throw new Error('weekly figures do not match the authoritative workbook');
      }
      var authoritativeWeightText = authoritative.weight === '' ? '' : String(Number(authoritative.weight));
      if (weeklyAttestation.weight !== authoritativeWeightText) {
        throw new Error('weekly attestation weight does not match the authoritative workbook');
      }
      fields.documented = authoritative.documented;
      fields.required = authoritative.required;
      fields.weight = authoritative.weight;
      fields.openEntries = authoritative.openEntries;
      var sheet = tab('Weekly Log');
      var matches = weeklyRowsForWeek(sheet, fields.week);
      var dateMatches = weeklyRowsForDate(sheet, fields.date);
      if (matches.length > 1) throw new Error('duplicate weekly records require AP repair');
      if (dateMatches.length > 1) throw new Error('duplicate weekly review dates require AP repair');
      if (!matches.length && dateMatches.length) throw new Error('the existing weekly row has an invalid or conflicting week; AP repair required');
      if (matches.length === 1) {
        var current = matches[0].values;
        if (apDateStr(current[1]) !== fields.date) throw new Error('week ' + fields.week + ' is already filed for a different review date');
        var currentWeight = String(current[5] == null ? '' : current[5]).trim();
        var sameNumbers = storedWeeklyIntegerEquals(current[2], fields.week) &&
          storedWeeklyIntegerEquals(current[3], fields.documented) && storedWeeklyIntegerEquals(current[4], fields.required) &&
          (fields.weight === '' ? currentWeight === '' : currentWeight !== '' && isFinite(Number(currentWeight)) && Number(currentWeight) === fields.weight) &&
          storedWeeklyIntegerEquals(current[6], fields.openEntries);
        if (!sameNumbers) throw new Error('conflicting weekly record already exists for ' + fields.date);
        var currentUrl = String(current[7] || '').trim();
        if (currentUrl === fields.backupUrl || (!fields.backupUrl && !currentUrl) || /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(currentUrl) || /^https:\/\/youtu\.be\/[A-Za-z0-9_-]{11}$/.test(currentUrl)) {
          return { changed: false, idempotent: true };
        }
        throw new Error('conflicting weekly backup already exists for ' + fields.date);
      }
      sheet.appendRow([new Date(), fields.date, fields.week, fields.documented, fields.required,
        fields.weight, fields.openEntries, fields.backupUrl]);
      return { changed: true, idempotent: false };
    });
    return jsonOut({ ok: true, idempotent: filed.idempotent });
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  }
}

function fileWeeklyYoutubeUrl(date, url, gate, attestationSeal) {
  return withActiveAgreementMutation('the weekly YouTube URL could be filed', function (lockedGate) {
    var filedDate = agreementDateInput(date, 'weekly review date', lockedGate);
    filingAttestation(filedDate, 'weekly', attestationSeal);
    var day = Math.floor((new Date(filedDate) - new Date(lockedGate.projectStart)) / 864e5) + 1;
    if (day < 8 || (day - 1) % 7 !== 0) throw new Error('invalid completed-week review date');
    var week = (day - 1) / 7;
    var sheet = tab('Weekly Log');
    var matches = weeklyRowsForWeek(sheet, week);
    var dateMatches = weeklyRowsForDate(sheet, filedDate);
    if (matches.length > 1) throw new Error('duplicate weekly records require AP repair');
    if (dateMatches.length > 1) throw new Error('duplicate weekly review dates require AP repair');
    if (!matches.length && dateMatches.length) throw new Error('the existing weekly row has an invalid or conflicting week; AP repair required');
    if (!matches.length) throw new Error('no weekly row for ' + filedDate);
    if (apDateStr(matches[0].values[1]) !== filedDate) throw new Error('week ' + week + ' is filed for a different review date');
    var current = String(matches[0].values[7] || '').trim();
    if (current === url) return { changed: false, idempotent: true };
    if (current) privateDriveBackupUrlInput(current, 'existing weekly private Drive backup URL');
    sheet.getRange(matches[0].row, 8).setValue(url);
    return { changed: true, idempotent: false };
  });
}

/* Files the public YouTube URL for any session kind (§2: YouTube is an
   Official Platform; the site embeds whatever URL the record holds).
   daily → Weigh-ins col H · corrective → Violation Log col H (via
   handleCorrectiveFiled) · weekly → Weekly Log url · confirmation →
   Confirmations url · demo → Site State demo_video_url. */
function handleYtFiled(obj) {
  var url, kind, date, filingGate = null;
  try {
    url = youtubeUrlInput(obj.url);
    kind = filingKindInput(obj.kind || 'demo');
    date = obj.date ? isoDateInput(obj.date, 'filing date') : '';
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  }
  var serverToday = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (date && date > serverToday) return jsonOut({ ok: false, error: 'filing date is in the future' });
  if (['confirmation', 'consent', 'demo', 'announcement'].indexOf(kind) === -1) {
    filingGate = activeAgreementGate('YouTube filing ' + kind);
    if (!filingGate) return inactiveEnforcementJson('YouTube filing ' + kind);
    if (date && !dateWithinAgreement(date, filingGate)) {
      return jsonOut({ ok: false, error: 'filing date is outside the active agreement period' });
    }
  }
  if (kind === 'corrective') return handleCorrectiveFiled(obj);
  if (!date && kind !== 'announcement' && kind !== 'demo') return jsonOut({ ok: false, error: 'missing filing date' });
  if (kind === 'daily') {
    try {
      var dailyFiled = withActiveAgreementMutation('the daily YouTube URL could be filed', function (lockedGate) {
        var filedDate = agreementDateInput(date, 'daily filing date', lockedGate);
        filingAttestation(filedDate, 'daily', obj.attestation_seal || obj.seal);
        var sh = weighinsSheet();
        var v = sh.getDataRange().getValues();
        var dailyMatches = [];
        for (var i = v.length - 1; i >= 1; i--) {
          var ds = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], 'America/New_York', 'yyyy-MM-dd') : String(v[i][0] || '').trim();
          if (ds === filedDate) dailyMatches.push(i);
        }
        if (dailyMatches.length > 1) throw new Error('duplicate daily rows require AP repair');
        if (dailyMatches.length === 1) {
          var dailyIndex = dailyMatches[0];
          var existingDailyVideo = String(v[dailyIndex][7] || '').trim();
          if (existingDailyVideo) {
            var normalizedDailyVideo = '';
            try {
              normalizedDailyVideo = youtubeUrlInput(existingDailyVideo, 'existing daily YouTube URL');
            } catch (notPublicDailyVideo) {
              if (!driveIdFromUrl(existingDailyVideo)) {
                throw new Error('the existing daily recording pointer is not recognized; AP repair required');
              }
            }
            if (normalizedDailyVideo === url) return { changed: false, idempotent: true };
            if (normalizedDailyVideo) throw new Error('daily recording evidence is immutable; conflicting public URL rejected');
          }
          sh.getRange(dailyIndex + 1, 8).setValue(url);
          return { changed: true, idempotent: false };
        }
        throw new Error('no weigh-in row for ' + filedDate);
      });
      return jsonOut({ ok: true, idempotent: dailyFiled.idempotent });
    } catch (dailyAttestationError) {
      return jsonOut({ ok: false, error: String(dailyAttestationError.message || dailyAttestationError) });
    }
  }
  if (kind === 'weekly') {
    try {
      var weeklyYoutube = fileWeeklyYoutubeUrl(date, url, filingGate, obj.attestation_seal || obj.seal);
      return jsonOut({ ok: true, idempotent: weeklyYoutube.idempotent });
    } catch (weeklyYoutubeError) {
      return jsonOut({ ok: false, error: String(weeklyYoutubeError.message || weeklyYoutubeError) });
    }
  }
  if (kind === 'confirmation') {
    try {
      var confirmationFiled = fileParticipantConfirmationUrl(
        date, AGREEMENT_EDITION, url, false, obj.attestation_seal || obj.seal
      );
      return jsonOut({ ok: true, edition: AGREEMENT_EDITION, idempotent: confirmationFiled.idempotent });
    } catch (confirmationFileError) {
      return jsonOut({ ok: false, error: String(confirmationFileError.message || confirmationFileError) });
    }
  }
  if (kind === 'consent') {
    try {
      var consentFiled = fileParticipantConfirmationUrl(
        date, AGREEMENT_EDITION, url, true, obj.attestation_seal || obj.seal
      );
      return jsonOut({ ok: true, edition: AGREEMENT_EDITION, idempotent: consentFiled.idempotent });
    } catch (consentFileError) {
      return jsonOut({ ok: false, error: String(consentFileError.message || consentFileError) });
    }
  }
  if (kind === 'supervision') {
    if (!PUBLIC_SUPERVISION_VIDEO_ENABLED) {
      return jsonOut({ ok: false, error: 'public supervision video is disabled pending separate safety review' });
    }
    // Evening Supervision archive link (legacy §3.4). A device filing is only
    // evidence submitted for review; it cannot verify itself or write
    // COMPLETED. AP must use the separately authenticated apsupervision action.
    var start, end;
    try {
      start = sheetText(obj.start, 40, 'supervision start');
      end = sheetText(obj.end, 40, 'supervision end');
    } catch (e2) {
      return jsonOut({ ok: false, error: String(e2.message || e2) });
    }
    try {
      withActiveAgreementMutation('the supervision filing could be recorded', function (lockedGate) {
        var filedDate = agreementDateInput(date, 'supervision filing date', lockedGate);
        var sr = supervisionRow(filedDate);
        var ssh = supervisionSheet();
        if (sr) {
          var cur = String(sr.vals[2] || '');
          var replacement = sr.vals.slice(2, 7); // columns C:G
          replacement[3] = url;
          if (start) replacement[1] = start;
          if (end) replacement[2] = end;
          if (/^MISSED/i.test(cur)) replacement[4] = (String(sr.vals[6] || '') + '; link filed after the MISSED ruling').replace(/^; /, '');
          else if (!/^(EXCEPTION|COMPLETED)/i.test(cur)) replacement[0] = 'SUBMITTED · awaiting AP verification';
          ssh.getRange(sr.row, 3, 1, 5).setValues([replacement]);
        } else {
          ssh.appendRow([filedDate, supervisionScheduled(filedDate) ? 'yes' : 'no', 'SUBMITTED · awaiting AP verification', start, end, url, '']);
        }
        return { changed: true };
      });
    } catch (supervisionFileError) {
      return jsonOut({ ok: false, error: String(supervisionFileError.message || supervisionFileError) });
    }
    return jsonOut({ ok: true, status: 'submitted-awaiting-ap-verification' });
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

var VIDEO_UPLOAD_SESSION_PREFIX = 'VID_UPLOAD_V1_';
var VIDEO_UPLOAD_SESSION_MS = 6 * 24 * 60 * 60 * 1000;
var COMPLETED_VIDEO_SESSION_MS = 24 * 60 * 60 * 1000;
var MAX_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
var MAX_VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
var DRIVE_CHUNK_ALIGNMENT = 256 * 1024;

function videoMimeInput(value) {
  var mime = sheetText(value || 'video/webm', 128, 'video MIME type').toLowerCase().replace(/\s+/g, '');
  if (!/^video\/(?:webm|mp4)(?:;codecs=[a-z0-9._,+-]{1,80})?$/.test(mime)) {
    throw new Error('unsupported video MIME type');
  }
  return mime;
}

function videoSizeInput(value) {
  var size = Number(value);
  if (!isFinite(size) || Math.floor(size) !== size || size < 1 || size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error('invalid video upload size');
  }
  return size;
}

function videoSessionTokenInput(value) {
  var token = String(value || '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('chunk 410: unrecognized or expired upload session');
  return token;
}

function videoSessionPropertyKey(token) {
  return VIDEO_UPLOAD_SESSION_PREFIX + token;
}

function purgeExpiredVideoSessions(props, nowMs) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(VIDEO_UPLOAD_SESSION_PREFIX) !== 0) return;
    try {
      var state = JSON.parse(all[key]);
      if (!state || Number(state.expiresAt) <= nowMs) props.deleteProperty(key);
    } catch (e) {
      props.deleteProperty(key);
    }
  });
}

function handleVidInit(obj) {
  var kind, mime, total;
  try {
    kind = captureKindInput(obj.kind);
    mime = videoMimeInput(obj.mime);
    total = videoSizeInput(obj.size);
  }
  catch (e) { return jsonOut({ ok: false, error: String(e.message || e) }); }
  var gatedUpload = ['confirmation', 'demo', 'announcement'].indexOf(kind) === -1;
  if (gatedUpload && !enforcementActive('video upload ' + kind)) {
    return inactiveEnforcementJson('video upload ' + kind);
  }
  var folder;
  function uploadFolder() {
    if (kind === 'corrective') return correctiveFolder();
    if (kind === 'daily') return publicSubfolder('Inspection Videos');
    if (kind === 'weekly') return publicSubfolder('Weekly Reviews');
    if (kind === 'confirmation') return publicSubfolder('Consent Confirmations');
    return publicSubfolder('Announcements & Demos');
  }
  try {
    if (gatedUpload) {
      folder = withActiveAgreementMutation('the video upload session could be initialized', function () {
        return { changed: false, folder: uploadFolder() };
      }).folder;
    } else {
      folder = uploadFolder();
    }
  } catch (folderError) {
    return jsonOut({ ok: false, error: String(folderError.message || folderError) });
  }
  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(total)
    },
    payload: JSON.stringify({ name: safeFileName(obj.name, 'video.webm'), parents: [folder.getId()] }),
    muteHttpExceptions: true
  });
  var headers = r.getAllHeaders();
  var loc = String(headers['Location'] || headers['location'] || '');
  if (r.getResponseCode() !== 200 || !/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?[^\s#]+$/.test(loc)) {
    return jsonOut({ ok: false, error: 'init ' + r.getResponseCode() });
  }

  // The device receives only an opaque token. The upstream Drive bearer URL
  // stays in Script Properties and is bound to every immutable upload field.
  var props = PropertiesService.getScriptProperties();
  var nowMs = Date.now();
  function storeUploadSession() {
    purgeExpiredVideoSessions(props, nowMs);
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
    props.setProperty(videoSessionPropertyKey(token), JSON.stringify({
      version: 1,
      uploadUrl: loc,
      kind: kind,
      mime: mime,
      total: total,
      nextOffset: 0,
      createdAt: nowMs,
      expiresAt: nowMs + VIDEO_UPLOAD_SESSION_MS,
    }));
    return token;
  }
  try {
    var storedToken;
    if (gatedUpload) {
      storedToken = withActiveAgreementMutation('the video upload session could be issued', function () {
        return { changed: false, token: storeUploadSession() };
      }).token;
    } else {
      var sessionLock = LockService.getScriptLock();
      if (!sessionLock.tryLock(5000)) return jsonOut({ ok: false, error: 'upload session busy' });
      try { storedToken = storeUploadSession(); }
      finally { sessionLock.releaseLock(); }
    }
    return jsonOut({ ok: true, session: storedToken });
  } catch (sessionError) {
    return jsonOut({ ok: false, error: String(sessionError.message || sessionError) });
  }
}

function handleVidChunk(obj) {
  var token, mime, total, offset, encoded, bytes;
  try {
    token = videoSessionTokenInput(obj.session);
    mime = videoMimeInput(obj.mime);
    total = videoSizeInput(obj.total);
    offset = Number(obj.offset);
    if (!isFinite(offset) || Math.floor(offset) !== offset || offset < 0 || offset >= total) throw new Error('invalid video chunk offset');
    encoded = String(obj.chunk_b64 || '').trim();
    if (!encoded || encoded.length > Math.ceil(MAX_VIDEO_CHUNK_BYTES / 3) * 4 + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('invalid video chunk encoding');
    }
    bytes = Utilities.base64Decode(encoded);
    if (!bytes.length || bytes.length > MAX_VIDEO_CHUNK_BYTES || offset + bytes.length > total) {
      throw new Error('invalid video chunk size');
    }
    if (offset + bytes.length < total && bytes.length % DRIVE_CHUNK_ALIGNMENT !== 0) {
      throw new Error('non-final video chunk is not 256 KiB aligned');
    }
  } catch (inputError) {
    return jsonOut({ ok: false, error: String(inputError.message || inputError) });
  }

  var props = PropertiesService.getScriptProperties();
  var propertyKey = videoSessionPropertyKey(token);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return jsonOut({ ok: false, error: 'upload session busy' });
  try {
    var raw = props.getProperty(propertyKey);
    if (!raw) return jsonOut({ ok: false, error: 'chunk 410: unrecognized or expired upload session' });
    var state;
    try { state = JSON.parse(raw); }
    catch (stateError) {
      props.deleteProperty(propertyKey);
      return jsonOut({ ok: false, error: 'chunk 410: invalid upload session state' });
    }
    if (!state || Number(state.version) !== 1 || Number(state.expiresAt) <= Date.now()) {
      props.deleteProperty(propertyKey);
      return jsonOut({ ok: false, error: 'chunk 410: upload session expired' });
    }
    if (state.done) {
      if (Number(state.total) === total && String(state.mime) === mime) {
        return jsonOut({ ok: true, done: true, id: state.id, url: state.url });
      }
      return jsonOut({ ok: false, error: 'chunk 410: completed upload session does not match request' });
    }
    if (!/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?[^\s#]+$/.test(String(state.uploadUrl || '')) ||
        Number(state.total) !== total || String(state.mime) !== mime) {
      props.deleteProperty(propertyKey);
      return jsonOut({ ok: false, error: 'chunk 410: upload session binding mismatch' });
    }
    if (['confirmation', 'demo', 'announcement'].indexOf(String(state.kind || '')) === -1 && !enforcementActive('video upload chunk ' + state.kind)) {
      props.deleteProperty(propertyKey);
      return jsonOut({ ok: false, error: 'chunk 410: agreement execution inactive' });
    }

    var chunkSha = sha256HexBytes(bytes);
    var expectedOffset = Number(state.nextOffset);
    // A lost 308 response may make the device retry the immediately preceding
    // chunk. Accept that retry as an idempotent no-op only when its digest and
    // exact range match what was already recorded.
    if (offset !== expectedOffset) {
      if (offset === Number(state.lastOffset) && bytes.length === Number(state.lastLength) &&
          chunkSha === String(state.lastSha || '') && offset + bytes.length === expectedOffset) {
        return jsonOut({ ok: true, done: false, nextOffset: expectedOffset });
      }
      return jsonOut({ ok: false, error: 'chunk 409: upload offset does not match the bound session' });
    }

    var r = UrlFetchApp.fetch(String(state.uploadUrl), {
      method: 'put',
      contentType: mime,
      headers: { 'Content-Range': 'bytes ' + offset + '-' + (offset + bytes.length - 1) + '/' + total },
      payload: bytes,
      muteHttpExceptions: true
    });
    var code = r.getResponseCode();
    if (code === 308) {
      var nextOffset = offset + bytes.length;
      if (nextOffset >= total) {
        props.deleteProperty(propertyKey);
        return jsonOut({ ok: false, error: 'chunk 409: Drive did not finalize the complete upload' });
      }
      var responseHeaders = r.getAllHeaders ? r.getAllHeaders() : {};
      var receivedRange = String(responseHeaders.Range || responseHeaders.range || '');
      if (receivedRange) {
        var rangeMatch = receivedRange.match(/^bytes=0-(\d+)$/);
        if (!rangeMatch || Number(rangeMatch[1]) + 1 !== nextOffset) {
          props.deleteProperty(propertyKey);
          return jsonOut({ ok: false, error: 'chunk 409: Drive range disagrees with the bound session' });
        }
      }
      state.nextOffset = nextOffset;
      state.lastOffset = offset;
      state.lastLength = bytes.length;
      state.lastSha = chunkSha;
      props.setProperty(propertyKey, JSON.stringify(state));
      return jsonOut({ ok: true, done: false, nextOffset: nextOffset });
    }
    if (code === 200 || code === 201) {
      var id = '';
      try { id = JSON.parse(r.getContentText()).id || ''; } catch (responseError) {}
      if (!id || offset + bytes.length !== total) {
        props.deleteProperty(propertyKey);
        return jsonOut({ ok: false, error: 'Drive upload completed with an invalid final response' });
      }
      var uploadedFile = null;
      try {
        uploadedFile = DriveApp.getFileById(id);
        requirePrivateDriveItem(uploadedFile, 'uploaded video');
      } catch (privacyError) {
        try { if (uploadedFile) uploadedFile.setTrashed(true); } catch (trashError) {}
        props.deleteProperty(propertyKey);
        return jsonOut({ ok: false, error: String(privacyError.message || privacyError) });
      }
      var privateUrl = 'https://drive.google.com/file/d/' + id + '/view';
      props.setProperty(propertyKey, JSON.stringify({
        version: 1,
        done: true,
        id: id,
        url: privateUrl,
        mime: mime,
        total: total,
        expiresAt: Date.now() + COMPLETED_VIDEO_SESSION_MS,
      }));
      return jsonOut({ ok: true, done: true, id: id, url: privateUrl });
    }
    if (code >= 400 && code < 500) props.deleteProperty(propertyKey);
    return jsonOut({ ok: false, error: 'chunk ' + code });
  } finally {
    lock.releaseLock();
  }
}

function handlePacket(obj) {
  var gate = activeAgreementGate('daily packet filing');
  if (!gate) return inactiveEnforcementJson('daily packet filing');
  var today;
  var videoUrl = '';
  try {
    today = obj.date
      ? isoDateInput(obj.date, 'packet date')
      : gate.today;
    today = agreementDateInput(today, 'packet date', gate);
    filingAttestation(today, 'daily', obj.attestation_seal || obj.seal);
    if (obj.video_url) {
      videoUrl = httpsUrlInput(obj.video_url, 'packet video URL');
      var privateVideoId = driveIdFromUrl(videoUrl);
      if (!privateVideoId) throw new Error('packet video must be the private Drive backup returned by the upload service');
      requirePrivateDriveItem(DriveApp.getFileById(privateVideoId), 'daily packet video');
    }
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  }
  if (obj.image_b64) {
    var name = safeFileName(obj.name, 'mrb-daily-photo-' + today + '-front.jpg');
    var isPrivate = /corrective|corner|resolution|acknowledgment/i.test(name);
    var isWait = /-wait-/i.test(name);
    var mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
    var blob = Utilities.newBlob(Utilities.base64Decode(String(obj.image_b64)), mime, name);
    try {
      withActiveAgreementMutation('the daily packet image could be stored', function (lockedGate) {
        var lockedDate = agreementDateInput(today, 'packet date', lockedGate);
        filingAttestation(lockedDate, 'daily', obj.attestation_seal || obj.seal);
        if (isWait) {
          // Wait-position still: the /positions reference frame, never a record photograph.
          var wf = requirePrivateDriveItem(publicSubfolder('Wait Stills').createFile(blob), 'uploaded wait still');
          var stateSheet = siteStateSheet(), snapshot = siteStateSnapshot();
          stateSetUnlockedBatch(stateSheet, snapshot, [
            { key: 'wait_still_date', value: lockedDate },
            { key: 'wait_still_url', value: 'https://drive.google.com/thumbnail?id=' + wf.getId() + '&sz=w1200' },
          ], 'wait_still_url');
        } else {
          requirePrivateDriveItem((isPrivate ? correctiveFolder() : photosFolder()).createFile(blob), 'uploaded photo');
        }
        return { changed: true };
      });
    } catch (imageError) {
      return jsonOut({ ok: false, error: String(imageError.message || imageError) });
    }
  }
  if (videoUrl) {
    try {
      withActiveAgreementMutation('the daily packet video could be recorded', function (lockedGate) {
        var lockedDate = agreementDateInput(today, 'packet date', lockedGate);
        filingAttestation(lockedDate, 'daily', obj.attestation_seal || obj.seal);
        var privateVideoId = driveIdFromUrl(videoUrl);
        if (!privateVideoId) throw new Error('packet video must be the private Drive backup returned by the upload service');
        requirePrivateDriveItem(DriveApp.getFileById(privateVideoId), 'daily packet video');
        var vs = weighinsSheet();
        var vv = vs.getDataRange().getValues();
        var packetRows = [];
        for (var v = 1; v < vv.length; v++) {
          if (apDateStr(vv[v][0]) === lockedDate) packetRows.push(v + 1);
        }
        if (packetRows.length > 1) throw new Error('duplicate daily rows require AP repair');
        var vrow = packetRows.length ? packetRows[0] : 0;
        if (!vrow) { vs.appendRow([lockedDate]); vrow = vs.getLastRow(); }
        var existingVideo = String(vs.getRange(vrow, 8).getValue() || '').trim();
        if (existingVideo && existingVideo !== videoUrl) {
          var existingPublicVideo = '';
          try {
            existingPublicVideo = youtubeUrlInput(existingVideo, 'existing public daily video');
          } catch (existingPublicError) {
            if (driveIdFromUrl(existingVideo)) {
              throw new Error('a different private daily backup is already on file');
            }
            throw new Error('the existing daily recording pointer is not recognized; AP repair required');
          }
          if (existingPublicVideo) throw new Error('a public daily recording is already on file and cannot be replaced by the device');
        }
        var dur = Math.round(Number(obj.duration_sec) || 0);
        var existingDurationValue = vs.getRange(vrow, 9).getValue();
        var existingDurationText = String(existingDurationValue || '').trim();
        if (dur > 0 && existingDurationText && Number(existingDurationText) !== dur) {
          throw new Error('daily recording duration is immutable; conflicting value rejected');
        }
        if (!existingVideo || (dur > 0 && !existingDurationText)) {
          // Commit the immutable URL/duration transition in one range write.
          vs.getRange(vrow, 8, 1, 2).setValues([[
            existingVideo || videoUrl,
            existingDurationText ? existingDurationValue : (dur > 0 ? dur : ''),
          ]]);
          return { changed: true };
        }
        return { changed: false };
      });
    } catch (packetCommitError) {
      return jsonOut({ ok: false, error: String(packetCommitError.message || packetCommitError) });
    }
  }

  /* Manual weight is no longer accepted (AP directive): the official daily
     weight is ONLY the scale-synced figure written by withingsSync(). A weight
     sent by a device tool still lands in the Attestation log (spoken and
     burned into the video) but never touches the Weigh-ins column. */
  if (obj.finalize) importPhotos(); // pull anything just written into its column
  return jsonOut({ ok: true });
}

/* ═════ CAPTURE ATTESTATION (challenge codes + file fingerprints) ═════
   Every session fetches a one-time code (logged with server time, spoken
   and burned into the video), then posts back SHA-256 hashes of the
   finished files. If a Drive file is later edited or replaced, its hash
   no longer matches the one logged at capture. */

function attestationSheet() {
  var s = ss();
  var sh = s.getSheetByName('Attestation');
  var expected = TABS.Attestation;
  if (!sh) {
    sh = s.insertSheet('Attestation');
    sh.appendRow(expected);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, expected.length).setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
    sh.setTabColor('#B3261E');
    protectOwnerOnlyColumns(sh, 1, expected.length, 'AP-only server-sealed attestation evidence');
    return sh;
  }

  /* Migrate only the known legacy 10-column schema. Never overwrite an
     unexpected heading: a shifted column would make seals appear to validate
     different values, so schema ambiguity must stop attestation processing. */
  var usedColumns = sh.getDataRange().getNumColumns();
  if (usedColumns !== 10 && usedColumns !== expected.length) {
    throw new Error('Attestation schema must use exactly ten legacy columns or fourteen current columns');
  }
  if (sh.getMaxColumns() < expected.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), expected.length - sh.getMaxColumns());
  }
  var actual = sh.getRange(1, 1, 1, usedColumns).getValues()[0];
  for (var i = 0; i < usedColumns; i++) {
    var current = String(actual[i] || '').trim();
    if (current !== expected[i]) {
      throw new Error('Attestation schema mismatch at column ' + (i + 1) + '; refusing to read or write attestations');
    }
  }
  if (usedColumns === 10) {
    sh.getRange(1, 11, 1, 4).setValues([expected.slice(10)])
      .setFontWeight('bold').setFontFamily('IBM Plex Mono').setFontSize(10);
  }
  protectOwnerOnlyColumns(sh, 1, expected.length, 'AP-only server-sealed attestation evidence');
  return sh;
}

function handleAttest(obj) {
  var sh = attestationSheet();
  var now = new Date();
  var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  var code, kind, date, day, videoHash, photoHashes, chain, chunks, weight;
  var correctiveRef, correctiveAssignmentId, correctiveAttemptId;
  try {
    date = isoDateInput(obj.date || today, 'attestation date');
    if (date !== today) throw new Error('attestation date is not today');
    kind = captureKindInput(obj.kind);
    if (kind === 'corrective') {
      correctiveRef = canonicalCorrectiveContextRef(obj.ref);
      correctiveAssignmentId = canonicalCorrectiveContextAssignmentId(obj.assignment_id);
      correctiveAttemptId = canonicalCorrectiveContextAttemptId(obj.attempt_id);
    } else if ((obj.ref != null && String(obj.ref).trim()) ||
               (obj.assignment_id != null && String(obj.assignment_id).trim()) ||
               (obj.attempt_id != null && String(obj.attempt_id).trim())) {
      throw new Error('attestation context is valid only for corrective capture');
    }
    code = sheetText(obj.code, 4, 'challenge code');
    if (!/^\d{4}$/.test(code)) throw new Error('invalid challenge code');
    day = Number(obj.day);
    if (obj.day == null || obj.day === '' || !isFinite(day) || Math.floor(day) !== day) throw new Error('invalid project day');
    videoHash = sha256Input(obj.video_sha256, 'video SHA-256');
    if (obj.photo_sha256s == null) photoHashes = [];
    else {
      if (!Array.isArray(obj.photo_sha256s)) throw new Error('photo SHA-256 values must be an array');
      photoHashes = obj.photo_sha256s.map(function (hash) { return sha256Input(hash, 'photo SHA-256'); });
    }
    if (kind === 'daily' && photoHashes.length !== 4) throw new Error('daily attestation requires four photo SHA-256 values');
    chain = sha256Input(obj.chunk_chain, 'chunk-chain SHA-256');
    chunks = Number(obj.chunk_count);
    if (!isFinite(chunks) || Math.floor(chunks) !== chunks || chunks < 1 || chunks > 21600) throw new Error('invalid chunk count');
    weight = '';
    if (obj.weight != null && obj.weight !== '') {
      weight = Number(obj.weight);
      if (!isFinite(weight) || weight <= 0 || weight > 1500) throw new Error('invalid attested weight');
    }
  } catch (e) {
    return jsonOut({ ok: false, error: String(e.message || e) });
  }
  if (['confirmation', 'demo', 'announcement'].indexOf(kind) === -1 && !enforcementActive('attestation ' + kind)) {
    return inactiveEnforcementJson('attestation ' + kind);
  }

  /* Serialize challenge consumption so two concurrent posts cannot both use
     the same code. The stronger status deliberately excludes legacy rows that
     were accepted without kind/date binding or one-time consumption. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonOut({ ok: false, error: 'attestation busy — request a new challenge' });
  var attestationSheetChanged = false;
  try {
    if (['confirmation', 'demo', 'announcement'].indexOf(kind) === -1) {
      var lockedGate = agreementExecutionState();
      if (!lockedGate.active || !dateWithinAgreement(date, lockedGate)) {
        return inactiveEnforcementJson('attestation ' + kind);
      }
      var lockedDay = Math.floor((new Date(date) - new Date(lockedGate.projectStart)) / 864e5) + 1;
      if (day !== lockedDay) return jsonOut({ ok: false, error: 'attestation project day mismatch' });
    }
    var vals = sh.getDataRange().getValues();
    var codeChallengeRows = [];
    for (var i = vals.length - 1; i >= 1; i--) {
      if (String(vals[i][3]) !== 'challenge-issued' || String(vals[i][4]) !== code) continue;
      if (apDateStr(vals[i][1]) !== date || String(vals[i][5] || '') !== kind) continue;
      codeChallengeRows.push(i + 1);
    }
    if (codeChallengeRows.length > 1) return jsonOut({ ok: false, error: 'ambiguous challenge code; request a new challenge' });
    var challengeRows = codeChallengeRows.filter(function (rowNumber) {
      if (kind !== 'corrective') return true;
      var context = correctiveChallengeContext(vals[rowNumber - 1]);
      return context && context.ref === correctiveRef && context.assignmentId === correctiveAssignmentId &&
        context.attemptId === correctiveAttemptId;
    });
    if (!challengeRows.length) return jsonOut({ ok: false, error: 'unknown challenge for this date, capture kind, and context' });
    var challengeRow = challengeRows[0];

    var challenge = vals[challengeRow - 1];
    if (Number(challenge[2]) !== day) return jsonOut({ ok: false, error: 'challenge project day mismatch' });
    var requestedPhotoHashes = photoHashes.join(' ');
    var requestedWeight = weight === '' ? '' : String(Number(weight));
    var replay = [];
    for (var ai = 1; ai < vals.length; ai++) {
      var prior = vals[ai];
      if (String(prior[3] || '') !== 'capture-attested' ||
          apDateStr(prior[1]) !== date || Number(prior[2]) !== day ||
          String(prior[4] || '') !== code || String(prior[5] || '') !== kind ||
          String(prior[6] || '').toLowerCase() !== videoHash ||
          String(prior[7] || '').trim() !== requestedPhotoHashes ||
          String(prior[8] == null ? '' : prior[8]).trim() !== requestedWeight ||
          String(prior[10] || '').toLowerCase() !== chain ||
          Number(prior[11]) !== chunks || !acceptedAttestationRow(prior, date, kind)) continue;
      replay.push(prior);
    }
    if (replay.length > 1) {
      return jsonOut({ ok: false, error: 'duplicate exact attestation replay; AP repair required' });
    }
    if (replay.length === 1) {
      var replaySeal = attestationSealInput(replay[0][12], 'stored attestation seal');
      var replayStamped = String(replay[0][13] || '').trim();
      if (kind === 'corrective') {
        try { storeCorrectiveAttestationContext(
          replaySeal, date, correctiveRef, correctiveAssignmentId, correctiveAttemptId, videoHash
        ); }
        catch (contextReplayError) {
          return jsonOut({ ok: false, error: String(contextReplayError.message || contextReplayError) });
        }
      }
      if (!String(challenge[9] || '').trim()) {
        attestationSheetChanged = true;
        sh.getRange(challengeRow, 10).setValue('USED — ' + replayStamped);
      }
      return jsonOut({ ok: true, status: 'VALID-CONSUMED', seal: replaySeal,
        sealed_at: replayStamped, idempotent: true });
    }
    if (String(challenge[9] || '').trim()) return jsonOut({ ok: false, error: 'challenge already used by different evidence' });
    var issuedAt = new Date(challenge[0]);
    var ageMs = now.getTime() - issuedAt.getTime();
    if (isNaN(issuedAt.getTime()) || ageMs < 0 || ageMs > 90 * 60000) {
      return jsonOut({ ok: false, error: 'challenge expired' });
    }

    /* The seal protects this normalized, server-received assertion after
       receipt. It does not independently prove that Drive contains those bytes. */
    var loggedAtIso = now.toISOString();
    var stamped = loggedAtIso;
    var status = 'VALID-CONSUMED';
    var seal = sealFor(attestationSealPayload({
      loggedAt: loggedAtIso,
      date: today,
      day: day,
      event: 'capture-attested',
      code: code,
      kind: kind,
      videoHash: videoHash,
      photoHashes: requestedPhotoHashes,
      weight: requestedWeight,
      status: status,
      chunkChain: chain,
      chunkCount: chunks,
      sealedAt: stamped,
    }));
    attestationSheetChanged = true;
    // Append the sealed evidence first. If the later challenge marker write
    // fails, the exact-replay branch above repairs that marker idempotently;
    // the reverse order could burn a challenge without retaining evidence.
    sh.appendRow([now, today, day, 'capture-attested', code, kind,
      videoHash, requestedPhotoHashes, weight, status,
      chain, chunks, seal, stamped]);
    sh.getRange(challengeRow, 10).setValue('USED — ' + stamped);
    if (kind === 'corrective') {
      try { storeCorrectiveAttestationContext(
        seal, today, correctiveRef, correctiveAssignmentId, correctiveAttemptId, videoHash
      ); }
      catch (contextStoreError) {
        return jsonOut({ ok: false, error: String(contextStoreError.message || contextStoreError) });
      }
    }
    return jsonOut({ ok: true, status: status, seal: seal, sealed_at: stamped });
  } finally {
    try {
      if (attestationSheetChanged) SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

/* Generated once and never published. Rotating it would invalidate every
   existing seal, so it is only ever created, never replaced. */
function sealSecret() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SEAL_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SEAL_SECRET', s); }
  return s;
}
function existingSealSecret() {
  var s = PropertiesService.getScriptProperties().getProperty('SEAL_SECRET');
  if (!s) throw new Error('SEAL_SECRET is missing; run setup before evaluating sealed evidence');
  return s;
}
function sealWithSecret(payload, secret) {
  var raw = Utilities.computeHmacSha256Signature(payload, String(secret));
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}
function sealFor(payload) {
  return sealWithSecret(payload, sealSecret());
}

/* Row-based verification prevents an operator from accidentally omitting a
   security-relevant column when checking a seal. Row 1 is the header. */
function verifyAttestationRow(rowNumber) {
  var sh = attestationSheet();
  var row = sheetRowInput(rowNumber, sh.getLastRow(), 'attestation row');
  var values = sh.getRange(row, 1, 1, TABS.Attestation.length).getValues()[0];
  var date = apDateStr(values[1]);
  var kind = String(values[5] || '');
  var valid = acceptedAttestationRow(values, date, kind);
  Logger.log(valid
    ? 'ATTESTATION SEAL VALID — row ' + row + ' matches the complete v2 sealed payload.'
    : 'ATTESTATION SEAL INVALID — row ' + row + ' is incomplete, altered, legacy, or malformed.');
  return valid;
}

/* ═════ NIGHTLY RECORD-PRESENCE REVIEW ═════
   Refreshes the files, then records a private review signal if something is
   absent when the scheduled job actually runs. This is not an immutable
   deadline receipt and cannot declare a violation or assign a consequence. */

function violationReviewKey(status) {
  var match = String(status || '').match(/(?:^| · )([A-Z]+:[A-Za-z0-9._:-]+)$/);
  return match ? match[1] : '';
}

function queueViolationReview(dateStr, key, text) {
  var reviewText = sheetText(text, 1000, 'review signal');
  var result = withViolationLogMutation(function (sh, vals) {
    var lockedGate = agreementExecutionState();
    if (!lockedGate.active || !dateWithinAgreement(dateStr, lockedGate)) {
      return { changed: false, queued: false };
    }
    for (var i = 1; i < vals.length; i++) {
      if (violationReviewKey(vals[i][2]) === key) return { changed: false, queued: false };
    }
    sh.appendRow([dateStr, reviewText, 'Pending AP review · ' + key, '', '', '', '', '', '']);
    return { changed: true, queued: true };
  });
  return result.queued === true;
}

function nightlyComplianceCheck() {
  var gate = activeAgreementGate('nightlyComplianceCheck');
  if (!gate || !dateWithinAgreement(gate.today, gate)) return;
  importPhotos();
  try { withingsSync(); } catch (ew) {}
  triggerDeploy(); // refresh public file presence; this publishes no ruling

  var today = gate.today;

  correctiveDeadlineCheck(today);

  // Use the same published-packet predicate as reminders, weekly summaries,
  // and abandonment. Attestation is evidence about a capture, not one of the
  // four filing requirements in the Edition 2 Daily Compliance Packet.
  var packet = packetState(today);
  var missing = packet.missing.slice();
  var dayN = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  if (packet.complete) {
    notifySubscribers('daily', 'Daily Result: PACKET FILED — Day ' + dayN,
      'Micheal Ray Berry — Daily Result for ' + today + ' (Day ' + dayN + ')\n\n' +
      'Daily Compliance Packet: all required files present at the 10:00 PM ET check.\n\n' +
      'Record: ' + SUB_SITE + '/daily/\n');
    return;
  }
  var checkedAt = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm:ss z');
  var queued = queueViolationReview(today, 'PACKET:' + today,
    'Record-presence review — packet files were incomplete when checked at ' + checkedAt + ': ' + missing.join(', ') + '.');

  var dayNum = Math.floor((new Date(today) - new Date(PROJECT_START)) / 864e5) + 1;
  MailApp.sendEmail({
    to: AP_EMAIL,
    subject: 'MRB Day ' + dayNum + ' — AP REVIEW REQUIRED: packet files incomplete when checked',
    body: 'Scheduled record-presence review for ' + today + ' (Day ' + dayNum + ').\n\n' +
      'Checked at: ' + checkedAt + '\nFiles absent then:\n- ' + missing.join('\n- ') + '\n\n' +
      (queued ? 'A private pending-review signal was added.\n\n' : 'The existing private review signal was retained.\n\n') +
      'This observation is not a deadline verdict or a Violation Event. Current file presence cannot prove filing time. Review server-side receipts and any documented exception, then explicitly VERIFY or REJECT the selected signal from the MRB menu.\n\n' +
      'Cross-check file authenticity against the Attestation tab: hash the received file (shasum -a 256) and compare.\n\n' +
      'Private tracker: ' + privateRecordUrl() + '\n' +
      'Console: the MRB menu in the record sheet.\n' +
      'This is an automated message from the site Apps Script.',
  });
  notifySubscribers('daily', 'Daily Result: PACKET INCOMPLETE — Day ' + dayN,
    'Micheal Ray Berry — Daily Result for ' + today + ' (Day ' + dayN + ')\n\n' +
    'Daily Compliance Packet incomplete at the 10:00 PM ET check.\nMissing: ' + missing.join(', ') + '.\n\n' +
    'The miss has been declared to the Accountability Partner for confirmation under §7. Once confirmed it is published as a Violation Event with its corrective requirement.\n\n' +
    'Record: ' + SUB_SITE + '/daily/\n');
}

/* ═════ SCHEDULED SUPERVISION CHECK (§3.4) ═════
   User ruling Oct 3 2026: no session record by the check = the night is
   marked MISSED automatically (public) and a Violation Event is declared for
   AP confirmation under §7, exactly like the packet. */
function supervisionNightlyCheck() {
  var gate = activeAgreementGate('supervisionNightlyCheck');
  if (!gate || !dateWithinAgreement(gate.today, gate)) return;
  if (!PUBLIC_SUPERVISION_VIDEO_ENABLED) {
    Logger.log('supervisionNightlyCheck inactive: public supervision video safety gate is disabled');
    return;
  }
  var checkedAt = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm:ss z');
  var review = withActiveAgreementMutation('the supervision review signal could be recorded', function (lockedGate) {
    var today = lockedGate.today;
    if (!dateWithinAgreement(today, lockedGate) || !supervisionScheduled(today)) return { changed: false, queued: false };
    var sr = supervisionRow(today);
    var status = sr ? String(sr.vals[2] || '') : '';
    if (/^(SUBMITTED|COMPLETED|EXCEPTION|MISSED|REVIEW REQUIRED)/i.test(status)) {
      return { changed: false, queued: false };
    }
    var sh = supervisionSheet();
    if (sr) sh.getRange(sr.row, 3).setValue('MISSED');
    else sh.appendRow([today, 'yes', 'MISSED', '', '', '', 'Declared automatically: no session record was present when checked at ' + checkedAt]);
    return { changed: true, queued: true, today: today };
  });
  if (!review.queued) return;
  var today = review.today;
  queueViolationReview(today, 'SUPERVISION:' + today,
    'Supervision record-presence review — no submitted archive record was present when checked at ' + checkedAt + '.');
  try {
    mailAP('MISSED — Evening Supervision ' + today + ' — confirm the Violation Event',
      'No session record was present when the scheduled check ran at ' + checkedAt + '. The night is now publicly marked MISSED. A Violation Event has been declared for your confirmation under §7: VERIFY or REJECT it from the MRB menu. If a documented §9 exception applies, mark the night EXCEPTION and reject the event with the reason.');
  } catch (e) {}
  notifySubscribers('supervision', 'MISSED: Evening Supervision — ' + today,
    'Micheal Ray Berry — Evening Supervision, ' + today + '\n\n' +
    'The required 6:00–10:00 PM ET session was not on the record when checked at ' + checkedAt + '. The night is marked MISSED.\n\n' +
    'The Violation Event is declared to the Accountability Partner for confirmation under §7.\n\n' +
    'Supervision record: ' + SUB_SITE + '/live/\n');
}

/* A scheduled check may flag a possible lapsed corrective window, but only
   for an explicit assignment linked to a verified source event and only as a
   private review signal. The assignment's recorded due date controls. */
function correctiveDeadlineCheck(today) {
  var gate = activeAgreementGate('correctiveDeadlineCheck');
  if (!gate || today !== gate.today || !dateWithinAgreement(today, gate)) return 0;
  var vals = correctiveSheet().getDataRange().getValues();
  var lapsed = [];
  for (var i = 1; i < vals.length; i++) {
    var linked = verifiedCorrectiveDetails(vals[i], gate);
    if (!linked) continue;
    if (verifiedCorrectiveCompletion(vals[i], gate)) continue;
    if (String(linked.source.values[7] || '').trim()) continue; // a recording is already awaiting AP review
    var deadlineRetryEvidence = verifiedCorrectiveRejectionDetails(linked.source.values, gate);
    if (deadlineRetryEvidence && deadlineRetryEvidence.assignmentId === linked.assignmentId) continue;
    if (today <= linked.due) continue;
    var sourceDigest = linked.marker.split('|')[2];
    var key = 'CORRECTIVE:' + linked.due + ':' + sourceDigest.slice(0, 12);
    if (queueViolationReview(today, key,
      'Corrective-window review — no recording was present when checked after the linked assignment due ' + linked.due + '.')) {
      lapsed.push(linked.due);
    }
  }
  if (lapsed.length) {
    try {
      MailApp.sendEmail(AP_EMAIL,
        'AP REVIEW REQUIRED — possible corrective-window lapse',
        'The scheduled review found no corrective recording after linked assignment due date(s): ' + lapsed.join(', ') + '.\n\n' +
        'Private pending-review signals were added. This is not a deadline verdict, escalation, or new Violation Event. Review the assignment and receipt evidence, then explicitly VERIFY or REJECT each signal.\n\n' +
        'Console: the MRB menu in the record sheet.');
    } catch (e) {}
  }
  return lapsed.length;
}

function apWeeklyReview() {
  var gate = activeAgreementGate('apWeeklyReview');
  if (!gate) return;
  var vals = weighinsSheet().getDataRange().getValues();
  var days = [], missing = [];
  for (var i = 6; i >= 0; i--) {
    var ds = isoDateOffset(gate.today, -i - 1); // last 7 completed ET civil days
    if (!dateWithinAgreement(ds, gate)) continue;
    var row = null;
    for (var r = 1; r < vals.length; r++) {
      var rd = vals[r][0];
      var rds = rd instanceof Date ? Utilities.formatDate(rd, 'America/New_York', 'yyyy-MM-dd') : String(rd).trim();
      if (rds === ds) { row = vals[r]; break; }
    }
    var dayNum = Math.floor((new Date(ds) - new Date(PROJECT_START)) / 864e5) + 1;
    var packet = dailyPacketStateFromRow(ds, row);
    var w = packet.weightRecorded ? parseFloat(row[1]) : NaN;
    days.push('Day ' + dayNum + ' (' + ds + '): ' + (packet.weightRecorded ? w.toFixed(1) + ' lb' : 'no weight') +
      ' · photos ' + packet.photoCount + '/4' +
      ' · video ' + (packet.videoFiled ? '✓' : '✗') +
      ' · tracker ' + (packet.trackerUpdated ? '✓' : '✗') + (packet.complete ? '' : '  ← REVIEW'));
    if (!packet.complete) missing.push(dayNum);
  }

  var pens = [];
  try {
    var pv = violationLogSheet().getDataRange().getValues();
    for (var p = 1; p < pv.length; p++) {
      var pdate = apDateStr(pv[p][0]);
      if (isVerifiedViolationRow(pv[p], gate) && dateWithinAgreement(pdate, gate) && !isResolvedViolationRow(pv[p], gate)) {
        pens.push(pv[p][0] + ' — ' + pv[p][1]);
      }
    }
  } catch (e) {}

  MailApp.sendEmail({
    to: AP_EMAIL,
    subject: 'MRB weekly review — ' + gate.today +
      (missing.length || pens.length ? ' — ACTION NEEDED' : ' — clean week'),
    body: 'Eligible completed days since agreement effective date (' + gate.effectiveDate + '): ' + days.length + '\n' + days.join('\n') +
      '\n\nUnresolved violations: ' + (pens.length ? '\n' + pens.join('\n') : 'none') +
      '\n\n5-MINUTE CHECKLIST\n' +
      '1. Any ← REVIEW lines above: verify against Drive + YouTube, log a Violation Event if unexcused.\n' +
      '2. Unresolved violations: corrective corner time per §8; verify and mark resolved when done.\n' +
      '3. Spot-check one day\u2019s video + photos for documentation standard (§4).\n' +
      '4. Confirm the site is up and showing current data: https://michealrayberry.com\n' +
      '5. Note anything worth recording in the Updates log.\n\n' +
      'Private tracker: ' + privateRecordUrl() +
      '\nAutomated message from the site Apps Script.',
  });
}

/* ═════ SITE STATE (abandonment / completion) ═════
   Private key/value source. The sanitized publisher selects public fields on
   the next build; browser code must never read this tab directly. */

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
  protectOwnerOnlyColumns(sh, 1, 2, 'AP-only agreement and publication state');
  return sh;
}

function siteStateKeyInput(value) {
  var raw = String(value == null ? '' : value);
  var key = raw.trim();
  if (!key || raw !== key || !/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
    throw new Error('invalid or non-canonical Site State key');
  }
  return key;
}

/* One strict reader backs every state access. Duplicate, whitespace-padded,
   or malformed keys are never resolved by row order ("last row wins"). */
function siteStateSnapshot(existingSheet) {
  var dataRange = (existingSheet || siteStateSheet()).getDataRange();
  if (dataRange.getNumColumns() !== 2) {
    throw new Error('Site State schema mismatch; exactly two used columns are required');
  }
  var v = dataRange.getValues();
  if (!v.length || String(v[0][0] || '').trim() !== 'key' || String(v[0][1] || '').trim() !== 'value') {
    throw new Error('Site State schema mismatch; expected key,value headers');
  }
  var out = {};
  var rows = {};
  for (var i = 1; i < v.length; i++) {
    var rawKey = String(v[i][0] == null ? '' : v[i][0]);
    var rawValue = String(v[i][1] == null ? '' : v[i][1]);
    if (!rawKey && !rawValue) continue;
    if (!rawKey && rawValue) throw new Error('Site State row ' + (i + 1) + ' has a value without a key');
    var key = siteStateKeyInput(rawKey);
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new Error('duplicate Site State key: ' + key);
    }
    out[key] = rawValue;
    rows[key] = i + 1;
  }
  return { values: out, rows: rows };
}

function stateGet(k) {
  var key = siteStateKeyInput(k);
  var values = siteStateSnapshot().values;
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
}

/* Internal primitive: the caller must already hold the ScriptLock. Updating
   the in-memory snapshot lets one batch safely append multiple previously
   absent keys without resolving any key twice by row order. */
function stateSetUnlocked(sh, snapshot, key, value) {
  if (Object.prototype.hasOwnProperty.call(snapshot.rows, key)) {
    sh.getRange(snapshot.rows[key], 2).setValue(value);
  } else {
    sh.appendRow([key, value]);
    snapshot.rows[key] = sh.getLastRow();
  }
  snapshot.values[key] = String(value);
  if (key === 'start_date') CacheService.getScriptCache().remove('mrb_start_date');
}

/* Commit a related Site State tuple while the caller already owns ScriptLock.
   A non-empty commit value is cleared first and restored last; every batch is
   flushed and read back before success. This gives unlocked readers a
   fail-closed intermediate state and makes partial/reordered writes visible as
   an error rather than a successful transition. */
function stateSetUnlockedBatch(sh, snapshot, changes, failClosedCommitKey, afterFlushValidator) {
  var commitKey = failClosedCommitKey ? siteStateKeyInput(failClosedCommitKey) : '';
  var commitChange = null;
  for (var i = 0; i < changes.length; i++) {
    if (changes[i].key === commitKey) commitChange = changes[i];
  }
  if (commitKey && !commitChange) throw new Error('Site State batch is missing its fail-closed commit key');
  try {
    if (commitKey) {
      stateSetUnlocked(sh, snapshot, commitKey, '');
      SpreadsheetApp.flush();
    }
    for (var n = 0; n < changes.length; n++) {
      if (changes[n].key === commitKey) continue;
      stateSetUnlocked(sh, snapshot, changes[n].key, changes[n].value);
    }
    if (commitChange && commitChange.value) {
      stateSetUnlocked(sh, snapshot, commitKey, commitChange.value);
    }
    SpreadsheetApp.flush();
    var verified = siteStateSnapshot(sh);
    for (var a = 0; a < changes.length; a++) {
      var expected = changes[a];
      if (!Object.prototype.hasOwnProperty.call(verified.values, expected.key) ||
          verified.values[expected.key] !== expected.value) {
        throw new Error('Site State batch verification failed for ' + expected.key);
      }
    }
    return {
      snapshot: verified,
      validation: afterFlushValidator ? afterFlushValidator(verified.values) : null,
    };
  } catch (verificationError) {
    if (commitChange && commitChange.value) {
      try {
        stateSetUnlocked(sh, snapshot, commitKey, '');
        SpreadsheetApp.flush();
        var rolledBack = siteStateSnapshot(sh);
        if (!Object.prototype.hasOwnProperty.call(rolledBack.values, commitKey) ||
            rolledBack.values[commitKey] !== '') {
          throw new Error('commit key remained set after rollback');
        }
      } catch (rollbackError) {
        throw new Error('Site State activation validation failed and commit-key rollback could not be verified: ' +
          String(rollbackError.message || rollbackError) + '; original error: ' +
          String(verificationError.message || verificationError));
      }
    }
    throw verificationError;
  }
}

function stateSetWhileAgreementActive(context, key, value) {
  var normalizedKey = siteStateKeyInput(key);
  var normalizedValue = String(value == null ? '' : value);
  return withActiveAgreementMutation(context, function () {
    var sh = siteStateSheet(), snapshot = siteStateSnapshot();
    stateSetUnlocked(sh, snapshot, normalizedKey, normalizedValue);
    return { changed: true };
  });
}

/* Public lock boundary for Site State writes. Every requested key is written,
   flushed, and read back under one ScriptLock. When failClosedCommitKey is
   supplied, it is cleared+flushed first and restored last, so unlocked readers
   can observe only an inactive intermediate agreement state. The optional
   validators run under the lock and must not call stateSet()/stateSetBatch(). */
function stateSetBatch(changes, afterFlushValidator, failClosedCommitKey, beforeWriteValidator) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('Site State batch is empty');
  var normalized = [];
  var seen = {};
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i] || {};
    var key = siteStateKeyInput(change.key);
    if (Object.prototype.hasOwnProperty.call(seen, key)) throw new Error('duplicate Site State batch key: ' + key);
    seen[key] = true;
    normalized.push({ key: key, value: String(change.value == null ? '' : change.value) });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Site State is busy; retry');
  try {
    var sh = siteStateSheet();
    var snapshot = siteStateSnapshot();
    var commitKey = failClosedCommitKey ? siteStateKeyInput(failClosedCommitKey) : '';
    if (beforeWriteValidator) beforeWriteValidator(snapshot.values);
    return stateSetUnlockedBatch(sh, snapshot, normalized, commitKey, afterFlushValidator);
  } finally {
    lock.releaseLock();
  }
}

function stateSet(k, val) {
  return stateSetBatch([{ key: k, value: val }]);
}

function siteStateAll() {
  return siteStateSnapshot().values;
}

/* Central consent/execution gate. Edition 2 enforcement is active only when:
   1. the AP has recorded verification of Micheal's signature;
   2. the AP has recorded verification of the AP signature; and
   3. an Edition 2 confirmation URL has a same-date, challenge-consumed
      confirmation attestation.

   Missing sheets, malformed state, and read errors all mean INACTIVE. These
   state values are status markers, not signature images or other personal
   data. See menuVerifyEdition2Signatures() and README.md for activation. */
function agreementExecutionState() {
  var out = {
    active: false,
    edition: AGREEMENT_EDITION,
    editionSelected: false,
    mrbSignatureVerified: false,
    apSignatureVerified: false,
    consentConfirmationFiled: false,
    consentConfirmationVerified: false,
    effectiveDate: '',
    missing: [],
  };
  try {
    out.today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    var siteState = readOnlyExactSheet('Site State');
    requireOwnerOnlyProtection(siteState, 1, 2, 'AP-only agreement and publication state');
    var state = siteStateSnapshot(siteState).values;
    try { out.projectStart = isoDateInput(state.start_date, 'explicit Site State start_date'); }
    catch (startErr) { out.missing.push('valid explicit Site State start_date'); }
    out.editionSelected = String(state.agreement_edition || '') === String(AGREEMENT_EDITION);
    try {
      out.mrbSignatureDate = isoDateInput(state.mrb_signature_verified_at, 'Micheal signature verification date');
      out.mrbSignatureVerified = true;
    } catch (mrbErr) {}
    try {
      out.apSignatureDate = isoDateInput(state.ap_signature_verified_at, 'AP signature verification date');
      out.apSignatureVerified = true;
    } catch (apErr) {}

    // Gate evaluation is strictly read-only. Legacy schemas and missing
    // protections are handled by setup; until then they fail closed here.
    var confirmations = readOnlyExactSheet('Confirmations');
    requireOwnerOnlyProtection(confirmations, 1, 6, 'AP-only agreement confirmation evidence');
    var attestations = readOnlyExactSheet('Attestation');
    requireOwnerOnlyProtection(attestations, 1, 14, 'AP-only server-sealed attestation evidence');
    var correctiveEvidence = readOnlyExactSheet('Corrective Log');
    requireOwnerOnlyProtection(correctiveEvidence, 1, 6, 'AP-only corrective assignment evidence');
    var violationEvidence = readOnlyExactSheet('Violation Log');
    requireOwnerOnlyProtection(violationEvidence, 5, 2, 'AP-only violation resolution evidence');
    requireOwnerOnlyProtection(violationEvidence, 9, 1, 'AP-only event verification markers');
    var attestationValues = attestations.getDataRange().getValues();
    var attestationSecret = existingSealSecret();
    if (confirmations && attestations) {
      var cv = confirmations.getDataRange().getValues();
      var confirmationKeys = {};
      for (var i = 1; i < cv.length; i++) {
        if (Number(cv[i][2]) !== AGREEMENT_EDITION) continue;
        var date = apDateStr(cv[i][1]);
        try { date = isoDateInput(date, 'consent confirmation date'); }
        catch (confirmationDateError) { continue; }
        var confirmationKey = AGREEMENT_EDITION + '|' + date;
        if (confirmationKeys[confirmationKey]) throw new Error('duplicate Edition ' + AGREEMENT_EDITION + ' confirmation date: ' + date);
        confirmationKeys[confirmationKey] = true;
        var loggedAt = new Date(cv[i][0]);
        if (isNaN(loggedAt.getTime()) || Utilities.formatDate(loggedAt, 'America/New_York', 'yyyy-MM-dd') !== date) continue;
        var confirmationDay = Number(cv[i][3]);
        var expectedConfirmationDay = out.projectStart
          ? Math.floor((new Date(date) - new Date(out.projectStart)) / 864e5) + 1
          : 0;
        if (!isFinite(confirmationDay) || Math.floor(confirmationDay) !== confirmationDay ||
            confirmationDay < 1 || confirmationDay !== expectedConfirmationDay) continue;
        var canonicalUrl;
        try { canonicalUrl = confirmationUrlInput(cv[i][4]); }
        catch (urlErr) { continue; }
        var storedSeal, exactAttestation, fingerprint;
        try {
          storedSeal = attestationSealInput(cv[i][5], 'stored confirmation attestation seal');
          exactAttestation = acceptedAttestationForSeal(
            date, 'confirmation', storedSeal, attestationValues, attestationSecret
          );
          fingerprint = agreementConfirmationFingerprint(AGREEMENT_EDITION, date, canonicalUrl, exactAttestation);
        } catch (attestationError) { continue; }
        // The earliest fully bound confirmation establishes the prerequisite.
        // Later evidence must never move the effective date forward and erase
        // an already-operative interval.
        if (!out.consentDate || date < out.consentDate) {
          out.consentDate = date;
          out.consentFingerprint = fingerprint;
        }
      }
      out.consentConfirmationFiled = !!out.consentDate && !!out.consentFingerprint;
    }
    try {
      out.reviewedConsentDate = isoDateInput(state.agreement_confirmation_date, 'AP-reviewed confirmation date');
      out.confirmationReviewDate = isoDateInput(state.agreement_confirmation_verified_at, 'confirmation review date');
      out.reviewedConsentFingerprint = sha256Input(
        state.agreement_confirmation_fingerprint,
        'AP-reviewed confirmation fingerprint'
      );
      out.consentConfirmationVerified = !!out.consentDate && !!out.consentFingerprint &&
        out.reviewedConsentDate === out.consentDate &&
        secureTextEquals(out.reviewedConsentFingerprint, out.consentFingerprint);
    } catch (confirmationReviewError) {}
  } catch (e) {
    out.error = String(e.message || e);
  }

  if (!out.editionSelected) out.missing.push('Edition 2 selection');
  if (!out.mrbSignatureVerified) out.missing.push('verified Micheal signature');
  if (!out.apSignatureVerified) out.missing.push('verified AP signature');
  if (!out.consentConfirmationFiled) out.missing.push('filed Edition 2 consent confirmation');
  if (!out.consentConfirmationVerified) out.missing.push('AP review bound to the filed Edition 2 confirmation');
  // Future-dated prerequisites never activate the gate, even when some other
  // prerequisite is still missing. Report each bad date independently so the
  // operator cannot mistake a partially populated gate for a valid one.
  if (out.mrbSignatureDate && out.today && out.mrbSignatureDate > out.today) {
    out.missing.push('future-dated Micheal signature verification');
  }
  if (out.apSignatureDate && out.today && out.apSignatureDate > out.today) {
    out.missing.push('future-dated AP signature verification');
  }
  if (out.consentDate && out.today && out.consentDate > out.today) {
    out.missing.push('future-dated consent confirmation');
  }
  if (out.confirmationReviewDate && out.today && out.confirmationReviewDate > out.today) {
    out.missing.push('future-dated confirmation review');
  }
  if (out.projectStart && out.today && out.projectStart > out.today) {
    out.missing.push('project start has not arrived');
  }
  if (!out.error && out.projectStart && out.mrbSignatureDate && out.apSignatureDate && out.consentDate &&
      out.consentConfirmationVerified && out.confirmationReviewDate) {
    out.effectiveDate = [out.projectStart, out.mrbSignatureDate, out.apSignatureDate, out.consentDate, out.confirmationReviewDate]
      .sort().pop();
  }
  if (out.projectStart && out.projectStart !== PROJECT_FACTS.startDate) out.error = 'Site State start_date differs from the versioned Edition 2 config';
  if (testPhaseActive(out.today)) {
    out.test = true;
    out.launchDate = PROJECT_LAUNCH;
    out.projectStart = TEST_STATE.start;
    out.effectiveDate = TEST_STATE.start;
    out.missing = [];
    out.active = !out.error;
    return out;
  }
  out.active = !out.error && !!out.effectiveDate && out.effectiveDate <= out.today && out.missing.length === 0;
  return out;
}

function activeAgreementGate(context) {
  var gate = agreementExecutionState();
  if (!gate.active) {
    Logger.log('ENFORCEMENT INACTIVE' + (context ? ' (' + context + ')' : '') + ': ' +
      (gate.error || gate.missing.join(', ') || 'gate state unavailable'));
  }
  return gate.active ? gate : null;
}

function enforcementActive(context) {
  return !!activeAgreementGate(context);
}

function dateWithinAgreement(dateStr, gate) {
  if (!gate || !gate.active) return false;
  var date;
  try { date = isoDateInput(dateStr, 'record date'); } catch (e) { return false; }
  return date >= gate.effectiveDate && date <= gate.today;
}

function agreementDateInput(value, fieldName, gate) {
  var date = isoDateInput(value, fieldName || 'date');
  if (!gate || !gate.active) throw new Error('agreement execution inactive');
  if (date < gate.effectiveDate) throw new Error((fieldName || 'date') + ' precedes agreement effective date');
  if (date > gate.today) throw new Error((fieldName || 'date') + ' is in the future');
  return date;
}

function inactiveEnforcementJson(context) {
  var gate = agreementExecutionState();
  Logger.log('ENFORCEMENT INACTIVE' + (context ? ' (' + context + ')' : '') + ': ' +
    (gate.error || gate.missing.join(', ') || 'gate state unavailable'));
  return jsonOut({ ok: false, error: 'agreement execution inactive', missing: gate.missing });
}

// Consecutive days (ending yesterday) without the current complete file set.
// This is a presence count, not a filing-time verdict or adverse ruling.
function missedDayStreak(activeGate) {
  var gate = activeGate || activeAgreementGate('missedDayStreak');
  if (!gate) return 0;
  var vals = weighinsSheet().getDataRange().getValues();
  var byDate = {};
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    // Weigh-ins is one row per date. Preserve the first row, matching
    // packetState(), if a damaged sheet happens to contain duplicates.
    if (ds && !Object.prototype.hasOwnProperty.call(byDate, ds)) byDate[ds] = vals[i];
  }
  var streak = 0;
  var ds2 = isoDateOffset(gate.today, -1);
  for (var k = 0; k < 60; k++) {
    if (ds2 < gate.effectiveDate) break;
    if (dailyPacketStateFromRow(ds2, byDate[ds2] || null).complete) break;
    streak++;
    ds2 = isoDateOffset(ds2, -1);
  }
  return streak;
}

function abandonmentCheck() {
  var gate = activeAgreementGate('abandonmentCheck');
  if (!gate) return;
  completionStreakAlert(gate);
  var stage = stateGet('abandoned');
  if (stage === 'confirmed') return; // already confirmed — nothing to do
  var streak = missedDayStreak(gate);
  var today = gate.today;
  if (streak < 30 && stateGet('abandonment_review_signal')) {
    stateSetWhileAgreementActive('the abandonment review signal could be cleared', 'abandonment_review_signal', '');
  }
  if (streak >= 30 && stage !== 'presumed') {
    if (stateGet('abandonment_review_signal')) return;
    stateSetWhileAgreementActive('the abandonment review signal could be recorded', 'abandonment_review_signal', 'pending:' + today);
    MailApp.sendEmail(AP_EMAIL, 'AP REVIEW REQUIRED — 30 incomplete current file sets',
      'The current record-presence count reached ' + streak + ' consecutive days without a complete file set.\n\n' +
      'This count does not prove filing timeliness and has not changed the public abandonment state. Review receipts and exceptions, then use MRB menu → Stage only if you explicitly rule that the §11 standard is met.');
    return;
  }
  if ((streak === 7 || streak === 14 || streak === 21) && stage !== 'presumed') {
    try {
      mailMRB('RECORD-PRESENCE WATCH — ' + streak + ' incomplete days',
        streak + ' consecutive days currently lack a complete public file set. This does not establish filing time or an adverse ruling.\n\n' +
        'At 30 the Accountability Partner is asked to review the record and exceptions; the site does not make that judgement automatically.\n\n' +
        'File tonight: ' + PORTAL_URL);
    } catch (e) {}
    MailApp.sendEmail(AP_EMAIL, 'Record-presence warning — ' + streak + ' incomplete days',
      streak + ' consecutive days currently lack a complete public file set. This is not a deadline verdict. At 30, review receipts and exceptions before any manual §11 ruling.');
  }
}

function completionStreakAlert(activeGate) {
  var gate = activeGate || activeAgreementGate('completionStreakAlert');
  if (!gate) return;
  if (stateGet('completed') === 'confirmed') return;
  var vals = weighinsSheet().getDataRange().getValues();
  var byDate = {};
  for (var i = 1; i < vals.length; i++) {
    var ds = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], 'America/New_York', 'yyyy-MM-dd') : String(vals[i][0]).trim();
    var w = parseFloat(vals[i][1]);
    if (dateWithinAgreement(ds, gate) && !isNaN(w)) byDate[ds] = w;
  }
  var streak = 0;
  var ds2 = gate.today;
  for (var k = 0; k < 60; k++) {
    if (ds2 < gate.effectiveDate) break;
    var w2 = byDate[ds2];
    if (w2 === undefined || w2 > PROJECT_FACTS.goalWeightLb) { if (k === 0) { ds2 = isoDateOffset(ds2, -1); continue; } break; } // today may not be filed yet
    streak++;
    ds2 = isoDateOffset(ds2, -1);
  }
  if (streak === 14 || streak === 21 || streak >= PROJECT_FACTS.completionDays) {
    var key = 'COMPLETION_ALERT_' + (streak >= PROJECT_FACTS.completionDays ? PROJECT_FACTS.completionDays : streak);
    var props = PropertiesService.getScriptProperties();
    var recorded = withActiveAgreementMutation('the completion watch marker could be recorded', function () {
      if (props.getProperty(key)) return { changed: false, recorded: false };
      props.setProperty(key, '1');
      return { changed: false, recorded: true };
    });
    if (!recorded.recorded) return;
    MailApp.sendEmail(AP_EMAIL,
      streak >= PROJECT_FACTS.completionDays ? 'COMPLETION CONDITION MET — ' + PROJECT_FACTS.completionDays + ' days at/under ' + PROJECT_FACTS.goalWeightLb + ' (§6.3)' : 'Completion watch — ' + streak + ' days at/under ' + PROJECT_FACTS.goalWeightLb,
      streak >= PROJECT_FACTS.completionDays
        ? 'The tracker shows 28 consecutive days at or under 200.0 lbs.\n\nSchedule the official on-camera completion weigh-in (§6.3). Once verified, declare completion from the record sheet (MRB menu → Stage)'
        : streak + ' consecutive days at or under 200.0 lbs. At 28, the completion condition is met pending the official weigh-in.');
  }
}

function correctiveSheet() {
  var sh = ss().getSheetByName('Corrective Log');
  if (!sh) throw new Error('Corrective Log sheet is missing; run setup');
  var expected = TABS['Corrective Log'];
  var usedColumns = sh.getDataRange().getNumColumns();
  if (usedColumns !== expected.length) throw new Error('Corrective Log schema is not current; run setup');
  var actual = sh.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] || '').trim() !== expected[i]) {
      throw new Error('Corrective Log schema mismatch at column ' + (i + 1) + '; run setup');
    }
  }
  requireOwnerOnlyProtection(sh, 1, 6, 'AP-only corrective assignment evidence');
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
    .addItem('Agreement gate · show status', 'menuAgreementExecutionStatus')
    .addItem('Agreement gate · verify both signatures', 'menuVerifyEdition2Signatures')
    .addItem('Agreement gate · revoke signature verification', 'menuClearEdition2Signatures')
    .addSeparator()
    .addItem('Declare violation (today)', 'menuDeclareViolation')
    .addItem('Review selected signal · VERIFY', 'menuVerifyViolation')
    .addItem('Review selected signal · REJECT', 'menuRejectViolation')
    .addItem('Resolve selected entry', 'menuResolveViolation')
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

function menuAgreementExecutionStatus() {
  var gate = agreementExecutionState();
  SpreadsheetApp.getUi().alert('Edition ' + AGREEMENT_EDITION + ' enforcement gate',
    gate.active
      ? 'ACTIVE effective ' + gate.effectiveDate + '. Both signatures are recorded as verified and an attested Edition ' + AGREEMENT_EDITION + ' Consent Confirmation is filed' + (gate.consentDate ? ' (' + gate.consentDate + ')' : '') + '. Dates before the effective date are non-operative.'
      : 'INACTIVE. Missing: ' + (gate.missing.join(', ') || gate.error || 'gate state unavailable') + '.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuVerifyEdition2Signatures() {
  var ui = SpreadsheetApp.getUi();
  var before = agreementExecutionState();
  if (before.active) {
    ui.alert('Edition ' + AGREEMENT_EDITION + ' is already ACTIVE effective ' + before.effectiveDate + '. Activation evidence is write-once; revoke it first only when a deliberate new execution is required.');
    return;
  }
  if (!before.consentDate || !before.consentFingerprint) {
    ui.alert('No valid Edition ' + AGREEMENT_EDITION + ' confirmation is ready for review. File its canonical URL and same-date accepted attestation first.');
    return;
  }
  var answer = ui.alert('Verify Edition ' + AGREEMENT_EDITION + ' signatures',
    'Use this only after personally checking the final Edition ' + AGREEMENT_EDITION + ' document, confirming that Micheal and the Accountability Partner both signed it, and reviewing the filed Consent Confirmation. Signature images do not belong in Site State. Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  var stamp = menuToday();
  var activation;
  try {
    activation = stateSetBatch([
      { key: 'agreement_edition', value: String(AGREEMENT_EDITION) },
      { key: 'mrb_signature_verified_at', value: stamp },
      { key: 'ap_signature_verified_at', value: stamp },
      { key: 'agreement_confirmation_date', value: before.consentDate },
      { key: 'agreement_confirmation_verified_at', value: stamp },
      { key: 'agreement_confirmation_fingerprint', value: before.consentFingerprint },
    ], function () {
      var verifiedGate = agreementExecutionState();
      if (!verifiedGate.active || !verifiedGate.editionSelected ||
          verifiedGate.mrbSignatureDate !== stamp || verifiedGate.apSignatureDate !== stamp ||
          verifiedGate.reviewedConsentDate !== before.consentDate ||
          verifiedGate.confirmationReviewDate !== stamp ||
          !verifiedGate.consentConfirmationVerified ||
          !secureTextEquals(verifiedGate.consentFingerprint, before.consentFingerprint)) {
        throw new Error('the agreement gate did not validate the complete activation batch');
      }
      return verifiedGate;
    }, 'agreement_edition', function () {
      var lockedBefore = agreementExecutionState();
      if (lockedBefore.active || lockedBefore.editionSelected) {
        throw new Error('Edition ' + AGREEMENT_EDITION + ' is already selected; activation evidence was not rewritten');
      }
      if (lockedBefore.consentDate !== before.consentDate ||
          !secureTextEquals(lockedBefore.consentFingerprint, before.consentFingerprint)) {
        throw new Error('Consent Confirmation evidence changed during review; reopen the activation menu');
      }
    });
  } catch (activationError) {
    ui.alert('Activation was not deployed: ' + String(activationError.message || activationError));
    return;
  }
  var gate = activation.validation;
  triggerDeploy();
  ui.alert('Edition ' + AGREEMENT_EDITION + ' enforcement is ACTIVE effective ' + gate.effectiveDate + '.');
}

function menuClearEdition2Signatures() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Revoke signature verification',
    'This immediately disables all gated enforcement and automated record publication. Continue?',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  try {
    stateSetBatch([
      { key: 'agreement_edition', value: '' },
      { key: 'mrb_signature_verified_at', value: '' },
      { key: 'ap_signature_verified_at', value: '' },
      { key: 'agreement_confirmation_date', value: '' },
      { key: 'agreement_confirmation_verified_at', value: '' },
      { key: 'agreement_confirmation_fingerprint', value: '' },
    ], function () {
      var revokedGate = agreementExecutionState();
      if (revokedGate.active || revokedGate.editionSelected || revokedGate.mrbSignatureVerified ||
          revokedGate.apSignatureVerified || revokedGate.consentConfirmationVerified) {
        throw new Error('the agreement gate did not validate the complete revocation batch');
      }
      return revokedGate;
    }, 'agreement_edition');
  } catch (revocationError) {
    ui.alert('Revocation was not deployed: ' + String(revocationError.message || revocationError));
    return;
  }
  triggerDeploy();
  ui.alert('Signature verification cleared. Enforcement is INACTIVE.');
}

function menuDeclareViolation() {
  var ui = SpreadsheetApp.getUi();
  var gate = activeAgreementGate('menuDeclareViolation');
  if (!gate || !dateWithinAgreement(gate.today, gate)) { ui.alert('Agreement execution is inactive. No violation was declared.'); return; }
  var r = ui.prompt('Declare violation (today)', 'Nature of the documentation failure — published verbatim (§8: factual and neutral):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  var violation;
  try { violation = sheetText(r.getResponseText(), 1000, 'violation'); }
  catch (inputError) { ui.alert(String(inputError.message || inputError)); return; }
  if (ui.alert('Verify Violation Event', 'I have personally reviewed the evidence and rule that this exact dated statement is a Violation Event:\n\n' + violation, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var declared;
  try { declared = appendVerifiedViolation(gate.today, violation, gate); }
  catch (declarationError) { ui.alert(String(declarationError.message || declarationError)); return; }
  if (declared.appended) {
    triggerDeploy();
    try { mrbViolationNotice(declared.row); } catch (e) {}
  }
  ui.alert(declared.appended
    ? 'Entered. The site shows it on the next publish (Attestation → MRB → Publish site now).'
    : 'That exact AP-verified event is already recorded as ' + declared.ref + '; no duplicate row was added.');
}

function selectedViolationReview() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'Violation Log') throw new Error('Select a row in the Violation Log tab first.');
  var rowNumber = sh.getActiveRange().getRow();
  if (rowNumber < 2) throw new Error('Select an entry row, not the header.');
  var values = sh.getRange(rowNumber, 1, 1, 9).getValues()[0];
  return {
    sheet: sh,
    rowNumber: rowNumber,
    values: values,
    identity: violationSelectionIdentity(values),
  };
}

/* Physical row numbers can change while an AP prompt is open. Verified rows
   bind to their immutable APV1 marker; pending rows bind to an exact snapshot.
   The locked mutation re-resolves that identity and rejects ambiguity. */
function violationSelectionIdentity(values) {
  if (!values || values.length < 9) throw new Error('violation row is incomplete');
  var marker = String(values[8] || '').trim();
  if (/^APV1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}$/.test(marker)) return 'event:' + marker;
  var normalized = values.slice(0, 9).map(function (value, index) {
    if ((index === 0 || index === 3 || index === 4) && value instanceof Date) return apDateStr(value);
    return String(value == null ? '' : value);
  });
  return 'snapshot:' + sha256Text(JSON.stringify(normalized));
}

function violationRowForIdentity(rows, expectedIdentity, fallbackRow, lastRow, fieldName) {
  if (!expectedIdentity) return sheetRowInput(fallbackRow, lastRow, fieldName || 'violation row');
  var matches = [];
  for (var i = 1; i < rows.length; i++) {
    var matchesIdentity = violationSelectionIdentity(rows[i]) === expectedIdentity;
    if (expectedIdentity.indexOf('ref:V-') === 0) {
      var details = verifiedViolationDetails(rows[i]);
      matchesIdentity = !!details && 'ref:V-' + publicViolationToken(details.marker) === expectedIdentity;
    } else if (expectedIdentity.indexOf('review:') === 0) {
      matchesIdentity = 'review:' + violationReviewKey(rows[i][2]) === expectedIdentity;
    }
    if (matchesIdentity) matches.push(i + 1);
  }
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? 'the selected violation identity is duplicated; AP repair required'
      : 'the selected violation changed while the action was pending; review it again');
  }
  return matches[0];
}

function apiViolationReviewIdentity(value) {
  var key = sheetText(value, 200, 'violation review key');
  if (!/^[A-Z]+:[A-Za-z0-9._:-]+$/.test(key)) throw new Error('invalid violation review key');
  return 'review:' + key;
}

function apiViolationRefIdentity(value) {
  return 'ref:' + correctiveReferenceInput(value);
}

function verifyViolationReview(rowNumber, finalText, gate, expectedIdentity) {
  var verified = withViolationLogMutation(function (sh, allRows) {
    var lockedGate = agreementExecutionState();
    if (!lockedGate.active) throw new Error('agreement execution became inactive before the review could be verified');
    var row = violationRowForIdentity(allRows, expectedIdentity, rowNumber, sh.getLastRow(), 'violation row');
    var values = allRows[row - 1];
    if (isVerifiedViolationRow(values, lockedGate)) throw new Error('This event is already AP-verified.');
    verifiedViolationSummary(allRows, lockedGate);
    var date = agreementDateInput(apDateStr(values[0]), 'violation date', lockedGate);
    var text = sheetText(finalText == null ? values[1] : finalText, 1000, 'violation');
    if (!text) throw new Error('violation text is required');
    var marker = violationEventMarker(date, text, lockedGate.today);
    for (var duplicateIndex = 1; duplicateIndex < allRows.length; duplicateIndex++) {
      if (duplicateIndex + 1 === row) continue;
      if (String(allRows[duplicateIndex][8] || '').trim() === marker) {
        throw new Error('the APV1 marker is already present at row ' + (duplicateIndex + 1) + '; AP repair required');
      }
      if (apDateStr(allRows[duplicateIndex][0]) !== date || String(allRows[duplicateIndex][1] || '').trim() !== text) continue;
      if (isVerifiedViolationRow(allRows[duplicateIndex], lockedGate)) {
        throw new Error('this exact dated event is already AP-verified at row ' + (duplicateIndex + 1));
      }
    }
    var key = violationReviewKey(values[2]);
    var committedValues = values.slice(1, 9); // columns B:I
    committedValues[0] = text;
    committedValues[1] = 'Unresolved · AP verified ' + lockedGate.today + (key ? ' · ' + key : '');
    committedValues[7] = marker;
    sh.getRange(row, 2, 1, 8).setValues([committedValues]);
    return { changed: true, row: row, date: date, text: text, marker: marker };
  });
  triggerDeploy();
  try { mrbViolationNotice(verified.row); } catch (e) {}
  try {
    var lvl = consequenceForLevel(verifiedViolationCount());
    var esc = /72-hour corrective deadline/i.test(verified.text);
    notifySubscribers(esc ? 'escalation' : 'violation',
      (esc ? 'ESCALATION: ' : 'VIOLATION: ') + verified.text.slice(0, 80),
      'Micheal Ray Berry — ' + (esc ? 'Escalation' : 'New Violation Event') + ', ' + verified.date + '\n\n' +
      verified.text + '\n\n' +
      'Corrective requirement: Level ' + lvl.level + ' · ' + lvl.mins + ' minutes of corner time, recorded in one unbroken take and published beside the entry. Due within 72 hours of this notice; missing it is a new Violation Event at the next level.\n\n' +
      'Violation log: ' + SUB_SITE + '/violations/\n');
  } catch (ne) { Logger.log('subscriber notice failed: ' + ne); }
  return { date: verified.date, text: verified.text, marker: verified.marker };
}

function rejectViolationReview(rowNumber, reason, gate, expectedIdentity) {
  var note = sheetText(reason || 'not verified as a Violation Event', 1000, 'review reason');
  withViolationLogMutation(function (sh, rows) {
    var lockedGate = agreementExecutionState();
    if (!lockedGate.active) throw new Error('agreement execution became inactive before the review could be rejected');
    var row = violationRowForIdentity(rows, expectedIdentity, rowNumber, sh.getLastRow(), 'violation row');
    var values = rows[row - 1];
    if (isVerifiedViolationRow(values, lockedGate)) throw new Error('A verified event must be resolved or overruled, not rejected as a signal.');
    agreementDateInput(apDateStr(values[0]), 'review date', lockedGate);
    var key = violationReviewKey(values[2]);
    var rejectedValues = values.slice(2, 9); // columns C:I
    rejectedValues[0] = 'Dismissed · AP reviewed ' + lockedGate.today + (key ? ' · ' + key : '');
    rejectedValues[4] = note;
    rejectedValues[6] = '';
    sh.getRange(row, 3, 1, 7).setValues([rejectedValues]);
    return { changed: true };
  });
}

function menuVerifyViolation() {
  var ui = SpreadsheetApp.getUi(), gate = activeAgreementGate('menuVerifyViolation'), selected;
  if (!gate) { ui.alert('Agreement execution is inactive. Nothing was verified.'); return; }
  try { selected = selectedViolationReview(); }
  catch (e) { ui.alert(String(e.message || e)); return; }
  var text = String(selected.values[1] || '').trim();
  if (ui.alert('Verify selected finding', 'I have personally reviewed the source evidence and rule that this exact dated finding is a Violation Event:\n\n' + text, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  try { verifyViolationReview(selected.rowNumber, text, gate, selected.identity); ui.alert('Verified. The event is now eligible for the governed record and consequence count.'); }
  catch (e2) { ui.alert(String(e2.message || e2)); }
}

function menuRejectViolation() {
  var ui = SpreadsheetApp.getUi(), gate = activeAgreementGate('menuRejectViolation'), selected;
  if (!gate) { ui.alert('Agreement execution is inactive. Nothing was reviewed.'); return; }
  try { selected = selectedViolationReview(); }
  catch (e) { ui.alert(String(e.message || e)); return; }
  var r = ui.prompt('Reject selected finding', 'Private AP reason:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try { rejectViolationReview(selected.rowNumber, r.getResponseText(), gate, selected.identity); ui.alert('Rejected. The private signal remains non-operative and cannot be published as a violation.'); }
  catch (e2) { ui.alert(String(e2.message || e2)); }
}

function resolveViolationRow(rowNumber, note, gate, expectedIdentity, expectedReview) {
  var resolutionNote = note ? sheetText(note, 1000, 'resolution note') : '';
  if (!expectedReview) throw new Error('resolution requires the exact reviewed corrective attempt');
  var expectedAssignmentId = correctiveAssignmentIdInput(expectedReview.assignmentId);
  var expectedAttemptId = correctiveAttemptIdInput(expectedReview.attemptId);
  var resolved = withViolationLogMutation(function (sh, rows) {
    var lockedGate = agreementExecutionState();
    if (!lockedGate.active) throw new Error('agreement execution became inactive before the violation could be resolved');
    var row = violationRowForIdentity(rows, expectedIdentity, rowNumber, sh.getLastRow(), 'violation row');
    var values = rows[row - 1];
    var event = verifiedViolationDetails(values, lockedGate);
    if (!event) throw new Error('violation event has not been explicitly AP-verified');
    var currentReview = completedCorrectiveReviewForSource(
      values, lockedGate, expectedAssignmentId, expectedAttemptId
    );
    if ((expectedReview.submitted && currentReview.submitted !== expectedReview.submitted) ||
        (expectedReview.urlHash && currentReview.urlHash !== expectedReview.urlHash) ||
        (expectedReview.completed && currentReview.completed !== expectedReview.completed)) {
      throw new Error('the submitted corrective evidence changed after review; reopen the current entry');
    }
    if (isResolvedViolationRow(values, lockedGate)) {
      return { changed: false, row: row, idempotent: true,
        assignmentId: currentReview.assignmentId, attemptId: currentReview.attemptId };
    }
    var marker = violationResolutionMarker(event.marker, lockedGate.today);
    var replacement = values.slice(2, 6); // columns C:F
    replacement[0] = 'Resolved · ' + lockedGate.today + (resolutionNote ? ' · ' + resolutionNote : '');
    replacement[2] = lockedGate.today;
    replacement[3] = marker;
    sh.getRange(row, 3, 1, 4).setValues([replacement]);
    return { changed: true, row: row, idempotent: false, marker: marker,
      assignmentId: currentReview.assignmentId, attemptId: currentReview.attemptId };
  });
  if (resolved.changed) {
    triggerDeploy();
    try {
      var rv = violationLogSheet().getRange(resolved.row, 1, 1, 2).getValues()[0];
      notifySubscribers('corrected', 'CORRECTION COMPLETED: ' + apDateStr(rv[0]),
        'Micheal Ray Berry — Correction completed\n\n' +
        'Entry: ' + apDateStr(rv[0]) + ' · ' + String(rv[1] || '') + '\n' +
        'Corrective session: COMPLETED · RECORDED · verified by the Accountability Partner ' + Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd') + '.\n\n' +
        'The entry stays on the record. Violation log: ' + SUB_SITE + '/violations/\n');
    } catch (ne) { Logger.log('subscriber notice failed: ' + ne); }
  }
  return resolved;
}

function menuResolveViolation() {
  var ui = SpreadsheetApp.getUi();
  var gate = activeAgreementGate('menuResolveViolation');
  if (!gate) { ui.alert('Agreement execution is inactive. Nothing was resolved.'); return; }
  var selected;
  try { selected = selectedViolationReview(); }
  catch (selectionError) { ui.alert(String(selectionError.message || selectionError)); return; }
  var selectedReview;
  try { selectedReview = completedCorrectiveReviewForSource(selected.values, gate); }
  catch (reviewError) { ui.alert(String(reviewError.message || reviewError)); return; }
  var prompt = ui.prompt('Resolve selected entry',
    'You are accepting the exact completed corrective attempt ' + selectedReview.attemptId +
    ' for assignment ' + selectedReview.assignmentId + '.\n\n' +
    'Optional factual AP review note. This action writes the protected resolution date and APR1 marker:',
    ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  if (ui.alert('Confirm resolution',
      'Mark this AP-verified event resolved only if the same submitted recording is still current?',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  try {
    var result = resolveViolationRow(
      selected.rowNumber, prompt.getResponseText(), gate, selected.identity, selectedReview
    );
    ui.alert(result.idempotent ? 'This entry already has valid AP resolution evidence.' : 'Resolved with protected AP evidence; a sanitized rebuild was triggered.');
  } catch (resolutionError) {
    ui.alert(String(resolutionError.message || resolutionError));
  }
}

function menuOverrule() {
  var ui = SpreadsheetApp.getUi();
  var gate = activeAgreementGate('menuOverrule');
  if (!gate) { ui.alert('Agreement execution is inactive. No obligation was reopened.'); return; }
  var selected;
  try { selected = selectedViolationReview(); }
  catch (selectionError) { ui.alert(String(selectionError.message || selectionError)); return; }
  var row = selected.rowNumber;
  var entryDate = apDateStr(selected.values[0]);
  if (!dateWithinAgreement(entryDate, gate)) { ui.alert('That entry is outside the active agreement period and cannot be reopened.'); return; }
  if (!isVerifiedViolationRow(selected.values, gate)) { ui.alert('That row has no valid AP event-verification marker.'); return; }
  var selectedReview;
  try { selectedReview = pendingCorrectiveReviewForSource(selected.values, gate); }
  catch (reviewError) { ui.alert(String(reviewError.message || reviewError)); return; }
  var r = ui.prompt('Overrule — reopen row ' + row,
    'You are rejecting exact attempt ' + selectedReview.attemptId + ' for assignment ' +
    selectedReview.assignmentId + '.\n\nWhy the submitted session fails the standard (appended to corrections):',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var overruleReason;
  try { overruleReason = sheetText(String(r.getResponseText() || '').trim() || 'fails the §8 standard', 1000, 'overrule reason'); }
  catch (overruleReasonError) { ui.alert(String(overruleReasonError.message || overruleReasonError)); return; }
  try {
    var overruled = withViolationLogMutation(function (lockedSheet, rows) {
      var lockedGate = agreementExecutionState();
      if (!lockedGate.active) throw new Error('agreement execution became inactive before the violation could be reopened');
      var lockedRow = violationRowForIdentity(
        rows, selected.identity, row, lockedSheet.getLastRow(), 'violation row'
      );
      var values = rows[lockedRow - 1];
      agreementDateInput(apDateStr(values[0]), 'violation date', lockedGate);
      if (!isVerifiedViolationRow(values, lockedGate)) throw new Error('That row has no valid AP event-verification marker.');
      var currentReview = pendingCorrectiveReviewForSource(values, lockedGate);
      if (!sameCorrectiveReviewSnapshot(selectedReview, currentReview)) {
        throw new Error('the submitted corrective attempt changed while the review prompt was open; reopen the current row');
      }
      var noteCore = ': overruled — ' + overruleReason + '; replacement session required';
      var priorCorrections = String(values[6] || '').trim();
      var assignmentId = currentReview.assignmentId;
      var rawRejectionEvidence = String(values[5] || '').trim();
      var priorRejection = currentReview.rejection;
      if (/^APJ1\|/.test(rawRejectionEvidence) && !priorRejection) {
        throw new Error('protected corrective rejection evidence is invalid; AP repair required');
      }
      if (priorRejection && priorRejection.assignmentId !== assignmentId) {
        throw new Error('protected corrective rejection evidence belongs to a different assignment; AP repair required');
      }
      var rejectedRecording = String(values[7] || '').trim();
      rejectedRecording = youtubeUrlInput(rejectedRecording, 'submitted corrective recording');
      var note = lockedGate.today + noteCore +
        (rejectedRecording ? '; rejected recording: ' + rejectedRecording : '');
      var rejectionMarker = newCorrectiveRejectionMarker(
        String(values[8] || ''), assignmentId, lockedGate.today, rejectedRecording, priorRejection
      );
      var replacement = values.slice(2, 8); // columns C:H
      replacement[0] = 'Unresolved · overruled · ' + lockedGate.today;
      replacement[1] = '';
      replacement[2] = '';
      replacement[3] = rejectionMarker;
      replacement[4] = priorCorrections ? priorCorrections + '; ' + note : note;
      replacement[5] = '';
      lockedSheet.getRange(lockedRow, 3, 1, 6).setValues([replacement]);
      return { changed: true, idempotent: false };
    });
    if (overruled.changed) triggerDeploy();
    ui.alert(overruled.idempotent
      ? 'This exact overrule was already recorded; no history was duplicated.'
      : 'Rejected. The original assignment remains open and the sitewide notice returns on the next publish; the full session must be repeated.');
  } catch (overruleError) {
    ui.alert(String(overruleError.message || overruleError));
    return;
  }
}

/* §3.4 authorized exception for a scheduled night. Enter the date (default
   tonight) and the reason. The workbook retains the reason for AP review;
   public output exposes only a neutral EXCEPTION status. */
function menuSupervisionException() {
  var ui = SpreadsheetApp.getUi();
  var gate = activeAgreementGate('menuSupervisionException');
  if (!gate) {
    ui.alert('Agreement execution is inactive. No supervision exception was recorded.');
    return;
  }
  var d = ui.prompt('Supervision exception', 'Night (YYYY-MM-DD, blank = tonight):', ui.ButtonSet.OK_CANCEL);
  if (d.getSelectedButton() !== ui.Button.OK) return;
  var requestedDate = d.getResponseText().trim() || menuToday();
  var ds;
  try { ds = agreementDateInput(requestedDate, 'supervision date', gate); }
  catch (dateError) { ui.alert('Date must be a valid YYYY-MM-DD date.'); return; }
  var r = ui.prompt('Supervision exception — ' + ds, 'Authorized reason (§3.4: work schedule · travel · illness · emergency · non-consenting person present · technical failure) — retained in the private record, not published verbatim:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  var reason;
  try { reason = sheetText(r.getResponseText(), 500, 'supervision exception reason'); }
  catch (reasonError) { ui.alert(String(reasonError.message || reasonError)); return; }
  try {
    withActiveAgreementMutation('the supervision exception could be recorded', function (lockedGate) {
      var lockedDate = agreementDateInput(requestedDate, 'supervision date', lockedGate);
      var sr = supervisionRow(lockedDate);
      var st = 'EXCEPTION · ' + reason;
      if (sr) supervisionSheet().getRange(sr.row, 3).setValue(st);
      else supervisionSheet().appendRow([lockedDate, supervisionScheduled(lockedDate) ? 'yes' : 'no', st, '', '', '', 'entered by the AP ' + lockedGate.today]);
      return { changed: true };
    });
  } catch (exceptionError) {
    ui.alert(String(exceptionError.message || exceptionError));
    return;
  }
  ui.alert('Recorded. The public record may show neutral EXCEPTION status only; no MISSED ruling will be made for that night.');
}

function menuPostUpdate() {
  var ui = SpreadsheetApp.getUi();
  var t1 = ui.prompt('Post update', 'Title:', ui.ButtonSet.OK_CANCEL);
  if (t1.getSelectedButton() !== ui.Button.OK || !t1.getResponseText().trim()) return;
  var t2 = ui.prompt('Post update', 'Body — published verbatim under the official AP label:', ui.ButtonSet.OK_CANCEL);
  if (t2.getSelectedButton() !== ui.Button.OK) return;
  var kind = ui.alert('Post update', 'Is this an AMENDMENT to the agreement (§12.1)? YES = logged in Updates AND on the agreement page\u2019s amendment log. NO = ordinary update.', ui.ButtonSet.YES_NO_CANCEL);
  if (kind === ui.Button.CANCEL) return;
  var title, body;
  try {
    title = sheetText(t1.getResponseText(), 300, 'update title');
    body = sheetText(t2.getResponseText(), 5000, 'update body');
  } catch (updateInputError) {
    ui.alert(String(updateInputError.message || updateInputError));
    return;
  }
  tab('Updates').appendRow([menuToday(), kind === ui.Button.YES ? 'amendment' : 'official', title, body, '']);
  ui.alert('Recorded privately. It appears in Updates' + (kind === ui.Button.YES ? ' and on the agreement page' : '') + ' only after the next sanitized site publish.');
}

function menuStage(key, val, label) {
  var ui = SpreadsheetApp.getUi();
  var gate = null;
  if (val) {
    gate = activeAgreementGate('menuStage ' + key + '=' + val);
    if (!gate || !dateWithinAgreement(gate.today, gate)) {
      ui.alert('Agreement execution is inactive. This stage transition was not applied. Clearing an existing stage remains available.');
      return;
    }
  }
  if (ui.alert('Stage change', label, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  try {
    if (!val) {
      var clearChanges = [{ key: key, value: '' }];
      if (key === 'abandoned') clearChanges.push({ key: 'abandoned_date', value: '' });
      if (key === 'completed') clearChanges.push({ key: 'completed_date', value: '' });
      stateSetBatch(clearChanges);
    } else {
      withActiveAgreementMutation('the ' + key + ' stage transition could be recorded', function (lockedGate) {
        var stateSheet = siteStateSheet();
        var snapshot = siteStateSnapshot();
        var currentStage = String(snapshot.values[key] || '');
        if (currentStage === 'confirmed' && val !== 'confirmed') {
          throw new Error('clear the confirmed ' + key + ' stage before recording a different stage');
        }
        var stageChanges = [];
        if (key === 'abandoned' && !dateWithinAgreement(snapshot.values.abandoned_date, lockedGate)) {
          stageChanges.push({ key: 'abandoned_date', value: lockedGate.today });
        }
        if (key === 'completed' && val === 'confirmed' && !dateWithinAgreement(snapshot.values.completed_date, lockedGate)) {
          stageChanges.push({ key: 'completed_date', value: lockedGate.today });
        }
        if (currentStage === val && !stageChanges.length) return { changed: false, idempotent: true };
        stageChanges.push({ key: key, value: val });
        stateSetUnlockedBatch(stateSheet, snapshot, stageChanges, key);
        return { changed: true };
      });
    }
  } catch (stageError) {
    ui.alert(String(stageError.message || stageError));
    return;
  }
  ui.alert('Done. The public site changes only after the next sanitized publish.');
}
function menuAbandonPresumed()  { menuStage('abandoned', 'presumed',  'Set PRESUMED ABANDONED (§11)? Reversible.'); }
function menuAbandonConfirmed() { menuStage('abandoned', 'confirmed', 'CONFIRM abandonment (§11)? The site records a durable confirmed ruling, subject to safety, privacy, consent, and legal redaction or takedown requirements.'); }
function menuAbandonClear()     { menuStage('abandoned', '',          'Clear the abandonment stage (documented §9 exception)?'); }
function menuCompleteConfirmed(){ menuStage('completed', 'confirmed', 'CONFIRM completion (§6.3)? The site records a durable confirmed result, subject to safety, privacy, consent, and legal redaction or takedown requirements.'); }
function menuCompleteClear()    { menuStage('completed', '',          'Clear the completion stage?'); }

/* Warning-only protections on machine-written data: a stray edit shows a
   warning instead of silently corrupting a parsed field. */
function applySheetGuards() {
  var s = ss();
  var count = 0;
  [['Violation Log', [4, 8]]].forEach(function (spec) {
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
  protectViolationEventVerification(violationLogSheet());
  protectViolationResolutionFields(violationLogSheet());
  protectAgreementControlSheets();
  SpreadsheetApp.getUi().alert('Applied ' + count + ' warning-only protection(s), plus owner-only agreement-state, confirmation-evidence, event-verification, and resolution-evidence protections.');
}

/* ═════ ACCOUNTABILITY-PARTNER ENDPOINTS ═════
   Participant weekly and confirmation filing uses the separately authorized
   weeklyfiled/confirmationfiled routes above; ap* actions remain AP-only. */

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
  out.reviewSignals = [];
  var violationGate = activeAgreementGate('handleApState violations');
  for (var p = 1; p < pv.length; p++) {
    if (!violationGate || !pv[p][0]) continue;
    var violationDate = apDateStr(pv[p][0]);
    if (!dateWithinAgreement(violationDate, violationGate)) continue;
    var violationSummary = { date: violationDate, violation: String(pv[p][1] || ''), status: String(pv[p][2] || '') };
    var verifiedEvent = verifiedViolationDetails(pv[p], violationGate);
    if (verifiedEvent) {
      violationSummary.ref = 'V-' + publicViolationToken(verifiedEvent.marker);
      out.violations.push(violationSummary);
    } else if (/^Pending AP review\b/i.test(violationSummary.status)) {
      violationSummary.review_key = violationReviewKey(violationSummary.status);
      out.reviewSignals.push(violationSummary);
    }
  }
  out.siteState = siteStateAll();
  out.missedStreak = missedDayStreak();
  var cs = correctiveSheet().getDataRange().getValues();
  out.corrective = [];
  for (var c = 1; c < cs.length; c++) {
    if (!cs[c][0]) continue;
    var correctiveMarker = correctiveSourceMarker(cs[c][3]);
    var apCorrectiveDetails = violationGate ? verifiedCorrectiveDetails(cs[c], violationGate, true) : null;
    var apCorrectiveCompletion = violationGate ? verifiedCorrectiveCompletion(cs[c], violationGate) : null;
    var apRetryEvidence = apCorrectiveDetails
      ? verifiedCorrectiveRejectionDetails(apCorrectiveDetails.source.values, violationGate) : null;
    out.corrective.push({
      ref: correctiveMarker ? 'V-' + publicViolationToken(correctiveMarker) : '',
      assignment_id: String(cs[c][5] || ''),
      attempt_id: apCorrectiveCompletion ? apCorrectiveCompletion.attemptId :
        (apCorrectiveDetails ? correctiveAttemptId(apCorrectiveDetails.assignmentId, apRetryEvidence) : ''),
      date: apDateStr(cs[c][0]),
      assignment: String(cs[c][1] || ''),
      due: apDateStr(cs[c][2]),
      status: String(cs[c][3] || ''),
      completed: apDateStr(cs[c][4]),
    });
  }
  return jsonOut(out);
}

function handleApAction(obj) {
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  try {
    if (obj.action === 'apviolation') {
      if (obj.op === 'declare') {
        var violationGate = activeAgreementGate('AP violation declaration');
        if (!violationGate) return inactiveEnforcementJson('AP violation declaration');
        if (obj.confirm !== 'VERIFY') return jsonOut({ ok: false, error: 'explicit AP verification required (confirm=VERIFY)' });
        var violationDate = agreementDateInput(obj.date || today, 'violation date', violationGate);
        var violationText = sheetText(obj.violation || 'Violation Event', 1000, 'violation');
        var declaredViolation = appendVerifiedViolation(violationDate, violationText, violationGate);
        if (declaredViolation.appended) {
          triggerDeploy();
          try { mrbViolationNotice(declaredViolation.row); } catch (declarationMailError) {}
        }
        return jsonOut({ ok: true, verified: true, idempotent: !declaredViolation.appended, ref: declaredViolation.ref });
      }
      if (obj.op === 'verify' || obj.op === 'reject') {
        var reviewGate = activeAgreementGate('AP violation review');
        if (!reviewGate) return inactiveEnforcementJson('AP violation review');
        if (obj.confirm !== (obj.op === 'verify' ? 'VERIFY' : 'REJECT')) {
          return jsonOut({ ok: false, error: 'explicit AP ' + obj.op + ' confirmation required' });
        }
        var reviewIdentity = apiViolationReviewIdentity(obj.review_key);
        if (obj.op === 'verify') {
          var verifiedReview = verifyViolationReview(0, obj.violation == null ? null : obj.violation, reviewGate, reviewIdentity);
          return jsonOut({ ok: true, verified: true, date: verifiedReview.date });
        }
        rejectViolationReview(0, obj.note || obj.reason, reviewGate, reviewIdentity);
        return jsonOut({ ok: true, verified: false, rejected: true });
      }
      if (obj.op === 'resolve') {
        var resolveGate = activeAgreementGate('AP violation resolution');
        if (!resolveGate) return inactiveEnforcementJson('AP violation resolution');
        var resolution = resolveViolationRow(0, obj.note || '', resolveGate,
          apiViolationRefIdentity(obj.ref), {
            assignmentId: correctiveAssignmentIdInput(obj.assignment_id),
            attemptId: correctiveAttemptIdInput(obj.attempt_id),
          });
        return jsonOut({ ok: true, idempotent: resolution.idempotent,
          assignment_id: resolution.assignmentId, attempt_id: resolution.attemptId });
      }
    }
    if (obj.action === 'apcorrective') {
      if (obj.op === 'assign') {
        var correctiveRequestId = correctiveRequestIdInput(obj.request_id);
        var correctiveGate = activeAgreementGate('AP corrective assignment');
        if (!correctiveGate) return inactiveEnforcementJson('AP corrective assignment');
        var assignment = withActiveAgreementMutation('the AP corrective assignment could be recorded', function (lockedGate) {
          var cor = correctiveSheet();
          var sourceSheet = violationLogSheet();
          var sourceRows = sourceSheet.getDataRange().getValues();
          var sourceViolationRow = violationRowForIdentity(
            sourceRows, apiViolationRefIdentity(obj.ref), 0, sourceSheet.getLastRow(), 'source violation'
          );
          var sourceViolation = sourceRows[sourceViolationRow - 1];
          if (!isVerifiedViolationRow(sourceViolation, lockedGate)) {
            throw new Error('corrective assignment requires an AP-verified source violation');
          }
          var sourceMarker = String(sourceViolation[8] || '');
          var dueDate = isoDateInput(obj.due, 'corrective due date');
          var assignmentText = sheetText(obj.assignment, 1000, 'corrective assignment');
          if (!assignmentText) throw new Error('corrective assignment text is required');
          var assignmentId = correctiveAssignmentIdForRequest(sourceMarker, correctiveRequestId);
          var priorCorrectiveRows = cor.getDataRange().getValues();
          var idMatches = [];
          for (var pci = 1; pci < priorCorrectiveRows.length; pci++) {
            if (String(priorCorrectiveRows[pci][5] || '').trim().toUpperCase() === assignmentId) idMatches.push(pci + 1);
          }
          if (idMatches.length > 1) throw new Error('duplicate corrective assignment identity; AP repair required');
          if (idMatches.length === 1) {
            var priorRow = priorCorrectiveRows[idMatches[0] - 1];
            var priorDetails = verifiedCorrectiveDetails(priorRow, lockedGate, true);
            if (!priorDetails || priorDetails.marker !== sourceMarker ||
                String(priorRow[1] || '') !== assignmentText || apDateStr(priorRow[2]) !== dueDate) {
              throw new Error('request_id is already bound to different or invalid corrective assignment data');
            }
            return { changed: false, idempotent: true,
              ref: 'V-' + publicViolationToken(sourceMarker), assignmentId: assignmentId };
          }
          if (isResolvedViolationRow(sourceViolation, lockedGate)) {
            throw new Error('corrective assignment source is already resolved');
          }
          if (dueDate < lockedGate.today) throw new Error('corrective due date precedes assignment date');
          var openAssignments = openCorrectiveAssignmentsForMarker(sourceMarker, lockedGate);
          if (openAssignments.length) throw new Error('source event already has an open corrective assignment');
          for (var priorIndex = 1; priorIndex < priorCorrectiveRows.length; priorIndex++) {
            if (correctiveSourceMarker(priorCorrectiveRows[priorIndex][3]) === sourceMarker) {
              throw new Error('source event already has a corrective assignment; assignment generations are not implicit');
            }
          }
          cor.appendRow([lockedGate.today, assignmentText, dueDate,
            'Assigned · ' + sourceMarker, '', assignmentId]);
          return { changed: true, idempotent: false,
            ref: 'V-' + publicViolationToken(sourceMarker), assignmentId: assignmentId };
        });
        return jsonOut({ ok: true, idempotent: assignment.idempotent === true,
          ref: assignment.ref, assignment_id: assignment.assignmentId });
      }
      if (obj.op === 'complete') {
        var requestedAssignmentId = correctiveAssignmentIdInput(obj.assignment_id);
        var requestedAttemptId = correctiveAttemptIdInput(obj.attempt_id);
        var completionGate = activeAgreementGate('AP corrective completion');
        if (!completionGate) return inactiveEnforcementJson('AP corrective completion');
        var correctiveCompletion = withActiveAgreementMutation('the AP corrective completion could be recorded', function (lockedGate) {
          var cor = correctiveSheet();
          var sourceRows = violationLogSheet().getDataRange().getValues();
          var sourceRow = violationRowForIdentity(
            sourceRows, apiViolationRefIdentity(obj.ref), 0, sourceRows.length, 'source violation'
          );
          var sourceDetails = verifiedViolationDetails(sourceRows[sourceRow - 1], lockedGate);
          if (!sourceDetails) throw new Error('corrective completion requires an AP-verified source event');
          var correctiveRows = cor.getDataRange().getValues();
          var assignmentRows = [];
          for (var cri = 1; cri < correctiveRows.length; cri++) {
            if (String(correctiveRows[cri][5] || '').trim().toUpperCase() === requestedAssignmentId) {
              assignmentRows.push(cri + 1);
            }
          }
          if (assignmentRows.length !== 1) {
            throw new Error(assignmentRows.length ? 'corrective assignment identity is duplicated; AP repair required' : 'corrective assignment identity was not found');
          }
          var correctiveRow = assignmentRows[0];
          var correctiveValues = correctiveRows[correctiveRow - 1];
          var linkedCorrective = verifiedCorrectiveDetails(correctiveValues, lockedGate, true);
          if (!linkedCorrective) throw new Error('corrective assignment is not bound to a unique AP-verified source event');
          if (linkedCorrective.marker !== sourceDetails.marker) {
            throw new Error('corrective assignment does not belong to the supplied violation reference');
          }
          var verifiedExistingCompletion = verifiedCorrectiveCompletion(correctiveValues, lockedGate);
          if (verifiedExistingCompletion) {
            if (verifiedExistingCompletion.attemptId !== requestedAttemptId) {
              throw new Error('corrective completion command targets a stale attempt');
            }
            return { changed: false, idempotent: true, assignmentId: requestedAssignmentId,
              attemptId: requestedAttemptId };
          }
          if (isResolvedViolationRow(sourceRows[sourceRow - 1], lockedGate)) {
            throw new Error('corrective source is resolved but this assignment lacks valid completion evidence');
          }
          var completionRetryEvidence = verifiedCorrectiveRejectionDetails(
            sourceRows[sourceRow - 1], lockedGate
          );
          var rawCompletionRejection = String(sourceRows[sourceRow - 1][5] || '').trim();
          if (/^APJ1\|/.test(rawCompletionRejection) && !completionRetryEvidence) {
            throw new Error('protected corrective rejection evidence is invalid; AP repair required');
          }
          if (completionRetryEvidence && completionRetryEvidence.assignmentId !== requestedAssignmentId) {
            throw new Error('protected corrective rejection evidence belongs to a different assignment; AP repair required');
          }
          var currentAttemptId = correctiveAttemptId(requestedAssignmentId, completionRetryEvidence);
          if (requestedAttemptId !== currentAttemptId) {
            throw new Error('corrective completion command targets a stale attempt');
          }
          var completionTarget = {
            ref: 'V-' + publicViolationToken(linkedCorrective.marker),
            assignmentId: requestedAssignmentId,
            attemptId: requestedAttemptId,
          };
          requireCorrectiveFilingEvidence(completionTarget, sourceRows[sourceRow - 1], lockedGate);
          var openMatches = openCorrectiveAssignmentsForMarker(sourceDetails.marker, lockedGate);
          if (openMatches.length !== 1 || openMatches[0].row !== correctiveRow) {
            throw new Error('corrective assignment is not the unique open assignment for its source event');
          }
          cor.getRange(correctiveRow, 4, 1, 2).setValues([
            [correctiveCompletionStatus(linkedCorrective.marker, requestedAttemptId), lockedGate.today]
          ]);
          return { changed: true, idempotent: false, assignmentId: requestedAssignmentId,
            attemptId: requestedAttemptId };
        });
        return jsonOut({ ok: true, idempotent: correctiveCompletion.idempotent === true,
          assignment_id: correctiveCompletion.assignmentId,
          attempt_id: correctiveCompletion.attemptId });
      }
    }
    if (obj.action === 'apabandon') {
      if (obj.op === 'presume') {
        var abandonmentGate = activeAgreementGate('AP abandonment presumption');
        if (!abandonmentGate) return inactiveEnforcementJson('AP abandonment presumption');
        withActiveAgreementMutation('the AP abandonment presumption could be recorded', function (lockedGate) {
          var abandonmentDate = agreementDateInput(obj.date || lockedGate.today, 'abandonment date', lockedGate);
          var stateSheet = siteStateSheet(), snapshot = siteStateSnapshot();
          var existingStage = String(snapshot.values.abandoned || '');
          var existingDate = String(snapshot.values.abandoned_date || '');
          if (existingStage === 'presumed') {
            if (existingDate === abandonmentDate) return { changed: false, idempotent: true };
            throw new Error('abandonment presumption is already recorded on a different date; clear it explicitly before replacing it');
          }
          if (existingStage) throw new Error('an abandonment stage is already recorded; clear it explicitly before presuming abandonment');
          stateSetUnlockedBatch(stateSheet, snapshot, [
            { key: 'abandoned_date', value: abandonmentDate },
            { key: 'abandoned', value: 'presumed' },
          ], 'abandoned');
          return { changed: true };
        });
        return jsonOut({ ok: true });
      }
      if (obj.op === 'confirm') {
        var abandonmentConfirmGate = activeAgreementGate('AP abandonment confirmation');
        if (!abandonmentConfirmGate) return inactiveEnforcementJson('AP abandonment confirmation');
        withActiveAgreementMutation('the AP abandonment confirmation could be recorded', function (lockedGate) {
          var stateSheet = siteStateSheet(), snapshot = siteStateSnapshot();
          var confirmedDate = dateWithinAgreement(snapshot.values.abandoned_date, lockedGate)
            ? String(snapshot.values.abandoned_date) : lockedGate.today;
          if (String(snapshot.values.abandoned || '') === 'confirmed' &&
              String(snapshot.values.abandoned_date || '') === confirmedDate) {
            return { changed: false, idempotent: true };
          }
          stateSetUnlockedBatch(stateSheet, snapshot, [
            { key: 'abandoned_date', value: confirmedDate },
            { key: 'abandoned', value: 'confirmed' },
          ], 'abandoned');
          return { changed: true };
        });
        return jsonOut({ ok: true });
      }
      if (obj.op === 'clear') {
        stateSetBatch([{ key: 'abandoned', value: '' }, { key: 'abandoned_date', value: '' }]);
        return jsonOut({ ok: true });
      }
      if (obj.op === 'statement') { stateSet('ap_statement', sheetText(obj.text, 5000, 'AP statement')); return jsonOut({ ok: true }); }
      if (obj.op === 'links') { stateSet('ap_links', sheetText(obj.links || '[]', 5000, 'AP links')); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apcomplete') {
      if (obj.op === 'confirm') {
        var projectCompletionGate = activeAgreementGate('AP completion confirmation');
        if (!projectCompletionGate) return inactiveEnforcementJson('AP completion confirmation');
        withActiveAgreementMutation('the AP completion confirmation could be recorded', function (lockedGate) {
          var stateSheet = siteStateSheet(), snapshot = siteStateSnapshot();
          var completedDate = dateWithinAgreement(snapshot.values.completed_date, lockedGate)
            ? String(snapshot.values.completed_date) : lockedGate.today;
          if (String(snapshot.values.completed || '') === 'confirmed' &&
              String(snapshot.values.completed_date || '') === completedDate) {
            return { changed: false, idempotent: true };
          }
          stateSetUnlockedBatch(stateSheet, snapshot, [
            { key: 'completed_date', value: completedDate },
            { key: 'completed', value: 'confirmed' },
          ], 'completed');
          return { changed: true };
        });
        return jsonOut({ ok: true });
      }
      if (obj.op === 'clear') {
        stateSetBatch([{ key: 'completed', value: '' }, { key: 'completed_date', value: '' }]);
        return jsonOut({ ok: true });
      }
      if (obj.op === 'statement') { stateSet('completion_statement', sheetText(obj.text, 5000, 'completion statement')); return jsonOut({ ok: true }); }
    }
    if (obj.action === 'apupdate') {
      var updateTitle = sheetText(obj.title, 300, 'update title');
      var updateBody = sheetText(obj.body, 5000, 'update body');
      var updateLink = obj.link ? httpsUrlInput(obj.link, 'update link') : '';
      tab('Updates').appendRow([today, 'official', updateTitle, updateBody, updateLink]);
      return jsonOut({ ok: true });
    }
    /* Weekly reviews and confirmations keep their own logs. Neither is a
       consequence, so neither is ever written to the Violation Log. */
    if (obj.action === 'apweekly') {
      var weeklyGate = activeAgreementGate('AP weekly filing');
      if (!weeklyGate) return inactiveEnforcementJson('AP weekly filing');
      var apWeekly = withActiveAgreementMutation('the AP weekly filing could be recorded', function (lockedGate) {
        var weeklyDate = agreementDateInput(obj.date || lockedGate.today, 'weekly review date', lockedGate);
        var weeklyDay = Math.floor((new Date(weeklyDate) - new Date(lockedGate.projectStart)) / 864e5) + 1;
        if (weeklyDay < 8 || (weeklyDay - 1) % 7 !== 0) throw new Error('weekly review date is not a completed-week review day');
        var expectedWeeklyNumber = (weeklyDay - 1) / 7;
        var requestedWeeklyNumber = obj.week == null || obj.week === ''
          ? expectedWeeklyNumber
          : weeklyIntegerInput(obj.week, 1, 10000, 'weekly review week');
        if (requestedWeeklyNumber !== expectedWeeklyNumber) throw new Error('weekly review week mismatch');
        var weeklyDocumented = weeklyIntegerInput(obj.documented, 0, 7, 'documented-day count');
        var weeklyRequired = weeklyIntegerInput(obj.required, 7, 7, 'required-day count');
        var weeklyOpen = weeklyIntegerInput(obj.open, 0, 1000000, 'open-entry count');
        var weeklyUrl = obj.url ? youtubeUrlInput(obj.url, 'weekly review YouTube URL') : '';
        var weeklyWeight = obj.weight == null || obj.weight === '' ? '' : Number(obj.weight);
        if (weeklyWeight !== '' && (!isFinite(weeklyWeight) || weeklyWeight <= 0 || weeklyWeight > 1500)) {
          throw new Error('invalid weekly weight');
        }
        var authoritative = authoritativeWeeklyFigures({ date: weeklyDate, week: expectedWeeklyNumber }, lockedGate);
        var sameWeight = weeklyWeight === '' ? authoritative.weight === '' :
          authoritative.weight !== '' && Number(weeklyWeight) === Number(authoritative.weight);
        if (weeklyDocumented !== authoritative.documented || weeklyRequired !== authoritative.required ||
            weeklyOpen !== authoritative.openEntries || !sameWeight) {
          throw new Error('weekly figures do not match the authoritative workbook');
        }
        weeklyDocumented = authoritative.documented;
        weeklyRequired = authoritative.required;
        weeklyOpen = authoritative.openEntries;
        weeklyWeight = authoritative.weight;
        var wk = tab('Weekly Log');
        var apWeekMatches = weeklyRowsForWeek(wk, expectedWeeklyNumber);
        var apWeekDateMatches = weeklyRowsForDate(wk, weeklyDate);
        if (apWeekMatches.length > 1 || apWeekDateMatches.length > 1) {
          throw new Error('duplicate weekly records require AP repair');
        }
        if (!apWeekMatches.length && apWeekDateMatches.length) {
          throw new Error('the existing weekly row has an invalid or conflicting week; AP repair required');
        }
        if (apWeekMatches.length) {
          var apWeekCurrent = apWeekMatches[0].values;
          if (apDateStr(apWeekCurrent[1]) !== weeklyDate) {
            throw new Error('week ' + expectedWeeklyNumber + ' is already filed for a different review date');
          }
          var apCurrentWeight = String(apWeekCurrent[5] == null ? '' : apWeekCurrent[5]).trim();
          var apCurrentUrl = String(apWeekCurrent[7] || '').trim();
          var apSame = storedWeeklyIntegerEquals(apWeekCurrent[2], expectedWeeklyNumber) &&
            storedWeeklyIntegerEquals(apWeekCurrent[3], weeklyDocumented) &&
            storedWeeklyIntegerEquals(apWeekCurrent[4], weeklyRequired) &&
            (weeklyWeight === '' ? apCurrentWeight === '' : apCurrentWeight !== '' && Number(apCurrentWeight) === weeklyWeight) &&
            storedWeeklyIntegerEquals(apWeekCurrent[6], weeklyOpen) && apCurrentUrl === weeklyUrl;
          if (apSame) return { changed: false, idempotent: true };
          throw new Error('conflicting weekly record already exists for week ' + expectedWeeklyNumber);
        }
        wk.appendRow([new Date(), weeklyDate, expectedWeeklyNumber, weeklyDocumented,
          weeklyRequired, weeklyWeight, weeklyOpen, weeklyUrl]);
        return { changed: true, idempotent: false };
      });
      return jsonOut({ ok: true, idempotent: apWeekly.idempotent });
    }
    if (obj.action === 'apconfirmation') {
      var confirmationDate = isoDateInput(obj.date, 'confirmation date');
      if (confirmationDate !== today) return jsonOut({ ok: false, error: 'confirmation must be filed on its capture date' });
      var confirmationVersion = Number(obj.version);
      if (!isFinite(confirmationVersion) || Math.floor(confirmationVersion) !== confirmationVersion || confirmationVersion < 1) {
        return jsonOut({ ok: false, error: 'invalid confirmation version' });
      }
      var confirmationUrl = confirmationUrlInput(obj.url);
      var filedConfirmation = fileApConfirmationRecord(
        confirmationDate, confirmationVersion, confirmationUrl, obj.attestation_seal || obj.seal
      );
      return jsonOut({ ok: true, idempotent: filedConfirmation.idempotent, row: filedConfirmation.row });
    }

    if (obj.action === 'apsupervision') {
      var sop = String(obj.op || '').toLowerCase();
      if (['exception', 'complete', 'missed'].indexOf(sop) === -1) {
        return jsonOut({ ok: false, error: 'op must be exception | complete | missed' });
      }
      var supervisionContext = 'AP supervision ' + sop + ' ruling';
      var supervisionGate = activeAgreementGate(supervisionContext);
      if (!supervisionGate) return inactiveEnforcementJson(supervisionContext);
      if (sop === 'missed' && obj.confirm !== 'VERIFY') {
        return jsonOut({ ok: false, error: 'explicit AP verification required for a MISSED ruling (confirm=VERIFY)' });
      }
      if (obj.url && !PUBLIC_SUPERVISION_VIDEO_ENABLED) {
        return jsonOut({ ok: false, error: 'public supervision video is disabled pending separate safety review' });
      }
      var supervisionReason, supervisionUrl, supervisionNote;
      try {
        supervisionReason = sheetText(obj.reason || 'documented exception (§3.4)', 500, 'supervision exception reason');
        supervisionUrl = obj.url ? httpsUrlInput(obj.url, 'supervision archive URL') : '';
        supervisionNote = sheetText(obj.note, 1000, 'supervision note');
      } catch (supervisionInputError) {
        return jsonOut({ ok: false, error: String(supervisionInputError.message || supervisionInputError) });
      }
      withActiveAgreementMutation('the ' + supervisionContext + ' could be recorded', function (lockedGate) {
        var sd = agreementDateInput(obj.date || lockedGate.today, 'supervision date', lockedGate);
        var srow = supervisionRow(sd);
        var sst = sop === 'exception' ? 'EXCEPTION · ' + supervisionReason
          : sop === 'complete' ? 'COMPLETED' : 'MISSED';
        if (srow) supervisionSheet().getRange(srow.row, 3).setValue(sst);
        else supervisionSheet().appendRow([sd, supervisionScheduled(sd) ? 'yes' : 'no', sst, '', '', supervisionUrl, supervisionNote]);
        return { changed: true };
      });
      return jsonOut({ ok: true });
    }
    if (obj.action === 'apdeploy') { triggerDeploy(); return jsonOut({ ok: true, deployed: true }); }
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ═════ BUILD HOOK (Cloudflare Pages) ═════
   Pages project → Settings → Builds & deployments → Deploy hooks (main),
   copy the private URL, then run setBuildHook. */

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
    { name: 'Cloudflare Pages', url: props.getProperty('BUILD_HOOK') || props.getProperty('NETLIFY_HOOK') },
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
      'Cloudflare Pages → Settings → Builds & deployments → Deploy hooks →\n' +
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
        Set its private Callback URL to the exact value printed by
        withingsRedirectUri(); keep that deployed /exec URL in the private
        runbook, never in public source or documentation.
     2. setWithingsCredentials('<clientId>', '<clientSecret>')
     3. withingsAuthUrl() — open the logged URL, sign in as MICHEAL'S
        Withings account, and approve within ten minutes. The one-use random
        state and authorization code return directly to this script, which
        validates the state, exchanges the code, and runs the first sync.
     4. setup() — installs the hourly withingsSync trigger.
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
  var url = String(ScriptApp.getService().getUrl() || '').trim();
  if (!url) throw new Error('Deploy this Apps Script as a web app before connecting Withings');
  return httpsUrlInput(url, 'Withings callback URL');
}

function withingsAuthUrl() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WITHINGS_ID');
  if (!id) { Logger.log('Run setWithingsCredentials() first.'); return; }
  var oauthState = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('WITHINGS_OAUTH_STATE', oauthState);
  props.setProperty('WITHINGS_OAUTH_STATE_EXP', String(Date.now() + 10 * 60 * 1000));
  var url = 'https://account.withings.com/oauth2_user/authorize2' +
    '?response_type=code&client_id=' + encodeURIComponent(id) +
    '&scope=user.metrics&state=' + encodeURIComponent(oauthState) +
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
  var gate = activeAgreementGate('withingsSync');
  if (!gate) return;
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
  withActiveAgreementMutation('Withings measurements could be recorded', function (lockedGate) {
    var sh = healthSheet();
    Object.keys(byDay).sort().forEach(function (ds) {
      if (!dateWithinAgreement(ds, lockedGate)) return;
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
      autoWeighInUnlocked(ds, lb, 'scale-synced (Withings)', lockedGate);
      synced.push(ds + ' → ' + lb + ' lb');
    });
    return { changed: synced.length > 0 };
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

function autoWeighInUnlocked(ds, lb, label, gate) {
  if (!gate || !gate.active || !dateWithinAgreement(ds, gate)) return false;
  label = label || 'scale-synced';
  if (ds < WEIGHT_AUTO_START) return false;
  var sh = weighinsSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var d0 = vals[i][0];
    var ds0 = d0 instanceof Date ? Utilities.formatDate(d0, 'America/New_York', 'yyyy-MM-dd') : String(d0).trim();
    if (ds0 === ds) {
      if (Number(vals[i][1]) !== Number(lb)) sh.getRange(i + 1, 2).setValue(lb);
      if (String(vals[i][2] || '').indexOf('scale-synced') === -1) sh.getRange(i + 1, 3).setValue(('' + (vals[i][2] || '')).trim() ? vals[i][2] + ' · ' + label : label);
      return true;
    }
  }
  sh.appendRow([ds, lb, label]);
  return true;
}

function autoWeighIn(ds, lb, label) {
  var gate = activeAgreementGate('autoWeighIn');
  if (!gate || !dateWithinAgreement(ds, gate)) return;
  withActiveAgreementMutation('the automatic weigh-in could be recorded', function (lockedGate) {
    return { changed: autoWeighInUnlocked(ds, lb, label, lockedGate) };
  });
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

function sha256HexBytes(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function jpegBytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (jpegByte(a, i) !== jpegByte(b, i)) return false;
  return true;
}

function ghExistingContentBytes(probe) {
  var body;
  try { body = JSON.parse(probe.getContentText()); }
  catch (e) { throw new Error('GitHub returned an unreadable existing-file response'); }
  if (!body || body.type !== 'file') throw new Error('GitHub path exists but is not a file');
  if (body.encoding === 'base64' && body.content) {
    return Utilities.base64Decode(String(body.content).replace(/\s/g, ''));
  }
  if (body.download_url) {
    var raw = UrlFetchApp.fetch(String(body.download_url), {
      headers: ghHeaders(), muteHttpExceptions: true, followRedirects: true,
    });
    if (raw.getResponseCode() === 200) return raw.getBlob().getBytes();
    throw new Error('GitHub existing-file download failed (' + raw.getResponseCode() + ')');
  }
  throw new Error('GitHub existing-file bytes are unavailable for verification');
}

/* Commits one file. Existing paths are accepted only when their downloaded
   bytes match the expected derivative hash and re-parse as metadata-free.
   A stale GH_MIRRORED marker or path existence is never evidence by itself. */
function ghPutFile(repoPath, blob, message, expectedSha256) {
  var api = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + repoPath;
  var probe = UrlFetchApp.fetch(api + '?ref=' + GH_BRANCH, { headers: ghHeaders(), muteHttpExceptions: true });
  if (probe.getResponseCode() === 200) {
    var existing = ghExistingContentBytes(probe);
    var existingSha = sha256HexBytes(existing);
    if (!expectedSha256 || existingSha !== expectedSha256) {
      throw new Error('GitHub path already exists with unverified or different bytes; refusing to repoint');
    }
    var reparsed = stripJpegMetadataBytes(existing);
    if (!jpegBytesEqual(existing, reparsed)) {
      throw new Error('GitHub path already exists with metadata-bearing bytes; refusing to repoint');
    }
    return 'verified-existing';
  }
  if (probe.getResponseCode() !== 404) {
    throw new Error('GitHub probe ' + probe.getResponseCode() + ': ' + probe.getContentText().slice(0, 200));
  }
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

   A path already in the repo is never overwritten. It is downloaded and must
   match the deterministic derivative hash before the Sheet can be repointed,
   so a stale marker or pre-existing object cannot bypass privacy validation. */

function driveIdFromUrl(url) {
  var s = String(url || '').trim();
  if (!/^https:\/\/(?:drive|docs)\.google\.com\//i.test(s)) return '';
  var m = s.match(/(?:\/d\/|id=|thumbnail\?id=|uc\?id=)([\w-]{20,})/);
  return m ? m[1] : '';
}

/* Apps Script has no documented, trustworthy pixel re-encode. This validator
   therefore accepts only the constrained JPEG shape produced by the browser
   capture path: baseline/progressive 8-bit pixels plus optional JFIF and ICC
   container segments. JFIF/ICC are removed from the published derivative.

   Any EXIF/XMP, JUMBF/C2PA, Photoshop/IPTC, comment, unknown APP marker,
   unsupported JPEG mode, malformed structure, or trailing byte fails closed.
   In particular, an EXIF-orientation camera image is rejected rather than
   silently rotated incorrectly. Sanitize and physically orient such a source
   with the pinned Sharp pipeline before replacing the private Drive original.
   The original camera blob is never passed to ghPutFile(). */
var MAX_PUBLIC_JPEG_BYTES = 12 * 1024 * 1024;
var MAX_PUBLIC_JPEG_PIXELS = 20 * 1000 * 1000;
var PUBLIC_PHOTO_TRANSFORM = 'mrb-jpeg-container-scrub-v1';

function jpegByte(bytes, index) { return Number(bytes[index]) & 0xFF; }
function appendJpegBytes(out, bytes, start, end) {
  for (var i = start; i < end; i++) out.push(bytes[i]);
}

function jpegAsciiAt(bytes, start, text, end) {
  if (start + text.length > end) return false;
  for (var i = 0; i < text.length; i++) if (jpegByte(bytes, start + i) !== text.charCodeAt(i)) return false;
  return true;
}

function isJpegFrameMarker(marker) {
  return (marker >= 0xC0 && marker <= 0xC3) ||
    (marker >= 0xC5 && marker <= 0xC7) ||
    (marker >= 0xC9 && marker <= 0xCB) ||
    (marker >= 0xCD && marker <= 0xCF);
}

function stripJpegMetadataBytes(bytes) {
  if (!bytes || bytes.length < 4) throw new Error('sanitized JPEG derivative required: file is empty or truncated');
  if (bytes.length > MAX_PUBLIC_JPEG_BYTES) throw new Error('sanitized JPEG derivative required: JPEG exceeds 12 MiB');
  if (jpegByte(bytes, 0) !== 0xFF || jpegByte(bytes, 1) !== 0xD8) {
    throw new Error('sanitized JPEG derivative required: source is not a JPEG');
  }

  var out = [];
  appendJpegBytes(out, bytes, 0, 2); // SOI
  var pos = 2;
  var inScan = false;
  var sawFrame = false;
  var sawScan = false;

  while (pos < bytes.length) {
    if (inScan) {
      var scanStart = pos;
      while (pos < bytes.length) {
        if (jpegByte(bytes, pos) !== 0xFF) { pos++; continue; }
        var scanMarker = pos;
        pos++;
        while (pos < bytes.length && jpegByte(bytes, pos) === 0xFF) pos++;
        if (pos >= bytes.length) throw new Error('sanitized JPEG derivative required: truncated scan marker');
        var scanCode = jpegByte(bytes, pos);
        // FF00 is escaped entropy data; RSTn markers are part of the scan.
        if (scanCode === 0x00 || (scanCode >= 0xD0 && scanCode <= 0xD7)) { pos++; continue; }
        appendJpegBytes(out, bytes, scanStart, scanMarker);
        pos = scanMarker;
        inScan = false;
        break;
      }
      if (inScan) throw new Error('sanitized JPEG derivative required: JPEG has no end marker');
      continue;
    }

    var markerStart = pos;
    if (jpegByte(bytes, pos) !== 0xFF) throw new Error('sanitized JPEG derivative required: malformed JPEG marker');
    pos++;
    while (pos < bytes.length && jpegByte(bytes, pos) === 0xFF) pos++;
    if (pos >= bytes.length) throw new Error('sanitized JPEG derivative required: truncated JPEG marker');
    var marker = jpegByte(bytes, pos++);
    if (marker === 0x00 || marker === 0xD8) throw new Error('sanitized JPEG derivative required: invalid JPEG marker');

    if (marker === 0xD9) { // EOI
      if (!sawFrame || !sawScan) throw new Error('sanitized JPEG derivative required: JPEG has no decodable frame and scan');
      appendJpegBytes(out, bytes, markerStart, pos);
      if (pos !== bytes.length) throw new Error('sanitized JPEG derivative required: trailing data after JPEG');
      return out;
    }
    // TEM/restart markers outside entropy data are unsupported and ambiguous.
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      throw new Error('sanitized JPEG derivative required: standalone JPEG marker');
    }
    if (pos + 2 > bytes.length) throw new Error('sanitized JPEG derivative required: truncated JPEG segment');
    var segmentLength = (jpegByte(bytes, pos) << 8) | jpegByte(bytes, pos + 1);
    if (segmentLength < 2 || pos + segmentLength > bytes.length) {
      throw new Error('sanitized JPEG derivative required: invalid JPEG segment length');
    }
    var segmentEnd = pos + segmentLength;

    if ((marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE) {
      var dataStart = pos + 2;
      var allowedJfif = marker === 0xE0 && jpegAsciiAt(bytes, dataStart, 'JFIF\u0000', segmentEnd);
      var allowedIcc = marker === 0xE2 && jpegAsciiAt(bytes, dataStart, 'ICC_PROFILE\u0000', segmentEnd);
      if (!allowedJfif && !allowedIcc) {
        throw new Error('pre-sanitized JPEG required: source contains privacy/provenance metadata');
      }
      // The allow-listed container segment is intentionally omitted.
      pos = segmentEnd;
      continue;
    }

    if (isJpegFrameMarker(marker)) {
      if (marker !== 0xC0 && marker !== 0xC2) {
        throw new Error('sanitized JPEG derivative required: unsupported JPEG frame type');
      }
      if (sawFrame) throw new Error('sanitized JPEG derivative required: multiple JPEG frames');
      if (segmentLength < 11) throw new Error('sanitized JPEG derivative required: truncated JPEG frame');
      var precision = jpegByte(bytes, pos + 2);
      var height = (jpegByte(bytes, pos + 3) << 8) | jpegByte(bytes, pos + 4);
      var width = (jpegByte(bytes, pos + 5) << 8) | jpegByte(bytes, pos + 6);
      var components = jpegByte(bytes, pos + 7);
      if (precision !== 8 || !width || !height || components < 1 || components > 4 ||
          segmentLength !== 8 + 3 * components || width * height > MAX_PUBLIC_JPEG_PIXELS) {
        throw new Error('sanitized JPEG derivative required: invalid or oversized JPEG frame');
      }
      sawFrame = true;
      appendJpegBytes(out, bytes, markerStart, segmentEnd);
      pos = segmentEnd;
      continue;
    }

    if (marker === 0xDA) { // SOS: copy header, then parse entropy to next marker.
      if (!sawFrame) throw new Error('sanitized JPEG derivative required: scan precedes frame');
      var scanComponents = jpegByte(bytes, pos + 2);
      if (scanComponents < 1 || scanComponents > 4 || segmentLength !== 6 + 2 * scanComponents) {
        throw new Error('sanitized JPEG derivative required: invalid JPEG scan header');
      }
      appendJpegBytes(out, bytes, markerStart, segmentEnd);
      pos = segmentEnd;
      inScan = true;
      sawScan = true;
      continue;
    }

    // Only Huffman-coded baseline/progressive tables and restart intervals are
    // accepted. This deliberately rejects extensions Apps Script cannot safely
    // decode or normalize (DAC/DNL/DHP/EXP and reserved marker segments).
    if (marker !== 0xC4 && marker !== 0xDB && marker !== 0xDD) {
      throw new Error('sanitized JPEG derivative required: unsupported JPEG segment');
    }
    appendJpegBytes(out, bytes, markerStart, segmentEnd);
    pos = segmentEnd;
  }
  throw new Error('sanitized JPEG derivative required: JPEG has no end marker');
}

function sanitizedPublicPhoto(sourceBlob, publicName) {
  var mime = String(sourceBlob.getContentType ? sourceBlob.getContentType() : '').toLowerCase().split(';')[0].trim();
  if (mime !== 'image/jpeg' && mime !== 'image/jpg') {
    throw new Error('pre-sanitized JPEG required: MIME type is not image/jpeg');
  }
  var sourceBytes = sourceBlob.getBytes();
  var cleanBytes = stripJpegMetadataBytes(sourceBytes);
  // A second strict parse must be byte-for-byte stable: no APP/COM segment can
  // survive the transform or be introduced by the Blob wrapper.
  var reparsed = stripJpegMetadataBytes(cleanBytes);
  if (!jpegBytesEqual(cleanBytes, reparsed)) throw new Error('sanitized JPEG verification failed');
  return {
    blob: Utilities.newBlob(cleanBytes, 'image/jpeg', publicName),
    captureSha256: sha256HexBytes(sourceBytes),
    publishedSha256: sha256HexBytes(cleanBytes),
    transform: PUBLIC_PHOTO_TRANSFORM,
  };
}

function sanitizedPublicPhotoBlob(sourceBlob, publicName) {
  return sanitizedPublicPhoto(sourceBlob, publicName).blob;
}

function acceptedDailyPhotoSourceHash(attestationRows, date, angleIndex, captureSha256) {
  for (var i = attestationRows.length - 1; i >= 1; i--) {
    var row = attestationRows[i];
    if (!acceptedAttestationRow(row, date, 'daily')) continue;
    var hashes = String(row[7] || '').toLowerCase().trim().split(/\s+/);
    if (hashes.length === 4 && hashes[angleIndex] === captureSha256) return true;
  }
  return false;
}

function photoPublicationPropertyKey(repoPath) {
  return 'GH_PHOTO_' + sha256HexBytes(Utilities.newBlob(String(repoPath)).getBytes()).slice(0, 32);
}

function recordPhotoPublication(props, repoPath, date, angle, photo) {
  props.setProperty(photoPublicationPropertyKey(repoPath), JSON.stringify({
    path: repoPath,
    date: date,
    angle: angle,
    capture_sha256: photo.captureSha256,
    published_sha256: photo.publishedSha256,
    transform: photo.transform,
    attestation: 'VALID-CONSUMED',
    recorded_at: new Date().toISOString(),
  }));
}

function githubMirrorPhotos() {
  var gate = activeAgreementGate('githubMirrorPhotos');
  if (!gate) return;
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GH_TOKEN')) {
    Logger.log('No GH_TOKEN — run setGithubToken() first. Nothing mirrored.');
    return;
  }
  var weighins = weighinsSheet();
  var vals = weighins.getDataRange().getValues();
  var attestations = attestationSheet().getDataRange().getValues();
  var angles = ['front', 'left', 'rear', 'right'];
  var pushed = 0, verified = 0, skipped = 0, missing = 0, repointed = 0;

  for (var r = 1; r < vals.length && pushed < 20; r++) {
    var date = apDateStr(vals[r][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!dateWithinAgreement(date, gate)) continue;
    var day = Math.floor((new Date(date) - new Date(PROJECT_START)) / 864e5) + 1;
    if (day < 1) continue;

    for (var a = 0; a < angles.length && pushed < 20; a++) {
      var url = String(vals[r][3 + a] || '').trim();
      if (!url) { missing++; continue; }
      if (!/^https?:/i.test(url)) { missing++; continue; }

      var name = 'micheal-ray-berry-day-' + String(day).padStart(3, '0') + '-' + angles[a] + '-' + date + '.jpg';
      var repoPath = 'photos/' + date.slice(0, 4) + '/' + date.slice(5, 7) + '/' + date.slice(8, 10) + '/' + name;
      var publicUrl = 'https://michealrayberry.com/' + repoPath;
      if (url === publicUrl) {
        skipped++;
        continue;
      }

      try {
        // Mirror only a private Drive source. Arbitrary HTTP fetching from a
        // Sheet cell would turn the Apps Script service into an SSRF proxy.
        var id = driveIdFromUrl(url);
        if (!id) {
          Logger.log('NOT MIRRORED — ' + name + ': source must be a private Google Drive file');
          missing++;
          continue;
        }
        var sourceFile = requirePrivateDriveItem(DriveApp.getFileById(id), 'raw photo source');
        var photo;
        try {
          photo = sanitizedPublicPhoto(sourceFile.getBlob(), name);
        } catch (sanitizeError) {
          Logger.log('NOT MIRRORED — ' + name + ': ' + sanitizeError.message);
          missing++;
          continue;
        }
        if (!acceptedDailyPhotoSourceHash(attestations, date, a, photo.captureSha256)) {
          Logger.log('NOT MIRRORED — ' + name + ': source hash does not match a same-date VALID-CONSUMED daily attestation');
          missing++;
          continue;
        }
        // Re-read both authorization and source evidence under the shared
        // gate lock immediately before the irreversible public GitHub call.
        withActiveAgreementMutation('the public photo mirror could start', function (lockedGate) {
          if (!dateWithinAgreement(date, lockedGate)) throw new Error('photo date is outside the active agreement period');
          var currentRows = weighinsSheet().getDataRange().getValues();
          var currentMatches = [];
          for (var wi = 1; wi < currentRows.length; wi++) {
            if (apDateStr(currentRows[wi][0]) === date) currentMatches.push(wi + 1);
          }
          if (currentMatches.length !== 1) throw new Error('daily photo row is missing or duplicated; AP repair required');
          var currentUrl = String(currentRows[currentMatches[0] - 1][3 + a] || '').trim();
          if (currentUrl !== url) throw new Error('daily photo source changed before publication');
          var currentAttestations = attestationSheet().getDataRange().getValues();
          if (!acceptedDailyPhotoSourceHash(currentAttestations, date, a, photo.captureSha256)) {
            throw new Error('daily photo attestation changed before publication');
          }
          return { changed: false };
        });
        var result = ghPutFile(repoPath, photo.blob,
          'Mirror verified, metadata-free daily photo ' + name, photo.publishedSha256);

        // Persist the private source→derivative link before replacing the raw
        // Drive pointer. On a retry, an existing GitHub object is downloaded
        // and verified; path existence or the legacy GH_MIRRORED map is ignored.
        var publicationCommit = withActiveAgreementMutation('the public photo mirror could be committed', function (lockedGate) {
          if (!dateWithinAgreement(date, lockedGate)) throw new Error('photo date is outside the active agreement period');
          var currentRows = weighinsSheet().getDataRange().getValues();
          var commitMatches = [];
          for (var commitIndex = 1; commitIndex < currentRows.length; commitIndex++) {
            if (apDateStr(currentRows[commitIndex][0]) === date) commitMatches.push(commitIndex + 1);
          }
          if (commitMatches.length !== 1) throw new Error('daily photo row changed during publication; AP repair required');
          var commitRow = commitMatches[0];
          var currentUrl = String(currentRows[commitRow - 1][3 + a] || '').trim();
          if (currentUrl === publicUrl) return { changed: false, repointed: false };
          if (currentUrl !== url) throw new Error('daily photo source changed during publication');
          var currentAttestations = attestationSheet().getDataRange().getValues();
          if (!acceptedDailyPhotoSourceHash(currentAttestations, date, a, photo.captureSha256)) {
            throw new Error('daily photo attestation changed during publication');
          }
          recordPhotoPublication(props, repoPath, date, angles[a], photo);
          weighinsSheet().getRange(commitRow, 4 + a).setValue(publicUrl);
          return { changed: true, repointed: true };
        });
        if (publicationCommit.repointed) repointed++;
        if (result === 'created') pushed++; else verified++;
      } catch (e) {
        Logger.log('Mirror failed for ' + name + ': ' + e);
        return; // bad token, no Drive access, or rate limit — retry next run
      }
    }
  }

  Logger.log('Mirror run: ' + pushed + ' pushed, ' + repointed + ' cell(s) repointed to michealrayberry.com, ' +
    verified + ' existing object(s) hash-verified, ' + skipped + ' already canonical, ' +
    missing + ' photo cell(s) empty, unverified, or unreadable.');
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
    for (var a = 0; a < 4; a++) if (/^https?:/i.test(String(vals[r][3 + a] || '').trim())) have++;
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

function participantSiteState() {
  var state = siteStateAll();
  var allowed = [
    'start_date',
    'agreement_edition',
    'mrb_signature_verified_at',
    'ap_signature_verified_at',
    'abandoned',
    'abandoned_date',
    'completed',
    'completed_date',
  ];
  var out = {};
  for (var i = 0; i < allowed.length; i++) {
    if (Object.prototype.hasOwnProperty.call(state, allowed[i])) out[allowed[i]] = state[allowed[i]];
  }
  return out;
}

function participantSafeRecordText(value) {
  return String(value == null ? '' : value).replace(
    /AP(?:V|R)1\|\d{4}-\d{2}-\d{2}\|[a-f0-9]{64}/gi,
    '[internal evidence marker]'
  );
}

function handleMyState() {
  var gate = agreementExecutionState();
  var today = gate.today || Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var projectStart = gate.projectStart || '';
  var day = projectStart ? Math.floor((new Date(today) - new Date(projectStart)) / 864e5) + 1 : 0;
  var out = {
    ok: true,
    today: today,
    day: day,
    serverTime: new Date().toISOString(),
    projectStart: projectStart,
    agreementActive: gate.active === true,
  };

  var vals = weighinsSheet().getDataRange().getValues();
  var row = null, weights = [];
  for (var i = 1; i < vals.length; i++) {
    var d = apDateStr(vals[i][0]);
    var w = Number(vals[i][1]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today && isFinite(w) && w > 0) weights.push({ date: d, weight: w });
    if (d === today && !row) row = vals[i];
  }
  var packet = dailyPacketStateFromRow(today, row);
  out.packet = {
    tracker: packet.trackerUpdated,
    weight: row ? String(row[1] || '') : '',
    front: !!(row && String(row[3] || '').trim()),
    left: !!(row && String(row[4] || '').trim()),
    rear: !!(row && String(row[5] || '').trim()),
    right: !!(row && String(row[6] || '').trim()),
    video: !!(row && String(row[7] || '').trim()),
    complete: packet.complete,
    missing: packet.missing,
  };
  weights.sort(function (a, b) { return a.date === b.date ? 0 : a.date < b.date ? -1 : 1; });
  // The agreement's baseline is declared, not inferred from the first scale
  // reading. Keep the earliest observed measurement available as a separate
  // fact so a late first sync cannot silently rewrite the 340 lb declaration.
  out.start = PROJECT_FACTS.startWeightLb;
  out.declaredStart = PROJECT_FACTS.startWeightLb;
  out.earliestMeasurement = weights.length ? weights[0] : null;
  out.latest = weights.length ? weights[weights.length - 1] : null;
  out.history = weights.slice(-30);

  // Same-date server-sealed capture attestation. It correlates the submitted
  // hashes with a challenge; it does not independently prove capture
  // circumstances or filing timeliness.
  var att = attestationSheet().getDataRange().getValues();
  out.attested = false;
  for (var a = 1; a < att.length; a++) {
    if (acceptedAttestationRow(att[a], today, 'daily')) out.attested = true;
  }

  var pv = violationLogSheet().getDataRange().getValues();
  out.violations = [];
  var violationGate = gate.active ? gate : null;
  var participantViolationSummary = null;
  if (violationGate) {
    try { participantViolationSummary = verifiedViolationSummary(pv, violationGate); }
    catch (participantViolationError) {
      Logger.log('PARTICIPANT CONSEQUENCE STATE BLOCKED: ' + String(participantViolationError.message || participantViolationError));
    }
  }
  for (var v = 1; v < pv.length; v++) {
    var pd = apDateStr(pv[v][0]);
    var violationDetails = violationGate ? verifiedViolationDetails(pv[v], violationGate) : null;
    if (!violationDetails || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) continue;
    var participantStatus = String(pv[v][2] || 'Unresolved');
    var resolutionDetails = verifiedResolutionDetails(pv[v], violationGate);
    if (resolutionDetails) {
      participantStatus = 'Resolved · ' + resolutionDetails.date;
    } else if (/^\s*(resolved|satisfied|closed)\b/i.test(participantStatus)) {
      participantStatus = 'Unresolved · resolution evidence not verified';
    }
    out.violations.push({
      date: pd,
      what: participantSafeRecordText(pv[v][1]),
      status: participantSafeRecordText(participantStatus),
    });
  }

  var cs = correctiveSheet().getDataRange().getValues();
  out.corrective = [];
  var openCorrectiveCounts = {};
  var correctiveCandidates = [];
  for (var c = 1; c < cs.length; c++) {
    if (!String(cs[c][1] || '').trim()) continue;
    var correctiveDetails = violationGate ? verifiedCorrectiveDetails(cs[c], violationGate) : null;
    if (!correctiveDetails) continue;
    if (verifiedCorrectiveCompletion(cs[c], violationGate)) continue;
    openCorrectiveCounts[correctiveDetails.marker] = (openCorrectiveCounts[correctiveDetails.marker] || 0) + 1;
    correctiveCandidates.push({ values: cs[c], details: correctiveDetails });
  }
  for (var candidateIndex = 0; candidateIndex < correctiveCandidates.length; candidateIndex++) {
    var candidate = correctiveCandidates[candidateIndex];
    var details = candidate.details;
    if (!participantViolationSummary || openCorrectiveCounts[details.marker] !== 1 ||
        !Object.prototype.hasOwnProperty.call(participantViolationSummary.rankByMarker, details.marker)) continue;
    var participantRetryEvidence = verifiedCorrectiveRejectionDetails(details.source.values, violationGate);
    var retryAfterOverrule = participantRetryEvidence &&
      participantRetryEvidence.assignmentId === details.assignmentId;
    if ((details.due < today && !retryAfterOverrule) || String(details.source.values[7] || '').trim()) continue;
    var consequence = consequenceForLevel(participantViolationSummary.rankByMarker[details.marker]);
    out.corrective.push({
      id: 'V-' + publicViolationToken(details.marker),
      assignmentId: details.assignmentId,
      attemptId: correctiveAttemptId(details.assignmentId, participantRetryEvidence),
      violationDate: details.source.details.date,
      violation: participantSafeRecordText(details.source.details.text),
      assignment: participantSafeRecordText(candidate.values[1]),
      due: details.due,
      level: consequence.level,
      minutes: consequence.mins,
    });
  }

  var weeklyWeek = day >= 8 ? Math.floor((day - 1) / 7) : 0;
  out.weekly = { eligible: false, reason: '', date: today, day: day, week: weeklyWeek };
  if (!projectStart) {
    out.weekly.reason = 'Project start is unavailable; AP repair required.';
  } else if (!gate.active) {
    out.weekly.reason = 'Edition ' + AGREEMENT_EDITION + ' execution is not active.';
  } else if (day < 8) {
    out.weekly.reason = 'No project week has been completed yet.';
  } else if ((day - 1) % 7 !== 0) {
    out.weekly.reason = 'Weekly review is available only on the completed-week review day.';
  } else {
    var weeklySheet = tab('Weekly Log');
    var weekMatches = weeklyRowsForWeek(weeklySheet, weeklyWeek);
    var weeklyDateMatches = weeklyRowsForDate(weeklySheet, today);
    if (weekMatches.length > 1 || weeklyDateMatches.length > 1) {
      out.weekly.reason = 'Duplicate weekly records require AP repair.';
    } else if (!weekMatches.length && weeklyDateMatches.length) {
      out.weekly.reason = 'The weekly record has an invalid or conflicting week; AP repair required.';
    } else if (weekMatches.length && apDateStr(weekMatches[0].values[1]) !== today) {
      out.weekly.reason = 'This project week is already bound to a different review date; AP repair required.';
    } else if (weekMatches.length) {
      out.weekly.reason = 'This completed-week review is already filed.';
    } else {
      out.weekly.eligible = true;
      out.weekly.reason = 'Completed-week review is available today.';
    }
  }

  try { out.siteState = participantSiteState(); }
  catch (stateError) { out.siteState = {}; }
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
  [['Weigh-ins', 8], ['Violation Log', 9], ['Corrective Log', 6]].forEach(function (spec) {
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
        : (spec[0] === 'Corrective Log'
          ? correctiveAssignmentIdInput(vals[r][5])
          : apDateStr(vals[r][0]) + '|' + String(vals[r][1] || '').trim());
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

var PORTAL_URL = 'https://michealrayberry.com/assistant/';
var AP_CONSOLE = 'the MRB menu in the private operations workbook';

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
    if (TEST_PHASE) {
      subject = '[TEST] ' + testLabels(subject);
      body = testLabels(body) + '\n\n— Testing phase. The official record begins ' + PROJECT_LAUNCH +
        '. Test entries remain at https://michealrayberry.com/testing/ after launch and do not count toward official progress.';
    }
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

/* The single source of truth for "is the published packet complete".
   A packet is one dated public-tracker row containing a recorded weight, all
   four photo references, and the inspection video. Attestation is useful
   evidence but is deliberately not a packet requirement. */
function dailyPacketStateFromRow(dateStr, row) {
  var trackerUpdated = !!row && apDateStr(row[0]) === dateStr;
  var weight = trackerUpdated ? Number(row[1]) : NaN;
  var weightRecorded = isFinite(weight) && weight > 0;
  var missing = [];
  if (!trackerUpdated) missing.push('public tracker update (no dated Weigh-ins row)');
  if (!weightRecorded) missing.push('scale-synced weight (step on the Withings scale)');
  var photos = 0;
  if (trackerUpdated) for (var p = 3; p <= 6; p++) if (String(row[p] || '').trim()) photos++;
  if (photos !== 4) missing.push('accountability photographs (' + photos + '/4 filed)');
  if (!trackerUpdated || !String(row[7] || '').trim()) missing.push('four-angle inspection video');
  return {
    missing: missing,
    complete: missing.length === 0,
    trackerUpdated: trackerUpdated,
    weightRecorded: weightRecorded,
    photoCount: photos,
    videoFiled: !!(trackerUpdated && String(row[7] || '').trim()),
    day: dayOf(dateStr),
    date: dateStr,
  };
}

function packetState(dateStr) {
  var vals = weighinsSheet().getDataRange().getValues();
  var row = null;
  for (var i = 1; i < vals.length; i++) {
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (ds === dateStr) { row = vals[i]; break; }
  }
  return dailyPacketStateFromRow(dateStr, row);
}

/* What the NEXT violation would cost, stated in the reminders so the deadline
   is never abstract. Level follows the accumulated count, capped at three. */
function openCorrectiveDeadline() {
  try {
    var gate = activeAgreementGate('openCorrectiveDeadline');
    if (!gate) return null;
    var sh = correctiveSheet();
    var vals = sh.getDataRange().getValues();
    var today = gate.today;
    var soonest = null;
    for (var i = 1; i < vals.length; i++) {
      var linked = verifiedCorrectiveDetails(vals[i], gate);
      if (!linked) continue;
      if (verifiedCorrectiveCompletion(vals[i], gate)) continue;
      if (String(linked.source.values[7] || '').trim()) continue;
      var due = linked.due;
      if (!soonest || due < soonest.due) soonest = { due: due, assignment: String(vals[i][1] || ''), days: Math.round((new Date(due) - new Date(today)) / 864e5) };
    }
    if (!soonest) return null;
    soonest.text = soonest.days < 0
      ? 'The assigned corrective due date was ' + soonest.due + ' (' + Math.abs(soonest.days) + ' day(s) ago). Any apparent lapse requires AP review before it can become a Violation Event.'
      : (soonest.days === 0
        ? 'The assigned corrective session is due TODAY (' + soonest.due + '). An apparent lapse will be sent to the AP for review.'
        : soonest.days + ' day(s) remain to submit the assigned corrective session (due ' + soonest.due + '). Only an explicit AP ruling can turn an apparent lapse into a Violation Event.');
    return soonest;
  } catch (e) { return null; }
}

function nextConsequence() {
  var gate = activeAgreementGate('nextConsequence');
  if (!gate) return { level: 0, mins: 0, open: 0, total: 0, text: 'No consequence — agreement execution is inactive' };
  var summary;
  try {
    var v = violationLogSheet().getDataRange().getValues();
    summary = verifiedViolationSummary(v, gate);
  } catch (e) {
    Logger.log('CONSEQUENCE COUNT BLOCKED: ' + String(e.message || e));
    return {
      level: 0,
      mins: 0,
      open: 0,
      total: 0,
      invalid: true,
      text: 'No consequence calculated — verified violation evidence requires AP repair',
    };
  }
  var result = consequenceForLevel(summary.total + 1);
  result.open = summary.open;
  result.total = summary.total;
  return result;
}

function verifiedViolationCount(gate) {
  var activeGate = gate || activeAgreementGate('verifiedViolationCount');
  if (!activeGate) return 0;
  var rows = violationLogSheet().getDataRange().getValues();
  return verifiedViolationSummary(rows, activeGate).total;
}

function consequenceForLevel(number) {
  var level = Math.min(3, Math.max(1, Number(number) || 1));
  var mins = { 1: 10, 2: 20, 3: 30 }[level];
  return { level: level, mins: mins, open: 0, total: 0,
    text: 'Level ' + level + ' — ' + mins + ' continuous minutes of corner time, recorded in one unbroken take and published beside the entry' };
}

/* 7 AM ET. States the day, the deadline, and the cost of missing it. */
function morningBrief() {
  var gate = activeAgreementGate('morningBrief');
  if (!gate || !dateWithinAgreement(gate.today, gate)) return;
  var today = gate.today;
  if (stateGet('abandoned') === 'confirmed') return;
  var st = packetState(today);
  var c = nextConsequence();
  var body = 'Day ' + st.day + '. Everything below is due by 10:00 PM Eastern tonight.\n\n' +
    '  1. Four-angle inspection video, one continuous take\n' +
    '  2. Four accountability photographs\n' +
    '  3. Today\'s scale-synced weight\n' +
    '  4. Dated public tracker update\n\n' +
    'The filing flow captures the evidence and updates the tracker at ' + PORTAL_URL + '.\n\n' +
    'Current file presence alone does not prove filing time. The scheduled check records\n' +
    'what is present when it runs; the AP reviews server-side receipts before any ruling.\n\n' +
    'If the AP verifies a deadline miss, the governed consequence would be: ' + c.text + '.\n';
  if (PUBLIC_SUPERVISION_VIDEO_ENABLED && supervisionScheduled(today)) {
    var srx = supervisionRow(today);
    if (!(srx && /^EXCEPTION/i.test(String(srx.vals[2] || '')))) {
      body += '\nEVENING SUPERVISION tonight, 6:00–10:00 PM Eastern (\u00a73.4): full uniform, fixed camera,\n' +
        'water only, home-cooked dinner. File the archive link in the File tool before 10:20 PM.\n' +
        'An apparent filing gap is sent privately to the AP; only an explicit AP ruling may mark MISSED or declare a Violation Event.\n';
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
  var gate = activeAgreementGate('eveningWarning');
  if (!gate || !dateWithinAgreement(gate.today, gate)) return;
  var today = gate.today;
  if (stateGet('abandoned') === 'confirmed') return;
  var st = packetState(today);
  if (st.complete) return;
  var c = nextConsequence();
  mailMRB('TWO HOURS LEFT — Day ' + st.day + ' packet incomplete',
    'Two hours to the 10:00 PM Eastern deadline. The record shows ' + st.missing.length + ' outstanding ' +
    (st.missing.length === 1 ? 'item' : 'items') + ':\n\n  - ' + st.missing.join('\n  - ') + '\n\n' +
    'Record it now: ' + PORTAL_URL + '\n\n' +
    (function () { var dl = openCorrectiveDeadline(); return dl ? dl.text + '\n\n' : ''; })() +
    'The scheduled check records file presence and privately requests AP review; it does not declare a violation.\n' +
    'If the AP later verifies a deadline miss after reviewing receipts and exceptions, the governed consequence would be:\n\n  ' + c.text + '.\n\n' +
    'The entry is retained as durable history after the obligation closes, subject to safety,\n' +
    'privacy, consent, and legal redaction or takedown requirements. Completion changes its\n' +
    'status rather than deleting it by default.');
}

/* Sent the moment the nightly check declares. He should not learn it from the
   website in the morning. */
function mrbViolationNotice(rowNumber) {
  var gate = activeAgreementGate('mrbViolationNotice');
  if (!gate) return;
  var sh = violationLogSheet();
  var row;
  try { row = sheetRowInput(rowNumber, sh.getLastRow(), 'violation row'); }
  catch (rowError) { return; }
  var rows = sh.getDataRange().getValues();
  var event = rows[row - 1];
  var verifiedEvent = verifiedViolationDetails(event, gate);
  if (!verifiedEvent) return;
  var dateStr = verifiedEvent.date;
  var day = dayOf(dateStr);
  var summary = verifiedViolationSummary(rows, gate);
  var eventRank = summary.rankByMarker[verifiedEvent.marker];
  if (!eventRank) return;
  var c = consequenceForLevel(eventRank);
  mailMRB('AP-VERIFIED VIOLATION — Day ' + day + ' — ' + dateStr,
    'The Accountability Partner reviewed the source evidence and explicitly verified this dated Violation Event:\n\n' +
    String(event[1] || '').trim() + '\n\n' +
    'The event is now eligible for the governed record and consequence count.\n\n' +
    'Assigned: ' + c.text + '.\n\n' +
    'Record it at ' + PORTAL_URL + '. The entry stays open until the Accountability Partner\n' +
    'verifies the session — submitting it is not the same as resolving it.\n\n' +
    (function () { var dl = openCorrectiveDeadline(); return dl ? dl.text + '\n\n' : ''; })() +
    'If a documented medical event or verified platform failure applies, say so to the AP. The AP decision is logged either way.');
}

/* Hourly. Detects three things the moment they change: an AP verdict, a
   corrective submission awaiting review, and a recorded weight threshold. Each fires
   once — the last-seen marker lives in Site State, so a re-run is a no-op. */
function hourlyWatch() {
  if (!enforcementActive('hourlyWatch')) return;
  try { verdictWatch(); } catch (e) {}
  try { correctiveSubmittedWatch(); } catch (e) {}
  try { milestoneWatch(); } catch (e) {}
}

function verdictWatch() {
  var gate = activeAgreementGate('verdictWatch');
  if (!gate) return;
  var v = violationLogSheet().getDataRange().getValues();
  var seen = {};
  try { seen = JSON.parse(stateGet('verdict_seen') || '{}'); } catch (e) { seen = {}; }
  var changed = false;
  for (var i = 1; i < v.length; i++) {
    var ds = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], 'America/New_York', 'yyyy-MM-dd') : String(v[i][0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    if (!dateWithinAgreement(ds, gate)) continue;
    var verifiedEvent = verifiedViolationDetails(v[i], gate);
    if (!verifiedEvent) continue;
    var eventKey = 'event:' + verifiedEvent.marker.split('|')[2];
    var status = String(v[i][2] || '').trim();
    var verdict = String(v[i][5] || '').trim(); // column F — AP-only ruling evidence
    var fingerprint = status + '|' + verdict;
    if (seen[eventKey] === fingerprint) continue;
    var first = !Object.prototype.hasOwnProperty.call(seen, eventKey);
    var migratingLegacyDate = first && Object.prototype.hasOwnProperty.call(seen, ds);
    var rejectedSubmission = /^Unresolved · overruled · \d{4}-\d{2}-\d{2}$/.test(status) ||
      /reject|invalid|repeat|incomplete/i.test(verdict);
    seen[eventKey] = fingerprint;
    changed = true;
    // A protected overrule status is itself a deliberate AP verdict. Do not
    // suppress that notice merely because the watcher is being initialized.
    if ((first || migratingLegacyDate) && !rejectedSubmission) continue;
    var what = String(v[i][1] || '').replace(/\s*\[auto-declared\]\s*/i, '');
    if (isResolvedViolationRow(v[i], gate)) {
      mailMRB('RESOLVED — ' + ds + ' — verified by the Accountability Partner',
        'The entry for ' + ds + ' (' + what + ') has been verified and marked resolved.\n\n' +
        (verdict ? 'AP verification: ' + verdict + '\n\n' : '') +
        'The obligation is closed. The entry remains as durable record history and now shows its\n' +
        'resolution date, subject to safety, privacy, consent, and legal redaction or takedown requirements.');
    } else if (rejectedSubmission) {
      var rejectionSummary = /^APJ1\|/.test(verdict) ? status : (verdict || status);
      mailMRB('SESSION REJECTED — ' + ds + ' — must be repeated',
        'The Accountability Partner has reviewed the session submitted against the entry for ' + ds + '\n' +
        '(' + what + ') and has not accepted it.\n\n' +
        'Result: ' + rejectionSummary + '\n\n' +
        'The entry remains open. The full assignment restarts from zero — a partial or invalid\n' +
        'session counts for nothing.\n\n' +
        'Record it again at ' + PORTAL_URL + '.');
    }
  }
  for (var legacyVerdictKey in seen) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(legacyVerdictKey)) { delete seen[legacyVerdictKey]; changed = true; }
  }
  if (changed) stateSetWhileAgreementActive('the verdict watch marker could be recorded', 'verdict_seen', JSON.stringify(seen));
}

function correctiveSubmittedWatch() {
  var gate = activeAgreementGate('correctiveSubmittedWatch');
  if (!gate) return;
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
    if (!dateWithinAgreement(ds, gate)) continue;
    var verifiedEvent = verifiedViolationDetails(v[i], gate);
    if (!verifiedEvent) continue;
    var eventKey = 'event:' + verifiedEvent.marker.split('|')[2];
    var submitted = String(v[i][3] || '').trim(); // column D — submission timestamp
    // Must actually be a timestamp. On a sheet still using the pre-rewrite
    // layout, column D holds the consequence level — a bare '1' would read as
    // a submission on every row and mail the AP once per row, every hour.
    if (!/^\d{4}-\d{2}-\d{2}/.test(submitted)) continue;
    var submittedDay = submitted.slice(0, 10);
    try { isoDateInput(submittedDay, 'corrective submission date'); } catch (submittedDateError) { continue; }
    if (submittedDay < gate.effectiveDate || submittedDay < ds || submittedDay > gate.today) continue;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(submitted)) {
      var nowEtMinute = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm');
      if (submitted.slice(0, 16) > nowEtMinute) continue;
    }
    var currentReview;
    try { currentReview = pendingCorrectiveReviewForSource(v[i], gate); }
    catch (reviewError) { continue; }
    var fingerprint = currentReview.assignmentId + '|' + currentReview.attemptId + '|' +
      currentReview.submitted + '|' + currentReview.urlHash;
    if (seen[eventKey] === fingerprint) continue;
    var first = !Object.prototype.hasOwnProperty.call(seen, eventKey);
    var migratingLegacyDate = first && Object.prototype.hasOwnProperty.call(seen, ds);
    seen[eventKey] = fingerprint;
    changed = true;
    if (priming || migratingLegacyDate) continue;
    var verdict = String(v[i][5] || '').trim();
    if (verdict && !currentReview.rejection) continue; // already ruled on, not a filed retry
    mailAP('Corrective session submitted — ' + ds + ' — awaiting your verification',
      'A corrective session has been submitted against the entry for ' + ds + '.\n\n' +
      'Submitted: ' + submitted + '\n' +
      'Assignment: ' + currentReview.assignmentId + '\n' +
      'Attempt: ' + currentReview.attemptId + '\n' +
      'Requirement missed: ' + String(v[i][1] || '') + '\n\n' +
      'The entry remains submitted and unresolved. The public posting is the\n' +
      'evidence, filed in column H and embedded beside the entry on the next build.\n' +
      'Review it for identity, attire, posture, elapsed time, and completion.\n' +
      'If accepted, first complete the exact assignment and attempt in the AP\n' +
      'client, then use MRB → Resolve selected entry; that writes the protected\n' +
      'resolution date and APR1 evidence together. If it fails, use Overrule\n' +
      'selected entry, record the reason, and require a replacement session.');
  }
  for (var legacySubmittedKey in seen) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(legacySubmittedKey)) { delete seen[legacySubmittedKey]; changed = true; }
  }
  if (changed) stateSetWhileAgreementActive('the corrective-submission watch marker could be recorded', 'submitted_seen', JSON.stringify(seen));
}

var MILESTONES = PROJECT_FACTS.milestonesLb;

function milestoneWatch() {
  var gate = activeAgreementGate('milestoneWatch');
  if (!gate) return;
  var vals = weighinsSheet().getDataRange().getValues();
  var latest = null, latestDate = '';
  for (var i = 1; i < vals.length; i++) {
    var w = parseFloat(vals[i][1]);
    if (isNaN(w)) continue;
    var d = vals[i][0];
    var ds = d instanceof Date ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : String(d).trim();
    if (!dateWithinAgreement(ds, gate)) continue;
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
    var final = target === PROJECT_FACTS.goalWeightLb;
    mailMRB('THRESHOLD RECORDED — ' + target + ' lb scale row on Day ' + day,
      'The scale row for ' + latestDate + ' recorded ' + latest + ' lb, at or below the ' + target + '-pound threshold.\n\n' +
      'This is a threshold observation, not an official milestone. The milestone requires\n' +
      'the required milestone video and Accountability Partner verification before it may be\n' +
      'described as reached or entered as official.\n\n' +
      (final
        ? 'If the 200-pound milestone is verified, completion still separately requires the\n' +
          'agreement\'s sustained-weight period and official completion verification.\n'
        : 'Next: ' + MILESTONES[m + 1] + ' lb.\n'));
    mailAP('Threshold recorded — ' + target + ' lb — verification required (' + latestDate + ')',
      'The scale row for ' + latestDate + ' recorded ' + latest + ' lb at or below the ' + target + '-pound threshold (Day ' + day + ').\n\n' +
      'Do not call this an official milestone yet. Verify the required milestone video and the\n' +
      'weigh-in evidence first; only an accepted AP review may mark the milestone official.');
  }
  if (changed) stateSetWhileAgreementActive('the milestone watch marker could be recorded', 'milestones_hit', JSON.stringify(hit));
}

/* Monday. The same seven days the AP is reviewing, from the other side. */
function mrbWeeklyBrief() {
  var gate = activeAgreementGate('mrbWeeklyBrief');
  if (!gate) return;
  if (stateGet('abandoned') === 'confirmed') return;
  var vals = weighinsSheet().getDataRange().getValues();
  var documented = 0, eligibleDays = 0, missed = [], weights = [];
  for (var i = 6; i >= 0; i--) {
    var ds = isoDateOffset(gate.today, -i - 1);
    if (!dateWithinAgreement(ds, gate)) continue;
    eligibleDays++;
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
      'The number is not a violation. Any documentation ruling requires explicit AP verification.\n';
  } else if (weights.length === 1) {
    trend = 'Weight: ' + weights[0].w + ' lb — one entry all week.\n';
  } else {
    trend = 'No weight was recorded at all this week.\n';
  }
  mailMRB('Week in review — ' + documented + ' of ' + eligibleDays + ' eligible days documented',
    documented + ' of ' + eligibleDays + ' eligible completed days since the ' + gate.effectiveDate + ' effective date carry a complete record.\n\n' + trend + '\n' +
    (missed.length ? 'Current incomplete file sets (timeliness not inferred):\n  - ' + missed.join('\n  - ') + '\n\n' : 'No incomplete file sets are currently shown for the reviewed dates.\n\n') +
    (c.open
      ? c.open + ' unresolved ' + (c.open === 1 ? 'entry remains' : 'entries remain') + ' on the public record.\n' +
        'Each one stays open until the Accountability Partner verifies a completed session.\n'
      : 'No entries are open. The record is current.\n') +
    '\n' + c.total + ' violation ' + (c.total === 1 ? 'entry has' : 'entries have') + ' been recorded since Day 1.\n' +
    'By default, resolution changes status while retaining durable record history. Publication\n' +
    'remains subject to safety, privacy, consent, and legal redaction or takedown requirements.');
}

/* Sends the non-violation examples so wording, links, and formatting can be
   checked without waiting for a trigger. Violation notices are deliberately
   excluded: they require an existing AP-verified record row and must never be
   synthesized by a test helper. */
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
  Logger.log('Violation notice test skipped: mrbViolationNotice requires an existing AP-verified record row.');
  mrbWeeklyBrief();
  Logger.log('Sent ' + (before - MailApp.getRemainingDailyQuota()) + ' message(s) to ' + MRB_EMAIL +
    '. Quota left: ' + MailApp.getRemainingDailyQuota());
}

/* Legacy existence-only relinking is disabled. HTTP 200 and a remembered path
   do not prove a photo is sanitized or linked to the accepted capture hash.
   githubMirrorPhotos() is the only allowed raw Drive→public URL transition. */
function relinkPhotosScan(apply) {
  Logger.log('DISABLED: existence-only photo relinking is unsafe. Run githubMirrorPhotos(); it verifies privacy, attestation, and both byte hashes before repointing.');
  return { ok: false, disabled: true, apply: !!apply };
}

function relinkPhotosPreview() { relinkPhotosScan(false); }
function relinkPhotos() { relinkPhotosScan(true); }


/* Legacy direct video relinking is disabled. It bypassed the accepted-capture
   hash, attestation, confirmation, duplicate, immutability, and agreement-gate
   checks enforced by the Recording Assistant filing routes. */
function setVideoUrl(date, pathOrUrl) {
  Logger.log('DISABLED: direct video relinking is unsafe. Use the Recording Assistant and its attested filing routes.');
  return { ok: false, disabled: true };
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


/* ═════ OBSERVER NOTIFICATIONS (user ruling Oct 3 2026) ═════
   Anyone may subscribe with an email address; double opt-in by emailed link.
   The public site never sees the /exec URL: the Cloudflare Pages Function
   /api/subscribe relays with the SUBSCRIBE_RELAY_KEY script property.
   Subscribers tab is private (AP-only): email · status · token · created · confirmed. */
var SUB_SITE = 'https://michealrayberry.com';
var SUB_HEADERS = ['email', 'status', 'token', 'created', 'confirmed'];
function subscribersSheet() {
  var book = ss();
  var sh = book.getSheetByName('Subscribers');
  if (!sh) { sh = book.insertSheet('Subscribers'); sh.appendRow(SUB_HEADERS); sh.setFrozenRows(1); }
  return sh;
}
function setSubscribeRelayKey(key) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(String(key || ''))) throw new Error('key must be 32+ url-safe characters');
  PropertiesService.getScriptProperties().setProperty('SUBSCRIBE_RELAY_KEY', key);
}
function handleSubscribeAction(p) {
  var expected = PropertiesService.getScriptProperties().getProperty('SUBSCRIBE_RELAY_KEY') || '';
  if (!expected || !secureTextEquals(String(p.key || ''), expected)) return jsonOut({ ok: false, error: 'unauthorized' });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = subscribersSheet(), vals = sh.getDataRange().getValues(), now = new Date();
    if (p.sub === 'subscribe') {
      var email = String(p.email || '').trim().toLowerCase();
      if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/.test(email)) return jsonOut({ ok: false, error: 'invalid email' });
      for (var i = 1; i < vals.length; i++) {
        if (String(vals[i][0]).toLowerCase() !== email) continue;
        if (vals[i][1] === 'ACTIVE') return jsonOut({ ok: true, state: 'active' });
        if (vals[i][1] === 'PENDING' && now - new Date(vals[i][3]) < 10 * 60 * 1000) return jsonOut({ ok: true, state: 'pending' });
        var t = Utilities.getUuid().replace(/-/g, '');
        sh.getRange(i + 1, 2, 1, 3).setValues([['PENDING', t, now]]);
        sendSubscribeConfirm(email, t);
        return jsonOut({ ok: true, state: 'pending' });
      }
      var tok = Utilities.getUuid().replace(/-/g, '');
      sh.appendRow([email, 'PENDING', tok, now, '']);
      sendSubscribeConfirm(email, tok);
      return jsonOut({ ok: true, state: 'pending' });
    }
    var token = String(p.token || '');
    if (!/^[a-f0-9]{32}$/.test(token)) return jsonOut({ ok: false, error: 'invalid token' });
    for (var j = 1; j < vals.length; j++) {
      if (String(vals[j][2]) !== token) continue;
      if (p.sub === 'confirm') {
        if (vals[j][1] === 'ACTIVE') return jsonOut({ ok: true, state: 'active' });
        if (vals[j][1] !== 'PENDING' || now - new Date(vals[j][3]) > 48 * 60 * 60 * 1000) return jsonOut({ ok: false, error: 'expired token' });
        sh.getRange(j + 1, 2).setValue('ACTIVE'); sh.getRange(j + 1, 5).setValue(now); return jsonOut({ ok: true, state: 'active' }); }
      if (p.sub === 'unsubscribe') { sh.getRange(j + 1, 2).setValue('UNSUBSCRIBED'); return jsonOut({ ok: true, state: 'unsubscribed' }); }
    }
    return jsonOut({ ok: false, error: 'unknown token' });
  } finally { lock.releaseLock(); }
}
function sendSubscribeConfirm(email, token) {
  sendMail(email, 'Confirm: Micheal Ray Berry public accountability notifications',
    'You asked to receive notifications from the Micheal Ray Berry public accountability record: the nightly result, new violations, escalations, completed corrections, missed supervision, and the weekly audit.\n\n' +
    'Confirm: ' + SUB_SITE + '/api/subscribe?confirm=' + token + '\n\n' +
    'If you did not ask for this, ignore this message; nothing will be sent.\n\n— Administered by the Accountability Partner · ' + AP_EMAIL);
}
function notifySubscribers(kind, subject, body) {
  try {
    var sh = subscribersSheet(), vals = sh.getDataRange().getValues(), sent = 0;
    for (var i = 1; i < vals.length; i++) {
      if (vals[i][1] !== 'ACTIVE') continue;
      if (MailApp.getRemainingDailyQuota() < 10) { Logger.log('SUBSCRIBER MAIL STOPPED — quota low after ' + sent); break; }
      sendMail(String(vals[i][0]), 'Ray Berry — ' + subject, body +
        '\n—\nYou subscribed at michealrayberry.com/notify/. Unsubscribe: ' + SUB_SITE + '/api/subscribe?unsubscribe=' + vals[i][2] +
        '\nAdministered by the Accountability Partner · ' + AP_EMAIL);
      sent++;
    }
    Logger.log('notifySubscribers(' + kind + '): ' + sent);
    return sent;
  } catch (e) { Logger.log('notifySubscribers failed: ' + e); return 0; }
}
function subscriberWeeklyAudit() {
  var gate = activeAgreementGate('subscriberWeeklyAudit');
  if (!gate) return;
  var filed = 0, missed = 0, days = 0;
  for (var i = 7; i >= 1; i--) {
    var ds = isoDateOffset(gate.today, -i);
    if (!dateWithinAgreement(ds, gate)) continue;
    days++;
    if (packetState(ds).complete) filed++; else missed++;
  }
  if (!days) return;
  var sup = 0, supMissed = 0;
  try {
    var sv = supervisionSheet().getDataRange().getValues();
    for (var r = 1; r < sv.length; r++) {
      var d = apDateStr(sv[r][0]);
      if (d < isoDateOffset(gate.today, -7) || d >= gate.today || !dateWithinAgreement(d, gate)) continue;
      if (!/^(true|yes|1|required)$/i.test(String(sv[r][1]))) continue;
      sup++; if (/^MISSED/i.test(String(sv[r][2]))) supMissed++;
    }
  } catch (e) {}
  var summary = verifiedViolationSummary(violationLogSheet().getDataRange().getValues(), gate);
  var week = Math.ceil((Math.floor((new Date(gate.today) - new Date(PROJECT_START)) / 864e5)) / 7);
  notifySubscribers('weekly', 'Weekly Audit — Week ' + week,
    'Micheal Ray Berry — Weekly Audit, the 7 days ending ' + isoDateOffset(gate.today, -1) + '\n\n' +
    'Packet filed: ' + filed + ' of ' + days + ' days\n' +
    'Packet incomplete at deadline: ' + missed + '\n' +
    'Evening Supervision: ' + (sup - supMissed) + ' of ' + sup + ' required sessions on the record' + (supMissed ? ' · ' + supMissed + ' MISSED' : '') + '\n' +
    'Open violations: ' + summary.open + ' · total on record: ' + summary.total + '\n\n' +
    'Weekly page: ' + SUB_SITE + '/weeks/\n');
}
