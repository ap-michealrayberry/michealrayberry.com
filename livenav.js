/* LIVE nav state. Reads the Supervision tab: a required night inside its
   6–10 PM ET window and not ruled MISSED/EXCEPTION lights the dot and
   relabels the link "Live now". Static HTML already says "Live". */
(function () {
  var SHEET = '1sEL0SWIh4NnNji4XUAVVG4pQSZe7a0y3vDmvvLNV6wE';
  var url = 'https://docs.google.com/spreadsheets/d/' + SHEET + '/gviz/tq?tqx=out:csv&sheet=Supervision';
  function csv(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function iso(v) { var s = String(v || '').trim(); var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : s; }
  function light() {
    document.querySelectorAll('[data-live-nav]').forEach(function (a) {
      a.classList.add('is-live');
      a.style.color = '#B3261E';
      var dot = a.querySelector('[data-live-dot]');
      if (dot) { dot.style.background = '#B3261E'; dot.style.borderColor = '#B3261E'; dot.style.animation = 'livepulse 1.6s ease-in-out infinite'; }
      var lab = a.querySelector('[data-live-label]');
      if (lab) lab.textContent = 'Live now';
    });
    if (!document.getElementById('livepulse-kf')) {
      var s = document.createElement('style'); s.id = 'livepulse-kf';
      s.textContent = '@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}';
      document.head.appendChild(s);
    }
  }
  function check() {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date());
    var g = {}; parts.forEach(function (p) { g[p.type] = p.value; });
    var today = g.year + '-' + g.month + '-' + g.day, h = parseInt(g.hour, 10) % 24;
    if (h < 18 || h >= 22) return;
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (text) {
      var row = csv(text).slice(1).filter(function (r) { return iso(r[0]) === today; })[0];
      if (!row) return;
      var required = /^(true|yes|1)$/i.test(String(row[1] || '').trim());
      var status = String(row[2] || '').trim().toUpperCase();
      if (required && status !== 'MISSED' && status !== 'EXCEPTION') light();
    }).catch(function () {});
  }
  check();
  setInterval(check, 5 * 60 * 1000);
  /* Report-card "Copy link": copies the permalink; falls back to following it. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-copy]');
    if (!a || !navigator.clipboard) return;
    e.preventDefault();
    navigator.clipboard.writeText(a.getAttribute('data-copy')).then(function () {
      var t = a.textContent; a.textContent = 'Copied'; setTimeout(function () { a.textContent = t; }, 1400);
    }).catch(function () { location.href = a.href; });
  });
})();
