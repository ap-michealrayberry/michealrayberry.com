/* Evening Supervision: /live/ console + homepage module. Public live video is
   ON (user ruling, Oct 3 2026): during a confirmed session (row LIVE / IN
   PROGRESS, fresh feed, active agreement) /live/ mounts the Twitch live embed
   and the homepage module reads LIVE NOW. A writable schedule row alone is not
   proof of a broadcast. */
(function () {
  var TZ = 'America/New_York', START = '2026-09-13', H0 = 18, H1 = 22;
  var FEED = '/data/supervision.json';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var rows = {}, agreementActive = false, publishedAt = 0, feedFailed = false;
  function applyPayload(payload) {
    rows = payload && payload.sessions && typeof payload.sessions === 'object' ? payload.sessions : {};
    agreementActive = !!(payload && payload.agreement_active === true);
    publishedAt = Date.parse(payload && payload.published_at || '') || 0;
    feedFailed = false;
  }
  try { var el = document.getElementById('supervision-data'); if (el) applyPayload(JSON.parse(el.textContent || '{}')); } catch (e) {}

  function yes(v) { return /^(true|yes|1|required)$/i.test(String(v == null ? '' : v).trim()); }
  function et(d) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { iso: p.year + '-' + p.month + '-' + p.day, h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
  }
  function dowOf(date) { var a = date.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2], 12)).getUTCDay(); }
  function addDays(date, n) { var a = date.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2] + n, 12)).toISOString().slice(0, 10); }
  function rowOf(date) { return rows[date] || null; }
  function feedFresh(maxAge) { var age = Date.now() - publishedAt; return publishedAt > 0 && age >= -300000 && age <= maxAge; }
  function gateCurrent() { return agreementActive && feedFresh(36 * 60 * 60 * 1000); }
  function exempt(date) { var r = rowOf(date); return !!(r && /^EXCEPTION\b/i.test(r.status || '')); }
  function required(date) {
    var r = rowOf(date);
    if (!gateCurrent() || !r) return false;
    if (exempt(date)) return false;
    return Object.prototype.hasOwnProperty.call(r, 'required') && yes(r.required);
  }
  function confirmed(date) { var r = rowOf(date); return !!(r && feedFresh(10 * 60 * 1000) && /^(LIVE|IN PROGRESS)\b/i.test(r.status || '')); }
  function sessionNo(date) { var n = 0; for (var d = START; d <= date; d = addDays(d, 1)) if (required(d)) n++; return n; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function label(date) { var a = date.split('-'); return DOW[dowOf(date)].toUpperCase() + ' ' + Number(a[2]); }
  function state() {
    var now = et(new Date());
    var windowOpen = required(now.iso) && now.h >= H0 && now.h < H1;
    var live = windowOpen && confirmed(now.iso);
    var remaining = live ? (H1 - now.h) * 3600 - now.m * 60 - now.s : 0;
    return { now: now, active: live, windowOpen: windowOpen, remaining: remaining, tonight: required(now.iso), exemptTonight: exempt(now.iso), no: sessionNo(now.iso), inactive: !feedFailed && !agreementActive, stale: feedFailed || (agreementActive && !gateCurrent()) };
  }

  function set(sel, html) {
    document.querySelectorAll(sel).forEach(function (n) {
      if (n.innerHTML !== html) n.innerHTML = html;
    });
  }
  function setActiveDetail(session, clockText) {
    document.querySelectorAll('[data-live-detail]').forEach(function (n) {
      var clock = n.querySelector('[data-live-clock]');
      if (!clock) {
        n.innerHTML =
          '<div><b>Session</b><span>' + session + '</span></div>' +
          '<div><b>Scheduled start</b><span>6:00 PM ET</span></div>' +
          '<div><b>Required end</b><span>10:00 PM ET</span></div>' +
          '<div><b>Time remaining</b><span data-live-clock></span></div>' +
          '<div><b>Record state</b><span>IN PROGRESS</span></div>' +
          '<div><b>Public video</b><span>Live below</span></div>';
        clock = n.querySelector('[data-live-clock]');
      }
      if (clock && clock.textContent !== clockText) clock.textContent = clockText;
    });
  }
  function show(sel, on) { document.querySelectorAll(sel).forEach(function (n) { n.style.display = on ? '' : 'none'; }); }

  function embed(on) {
    document.querySelectorAll('[data-live-embed]').forEach(function (f) {
      if (!on) { if (f.firstChild) f.innerHTML = ''; f.style.display = 'none'; return; }
      f.style.display = 'block';
      if (f.firstChild) return;
      var src = f.getAttribute('data-src');
      if (src) {
        var i = document.createElement('iframe');
        i.src = src; i.title = 'Evening Supervision — live';
        i.allow = 'autoplay; fullscreen'; i.allowFullscreen = true;
        f.appendChild(i);
      } else {
        var a = document.createElement('a');
        a.className = 'fb'; a.rel = 'noopener';
        a.href = f.getAttribute('data-fallback') || 'https://www.twitch.tv/michealrayberry';
        a.textContent = 'Watch on Twitch \u2192';
        f.appendChild(a);
      }
    });
  }

  function renderConsole() {
    var st = state();
    var lamp = '<span class="lamp' + (st.active ? ' on' : '') + '"></span>';
    if (st.inactive) {
      set('[data-live-status]', lamp + 'PROPOSED — NOT ACTIVATED');
      set('[data-live-detail]', '<div><b>Agreement</b><span>Execution is not verified</span></div><div><b>Today</b><span>No active supervision requirement</span></div><div><b>Public video</b><span>Plays here during a live session</span></div>');
      embed(false);
    } else if (st.stale) {
      set('[data-live-status]', lamp + 'STATUS UNAVAILABLE — STALE PUBLIC FEED');
      set('[data-live-detail]', '<div><b>Today</b><span>No current requirement state can be shown</span></div><div><b>Public video</b><span>Plays here during a live session</span></div>');
      embed(false);
    } else if (st.active) {
      set('[data-live-status]', lamp + 'SUPERVISION STATUS — IN PROGRESS');
      var hh = Math.floor(st.remaining / 3600), mm = Math.floor((st.remaining % 3600) / 60), ss = st.remaining % 60;
      setActiveDetail(pad(st.no).padStart(3, '0'), pad(hh) + ':' + pad(mm) + ':' + pad(ss));
      embed(true);
    } else if (st.windowOpen) {
      set('[data-live-status]', lamp + 'SCHEDULED WINDOW — STREAM NOT CONFIRMED');
      set('[data-live-detail]', '<div><b>Tonight</b><span>Required, 6:00–10:00 PM ET</span></div><div><b>Public feed</b><span>No active status has been recorded</span></div>');
      embed(false);
    } else {
      set('[data-live-status]', lamp + 'OFFLINE');
      var tonight = st.exemptTonight ? 'Not required tonight — documented exception on the record.'
        : st.tonight ? (st.now.h >= H1 ? 'Tonight\u2019s session window has closed.' : 'Required tonight, 6:00–10:00 PM ET.')
        : 'Not scheduled tonight.';
      set('[data-live-detail]', '<div><b>Today</b><span>' + tonight + '</span></div><div><b>Public video</b><span>Plays here during a live session</span></div>');
      embed(false);
    }
    var d = st.now.iso, r = rowOf(d), rowStatus = r ? String(r.status || '') : '';
    var stat = st.inactive ? 'PROPOSED — NOT ACTIVATED' : st.stale ? 'STATUS UNAVAILABLE' : exempt(d) ? 'EXCEPTION' : required(d) ? 'REQUIRED — 6:00–10:00' : 'NO REQUIREMENT RECORDED';
    if (!st.inactive && !st.stale && /^COMPLETED$/i.test(rowStatus.trim())) stat = 'COMPLETED';
    if (!st.inactive && !st.stale && /^MISSED$/i.test(rowStatus.trim())) stat = 'MISSED';
    if (st.active) stat = 'IN PROGRESS';
    var out = '<div class="today' + (required(d) ? ' req' : '') + '"><b>' + label(d) + '</b><span>' + stat + '</span></div>';
    set('[data-live-schedule]', out);
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(date) { var a = date.split('-'); return DOW[dowOf(date)] + ' ' + MON[Number(a[1]) - 1] + ' ' + Number(a[2]); }
  function css(n, k, v) { if (n && n.style[k] !== v) n.style[k] = v; }
  function txt(n, v) { if (n && n.textContent !== v) n.textContent = v; }
  function renderModule() {
    var mods = document.querySelectorAll('[data-sup-module]');
    if (!mods.length) return;
    var st = state(), d = st.now.iso, r = rowOf(d), rs = r ? String(r.status || '').trim() : '';
    var s = { key: 'offline', label: 'Offline', when: '', action: 'Supervision status', href: '/live/' };
    if (st.inactive) s = { key: 'muted', label: 'Not yet active', when: 'Begins when the agreement is executed', action: 'Rules', href: '/live/' };
    else if (st.stale) s = { key: 'muted', label: 'Status unavailable', when: 'The public status feed is out of date', action: 'Supervision status', href: '/live/' };
    else if (st.active) s = { key: 'live', label: 'Live now', when: 'Tonight \u00b7 until 10:00 PM ET', action: 'Watch live', href: '/live/' };
    else if (st.windowOpen) s = { key: 'pending', label: 'Awaiting stream', when: 'Tonight \u00b7 6:00\u201310:00 PM ET', action: 'Watch live', href: '/live/' };
    else if (required(d) && /^COMPLETED$/i.test(rs)) s = { key: 'done', label: 'Session completed', when: shortDate(d) + ' \u00b7 6:00\u201310:00 PM ET', action: 'Session record', href: '/live/' };
    else if (required(d) && /^MISSED$/i.test(rs)) s = { key: 'missed', label: 'Missed', when: shortDate(d) + ' \u00b7 required session not completed', action: 'Violation log', href: '/violations/' };
    else if (st.exemptTonight) s = { key: 'muted', label: 'Exempt', when: shortDate(d) + ' \u00b7 documented exception', action: '', href: '/live/' };
    else if (st.tonight && st.now.h < H0) s.when = 'Tonight \u00b7 6:00 PM ET';
    else if (st.tonight) s.when = shortDate(d) + ' \u00b7 session window closed, outcome pending review';
    else s.when = 'Not scheduled tonight';
    var color = s.key === 'live' || s.key === 'missed' ? '#B3261E' : s.key === 'muted' ? '#6B6A64' : '#141412';
    var primary = s.key === 'live' || s.key === 'pending';
    mods.forEach(function (m) {
      if (m.getAttribute('data-sup-state') !== s.key) m.setAttribute('data-sup-state', s.key);
      css(m.querySelector('[data-sup-head]'), 'background', s.key === 'live' ? '#FBF1F0' : '');
      var lab = m.querySelector('[data-sup-label]'); txt(lab, s.label); css(lab, 'color', color);
      css(m.querySelector('[data-sup-dot]'), 'display', s.key === 'live' ? 'inline-block' : 'none');
      var w = m.querySelector('[data-sup-when]'); txt(w, s.when); css(w, 'display', s.when ? 'block' : 'none');
      var a = m.querySelector('[data-sup-action]');
      if (!a) return;
      css(a, 'display', s.action ? '' : 'none');
      txt(a, s.action ? s.action + ' \u2192' : '');
      if (a.getAttribute('href') !== s.href) a.setAttribute('href', s.href);
      css(a, 'background', primary ? '#141412' : 'transparent');
      css(a, 'color', primary ? '#FAFAF7' : '#141412');
      css(a, 'padding', primary ? '12px 18px' : '0px');
      css(a, 'textDecoration', primary ? 'none' : 'underline');
    });
  }
  function tick() { if (document.querySelector('[data-live-status]')) renderConsole(); renderModule(); }
  function refresh() {
    fetch(FEED, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('feed'); return r.json(); }).then(function (payload) {
      applyPayload(payload);
      tick();
    }).catch(function () { rows = {}; agreementActive = false; publishedAt = 0; feedFailed = true; tick(); });
  }
  if (!document.querySelector('[data-live-status], [data-sup-module]')) return;
  tick();
  refresh();
  setInterval(tick, 1000);
  setInterval(refresh, 5 * 60 * 1000);
})();
