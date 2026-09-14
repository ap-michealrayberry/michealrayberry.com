/* Accountability Partner Console. Talks to the record's Apps Script with the
   AP key (action 'apconsole'). Re-reads 'status' after every write. */
(function () {
  "use strict";
  var DEFAULT_EXEC = "https://script.google.com/macros/s/AKfycbziCyE3mnmUGZypHRiu1A6wK1n2EIRj2_U3czGc3JQS4L3ZXMxRJCINyMFDYC5bZ9vQ/exec";
  var LS_KEY = "mrb_ap_key", LS_EXEC = "mrb_ap_exec";
  var $ = function (id) { return document.getElementById(id); };
  var state = null;

  function exec() { return localStorage.getItem(LS_EXEC) || DEFAULT_EXEC; }
  function key() { return localStorage.getItem(LS_KEY) || ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function longDate(iso) { var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return iso || ""; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }); }
  function todayEt() { var p = {}; new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return { iso: p.year + "-" + p.month + "-" + p.day, h: +p.hour % 24, m: +p.minute }; }

  async function api(op, extra) {
    var body = Object.assign({ action: "apconsole", op: op, key: key() }, extra || {});
    var r = await fetch(exec(), { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    var j; try { j = await r.json(); } catch (e) { throw new Error("The record did not answer as expected."); }
    if (!j.ok) throw new Error(j.error || "Request refused.");
    return j;
  }

  var toastT; function toast(msg, err) { var t = $("toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, err ? 5000 : 2800); }

  function confirmSheet(o) {
    return new Promise(function (resolve) {
      $("sheet-eyebrow").textContent = o.eyebrow || "Confirm";
      $("sheet-title").textContent = o.title;
      $("sheet-body").textContent = o.body || "";
      var checks = $("sheet-checks"); checks.innerHTML = "";
      var boxes = (o.checks || []).map(function (label, i) {
        var l = document.createElement("label"); l.className = "check";
        var c = document.createElement("input"); c.type = "checkbox"; c.id = "sc" + i;
        l.appendChild(c); l.appendChild(document.createTextNode(" " + label)); checks.appendChild(l); return c;
      });
      var ok = $("sheet-ok"); ok.textContent = o.confirmLabel || "Confirm"; ok.className = "btn" + (o.danger ? " ghost danger" : "");
      function gate() { ok.disabled = boxes.some(function (b) { return !b.checked; }); }
      boxes.forEach(function (b) { b.addEventListener("change", gate); }); gate();
      $("sheet").hidden = false;
      function done(v) { $("sheet").hidden = true; ok.onclick = null; $("sheet-cancel").onclick = null; resolve(v); }
      ok.onclick = function () { done(true); };
      $("sheet-cancel").onclick = function () { done(false); };
    });
  }

  async function act(op, extra, o) {
    if (o && !(await confirmSheet(o))) return;
    try { await api(op, extra); toast(o && o.done || "Done"); await load(); }
    catch (e) { toast(e.message, true); }
  }

  /* ── render ── */
  function render(s) {
    state = s;
    var t = todayEt();
    $("asof").textContent = "Day " + s.day + " · " + longDate(s.today) + " · read " + t.h.toString().padStart(2, "0") + ":" + t.m.toString().padStart(2, "0") + " ET";
    $("today-title").textContent = "Day " + s.day + " · " + longDate(s.today);
    var ps = $("packet-state"); ps.textContent = s.packet.complete ? "Filed" : "Not filed"; ps.className = s.packet.complete ? "good" : "bad";
    $("packet-missing").innerHTML = s.packet.complete ? "" : s.packet.missing.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("");
    var left = (22 * 60) - (t.h * 60 + t.m);
    $("deadline-left").textContent = left > 0 ? Math.floor(left / 60) + " h " + (left % 60) + " min remaining" : "Deadline passed";
    var st = s.supervision.tonight;
    $("sup-tonight").textContent = st.scheduled ? (st.status ? st.status.split(" · ")[0] : "Assigned") : "Not assigned";
    $("sup-tonight-sub").textContent = st.scheduled ? "6:00–10:00 PM ET" + (st.status && st.status.indexOf("·") > -1 ? " · " + st.status.split(" · ").slice(1).join(" · ") : "") : "No session required tonight";
    var up = s.supervision.upcoming || [];
    $("upcoming-list").innerHTML = up.length ? up.map(function (u) { return '<div class="obs" style="grid-template-columns:1fr auto;display:grid;align-items:center"><div><b>' + esc(longDate(u.date)) + '</b>' + (u.note ? '<div class="meta"><span>' + esc(u.note) + "</span></div>" : "") + '</div><button type="button" class="btn small ghost" data-release="' + esc(u.date) + '">Release</button></div>'; }).join("") : '<p class="note" style="margin:0">No nights assigned ahead.</p>';

    // agreement
    var a = s.agreement, pill = $("pill-agreement");
    pill.textContent = a.active ? "Agreement active" : "Agreement inactive"; pill.className = "pill " + (a.active ? "on" : "off");
    var conf = a.confirmation;
    var items = [
      ["Consent recording on record (sealed capture)", !!conf, conf ? conf.date + " · " + conf.url : "not yet filed"],
      ["Micheal's signature personally verified", !!a.mrbSig, a.mrbSig || "—"],
      ["Accountability Partner counter-signature verified", !!a.apSig, a.apSig || "—"],
      ["Consent recording reviewed (clear nod in the confirmation window)", !!a.confVerifiedAt, a.confVerifiedAt || "—"],
      ["Fingerprint bound to the record", !!(conf && conf.matches), conf && a.fingerprint ? (conf.matches ? "matches" : "MISMATCH — re-activate") : "—"],
      ["Activation flag", a.active, a.active ? "set" : "not set"],
    ];
    $("agreement-checklist").innerHTML = items.map(function (it) { return '<li class="' + (it[1] ? "ok" : "") + '"><span class="dot"></span><span>' + esc(it[0]) + '</span><span class="v">' + esc(it[2]) + "</span></li>"; }).join("");
    $("btn-activate").hidden = a.active; $("btn-activate").disabled = !conf;
    $("btn-deactivate").hidden = !a.active;

    // violations
    $("violations-table").querySelector("tbody").innerHTML = s.violations.length ? s.violations.slice().reverse().map(function (v) {
      var stateTag = v.resolutionVerified ? '<span class="tag res">Resolved</span>' : /overruled/i.test(v.status) ? '<span class="tag open">Overruled</span>' : /^resolved|corrected/i.test(v.status) ? '<span class="tag">Filed · awaiting review</span>' : '<span class="tag open">Open</span>';
      var pub = v.verified ? '<span class="tag pub">Published</span>' : '<span class="tag unpub">Not public</span>';
      var acts = [];
      if (!v.verified) acts.push('<button type="button" class="btn small" data-act="verify_violation" data-row="' + v.row + '">Verify → publish</button>');
      if (v.verified && !v.resolutionVerified && v.recording) acts.push('<button type="button" class="btn small" data-act="verify_resolution" data-row="' + v.row + '">Accept resolution</button>');
      if (v.recording && !v.resolutionVerified) acts.push('<button type="button" class="btn small ghost danger" data-act="overrule" data-row="' + v.row + '">Overrule</button>');
      return "<tr><td class=\"mono\">" + esc(v.date) + "</td><td class=\"mono\">" + v.day + "</td><td>" + esc(v.violation) + (v.corrections ? '<div class="obs-meta" style="font:12px \'IBM Plex Mono\',monospace;color:var(--muted);margin-top:4px">' + esc(v.corrections) + "</div>" : "") + "</td><td>" + stateTag + "</td><td>" + pub + "</td><td>" + (v.recording ? '<a href="' + esc(v.recording) + '" target="_blank" rel="noopener">View</a>' : "—") + '</td><td><div class="actions">' + acts.join("") + "</div></td></tr>";
    }).join("") : '<tr><td colspan="7" class="mono">No entries.</td></tr>';

    // supervision
    $("supervision-table").querySelector("tbody").innerHTML = s.supervision.recent.length ? s.supervision.recent.map(function (r) {
      return "<tr><td class=\"mono\">" + esc(r.date) + "</td><td class=\"mono\">" + esc(r.required) + "</td><td>" + esc(r.status || "—") + "</td><td>" + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">Archive</a>' : "—") + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="mono">No nights ruled on yet.</td></tr>';

    // observers
    $("observer-list").innerHTML = s.observers.length ? s.observers.map(function (o) {
      var opts = ["received", "dismissed", "verified", "published", "actioned"].map(function (x) { return '<option' + (o.review === x ? " selected" : "") + ">" + x + "</option>"; }).join("");
      return '<div class="obs"><div class="meta"><span>' + esc(o.received_at) + "</span><span>" + esc(o.type) + "</span>" + (o.name ? "<span>" + esc(o.name) + "</span>" : "") + (o.email ? "<span>" + esc(o.email) + "</span>" : "") + (o.quotable === "yes" ? "<span>quotable</span>" : "") + "</div><p>" + esc(o.message) + "</p>" + (o.source_url ? '<a href="' + esc(o.source_url) + '" target="_blank" rel="noopener">' + esc(o.source_url) + "</a>" : "") +
        '<div class="review"><label>Review <select data-obs-review="' + o.row + '">' + opts + '</select></label><label>Note <input type="text" data-obs-note="' + o.row + '" value="' + esc(o.note) + '"></label><button type="button" class="btn small" data-act="observer_review" data-row="' + o.row + '">Save</button></div></div>';
    }).join("") : '<p class="note">No submissions.</p>';

    // updates
    $("updates-recent").innerHTML = s.updates.map(function (u) { return "<li><span class=\"d\">" + esc(u.date) + " · " + esc(u.type) + "</span><b>" + esc(u.title) + "</b></li>"; }).join("");

    // record
    $("record-table").querySelector("tbody").innerHTML = s.weighins.map(function (w) {
      return "<tr><td class=\"mono\">" + esc(w.date) + "</td><td class=\"mono\">" + w.day + "</td><td class=\"mono\">" + (w.weight != null ? w.weight.toFixed(1) + " lb" : "—") + "</td><td class=\"mono\">" + w.photos + "/4</td><td>" + (w.video ? "Yes" : "—") + "</td><td>" + (w.attested ? "Yes" : "—") + "</td></tr>";
    }).join("");

    // stage
    var sg = s.stage, title = "Active", note = "The record is running. Stage changes are read live by the site.";
    if (sg.completed === "confirmed") { title = "Completed"; note = "Completion confirmed " + sg.completed_date + " (§6.3)."; }
    else if (sg.abandoned === "confirmed") { title = "Abandoned"; note = "Abandonment confirmed " + sg.abandoned_date + " (§11)."; }
    else if (sg.abandoned === "presumed") { title = "Presumed abandoned"; note = "Presumed since " + sg.abandoned_date + ". Reversible."; }
    $("stage-title").textContent = title; $("stage-note").textContent = note;
    var sa = [];
    if (!sg.abandoned) sa.push('<button type="button" class="btn ghost danger" data-stage="abandoned" data-value="presumed">Set presumed abandoned</button>');
    if (sg.abandoned === "presumed") { sa.push('<button type="button" class="btn ghost danger" data-stage="abandoned" data-value="confirmed">Confirm abandonment</button>'); sa.push('<button type="button" class="btn ghost" data-stage="abandoned" data-value="">Clear abandonment</button>'); }
    if (sg.abandoned === "confirmed") sa.push('<button type="button" class="btn ghost" data-stage="abandoned" data-value="">Clear abandonment</button>');
    if (!sg.completed) sa.push('<button type="button" class="btn ghost" data-stage="completed" data-value="confirmed">Confirm completion</button>');
    else sa.push('<button type="button" class="btn ghost" data-stage="completed" data-value="">Clear completion</button>');
    $("stage-actions").innerHTML = sa.join("");

    $("endpoint-label").textContent = "Endpoint " + exec().replace(/^https:\/\/script\.google\.com\/macros\/s\/(.{8}).*$/, "…$1…");
  }

  async function load() {
    try { var s = await api("status"); render(s); $("lock").hidden = true; $("app").hidden = false; $("mast-right").hidden = false; }
    catch (e) { if (/unauthorized|refused/i.test(e.message)) { localStorage.removeItem(LS_KEY); $("lock").hidden = false; $("app").hidden = true; $("mast-right").hidden = true; $("lock-error").hidden = false; $("lock-error").textContent = "Key not accepted."; } else toast(e.message, true); }
  }

  /* ── wiring ── */
  $("lock-form").addEventListener("submit", function (e) { e.preventDefault(); localStorage.setItem(LS_KEY, $("lock-key").value.trim()); $("lock-key").value = ""; $("lock-error").hidden = true; load(); });
  $("btn-refresh").addEventListener("click", load);
  $("btn-publish").addEventListener("click", function () { act("publish", {}, { title: "Publish the site now?", body: "Triggers a rebuild of michealrayberry.com from the record. Takes about a minute.", confirmLabel: "Publish", done: "Deploy triggered" }); });
  $("btn-signout").addEventListener("click", function () { localStorage.removeItem(LS_KEY); location.reload(); });
  $("btn-endpoint").addEventListener("click", function () { var v = prompt("Apps Script /exec URL", exec()); if (v && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(v.trim())) { localStorage.setItem(LS_EXEC, v.trim()); load(); } });

  $("btn-activate").addEventListener("click", async function () {
    var c = state && state.agreement.confirmation; if (!c) return;
    var ok = await confirmSheet({ eyebrow: "Agreement", title: "Activate enforcement", body: "Consent recording on record:\n" + c.date + "\n" + c.url + "\n\nActivation publishes verified violations, supervision status, and starts the nightly checks. Effective date is the latest of Day 1, both signature dates, the confirmation date, and today.\n\nAttest to each item you have personally verified:", checks: ["I verified Micheal Ray Berry's signature on the agreement.", "I counter-signed the agreement and verified my signature.", "I watched the consent recording and saw a clear, deliberate nod inside the CONFIRMATION WINDOW. Stillness is not consent."], confirmLabel: "Activate the agreement" });
    if (!ok) return;
    try { await api("activate", { attest: { mrb: true, ap: true, nod: true } }); toast("Agreement activated · deploy triggered"); await load(); } catch (e) { toast(e.message, true); }
  });
  $("btn-deactivate").addEventListener("click", function () { act("deactivate", {}, { title: "Deactivate enforcement?", body: "Clears the Activation flag. Verified entries stop publishing on the next build. Post an update explaining why.", confirmLabel: "Deactivate", danger: true, done: "Deactivated · deploy triggered" }); });

  document.addEventListener("click", async function (e) {
    var b = e.target.closest("[data-act]"); if (b) {
      var row = Number(b.dataset.row), v = (state.violations || []).find(function (x) { return x.row === row; });
      if (b.dataset.act === "verify_violation") return act("verify_violation", { row: row }, { eyebrow: "Violation Log", title: "Verify and publish", body: v.date + "\n\u201C" + v.violation + "\u201D\n\nThis publishes the entry with its own public page. Editing the date or wording afterwards unpublishes it until re-verified.", confirmLabel: "Verify → publish", done: "Verified · deploy triggered" });
      if (b.dataset.act === "verify_resolution") return act("verify_resolution", { row: row }, { eyebrow: "Violation Log", title: "Accept the corrective session", body: v.date + "\n\u201C" + v.violation + "\u201D\n\nRecording: " + v.recording + "\n\nMarks the entry Resolved as of today.", checks: ["I reviewed the recording against the written standard: identity, uniform, elapsed time, unbroken take."], confirmLabel: "Accept → resolve", done: "Resolved · deploy triggered" });
      if (b.dataset.act === "overrule") { var reason = prompt("Why the session fails the standard (appended to the public corrections note):", ""); if (reason === null) return; return act("overrule", { row: row, reason: reason }, { eyebrow: "Violation Log", title: "Overrule the session", body: v.date + "\n\u201C" + v.violation + "\u201D\n\nReopens the entry; a replacement session is required within the standard deadline.", confirmLabel: "Overrule", danger: true, done: "Overruled · deploy triggered" }); }
      if (b.dataset.act === "observer_review") { var sel = document.querySelector('[data-obs-review="' + row + '"]'), note = document.querySelector('[data-obs-note="' + row + '"]'); try { await api("observer_review", { row: row, review: sel.value, note: note.value }); toast("Saved"); } catch (er) { toast(er.message, true); } return; }
    }
    var sg = e.target.closest("[data-stage]"); if (sg) {
      var labels = { "abandoned:presumed": ["Set presumed abandoned?", "Reversible. The site shows the presumed-abandonment notice (§11)."], "abandoned:confirmed": ["Confirm abandonment?", "The site becomes the permanent abandonment record (§11). Do this only on the record's written standard."], "abandoned:": ["Clear the abandonment stage?", "Documented §9 exception or error."], "completed:confirmed": ["Confirm completion?", "The site becomes the permanent completion archive (§6.3): 200 lb held 28 consecutive days, verified."], "completed:": ["Clear the completion stage?", ""] };
      var l = labels[sg.dataset.stage + ":" + sg.dataset.value];
      return act("stage", { key: sg.dataset.stage, value: sg.dataset.value }, { eyebrow: "Project stage", title: l[0], body: l[1], confirmLabel: "Apply", danger: sg.dataset.value === "confirmed" && sg.dataset.stage === "abandoned", done: "Stage updated" });
    }
  });

  $("declare-form").addEventListener("submit", function (e) { e.preventDefault(); var d = $("declare-date").value, t = $("declare-text").value.trim(); act("declare", { date: d, text: t }, { eyebrow: "Violation Log", title: "Enter a violation on the log", body: d + "\n\u201C" + t + "\u201D\n\nEntered as Unresolved and NOT public until you verify it.", confirmLabel: "Enter", done: "Entered" }).then(function () { $("declare-text").value = ""; }); });
  $("assign-form").addEventListener("submit", function (e) { e.preventDefault(); var d = $("assign-date").value, n = $("assign-note").value.trim(); act("supervision_assign", { date: d, note: n }, { eyebrow: "Evening Supervision", title: "Assign a supervision night", body: longDate(d) + " · 6:00–10:00 PM ET\n\nMicheal is notified through the record; a missed assigned night is ruled Missed at 10:20 PM and declared as a violation once the agreement is active.", confirmLabel: "Assign", done: "Night assigned · deploy triggered" }).then(function () { $("assign-note").value = ""; }); });
  document.addEventListener("click", function (e) { var r = e.target.closest("[data-release]"); if (!r) return; act("supervision_release", { date: r.dataset.release }, { eyebrow: "Evening Supervision", title: "Release this night?", body: longDate(r.dataset.release) + " will no longer be required.", confirmLabel: "Release", done: "Released · deploy triggered" }); });
  $("exception-form").addEventListener("submit", function (e) { e.preventDefault(); var d = $("exception-date").value, r = $("exception-reason").value.trim(); act("supervision_exception", { date: d, reason: r }, { eyebrow: "Evening Supervision", title: "Record an authorized exception", body: d + "\n" + r + "\n\nPublished verbatim on the supervision page.", confirmLabel: "Record", done: "Exception recorded · deploy triggered" }).then(function () { $("exception-reason").value = ""; }); });
  $("update-form").addEventListener("submit", function (e) { e.preventDefault(); var t = $("update-title").value.trim(), b = $("update-body").value.trim(), l = $("update-link").value.trim(), am = $("update-amendment").checked; act("post_update", { title: t, body: b, link: l, amendment: am }, { eyebrow: "Updates", title: am ? "Post an amendment" : "Post an update", body: t + "\n\n" + b + (am ? "\n\nLogged in Updates and on the agreement page's amendment log." : ""), confirmLabel: "Post", done: "Posted · deploy triggered" }).then(function () { $("update-title").value = ""; $("update-body").value = ""; $("update-link").value = ""; $("update-amendment").checked = false; }); });

  var t0 = todayEt().iso; $("declare-date").value = t0; $("exception-date").value = t0; $("assign-date").value = t0;
  if (key()) load(); else { $("lock").hidden = false; }
})();
