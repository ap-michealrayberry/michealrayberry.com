/* MRB portal (/mrb/, Cloudflare Access: Micheal only). Reads GET /api/me and
   files factual-correction requests. It cannot edit, resolve, excuse, or
   remove a public entry. DOM is built with textContent only. */
(function () {
  'use strict';
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
  function left(ms) {
    if (ms <= 0) return '00:00:00';
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + s % 60;
  }
  function fmtEt(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  }
  function panel(label, stateNode, body) {
    return el('section', { class: 'panel' }, [el('div', { class: 'ph' }, [el('span', { class: 'lab', text: label }), stateNode]), el('div', { class: 'pb' }, body)]);
  }
  function msg(key) { var f = flash[key]; return f ? el('div', { class: 'msg ' + (f.ok ? 'good' : 'err'), text: f.text }) : null; }

  async function post(key, path, body) {
    if (busy) return;
    busy = true; flash[key] = { ok: true, text: 'Sending…' }; render();
    try {
      var r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      var j = await r.json();
      flash[key] = j.ok ? { ok: true, text: 'Sent to the Accountability Partner.' } : { ok: false, text: j.error || 'Not sent.' };
    } catch (e) { flash[key] = { ok: false, text: 'Network error — not sent.' }; }
    busy = false; await load();
  }

  function today() {
    var p = S.packet || {}, deadline = new Date(p.deadline), ms = deadline - Date.now();
    var st = !p.required ? el('span', { class: 'state', text: 'Not required' })
      : p.complete ? el('span', { class: 'state ok', text: 'Filed' })
      : ms > 0 ? el('span', { class: 'state no', text: 'Due' }) : el('span', { class: 'state no', text: 'After 10 PM' });
    var v = p.views || {};
    var items = [['Weigh-in (scale-synced)', p.weight], ['Front photo', v.front], ['Left photo', v.left], ['Rear photo', v.rear], ['Right photo', v.right], ['Inspection video', p.video], ['Tracker', p.tracker]];
    return panel('Today’s packet · due 10:00 PM ET', st, [
      el('div', { class: 'clock', 'data-count': deadline.toISOString(), text: p.complete ? 'Complete' : left(ms) }),
      el('div', { class: 'rows' }, items.map(function (x) { return el('div', { class: 'row' }, [el('span', { text: x[0] }), el('span', { class: x[1] ? 'ok' : 'no', text: x[1] ? 'Filed' : 'Outstanding' })]); })),
      el('a', { class: 'btn', href: '/assistant/', text: 'Open Recording Assistant →' }),
      el('p', { class: 'note', text: 'A late filing is still accepted and stays with its date; the time it arrived is recorded for the Accountability Partner (§4).' }),
    ]);
  }

  function owed() {
    var list = S.corrective || [];
    var body = [];
    if (!list.length) body.push(el('div', { class: 'big', text: 'Nothing owed' }));
    list.forEach(function (c) {
      var dueAt = new Date(c.dueAt);
      body.push(el('div', { class: 'item' }, [
        el('div', { class: 'big', style: 'color:#B3261E', text: 'Level ' + c.level + ' · ' + c.minutes + ' minutes' }),
        el('div', { class: 'row' }, [el('span', { text: 'Due ' + fmtEt(c.dueAt) }), el('span', { class: 'no', 'data-count': dueAt.toISOString(), text: left(dueAt - Date.now()) })]),
        el('p', { class: 'note', text: c.id + ' · ' + c.violationDate + ' · ' + c.violation }),
      ]));
    });
    var submitted = (S.violations || []).filter(function (v) { return v.status === 'submitted'; });
    submitted.forEach(function (v) {
      body.push(el('div', { class: 'msg good', text: v.public_id + ' · session filed ' + fmtEt(v.submitted_at) + ' · awaiting AP verification' }));
    });
    body.push(el('p', { class: 'note', text: 'Record the corrective session in the Recording Assistant; it is filed beside the entry automatically. Filing does not resolve the entry — the Accountability Partner verifies the session (§8). Stop at once for pain, dizziness, numbness or any emergency; a good-faith safety stop is never punished (§9).' }));
    return panel('Owed now · corrective requirement', list.length ? el('span', { class: 'state no', text: list.length + ' open' }) : el('span', { class: 'state', text: 'Clear' }), body);
  }

  function supervision() {
    var sv = S.supervision || {};
    var stNode = sv.status ? el('span', { class: 'state', text: String(sv.status).split('·')[0].trim() })
      : el('span', { class: 'state', text: sv.required ? 'Scheduled tonight' : 'Not scheduled' });
    return panel('Evening Supervision · 6:00–10:00 PM ET', stNode, [
      el('div', { class: 'rows' }, [
        el('div', { class: 'row' }, [el('span', { text: 'Started' }), el('span', { text: sv.start_at ? fmtEt(sv.start_at) : '—' })]),
        el('div', { class: 'row' }, [el('span', { text: 'Ended' }), el('span', { text: sv.end_at ? fmtEt(sv.end_at) : '—' })]),
      ]),
      el('p', { class: 'note', text: 'Stream on twitch.tv/michealrayberry. The session is recorded from the broadcast itself; there is nothing to press here. The Accountability Partner rules on each night — a flag is not a ruling (§6).' }),
    ]);
  }

  function corrections() {
    var list = (S.violations || []);
    var filed = {};
    (S.correction_requests || []).forEach(function (r) { filed[r.public_id] = r; });
    var body = [];
    if (!list.length) body.push(el('p', { class: 'note', text: 'No Violation Events on record.' }));
    list.forEach(function (v) {
      var req = filed[v.public_id];
      var reason = el('textarea', { placeholder: 'What the record gets wrong, with the facts (20–2,000 characters)', maxlength: '2000' });
      var ev = el('input', { type: 'url', placeholder: 'https:// evidence link (optional)' });
      body.push(el('div', { class: 'item' }, [
        el('div', { class: 'row' }, [el('span', { text: v.public_id + ' · ' + v.date }), el('span', { text: req ? 'Request filed' : 'No request filed' })]),
        el('p', { class: 'note', text: v.violation }),
        req ? el('div', { class: 'msg good', text: 'Filed ' + fmtEt(req.received_at) + ' · ' + req.status + (req.ap_note ? ' · ' + req.ap_note : '') }) : null,
        req ? null : reason, req ? null : ev,
        req ? null : el('button', { class: 'btn', disabled: busy, text: 'Send correction request to the AP', onclick: function () {
          post('con-' + v.public_id, '/api/correction-request', { violation_id: v.public_id, reason: reason.value, evidence_url: ev.value.trim() });
        } }),
        msg('con-' + v.public_id),
      ]));
    });
    body.push(el('p', { class: 'note', text: 'You may request a factual correction of any entry, at any time, with evidence (§3). One request per entry. The AP reviews it against the written rules; a request does not change the entry by itself.' }));
    return panel('Request a factual correction', el('span', { class: 'state', text: (S.correction_requests || []).length + ' filed' }), body);
  }

  function record() {
    var v = S.violations || [];
    return panel('Violation record', el('span', { class: 'state', text: v.length + ' on record' }), [
      v.length ? el('div', { class: 'rows' }, v.slice().reverse().map(function (x) {
        return el('div', { class: 'row' }, [el('span', { text: x.date + ' · ' + x.violation }), el('span', { class: x.status === 'resolved' ? 'ok' : 'no', text: x.status })]);
      })) : el('p', { class: 'note', text: 'No verified Violation Events.' }),
      el('a', { href: '/violations/', class: 'lab', text: 'Public violation log →' }),
    ]);
  }

  function render() {
    if (!S) return;
    document.getElementById('who').textContent = S.email + ' · Micheal';
    var a = S.agreement || {};
    document.getElementById('dayline').textContent = (a.active ? 'Under agreement' : 'Agreement not active') + (S.day ? ' · Day ' + S.day : '') + ' · ' + S.today;
    main.replaceChildren(today(), owed(), supervision(), corrections(), record());
  }
  function tick() {
    document.querySelectorAll('[data-count]').forEach(function (n) {
      if (n.textContent === 'Complete') return;
      n.textContent = left(new Date(n.getAttribute('data-count')) - Date.now());
    });
  }
  async function load() {
    try {
      var r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'not available');
      S = j;
      render();
    } catch (e) {
      main.replaceChildren(panel('Not available', el('span', { class: 'state no', text: 'Error' }), [el('p', { class: 'note', text: String(e.message || e) + ' — reload to sign in again.' })]));
    }
  }
  load();
  setInterval(tick, 1000);
  setInterval(function () { if (!busy && document.visibilityState === 'visible') load(); }, 60000);
})();
