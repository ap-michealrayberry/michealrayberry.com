/* Navigation and copy links use the existing published record. */
(function () {
  function markCurrentPage() {
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var best = null, bestLength = -1;
    document.querySelectorAll('.sitenav a[href]').forEach(function (a) {
      var target;
      try { target = new URL(a.getAttribute('href'), location.origin); } catch (e) { return; }
      if (target.origin !== location.origin) return;
      var candidate = target.pathname.replace(/\/+$/, '') || '/';
      var match = path === candidate || (candidate !== '/' && path.indexOf(candidate + '/') === 0);
      if (match && candidate.length > bestLength) { best = a; bestLength = candidate.length; }
    });
    if (best) best.setAttribute('aria-current', 'page');
  }
  markCurrentPage();

  /* Supervision nav state, read from the published record (/data/supervision.json,
     written at build). A night assigned by the AP, inside its 6–10 PM ET window,
     not ruled MISSED/EXCEPTION, lights the dot: ● SUPERVISION · LIVE. Otherwise
     the hollow dot stands and the label reads SUPERVISION. Static HTML is the
     default; this only upgrades it. */
  function etNow() {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { iso: p.year + '-' + p.month + '-' + p.day, h: Number(p.hour) % 24 };
  }
  function lightNav(on) {
    document.querySelectorAll('[data-live-nav]').forEach(function (a) {
      a.classList.toggle('is-live', on);
      var lab = a.querySelector('[data-live-label]');
      if (lab) lab.textContent = on ? 'Supervision \u00B7 Live' : 'Supervision';
    });
  }
  function checkSupervision() {
    var now = etNow();
    if (now.h < 18 || now.h >= 22) { lightNav(false); return; }
    fetch('/data/supervision.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var s = d && d.sessions && d.sessions[now.iso];
      var status = String((s && s.status) || '').toUpperCase();
      lightNav(!!(s && s.required && !/^(MISSED|EXCEPTION)/.test(status)));
    }).catch(function () { lightNav(false); });
  }
  if (document.querySelector('[data-live-nav]')) { checkSupervision(); setInterval(checkSupervision, 5 * 60 * 1000); }
  /* Report-card "Copy link": copies the permalink; falls back to following it. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-copy]');
    if (!a || !navigator.clipboard) return;
    e.preventDefault();
    navigator.clipboard.writeText(a.getAttribute('data-copy')).then(function () {
      var t = a.textContent; a.textContent = 'Copied'; setTimeout(function () { a.textContent = t; }, 1400);
    }).catch(function () { location.href = a.href; });
  });
  /* Corrective-deadline countdown: relative label recomputed from the
     PUBLISHED due time in data-due-iso, never a client-side deadline. */
  function tickDue() {
    document.querySelectorAll('[data-due-iso]').forEach(function (el) {
      var iso = el.getAttribute('data-due-iso'); if (!iso) return;
      var ms = new Date(iso) - Date.now(), a = Math.abs(ms);
      var h = Math.floor(a / 3600e3), m = Math.floor((a % 3600e3) / 60e3);
      var txt = h >= 24 ? h + ' h' : h > 0 ? h + ' h ' + m + ' m' : m + ' m';
      el.textContent = ms < 0 ? 'overdue by ' + txt : txt + ' remaining';
    });
  }
  tickDue(); setInterval(tickDue, 30 * 1000);
})();
