/* Progressive refresh of the public counters. The HTML already states the
   facts as of the last build; this only brings the four live figures up to
   the minute from the record sheet. If it fails, the page is still correct. */
(function () {
  var SHEET = '1sEL0SWIh4NnNji4XUAVVG4pQSZe7a0y3vDmvvLNV6wE';
  var base = 'https://docs.google.com/spreadsheets/d/' + SHEET + '/gviz/tq?tqx=out:csv&sheet=';
  var START = '2026-08-31';
  function csv(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.join('').trim()) rows.push(row); row = []; }
      else f += c;
    }
    row.push(f); if (row.join('').trim()) rows.push(row);
    return rows;
  }
  function iso(v) { var s = String(v || '').trim(); var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : s; }
  function set(key, text) { document.querySelectorAll('[data-live-key="' + key + '"]').forEach(function (n) { n.textContent = text; }); }
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  Promise.all([fetch(base + 'Weigh-ins').then(function (r) { return r.text(); }), fetch(base + encodeURIComponent('Violation Log')).then(function (r) { return r.text(); })])
    .then(function (t) {
      var w = csv(t[0]).slice(1).map(function (r) { return { date: iso(r[0]), weight: parseFloat(r[1]), photo: String(r[3] || '').trim() }; })
        .filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= START && !isNaN(r.weight); })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var v = csv(t[1]).slice(1).filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(iso(r[0])) && String(r[1] || '').trim(); });
      var open = v.filter(function (r) { var s = String(r[2] || ''); return !(/^\s*(resolved|satisfied|closed)/i.test(s) && !/unresolved/i.test(s)); }).length;
      var last = w[w.length - 1];
      var todayRow = w.filter(function (r) { return r.date === today; })[0];
      var done = !!(todayRow && todayRow.photo);
      var day = Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(START + 'T12:00:00Z')) / 864e5) + 1;
      set('openCountLabel', String(open));
      set('agreementStatus', 'under agreement · ' + open + ' open');
      if (last) set('currentLabel', last.weight.toFixed(1));
      set('complianceLabel', open > 0 ? (open === 1 ? 'Non-compliant — one unresolved violation' : 'Non-compliant — ' + open + ' unresolved violations') : (day < 1 ? 'Under agreement' : done ? 'Compliant — today’s packet filed' : 'Compliant — today’s packet due'));
      set('todayPacketLabel', day < 1 ? '' : (done ? 'Filed · ' : 'Not yet filed · ') + today);
    }).catch(function () {});
})();
