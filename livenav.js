/* Supervision nav state. Lights the nav item while a confirmed session is in
   progress (row LIVE / IN PROGRESS, fresh feed, active agreement); the stream
   itself plays on /live/. */
(function () {
  var url = '/data/supervision.json';
  function unlight() {
    document.querySelectorAll('[data-live-nav]').forEach(function (a) {
      a.classList.remove('is-live');
      a.style.removeProperty('color');
      var dot = a.querySelector('[data-live-dot]');
      if (dot) { dot.style.removeProperty('background'); dot.style.removeProperty('border-color'); dot.style.removeProperty('animation'); }
      var lab = a.querySelector('[data-live-label]');
      if (lab) lab.textContent = 'Supervision';
    });
  }
  function light() {
    document.querySelectorAll('[data-live-nav]').forEach(function (a) {
      a.classList.add('is-live');
      a.style.color = '#B3261E';
      var dot = a.querySelector('[data-live-dot]');
      if (dot) { dot.style.background = '#B3261E'; dot.style.borderColor = '#B3261E'; dot.style.animation = 'livepulse 1.6s ease-in-out infinite'; }
      var lab = a.querySelector('[data-live-label]');
      if (lab) lab.textContent = 'Supervision active';
    });
    if (!document.getElementById('livepulse-kf')) {
      var s = document.createElement('style'); s.id = 'livepulse-kf';
      s.textContent = '@keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}';
      document.head.appendChild(s);
    }
  }
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
  function check() {
    unlight();
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date());
    var g = {}; parts.forEach(function (p) { g[p.type] = p.value; });
    var today = g.year + '-' + g.month + '-' + g.day, h = parseInt(g.hour, 10) % 24;
    if (h < 18 || h >= 22) return;
    fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('feed'); return r.json(); }).then(function (payload) {
      var published = Date.parse(payload && payload.published_at || '');
      var age = Date.now() - published;
      if (!payload || payload.agreement_active !== true || !isFinite(published) || age < -300000 || age > 10 * 60 * 1000) return;
      var row = payload && payload.sessions ? payload.sessions[today] : null;
      if (!row) return;
      var required = row.required === true;
      var status = String(row.status || '').trim().toUpperCase();
      if (required && /^(LIVE|IN PROGRESS)\b/.test(status)) light();
    }).catch(unlight);
  }
  markCurrentPage();
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
