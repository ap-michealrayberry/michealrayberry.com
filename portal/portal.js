/* MRB portal client. All data comes from /api/portal (Access-verified).
   DOM is built with textContent only. Off the portal host, a fixture is used
   so the layout can be previewed. */
(function () {
  'use strict';
  var SITE = 'https://michealrayberry.com';
  var main = document.getElementById('main');
  var S = null, busy = false, flash = {};

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function etInstant(ds, hh, mm) {
    var a = ds.split('-').map(Number), want = Date.UTC(a[0], a[1] - 1, a[2], hh, mm), t = want;
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (var i = 0; i < 2; i++) {
      var p = {}; f.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = Number(x.value); });
      t += want - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    }
    return new Date(t);
  }
  function left(ms) {
    if (ms <= 0) return '00:00:00';
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + s % 60;
  }
  function fmtEt(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  }
  var ro = function () { return !S || S.me.role !== 'mrb'; };

  function panel(label, stateNode, body) {
    return el('section', { class: 'panel' }, [el('div', { class: 'ph' }, [el('span', { class: 'lab', text: label }), stateNode]), el('div', { class: 'pb' }, body)]);
  }
  function msg(key) { var f = flash[key]; return f ? el('div', { class: 'msg ' + (f.ok ? 'good' : 'err'), text: f.text }) : null; }

  async function post(key, body) {
    if (busy || ro()) return;
    busy = true; flash[key] = { ok: true, text: 'Filing…' }; render();
    try {
      var r = await fetch('/api/portal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      var j = await r.json();
      flash[key] = j.ok ? { ok: true, text: 'Filed. ' + (j.idempotent ? '(Already on file.)' : '') } : { ok: false, text: j.error || 'Not filed.' };
    } catch (e) { flash[key] = { ok: false, text: 'Network error — not filed.' }; }
    busy = false; await load();
  }

  function today() {
    var p = S.packet || {}, deadline = etInstant(S.today, 22, 0), ms = deadline - Date.now();
    var st = p.complete ? el('span', { class: 'state ok', text: 'Filed' }) : ms > 0 ? el('span', { class: 'state no', text: 'Due' }) : el('span', { class: 'state no', text: 'Missed' });
    var items = [['Weigh-in', !!p.weight], ['Front photo', p.front], ['Left photo', p.left], ['Rear photo', p.rear], ['Right photo', p.right], ['Inspection video', p.video], ['Tracker', p.tracker]];
    return panel('Today’s packet · due 10:00 PM ET', st, [
      el('div', { class: 'clock', 'data-count': deadline.toISOString(), text: p.complete ? 'Complete' : left(ms) }),
      el('div', { class: 'rows' }, items.map(function (x) { return el('div', { class: 'row' }, [el('span', { text: x[0] }), el('span', { class: x[1] ? 'ok' : 'no', text: x[1] ? 'Filed' : 'Outstanding' })]); })),
      el('a', { class: 'btn', href: SITE + '/assistant/', target: '_blank', rel: 'noopener', text: 'Open Recording Assistant →' }),
    ]);
  }

  function owed() {
    var list = S.corrective || [];
    var body = [];
    if (!list.length) body.push(el('div', { class: 'big', text: 'Nothing owed' }));
    list.forEach(function (c) {
      var filed = (S.portalFilings || {})[c.id];
      var input = el('input', { type: 'url', placeholder: 'https://youtube.com/shorts/…', 'aria-label': 'YouTube link for ' + c.id, disabled: ro() || !!filed });
      var dueAt = etInstant(c.due, 23, 59);
      body.push(el('div', { class: 'item' }, [
        el('div', { class: 'big', style: 'color:#B3261E', text: 'Level ' + c.level + ' · ' + c.minutes + ' minutes' }),
        el('div', { class: 'row' }, [el('span', { text: 'Due ' + c.due }), el('span', { class: 'no', 'data-count': dueAt.toISOString(), text: left(dueAt - Date.now()) })]),
        el('p', { class: 'note', text: c.violationDate + ' · ' + c.violation }),
        filed ? el('div', { class: 'msg good', text: 'Link filed ' + fmtEt(filed.received) + ' · ' + filed.status }) : input,
        filed ? null : el('button', { class: 'btn', disabled: ro() || busy, text: 'File YouTube link for AP verification', onclick: function () { post('cor-' + c.id, { action: 'corrective', id: c.id, url: input.value.trim() }); } }),
        msg('cor-' + c.id),
      ]));
    });
    body.push(el('p', { class: 'note', text: 'Record the session in the Recording Assistant, post it to YouTube, then file the link here. Filing does not resolve the entry; the AP verifies it.' }));
    if (S.next && S.next.text) body.push(el('p', { class: 'note', text: 'Next violation: ' + S.next.text + '.' }));
    return panel('Owed now · corrective requirement', list.length ? el('span', { class: 'state no', text: list.length + ' open' }) : el('span', { class: 'state', text: 'Clear' }), body);
  }

  function supervision() {
    var sv = S.supervision || {}, tw = S.twitch || {};
    var live = tw.live === true;
    var stNode = sv.start && !sv.end ? el('span', { class: 'state no' }, [el('span', { class: 'dot' }), 'In progress'])
      : sv.status ? el('span', { class: 'state', text: sv.status.split('·')[0].trim() })
      : el('span', { class: 'state', text: sv.scheduled ? 'Scheduled tonight' : 'Not scheduled' });
    var twText = !tw.configured ? 'Twitch check not configured' : tw.error ? 'Twitch unreachable' : live ? 'LIVE · ' + (tw.title || 'michealrayberry') : 'Offline';
    var canStart = !ro() && !busy && sv.scheduled && live && !sv.start;
    var canEnd = !ro() && !busy && sv.start && !sv.end;
    return panel('Evening Supervision · ' + (sv.window || '6:00–10:00 PM ET'), stNode, [
      el('div', { class: 'rows' }, [
        el('div', { class: 'row' }, [el('span', { text: 'Twitch' }), el('span', { class: live ? 'no' : '', text: twText })]),
        el('div', { class: 'row' }, [el('span', { text: 'Started' }), el('span', { text: sv.start ? fmtEt(sv.start) : '—' })]),
        el('div', { class: 'row' }, [el('span', { text: 'Ended' }), el('span', { text: sv.end ? fmtEt(sv.end) : '—' })]),
      ]),
      el('div', { class: 'btns' }, [
        el('button', { class: 'btn red', disabled: !canStart, text: 'Start session', onclick: function () { post('sup', { action: 'supstart' }); } }),
        el('button', { class: 'btn', disabled: !canEnd, text: 'End session', onclick: function () {
          if (Date.now() < etInstant(S.today, 22, 0) && !confirm('Ending before 10:00 PM ET is recorded as an early end. End now?')) return;
          post('sup', { action: 'supend' });
        } }),
      ]),
      msg('sup'),
      el('p', { class: 'note', text: 'Start opens 5:45 PM ET and is accepted only while Twitch shows the channel live. End stamps the time and submits the night for AP verification against the broadcast. A night with no completed session at the 10:20 PM check is flagged to the AP, who rules on it.' }),
    ]);
  }

  function contest() {
    var list = S.contestable || [];
    var body = [];
    if (!list.length) body.push(el('p', { class: 'note', text: 'No Violation Events on record.' }));
    list.forEach(function (c) {
      var reason = el('textarea', { placeholder: 'What the record gets wrong, with the facts', disabled: ro() || !c.open, maxlength: '2000' });
      var ev = el('input', { type: 'url', placeholder: 'https:// evidence link', disabled: ro() || !c.open });
      body.push(el('div', { class: 'item' }, [
        el('div', { class: 'row' }, [el('span', { text: c.id + ' · ' + c.date }), el('span', { text: c.filed ? 'Request filed' : 'No request filed' })]),
        el('p', { class: 'note', text: c.what }),
        c.filed ? el('div', { class: 'msg good', text: 'Filed ' + fmtEt(c.filed) + ' · ' + (c.filedStatus || 'RECEIVED') }) : null,
        c.open ? reason : null, c.open ? ev : null,
        c.open ? el('button', { class: 'btn', disabled: ro() || busy, text: 'Send correction request to the AP', onclick: function () { post('con-' + c.id, { action: 'contest', id: c.id, reason: reason.value, evidence: ev.value.trim() }); } }) : null,
        msg('con-' + c.id),
      ]));
    });
    body.push(el('p', { class: 'note', text: 'You may request a factual correction of any entry, with evidence (§3). The AP reviews it against the written rules; a request does not change the entry by itself.' }));
    return panel('Request a factual correction', el('span', { class: 'state', text: list.filter(function (c) { return c.filed; }).length + ' filed' }), body);
  }

  function record() {
    var v = S.violations || [];
    return panel('Violation record', el('span', { class: 'state', text: v.length + ' on record' }), [
      v.length ? el('div', { class: 'rows' }, v.slice().reverse().map(function (x) {
        return el('div', { class: 'row' }, [el('span', { text: x.date + ' · ' + x.what }), el('span', { class: /^resolved/i.test(x.status) ? 'ok' : 'no', text: x.status })]);
      })) : el('p', { class: 'note', text: 'No verified Violation Events.' }),
      el('a', { href: SITE + '/violations/', target: '_blank', rel: 'noopener', class: 'lab', text: 'Public violation log →' }),
    ]);
  }

  function render() {
    if (!S) return;
    document.getElementById('who').textContent = S.me.email + ' · ' + (S.me.role === 'mrb' ? 'Micheal' : 'AP · read-only');
    document.getElementById('ro').style.display = ro() ? 'block' : 'none';
    document.getElementById('dayline').textContent = (S.agreementActive ? 'Under agreement' : 'Agreement not active') + ' · Day ' + S.day + ' · ' + S.today;
    main.replaceChildren(today(), owed(), supervision(), contest(), record());
  }
  function tick() {
    document.querySelectorAll('[data-count]').forEach(function (n) {
      if (n.textContent === 'Complete') return;
      n.textContent = left(new Date(n.getAttribute('data-count')) - Date.now());
    });
  }
  async function load() {
    try {
      var r = await fetch('/api/portal', { credentials: 'same-origin', cache: 'no-store' });
      var j = await r.json();
      if (!j.ok && !j.today) throw new Error(j.error || 'not available');
      S = j;
    } catch (e) {
      if (/^mrb\./.test(location.hostname)) {
        main.replaceChildren(panel('Not available', el('span', { class: 'state no', text: 'Error' }), [el('p', { class: 'note', text: String(e.message || e) })]));
        return;
      }
      S = DEMO();
    }
    render();
  }
  function DEMO() {
    var d = new Date(), ds = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return { ok: true, today: ds, day: 9, agreementActive: true, me: { email: 'michealrayberry@gmail.com', role: 'mrb' },
      packet: { weight: '333.4', front: true, left: true, rear: true, right: false, video: true, tracker: true, complete: false },
      corrective: [{ id: 'V-3F8A1C0D9B27', violationDate: '2026-10-16', violation: 'Daily Compliance Packet incomplete — photographs not filed by 10:00 PM ET', due: ds, level: 1, minutes: 10 }],
      portalFilings: {}, next: { text: 'Level 2 — 20 continuous minutes of corner time, recorded in one unbroken take and published beside the entry' },
      supervision: { scheduled: true, status: '', start: '', end: '', window: '6:00–10:00 PM ET' },
      twitch: { configured: true, live: true, title: 'Evening Supervision · Session 007' },
      contestable: [{ id: 'V-3F8A1C0D9B27', date: '2026-10-16', what: 'Daily Compliance Packet incomplete — photographs not filed by 10:00 PM ET', open: true, filed: '' }],
      violations: [{ date: '2026-10-16', what: 'Daily Compliance Packet incomplete', status: 'Unresolved' }] };
  }
  load();
  setInterval(tick, 1000);
  setInterval(function () { if (!busy && document.visibilityState === 'visible') load(); }, 60000);
})();
