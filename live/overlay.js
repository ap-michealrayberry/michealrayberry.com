/* Params: ?start=18:00 ?end=22:00 ?demo=1 ?state=live|scheduled|interrupted ?rules=0 (hide the rule band) ?every=12 (seconds per rule) */
(function () {
  var q = new URLSearchParams(location.search);
  var START = (q.get('start') || '18:00').split(':').map(Number), END = (q.get('end') || '22:00').split(':').map(Number);
  var DAY1 = Date.UTC(2026, 7, 31);
  var RULES = [
    'Full project uniform in every monitored area.',
    'Fixed camera. It is not repositioned to avoid observation.',
    'Normal evening activity continues. This is not a performance.',
    'Water only for the whole period.',
    'Dinner is a home-prepared meal. No delivery, takeout, or convenience food.',
    'Yogurt for dessert. Nothing else outside the planned meal.',
    'Monitored areas are brought to the minimum order standard before the session.',
    'The Daily Compliance Packet is still due by 10:00 PM ET.',
    'Bathrooms, changing, private communications, and visitors stay off camera.',
    'A session not completed is recorded as MISSED. It stays on the record.'
  ];
  var streaming = false, forced = q.get('state'), liveSince = null, inObs = !!window.obsstudio;
  if (inObs) {
    window.obsstudio.getStatus && window.obsstudio.getStatus(function (s) { streaming = !!(s && s.streaming); if (streaming) liveSince = liveSince || Date.now(); });
    window.addEventListener('obsStreamingStarted', function () { streaming = true; liveSince = Date.now(); });
    window.addEventListener('obsStreamingStopped', function () { streaming = false; });
  }
  function et() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hms(ms) { ms = Math.max(0, ms); return pad(Math.floor(ms / 3.6e6)) + ':' + pad(Math.floor(ms / 6e4) % 60) + ':' + pad(Math.floor(ms / 1e3) % 60); }
  function setState(s) { document.body.classList.remove('live', 'interrupted', 'closed'); if (s !== 'scheduled') document.body.classList.add(s); document.getElementById('statusText').textContent = { scheduled: 'Supervision scheduled', live: 'Under supervision — Live', interrupted: 'Feed interrupted', closed: '' }[s]; }
  function tick() {
    var now = et();
    var start = new Date(now); start.setHours(START[0], START[1] || 0, 0, 0);
    var end = new Date(now); end.setHours(END[0], END[1] || 0, 0, 0);
    var K = document.getElementById('clockK'), V = document.getElementById('clockV'), W = document.getElementById('clockW');
    document.getElementById('day').textContent = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - DAY1) / 864e5) + 1;
    if (now >= end) { document.getElementById('closedDate').textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); setState('closed'); return; }
    var live = forced ? forced === 'live' : streaming;
    if (now < start) { setState(forced === 'live' ? 'live' : 'scheduled'); K.textContent = 'Session begins in'; V.textContent = hms(start - now); V.classList.remove('due'); W.textContent = '6:00–10:00 PM ET'; return; }
    if (live) { setState('live'); K.textContent = 'Session time'; V.textContent = hms(Date.now() - (liveSince || Date.now())); var r = end - now; W.textContent = hms(r) + ' until 10:00 PM ET'; V.classList.toggle('due', r < 15 * 6e4); }
    else { setState(forced === 'scheduled' ? 'scheduled' : (inObs || forced ? 'interrupted' : 'scheduled')); K.textContent = 'Session closes in'; V.textContent = hms(end - now); V.classList.remove('due'); W.textContent = inObs && !forced ? 'Stream not active' : 'Closes 10:00 PM ET'; }
  }
  tick(); setInterval(tick, 1000);
  // rotating rule
  var ruleEl = document.getElementById('rule'), txt = document.getElementById('ruleTxt'), nEl = document.getElementById('ruleN');
  if (q.get('rules') === '0') ruleEl.style.display = 'none';
  else {
    var ri = 0, every = Math.max(4, parseInt(q.get('every') || '12', 10)) * 1000;
    function showRule() { txt.textContent = RULES[ri]; nEl.textContent = (ri + 1) + ' / ' + RULES.length; ri = (ri + 1) % RULES.length; }
    showRule();
    setInterval(function () { txt.classList.add('fade'); setTimeout(function () { showRule(); txt.classList.remove('fade'); }, 500); }, every);
  }
  if (q.get('demo') === '1') { document.getElementById('weight').textContent = '336.4'; document.getElementById('open').textContent = '0'; return; }
  function refresh() {
    fetch('/data/record.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('record unavailable'); return r.json();
    }).then(function (data) {
      if (!data || data.schema_version !== 1) return;
      DAY1 = Date.parse(data.start_date + 'T00:00:00Z');
      document.getElementById('weight').textContent = data.counters.currentLabel;
      document.getElementById('open').textContent = data.counters.openCountLabel;
    }).catch(function () {});
  }
  refresh(); setInterval(refresh, 5 * 60 * 1000);
})();
