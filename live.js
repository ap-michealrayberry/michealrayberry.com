/* Evening Supervision console — michealrayberry.com/live and the homepage bar.
   Schedule is fixed by §3.4: nights preceding a scheduled workday (Sun–Thu),
   6:00–10:00 PM Eastern, from Sunday 13 September 2026. Record rows (status
   per night) arrive from the publisher in #supervision-data. */
(function () {
  var TZ = 'America/New_York', START = '2026-09-13', H0 = 18, H1 = 22, NIGHTS = [0, 1, 2, 3, 4];
  var CHANNEL = 'UCi_0KqZjgbRUuLVAM5CmStQ';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var rows = {};
  try { var el = document.getElementById('supervision-data'); if (el) rows = JSON.parse(el.textContent || '{}'); } catch (e) {}

  function et(d) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { iso: p.year + '-' + p.month + '-' + p.day, h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
  }
  function dowOf(iso) { var a = iso.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2], 12)).getUTCDay(); }
  function addDays(iso, n) { var a = iso.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2] + n, 12)).toISOString().slice(0, 10); }
  function scheduled(iso) { return iso >= START && NIGHTS.indexOf(dowOf(iso)) !== -1; }
  function rowOf(iso) { return rows[iso] || null; }
  function exempt(iso) { var r = rowOf(iso); return !!(r && /^EXCEPTION/i.test(r.status || '')); }
  function required(iso) { return scheduled(iso) && !exempt(iso); }
  function sessionNo(iso) { var n = 0; for (var d = START; d <= iso; d = addDays(d, 1)) if (scheduled(d)) n++; return n; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function label(iso) { var a = iso.split('-'); return DOW[dowOf(iso)].toUpperCase() + ' ' + Number(a[2]); }
  function longLabel(iso) {
    var a = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(a[0], a[1] - 1, a[2], 12)));
  }

  function state() {
    var now = et(new Date());
    var live = required(now.iso) && now.h >= H0 && now.h < H1;
    var remaining = live ? (H1 - now.h) * 3600 - now.m * 60 - now.s : 0;
    var next = null;
    for (var i = 0; i < 14 && !next; i++) {
      var d = addDays(now.iso, i);
      if (!required(d)) continue;
      if (i === 0 && now.h >= H1) continue;
      next = { iso: d, tonight: i === 0, tomorrow: i === 1 };
    }
    return { now: now, live: live, remaining: remaining, next: next, tonight: required(now.iso), exemptTonight: exempt(now.iso), no: sessionNo(now.iso) };
  }

  function set(sel, html) { document.querySelectorAll(sel).forEach(function (n) { n.innerHTML = html; }); }
  function show(sel, on) { document.querySelectorAll(sel).forEach(function (n) { n.style.display = on ? '' : 'none'; }); }

  function renderConsole() {
    var st = state();
    var lamp = '<span class="lamp' + (st.live ? ' on' : '') + '"></span>';
    if (st.live) {
      set('[data-live-status]', lamp + 'LIVE — UNDER SUPERVISION');
      var hh = Math.floor(st.remaining / 3600), mm = Math.floor((st.remaining % 3600) / 60), ss = st.remaining % 60;
      set('[data-live-detail]',
        '<div><b>Session</b><span>' + pad(st.no).padStart(3, '0') + '</span></div>' +
        '<div><b>Started</b><span>6:00 PM ET</span></div>' +
        '<div><b>Required end</b><span>10:00 PM ET</span></div>' +
        '<div><b>Time remaining</b><span data-live-clock>' + pad(hh) + ':' + pad(mm) + ':' + pad(ss) + '</span></div>' +
        '<div><b>Compliance</b><span>IN PROGRESS</span></div>');
      var embed = document.querySelector('[data-live-embed]');
      if (embed && !embed.querySelector('iframe')) {
        embed.innerHTML = '<iframe src="https://www.youtube.com/embed/live_stream?channel=' + CHANNEL + '" title="Evening Supervision — live" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
      }
      show('[data-live-embed]', true);
    } else {
      var when = !st.next ? 'NO SESSION SCHEDULED'
        : st.next.tonight ? 'TONIGHT 6:00 PM ET'
        : st.next.tomorrow ? 'TOMORROW 6:00 PM ET'
        : DOW[dowOf(st.next.iso)].toUpperCase() + ' 6:00 PM ET';
      set('[data-live-status]', lamp + 'OFFLINE — NEXT SESSION: ' + when);
      var tonight = st.exemptTonight ? 'Not required tonight — documented exception on the record.'
        : st.tonight ? (st.now.h >= H1 ? 'Tonight\u2019s session window has closed.' : 'Required tonight, 6:00–10:00 PM ET.')
        : 'Not scheduled tonight.';
      set('[data-live-detail]', '<div><b>Tonight</b><span>' + tonight + '</span></div>' +
        (st.next ? '<div><b>Next required</b><span>' + longLabel(st.next.iso) + ' · 6:00–10:00 PM ET</span></div>' : ''));
      show('[data-live-embed]', false);
    }
    // 7-day schedule from today
    var out = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(st.now.iso, i);
      var r = rowOf(d);
      var stat = exempt(d) ? 'EXCEPTION' : scheduled(d) ? 'REQUIRED — 6:00–10:00' : 'NOT SCHEDULED';
      if (r && /^COMPLETED/i.test(r.status || '')) stat = 'COMPLETED';
      if (r && /^MISSED/i.test(r.status || '')) stat = 'MISSED';
      out += '<div class="' + (i === 0 ? 'today' : '') + (scheduled(d) && !exempt(d) ? ' req' : '') + '"><b>' + label(d) + '</b><span>' + stat + '</span></div>';
    }
    set('[data-live-schedule]', out);
  }

  function renderBar() {
    var st = state();
    document.querySelectorAll('[data-live-bar]').forEach(function (n) { n.style.display = st.live ? 'flex' : 'none'; });
  }

  function tick() {
    if (document.querySelector('[data-live-status]')) renderConsole();
    renderBar();
  }
  tick();
  setInterval(tick, 1000);
})();
