const TABS = Object.freeze({
  PROJECT: 'Project',
  PACKETS: 'Packets',
  VIOLATIONS: 'Violations',
  AUDIT: 'Audit'
});

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || 'publicSnapshot');
  try {
    if (action === 'publicSnapshot') return json_(publicSnapshot_());
    if (action === 'health') return json_({ ok: true, now: new Date().toISOString() });
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');
    if (action === 'submitPacket') return json_(submitPacket_(body));
    if (action === 'apDeclareViolation') return json_(apDeclareViolation_(body));
    if (action === 'apResolveViolation') return json_(apResolveViolation_(body));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    audit_('request-error', { error: String(err && err.stack || err) });
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function publicSnapshot_() {
  const ss = spreadsheet_();
  const project = keyValueTab_(ss, TABS.PROJECT);
  const packets = rows_(ss, TABS.PACKETS);
  const violations = rows_(ss, TABS.VIOLATIONS).map(function (r) {
    return { date: r.date, nature: r.nature, resolved: /^resolved$/i.test(String(r.status || '')) };
  });
  const accepted = packets.filter(function (p) { return p.status === 'accepted'; });
  const latest = accepted.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0] || {};
  return {
    ok: true,
    project: project,
    summary: {
      currentWeightLb: latest.weightLb || null,
      acceptedDays: accepted.length,
      violations: violations.filter(function (v) { return !v.resolved; }).length,
      lastUpdated: new Date().toISOString()
    },
    days: packets,
    violations: violations
  };
}

function submitPacket_(body) {
  requireKey_(body.key, 'PACKET_KEY');
  const packet = validatePacket_(body.packet || {});
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ensureTab_(spreadsheet_(), TABS.PACKETS, [
      'date','projectDay','weightLb','videoUrl','frontUrl','leftUrl','rearUrl','rightUrl',
      'submittedAt','status','reviewedAt','reviewNotes'
    ]);
    const existing = findRow_(sheet, 'date', packet.date);
    if (existing) throw new Error('A packet already exists for ' + packet.date);
    const submittedAt = new Date().toISOString();
    sheet.appendRow([
      packet.date, packet.projectDay, packet.weightLb, packet.videoUrl,
      packet.photos.front, packet.photos.left, packet.photos.rear, packet.photos.right,
      submittedAt, 'submitted', '', ''
    ]);
    audit_('packet-submitted', { date: packet.date, projectDay: packet.projectDay });
    return { ok: true, date: packet.date, submittedAt: submittedAt, status: 'submitted' };
  } finally {
    lock.releaseLock();
  }
}

function apDeclareViolation_(body) {
  requireKey_(body.key, 'AP_KEY');
  const date = isoDate_(body.date);
  const nature = String(body.nature || '').trim();
  if (!nature) throw new Error('Violation nature is required');
  const sheet = ensureTab_(spreadsheet_(), TABS.VIOLATIONS, ['date','nature','status','createdAt','resolvedAt']);
  sheet.appendRow([date, nature, 'unresolved', new Date().toISOString(), '']);
  audit_('violation-declared', { date: date, nature: nature });
  return { ok: true };
}

function apResolveViolation_(body) {
  requireKey_(body.key, 'AP_KEY');
  const row = Number(body.row);
  const sheet = ensureTab_(spreadsheet_(), TABS.VIOLATIONS, ['date','nature','status','createdAt','resolvedAt']);
  if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid row');
  sheet.getRange(row, 3, 1, 2).setValues([['resolved', new Date().toISOString()]]);
  audit_('violation-resolved', { row: row });
  return { ok: true };
}

function validatePacket_(p) {
  const date = isoDate_(p.date);
  const weight = Number(p.weightLb);
  if (!isFinite(weight) || weight <= 0) throw new Error('Valid weight is required');
  const photos = p.photos || {};
  ['front','left','rear','right'].forEach(function (a) {
    if (!String(photos[a] || '').trim()) throw new Error(a + ' photo URL is required');
  });
  const videoUrl = String(p.videoUrl || '').trim();
  if (!videoUrl) throw new Error('Video URL is required');
  return {
    date: date,
    projectDay: Number(p.projectDay) || '',
    weightLb: weight,
    videoUrl: videoUrl,
    photos: photos
  };
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID is not configured');
  return SpreadsheetApp.openById(id);
}

function requireKey_(provided, propertyName) {
  const expected = PropertiesService.getScriptProperties().getProperty(propertyName);
  if (!expected) throw new Error(propertyName + ' is not configured');
  if (String(provided || '') !== expected) throw new Error('Unauthorized');
}

function isoDate_(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Date must be YYYY-MM-DD');
  return s;
}

function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function rows_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift().map(function (h) { return String(h).trim(); });
  return values.filter(function (r) { return r.some(String); }).map(function (r, i) {
    const o = { row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    if (o.weightLb !== undefined && o.weightLb !== '') o.weightLb = Number(o.weightLb);
    if (o.projectDay !== undefined && o.projectDay !== '') o.projectDay = Number(o.projectDay);
    return o;
  });
}

function keyValueTab_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() === 0) return {};
  const values = sheet.getDataRange().getDisplayValues();
  const out = {};
  values.forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = r[1]; });
  return out;
}

function findRow_(sheet, header, value) {
  if (sheet.getLastRow() < 2) return 0;
  const values = sheet.getDataRange().getDisplayValues();
  const col = values[0].indexOf(header);
  if (col < 0) throw new Error('Missing header: ' + header);
  for (let i = 1; i < values.length; i++) if (String(values[i][col]) === String(value)) return i + 1;
  return 0;
}

function audit_(event, detail) {
  try {
    const sheet = ensureTab_(spreadsheet_(), TABS.AUDIT, ['at','event','detail']);
    sheet.appendRow([new Date().toISOString(), event, JSON.stringify(detail || {})]);
  } catch (ignored) {}
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
