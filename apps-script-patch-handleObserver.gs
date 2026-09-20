/* PATCH for the live Code.gs — replace the existing handleObserver() with this.
   Then in the record spreadsheet, Observer tab: insert a column after B named
   record_ref (header row becomes: received_at, type, record_ref, message, name,
   email, source_url, review, ap_note). Existing rows keep their old type labels. */
function handleObserver(obj) {
  var clip = function (v, n) { return String(v || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n); };
  var TYPES = ['Possible missed requirement', 'Incorrect or inconsistent record', 'Missing or broken evidence', 'Suspected misuse of public material', 'Question for the Accountability Partner'];
  var type = clip(obj.type, 60); if (TYPES.indexOf(type) === -1) type = 'Question for the Accountability Partner';
  var message = clip(obj.message, 4000);
  if (!message) return jsonOut({ ok: false, error: 'empty message' });
  var ref = clip(obj.record_ref, 40);
  var needsRef = TYPES.indexOf(type) <= 2;
  if (needsRef && !ref) return jsonOut({ ok: false, error: 'date or Project Day required' });
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
      'Review on the Observer tab (col H: received → dismissed / verified / published / actioned); a substantiated issue is entered through the console. Nothing publishes from this tab.' + apSign());
  } catch (e) { Logger.log('Observer mail failed: ' + e); }
  return jsonOut({ ok: true, n: n });
}
