/* AP console (/ap/, Cloudflare Access: the AP only). Reads GET /api/ap/state and
   posts rulings to /api/ap/*. Every action is audited server-side with the
   AP's sign-in. DOM is built with textContent only. */
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
  function fmtEt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  }
  function panel(label, stateText, body, wide) {
    return el('section', { class: 'panel' + (wide ? ' wide' : '') }, [
      el('div', { class: 'ph' }, [el('span', { class: 'lab', text: label }), el('span', { class: 'state', text: stateText })]),
      el('div', { class: 'pb' }, body),
    ]);
  }
  function msg(key) { var f = flash[key]; return f ? el('div', { class: 'msg ' + (f.ok ? 'good' : 'err'), text: f.text }) : null; }
  function row(k, v, cls) { return el('div', { class: 'row' }, [el('span', { text: k }), el('span', { class: cls || '', text: v == null || v === '' ? '—' : String(v) })]); }
  function input(attrs) { return el('input', attrs); }
  function area(ph) { return el('textarea', { placeholder: ph, maxlength: '2000' }); }

  async function post(key, path, body, confirmText) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    busy = true; flash[key] = { ok: true, text: 'Recording…' }; render();
    try {
      var r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      var j = await r.json();
      flash[key] = j.ok ? { ok: true, text: 'Recorded.' + (j.publicId ? ' ' + j.publicId + ' · Level ' + j.level + ' · due ' + fmtEt(j.dueAt) : '') } : { ok: false, text: j.error || 'Not recorded.' };
    } catch (e) { flash[key] = { ok: false, text: 'Network error — not recorded.' }; }
    busy = false; await load();
  }

  // ── Agreement ──────────────────────────────────────────────────────
  function agreement() {
    var a = S.agreement, st = S.state || {};
    var fields = [
      ['agreement_edition', 'Edition (2)'],
      ['participant_signature_verified_on', 'Participant signature verified on'],
      ['ap_signature_verified_on', 'AP signature verified on'],
      ['consent_recording_date', 'Consent recording date (a filed confirmation)'],
      ['consent_reviewed_on', 'Consent reviewed by the AP on'],
      ['supervision_days', 'Supervision nights (0=Sun … 6=Sat)'],
    ];
    var body = [
      row('Status', a.active ? 'ACTIVE' : 'NOT ACTIVE', a.active ? 'ok' : 'no'),
      row('Effective date', a.effective_date),
      a.ended ? row('Ended', a.ended.kind + ' · ' + a.ended.date, 'no') : null,
      a.missing && a.missing.length ? el('p', { class: 'note', text: 'Missing: ' + a.missing.join('; ') + '.' }) : null,
    ];
    fields.forEach(function (f) {
      var inp = input({ value: st[f[0]] || '', placeholder: f[0] === 'supervision_days' ? '0,1,2,3,4' : 'YYYY-MM-DD', 'aria-label': f[1] });
      body.push(el('div', { class: 'item' }, [
        el('span', { class: 'lab', text: f[1] }), inp,
        el('button', { class: 'btn', disabled: busy, text: 'Record', onclick: function () {
          post('st-' + f[0], '/api/ap/state', { key: f[0], value: inp.value.trim() });
        } }),
        msg('st-' + f[0]),
      ]));
    });
    var endKind = el('select', {}, ['withdrawn', 'completed', 'abandoned'].map(function (k) { return el('option', { value: k, text: k }); }));
    var endDate = input({ placeholder: 'YYYY-MM-DD' });
    body.push(el('details', {}, [el('summary', { text: 'Record how participation ended (§11)' }),
      el('div', { class: 'pb' }, [endKind, endDate,
        el('p', { class: 'note', text: 'A withdrawal is recorded as a withdrawal. An archival ending needs your review, the written notice and the seven-day opportunity to resume first.' }),
        el('button', { class: 'btn red', disabled: busy, text: 'Record ending', onclick: function () {
          post('st-end', '/api/ap/state', { key: endKind.value, value: endDate.value.trim() }, 'Record "' + endKind.value + '" on ' + endDate.value + '? New requirements stop from that date.');
        } }), msg('st-end')])]));
    return panel('Agreement execution (§1, §11, §13)', a.active ? 'Active' : 'Inactive', body);
  }

  // ── Flags → verify / reject (§8) ───────────────────────────────────
  function flags() {
    var list = S.flags || [];
    var body = list.length ? [] : [el('div', { class: 'big', text: 'Nothing awaiting review' })];
    list.forEach(function (f) {
      var wording = area('Public wording (optional): the facts, neutrally — the requirement missed');
      wording.value = '';
      var reason = area('Reason for rejecting (requirement, receipts, documented exception)');
      body.push(el('div', { class: 'item' }, [
        row(f.date + ' · ' + (f.requirement || f.source), 'flag #' + f.id),
        el('p', { class: 'note', text: f.violation }),
        el('details', {}, [el('summary', { text: 'Verify as a Violation Event' }), el('div', { class: 'pb' }, [wording,
          el('p', { class: 'note', text: 'Verifying publishes the entry, assigns the corrective session at the level for the confirmed count, and sets the due time 72 hours from now. Micheal and subscribers are emailed.' }),
          el('button', { class: 'btn red', disabled: busy, text: 'Verify and assign', onclick: function () {
            post('fl-' + f.id, '/api/ap/violation', { op: 'verify', id: f.id, violation: wording.value.trim() || undefined },
              'Verify this as a Violation Event against the written requirement? This publishes it and assigns the corrective session.');
          } })])]),
        el('details', {}, [el('summary', { text: 'Reject' }), el('div', { class: 'pb' }, [reason,
          el('button', { class: 'btn', disabled: busy, text: 'Reject flag', onclick: function () { post('fl-' + f.id, '/api/ap/violation', { op: 'reject', id: f.id, reason: reason.value.trim() }); } })])]),
        msg('fl-' + f.id),
      ]));
    });
    if (S.pre_agreement_entries) body.push(el('p', { class: 'note', text: S.pre_agreement_entries + ' entries imported from before Day 1 (2026-10-03) are kept as private history and are not shown: no requirement applied then (§1).' }));
    return panel('Flags awaiting your review (§8)', list.length + ' pending', body);
  }

  // ── Submitted correctives → resolve / overrule ─────────────────────
  function submitted() {
    var list = S.submitted || [];
    var body = list.length ? [] : [el('p', { class: 'note', text: 'No corrective session awaiting verification.' })];
    list.forEach(function (v) {
      var note = input({ placeholder: 'Verification note (optional)' });
      var reason = area('Which written requirement the session did not meet (§8)');
      body.push(el('div', { class: 'item' }, [
        row(v.public_id + ' · ' + v.date, 'Level ' + v.level + ' · ' + v.minutes + ' min'),
        el('p', { class: 'note', text: v.violation }),
        row('Submitted', fmtEt(v.submitted_at)), row('Due', fmtEt(v.revised_due_at || v.due_at)),
        v.recording ? el('a', { href: v.recording, target: '_blank', rel: 'noopener', class: 'lab', text: 'Open the recording →' }) : null,
        el('p', { class: 'note', text: 'Check identity, pink uniform, position, elapsed time from zero, one unbroken take, and the linked assignment.' }),
        note,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', disabled: busy, text: 'Resolve', onclick: function () { post('sb-' + v.id, '/api/ap/violation', { op: 'resolve', id: v.id, note: note.value.trim() }); } }),
        ]),
        el('details', {}, [el('summary', { text: 'Overrule (session not accepted)' }), el('div', { class: 'pb' }, [reason,
          el('button', { class: 'btn red', disabled: busy, text: 'Overrule', onclick: function () {
            post('sb-' + v.id, '/api/ap/violation', { op: 'overrule', id: v.id, reason: reason.value.trim() }, 'Overrule this session? The entry reopens and a new attempt starts from zero.');
          } })])]),
        msg('sb-' + v.id),
      ]));
    });
    return panel('Corrective sessions to verify', list.length + ' submitted', body);
  }

  // ── Open correctives → §9 exception ────────────────────────────────
  function open() {
    var list = S.open || [];
    var body = list.length ? [] : [el('p', { class: 'note', text: 'No open corrective requirement.' })];
    list.forEach(function (v) {
      var reason = input({ placeholder: 'Reason (no private medical details)' });
      var due = input({ type: 'datetime-local', 'aria-label': 'Revised due time' });
      body.push(el('div', { class: 'item' }, [
        row(v.public_id + ' · ' + v.date, v.level ? 'Level ' + v.level + ' · ' + v.minutes + ' min' : 'not assigned'),
        row('Due', fmtEt(v.revised_due_at || v.due_at), Date.parse(v.revised_due_at || v.due_at) < Date.now() ? 'no' : ''),
        v.exception_note ? el('p', { class: 'note', text: 'Exception: ' + v.exception_note }) : null,
        el('details', {}, [el('summary', { text: 'Record a safety stop or documented exception (§9)' }), el('div', { class: 'pb' }, [reason, due,
          el('button', { class: 'btn', disabled: busy, text: 'Record exception', onclick: function () {
            post('op-' + v.id, '/api/ap/violation', { op: 'exception', id: v.id, reason: reason.value.trim(), revised_due_at: due.value ? new Date(due.value).toISOString() : '' });
          } })])]),
        msg('op-' + v.id),
      ]));
    });
    return panel('Open corrective requirements', list.length + ' open', body);
  }

  // ── Supervision (§6) ───────────────────────────────────────────────
  function supervision() {
    var list = S.supervision || [];
    var body = list.length ? [] : [el('p', { class: 'note', text: 'No night awaiting a ruling.' })];
    list.forEach(function (s) {
      var reason = input({ placeholder: 'Exception reason (§9)' });
      var note = input({ placeholder: 'Note (optional)' });
      body.push(el('div', { class: 'item' }, [
        row(s.date, s.status), row('Started', fmtEt(s.start_at)), row('Ended', fmtEt(s.end_at)),
        el('a', { href: 'https://www.twitch.tv/michealrayberry/videos', target: '_blank', rel: 'noopener', class: 'lab', text: 'Twitch broadcasts →' }),
        note,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', disabled: busy, text: 'Completed', onclick: function () { post('sv-' + s.date, '/api/ap/supervision', { date: s.date, op: 'complete', note: note.value.trim() }); } }),
          el('button', { class: 'btn red', disabled: busy, text: 'Missed', onclick: function () {
            post('sv-' + s.date, '/api/ap/supervision', { date: s.date, op: 'missed', note: note.value.trim() }, 'Rule ' + s.date + ' MISSED? Subscribers are emailed.');
          } }),
        ]),
        el('details', {}, [el('summary', { text: 'Exception' }), el('div', { class: 'pb' }, [reason,
          el('button', { class: 'btn', disabled: busy, text: 'Record exception', onclick: function () { post('sv-' + s.date, '/api/ap/supervision', { date: s.date, op: 'exception', reason: reason.value.trim(), note: note.value.trim() }); } })])]),
        msg('sv-' + s.date),
      ]));
    });
    return panel('Evening Supervision rulings (§6)', list.length + ' nights', body);
  }

  // ── Requests and reports ───────────────────────────────────────────
  function requests() {
    var list = S.requests || [];
    var body = list.length ? [] : [el('p', { class: 'note', text: 'No correction requests.' })];
    list.forEach(function (r) {
      var status = el('select', {}, ['received', 'under review', 'corrected', 'declined'].map(function (k) { return el('option', { value: k, text: k, selected: r.status === k }); }));
      var note = area('Dated explanation of your decision');
      note.value = r.ap_note || '';
      body.push(el('div', { class: 'item' }, [
        row(r.public_id + ' · ' + r.date, fmtEt(r.received_at)), el('p', { class: 'note', text: r.reason }),
        r.evidence_url ? el('a', { href: r.evidence_url, target: '_blank', rel: 'noopener noreferrer', class: 'lab', text: 'Evidence →' }) : null,
        status, note,
        el('button', { class: 'btn', disabled: busy, text: 'Save', onclick: function () { post('cr-' + r.id, '/api/ap/correction-request', { id: r.id, status: status.value, ap_note: note.value.trim() }); } }),
        el('p', { class: 'note', text: 'To change the entry itself, add a dated correction below (Record tools → Factual correction).' }),
        msg('cr-' + r.id),
      ]));
    });
    return panel('Factual correction requests (§3)', list.length + ' total', body);
  }

  function observers() {
    var list = S.observers || [];
    var body = list.length ? [] : [el('p', { class: 'note', text: 'No observer reports.' })];
    list.forEach(function (o) {
      var review = el('select', {}, ['received', 'dismissed', 'verified', 'published', 'actioned'].map(function (k) { return el('option', { value: k, text: k, selected: o.review === k }); }));
      var note = input({ placeholder: 'Note', value: o.ap_note || '' });
      body.push(el('div', { class: 'item' }, [
        row('#' + o.id + ' · ' + o.type, fmtEt(o.received_at)), el('p', { class: 'note', text: o.message }),
        o.name || o.email ? el('p', { class: 'note', text: [o.name, o.email].filter(Boolean).join(' · ') }) : null,
        o.source_url ? el('a', { href: o.source_url, target: '_blank', rel: 'noopener noreferrer', class: 'lab', text: 'Source →' }) : null,
        review, note,
        el('button', { class: 'btn', disabled: busy, text: 'Save', onclick: function () { post('ob-' + o.id, '/api/ap/observer', { id: o.id, review: review.value, ap_note: note.value.trim() }); } }),
        msg('ob-' + o.id),
      ]));
    });
    body.push(el('p', { class: 'note', text: 'Observers may report evidence; they do not create requirements or impose consequences (§10). A substantiated issue is declared below as a Violation Event only against a written requirement.' }));
    return panel('Observer reports (§10)', list.filter(function (o) { return o.review === 'received'; }).length + ' new', body);
  }

  function milestonesAndRecordings() {
    var body = [];
    (S.milestones || []).forEach(function (m) {
      var note = input({ placeholder: 'Review note' });
      body.push(el('div', { class: 'item' }, [
        row(m.threshold + ' lb · ' + m.date, m.status), row('Scale weight', m.weight_lb + ' lb'),
        el('a', { href: m.url, target: '_blank', rel: 'noopener', class: 'lab', text: 'Milestone video →' }),
        m.status === 'submitted' ? note : null,
        m.status === 'submitted' ? el('div', { class: 'btns' }, [
          el('button', { class: 'btn', disabled: busy, text: 'Verify milestone', onclick: function () { post('ms-' + m.id, '/api/ap/milestone', { id: m.id, op: 'verify', ap_note: note.value.trim() }); } }),
          el('button', { class: 'btn red', disabled: busy, text: 'Reject', onclick: function () { post('ms-' + m.id, '/api/ap/milestone', { id: m.id, op: 'reject', ap_note: note.value.trim() }); } }),
        ]) : null,
        msg('ms-' + m.id),
      ]));
    });
    (S.recordings || []).forEach(function (r) {
      body.push(el('div', { class: 'item' }, [
        row(r.kind + ' recording', r.status), el('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'lab', text: 'Watch →' }),
        r.status === 'awaiting AP' ? el('div', { class: 'btns' }, [
          el('button', { class: 'btn', disabled: busy, text: 'Publish', onclick: function () { post('rc-' + r.id, '/api/ap/recording', { id: r.id, op: 'publish' }); } }),
          el('button', { class: 'btn red', disabled: busy, text: 'Decline', onclick: function () { post('rc-' + r.id, '/api/ap/recording', { id: r.id, op: 'decline' }); } }),
        ]) : null,
        msg('rc-' + r.id),
      ]));
    });
    if (!body.length) body.push(el('p', { class: 'note', text: 'No milestone filings or recordings awaiting review.' }));
    return panel('Milestones (§7) and recordings', '', body);
  }

  // ── Record tools ───────────────────────────────────────────────────
  function tools() {
    var dDate = input({ placeholder: 'YYYY-MM-DD' }), dText = area('The written requirement that was missed, stated neutrally');
    var cId = input({ placeholder: 'Entry number (flag # or V-… row id)' }), cNote = area('Dated explanation of the factual correction');
    var uType = el('select', {}, ['official', 'amendment', 'personal'].map(function (k) { return el('option', { value: k, text: k }); }));
    var uTitle = input({ placeholder: 'Title' }), uBody = area('Body'), uLink = input({ placeholder: 'Link (optional)' }), uCos = input({ placeholder: 'Co-signed on (amendments) YYYY-MM-DD' });
    var tDate = input({ placeholder: 'YYYY-MM-DD' }), tField = el('select', {}, ['video', 'photo_front', 'photo_left', 'photo_rear', 'photo_right'].map(function (k) { return el('option', { value: k, text: k }); }));
    var tWhy = area('Dated explanation (do not repeat the protected information)');
    var xTable = el('select', {}, ['days', 'violations', 'correctives', 'supervision', 'weekly', 'attestations', 'confirmations', 'updates', 'correction_requests', 'observer_reports', 'subscribers', 'milestone_filings', 'health', 'weight_readings', 'events', 'site_state', 'redactions', 'portal_filings'].map(function (k) { return el('option', { value: k, text: k }); }));
    var subs = S.subscribers || {};
    return panel('Record tools', '', [
      el('details', {}, [el('summary', { text: 'Declare a Violation Event' }), el('div', { class: 'pb' }, [dDate, dText,
        el('button', { class: 'btn red', disabled: busy, text: 'Declare and assign', onclick: function () {
          post('decl', '/api/ap/violation', { op: 'declare', date: dDate.value.trim(), violation: dText.value.trim() }, 'Declare a verified Violation Event for ' + dDate.value + '? It is published and the corrective session assigned.');
        } }), msg('decl')])]),
      el('details', {}, [el('summary', { text: 'Factual correction (dated, append-only)' }), el('div', { class: 'pb' }, [cId, cNote,
        el('button', { class: 'btn', disabled: busy, text: 'Add correction', onclick: function () { post('corr', '/api/ap/violation', { op: 'correct', id: Number(cId.value), note: cNote.value.trim() }); } }), msg('corr')])]),
      el('details', {}, [el('summary', { text: 'Post an update or amendment (§12)' }), el('div', { class: 'pb' }, [uType, uTitle, uBody, uLink, uCos,
        el('p', { class: 'note', text: 'An amendment takes effect only once written, dated, logged here and co-signed by both parties; a material amendment also needs a renewed consent confirmation.' }),
        el('button', { class: 'btn', disabled: busy, text: 'Publish', onclick: function () {
          post('upd', '/api/ap/update', { type: uType.value, title: uTitle.value.trim(), body: uBody.value.trim(), link: uLink.value.trim(), cosigned_on: uCos.value.trim() });
        } }), msg('upd')])]),
      el('details', {}, [el('summary', { text: 'Takedown (§10)' }), el('div', { class: 'pb' }, [tDate, tField, tWhy,
        el('button', { class: 'btn red', disabled: busy, text: 'Remove file', onclick: function () {
          post('td', '/api/ap/takedown', { date: tDate.value.trim(), field: tField.value, explanation: tWhy.value.trim() }, 'Remove this file permanently? A dated explanation is recorded in its place.');
        } }), msg('td')])]),
      el('div', { class: 'rows' }, [row('Subscribers', (subs.ACTIVE || 0) + ' active · ' + (subs.PENDING || 0) + ' pending · ' + (subs.UNSUBSCRIBED || 0) + ' unsubscribed')]),
      el('div', { class: 'btns' }, [
        el('button', { class: 'btn', disabled: busy, text: 'Rebuild site now', onclick: function () { post('build', '/api/ap/build', {}); } }),
        xTable,
        el('button', { class: 'btn', text: 'Export CSV', onclick: function () { window.location.href = '/api/ap/export.csv?table=' + encodeURIComponent(xTable.value); } }),
      ]),
      msg('build'),
    ]);
  }

  function recent() {
    var list = S.recent || [];
    return panel('Your recent actions (audit log)', list.length + '', [el('div', { class: 'rows' }, list.map(function (e) {
      return row(fmtEt(e.at), e.action.replace(/^ap\./, '') + (e.subject ? ' · ' + e.subject : ''));
    }))], true);
  }

  function render() {
    if (!S) return;
    document.getElementById('who').textContent = S.email + ' · Accountability Partner';
    document.getElementById('dayline').textContent = (S.agreement.active ? 'Under agreement' : 'Agreement not active') + ' · ' + S.agreement.today;
    main.replaceChildren(agreement(), flags(), submitted(), open(), supervision(), requests(), observers(), milestonesAndRecordings(), tools(), recent());
  }
  async function load() {
    try {
      var r = await fetch('/api/ap/state', { credentials: 'same-origin', cache: 'no-store' });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'not available');
      S = j;
      render();
    } catch (e) {
      main.replaceChildren(panel('Not available', 'Error', [el('p', { class: 'note', text: String(e.message || e) + ' — reload to sign in again.' })]));
    }
  }
  load();
  setInterval(function () { if (!busy && document.visibilityState === 'visible' && !document.querySelector('textarea:focus,input:focus')) load(); }, 120000);
})();
