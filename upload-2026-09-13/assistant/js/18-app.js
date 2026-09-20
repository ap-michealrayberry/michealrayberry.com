(function (MRB) {
  "use strict";

  var recordCache = null;
  var participantStateCache = null;
  var deadlineTimer = null;
  var initDone = false;
  var handlersBound = false;

  function isolate(name, fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        console.error("[MRB:" + name + "]", e);
        MRB.ui.showError(name + ": " + (e.message || String(e)));
      }
    };
  }

  async function refreshHome() {
    var c = MRB.config.get();
    MRB.ui.fillSettingsForm();
    try {
      recordCache = await MRB.api.loadRecord();
    } catch (e) {
      recordCache = { weighIns: [], violations: [] };
      MRB.ui.setStatus("preflight", "Record load: " + e.message);
    }
    try {
      participantStateCache = await MRB.api.myState();
    } catch (stateError) {
      participantStateCache = null;
      MRB.ui.setStatus("preflight", "Participant state: " + stateError.message);
    }
    recordCache.agreementActive = !!(recordCache.agreementActive && participantStateCache && participantStateCache.agreementActive);
    MRB.ui.updateHomeStatus(recordCache);
    applyAuthoritativeAvailability();
    try {
      var q = await MRB.queue.queueSummary();
      MRB.ui.renderQueue(q);
    } catch (e) {
      /* ignore */
    }
    // Process queue in background
    if (navigator.onLine) {
      MRB.queue.processQueue().then(function () {
        return MRB.queue.queueSummary();
      }).then(function (summary) {
        MRB.ui.renderQueue(summary);
      }).catch(function () {});
    }
  }

  function weekStartIso(projectStart, week) {
    var start = MRB.dates.parseDate(projectStart);
    var n = Number(week);
    if (!start || !isFinite(n) || Math.floor(n) !== n || n < 1) return "";
    var date = new Date(Date.UTC(start.y, start.m - 1, start.d + (n - 1) * 7));
    return MRB.dates.pad4(date.getUTCFullYear()) + "-" +
      MRB.dates.pad2(date.getUTCMonth() + 1) + "-" + MRB.dates.pad2(date.getUTCDate());
  }

  function correctiveEntries() {
    return ((participantStateCache && participantStateCache.corrective) || []).filter(function (entry) {
      return /^V-[A-F0-9]{12}$/.test(String(entry && entry.id || "").trim().toUpperCase()) &&
        /^C-[A-F0-9]{24}$/.test(String(entry && entry.assignmentId || "").trim().toUpperCase()) &&
        /^A-[A-F0-9]{24}$/.test(String(entry && entry.attemptId || "").trim().toUpperCase()) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(entry.violationDate || "")) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(entry.due || "")) &&
        isFinite(Number(entry.level)) && Number(entry.level) >= 1 && Number(entry.level) <= 3 &&
        isFinite(Number(entry.minutes)) && Number(entry.minutes) > 0;
    }).map(function (entry) {
      return {
        id: String(entry.id).trim().toUpperCase(),
        assignmentId: String(entry.assignmentId).trim().toUpperCase(),
        attemptId: String(entry.attemptId).trim().toUpperCase(),
        date: String(entry.violationDate),
        violationDate: String(entry.violationDate),
        violation: String(entry.violation || ""),
        assignment: String(entry.assignment || ""),
        due: String(entry.due),
        level: Math.floor(Number(entry.level)),
        minutes: Math.floor(Number(entry.minutes)),
      };
    });
  }

  function applyAuthoritativeAvailability() {
    var config = MRB.config.get();
    var active = !!(recordCache && recordCache.agreementActive && participantStateCache && participantStateCache.agreementActive);
    var daily = MRB.ui.byId("card-daily");
    var corrective = MRB.ui.byId("card-corrective");
    var weekly = MRB.ui.byId("card-weekly");
    if (daily) daily.disabled = !active;
    if (corrective) {
      corrective.disabled = !active || correctiveEntries().length === 0;
      corrective.title = corrective.disabled
        ? (!active ? "Unavailable until the agreement is active" : "No eligible AP corrective assignment")
        : "";
    }
    if (weekly) {
      var weeklyState = participantStateCache && participantStateCache.weekly;
      var weeklyComplete = !!weeklyState && weeklyState.eligible === true &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(weeklyState.date || "")) &&
        Number(weeklyState.day) >= 8 && Math.floor(Number(weeklyState.day)) === Number(weeklyState.day) &&
        Number(weeklyState.week) >= 1 && Math.floor(Number(weeklyState.week)) === Number(weeklyState.week);
      weekly.disabled = !active || !weeklyComplete;
      weekly.title = weekly.disabled
        ? (!active ? "Unavailable until the agreement is active" : String(weeklyState && weeklyState.reason || "Weekly review is not due"))
        : "";
    }
    if (config.demoMode) {
      ["card-daily", "card-corrective", "card-weekly", "card-confirmation", "card-announcement"].forEach(function (id) {
        var card = MRB.ui.byId(id);
        if (card) {
          card.disabled = true;
          card.title = "Offline demonstration mode permits only the demonstration session";
        }
      });
    }
  }

  async function beginSessionFlow(type) {
    if (MRB.config.get().demoMode && type !== "demo") {
      throw new Error("Offline demonstration mode permits only the demonstration session.");
    }
    if (type === "corrective" || type === "weekly") {
      participantStateCache = await MRB.api.myState();
      if (!participantStateCache.agreementActive) throw new Error("The agreement is not active.");
    }
    MRB.ui.showView("preflight");
    MRB.ui.byId("preflight-title").textContent =
      MRB.config.SESSION_TAGS[type] || type;
    MRB.ui.byId("preflight-subtitle").textContent = "Pre-flight verification";
    MRB.ui.setStatus("preflight", "Running checks…");
    MRB.ui.byId("btn-preflight-start").disabled = true;

    var fields = MRB.ui.byId("preflight-fields");
    fields.innerHTML = "";

    var level = 1;
    var entry = null;
    if (type === "corrective") {
      var open = correctiveEntries();
      if (!open.length) {
        throw new Error("No server-eligible corrective assignment is available.");
      }
      entry = open[0];
      level = entry.level;
      fields.innerHTML =
        '<label class="field"><span>Open entry</span><select id="pf-entry" class="mono"></select></label>' +
        '<div class="field"><span>Assignment id</span><p id="pf-assignment-id" class="mono small"></p></div>' +
        '<div class="field"><span>Current attempt id</span><p id="pf-attempt-id" class="mono small"></p></div>' +
        '<div class="field"><span>AP assignment</span><p id="pf-assignment" class="mono small"></p></div>' +
        '<div class="field"><span>Required session</span><p id="pf-corrective-terms" class="mono small"></p></div>';
      var sel = MRB.ui.byId("pf-entry");
      open.forEach(function (e, idx) {
        var opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = (e.id ? e.id + " · " : "") + (e.date || "") + " — " + (e.violation || "").slice(0, 48);
        sel.appendChild(opt);
      });
      sel.disabled = true;
      function showCorrectiveTerms() {
        var assignmentId = MRB.ui.byId("pf-assignment-id");
        var attemptId = MRB.ui.byId("pf-attempt-id");
        var assignment = MRB.ui.byId("pf-assignment");
        var terms = MRB.ui.byId("pf-corrective-terms");
        if (assignmentId) assignmentId.textContent = entry.assignmentId;
        if (attemptId) attemptId.textContent = entry.attemptId;
        if (assignment) assignment.textContent = entry.assignment || entry.violation || "AP corrective assignment";
        if (terms) terms.textContent = "Level " + entry.level + " · " + entry.minutes + " minutes · due " + entry.due;
      }
      showCorrectiveTerms();
    }

    if (type === "weekly") {
      var weeklyState = participantStateCache && participantStateCache.weekly;
      if (!weeklyState || weeklyState.eligible !== true) {
        throw new Error(String(weeklyState && weeklyState.reason || "Weekly review is not due."));
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weeklyState.date || "")) ||
          Number(weeklyState.day) < 8 || Math.floor(Number(weeklyState.day)) !== Number(weeklyState.day) ||
          Number(weeklyState.week) < 1 || Math.floor(Number(weeklyState.week)) !== Number(weeklyState.week)) {
        throw new Error("Server weekly schedule is incomplete.");
      }
      fields.innerHTML = '<div class="field"><span>Server schedule</span><p id="pf-weekly-terms" class="mono small"></p></div>';
      MRB.ui.byId("pf-weekly-terms").textContent = "Week " + String(weeklyState.week) +
        " · Day " + String(weeklyState.day) + " · " + String(weeklyState.date);
    }

    if (type === "daily") {
      // Read-only: the official figure is the scale-synced reading the server
      // returns with the challenge. No typed weight exists anymore.
      fields.innerHTML =
        '<div class="field"><span>Weight — scale-synced</span><p id="pf-weight-synced" class="mono" style="margin:4px 0 0;font-size:18px;font-weight:600">Fetched with the code at start</p><p class="mono small" style="margin:2px 0 0;color:#8B8A84">From the Withings scale via the record. If no reading synced today, step on the scale first.</p></div>';
    }

    if (type === "confirmation") {
      fields.innerHTML =
        '<label class="field"><span>Agreement version</span><input id="pf-version" type="text" class="mono" value="2" readonly aria-readonly="true" /></label>';
    }

    var minutes = type === "corrective" ? entry.minutes : MRB.preflight.estimateMinutes(type, 1);

    var checkResult = await MRB.preflight.runChecks(type, {
      minutes: minutes,
      level: level,
      entry: entry,
    });
    MRB.ui.renderPreflightList(checkResult.checks);

    // Start camera for framing preview
    try {
      var pv = MRB.ui.byId("preflight-video");
      await MRB.camera.start(pv);
      // Draw guides on preflight canvas
      var guide = MRB.ui.byId("preflight-guide");
      var gctx = guide.getContext("2d");
      function drawGuide() {
        if (MRB.ui.byId("view-preflight").hidden) return;
        MRB.overlay.drawOverlay(gctx, {
          videoEl: pv,
          sessionTag: type === "demo" ? MRB.overlay.demoTag() : MRB.config.SESSION_TAGS[type],
          bottomPrimary: "FRAMING PREVIEW",
          bottomSecondary: "MICHEALRAYBERRY.COM",
          showGuides: true,
        });
        requestAnimationFrame(drawGuide);
      }
      requestAnimationFrame(drawGuide);
    } catch (e) {
      MRB.ui.setStatus("preflight", "Camera: " + e.message);
      checkResult.canStart = false;
      checkResult.checks = checkResult.checks.concat([{
        label: "Live camera",
        level: "fail",
        detail: e.message,
        blocking: true,
      }]);
    }

    var startBtn = MRB.ui.byId("btn-preflight-start");
    function renderChecksWithUniform(result) {
      // Uniform attestation is not machine-checkable. Rebuild it whenever an
      // assignment changes so a longer duration cannot reuse stale battery or
      // storage checks—or a prior confirmation tap.
      MRB.ui.renderPreflightList(result.checks);
      var couldStart = result.canStart;
      startBtn.disabled = true;
      var ul = MRB.ui.byId("preflight-list");
      if (!ul) { startBtn.disabled = !couldStart; return; }
      var li = document.createElement("li");
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.style.cursor = "pointer";
      var left = document.createElement("span");
      left.textContent = type === "corrective" ? "Correction uniform — pink unitard" : "Uniform — black unitard";
      var right = document.createElement("span");
      var confirmed = false;
      function paint() {
        right.className = confirmed ? "check-ok" : "check-fail";
        right.textContent = confirmed ? "Confirmed" : "Tap to confirm";
        if (couldStart) startBtn.disabled = !confirmed;
      }
      function toggle() { confirmed = !confirmed; paint(); }
      li.addEventListener("click", toggle);
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
      paint();
      MRB.ui.setStatus(
        "preflight",
        couldStart
        ? "Checks passed. Confirm the uniform, frame full body, then begin."
        : "Blocking checks failed — fix before starting."
      );
    }

    renderChecksWithUniform(checkResult);

    // Store context for start button
    MRB._pending = {
      type: type,
      level: level,
      entry: entry,
      minutes: minutes,
      open: type === "corrective" ? open : [],
    };

    if (type === "corrective" && sel) {
      sel.disabled = false;
      sel.onchange = async function () {
        entry = open[+sel.value];
        level = entry.level;
        minutes = entry.minutes;
        showCorrectiveTerms();
        startBtn.disabled = true;
        sel.disabled = true;
        MRB.ui.setStatus("preflight", "Assignment changed — rerunning duration checks…");
        try {
          var refreshed = await MRB.preflight.runChecks(type, {
            minutes: minutes,
            level: level,
            entry: entry,
          });
          // A camera failure from the initial preview remains blocking; changing
          // an assignment cannot make the missing stream valid.
          var cameraFailure = checkResult.checks.filter(function (check) {
            return check.label === "Live camera" && check.level === "fail";
          });
          if (cameraFailure.length) {
            refreshed.canStart = false;
            refreshed.checks = refreshed.checks.concat(cameraFailure);
          }
          checkResult = refreshed;
          MRB._pending = {
            type: type,
            level: level,
            entry: entry,
            minutes: minutes,
            open: open,
          };
          renderChecksWithUniform(checkResult);
        } catch (selectionError) {
          MRB.ui.setStatus("preflight", "Assignment checks failed: " + selectionError.message);
          startBtn.disabled = true;
        } finally {
          sel.disabled = false;
        }
      };
    }
  }

  async function onStartSession() {
    var pending = MRB._pending;
    if (!pending) return;
    var type = pending.type;

    var weight = null;

    var level = pending.level;
    var entry = pending.entry;
    if (type === "corrective") {
      var sel = MRB.ui.byId("pf-entry");
      if (sel && pending.open) entry = pending.open[+sel.value] || entry;
    }

    if (type === "corrective" || type === "weekly") {
      try {
        participantStateCache = await MRB.api.myState();
        if (!participantStateCache.agreementActive) throw new Error("The agreement is not active.");
        if (type === "corrective") {
          var selectedId = String(entry && entry.id || "");
          var selectedAssignmentId = String(entry && entry.assignmentId || "");
          var selectedAttemptId = String(entry && entry.attemptId || "");
          entry = correctiveEntries().find(function (candidate) {
            return candidate.id === selectedId && candidate.assignmentId === selectedAssignmentId &&
              candidate.attemptId === selectedAttemptId;
          }) || null;
          if (!entry) throw new Error("That corrective assignment is no longer eligible.");
          level = entry.level;
        } else {
          var currentWeekly = participantStateCache.weekly;
          if (!currentWeekly || currentWeekly.eligible !== true) {
            throw new Error(String(currentWeekly && currentWeekly.reason || "Weekly review is not due."));
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(currentWeekly.date || "")) ||
              Number(currentWeekly.day) < 8 || Math.floor(Number(currentWeekly.day)) !== Number(currentWeekly.day) ||
              Number(currentWeekly.week) < 1 || Math.floor(Number(currentWeekly.week)) !== Number(currentWeekly.week)) {
            throw new Error("Server weekly schedule is incomplete.");
          }
        }
      } catch (stateError) {
        MRB.ui.setStatus("preflight", "Eligibility check failed: " + stateError.message);
        MRB.ui.byId("btn-preflight-start").disabled = false;
        return;
      }
    }

    var version = "2";
    if (type === "confirmation") {
      var vEl = MRB.ui.byId("pf-version");
      if (vEl) version = vEl.value || "2";
    }

    MRB.ui.byId("btn-preflight-start").disabled = true;
    MRB.ui.setStatus("preflight", "Requesting challenge code…");

    // One challenge per attempt — never reuse
    var kind = MRB.config.KIND_MAP[type];
    var ch;
    try {
      ch = await MRB.api.challenge(kind,
        type === "corrective" && entry ? entry.id : "",
        type === "corrective" && entry ? entry.assignmentId : "",
        type === "corrective" && entry ? entry.attemptId : "");
    } catch (e) {
      MRB.ui.setStatus("preflight", "Challenge failed: " + e.message);
      MRB.ui.byId("btn-preflight-start").disabled = false;
      return;
    }

    // Daily sessions require the scale-synced weight — the record accepts no
    // other figure, so a session cannot start without one on file for today.
    if (type === "daily") {
      var swEl = MRB.ui.byId("pf-weight-synced");
      if (!ch.weight) {
        if (swEl) swEl.textContent = "No synced reading today";
        MRB.ui.setStatus("preflight", "No scale-synced weight on the record for today. Step on the Withings scale, wait for it to sync, then try again.");
        MRB.ui.byId("btn-preflight-start").disabled = false;
        return;
      }
      if (swEl) swEl.textContent = Number(ch.weight).toFixed(1) + " lb — official (scale-synced)";
    }

    var date = MRB.ui.formatTodayET();
    // Prefer server-issued day; never device clock for day number
    var day = ch.day != null ? ch.day : 1;
    // issuedAt is a UTC timestamp: taking its first 10 chars stamps TOMORROW'S
    // date on any session recorded after 8 PM Eastern (UTC has already rolled
    // over) — the normal window before the 10 PM deadline. Convert to Eastern
    // before extracting the date.
    if (ch.issuedAt) {
      try {
        var issuedET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ch.issuedAt));
        var issuedDay = MRB.dates.parseDate(issuedET);
        if (issuedDay) date = issuedDay.iso;
      } catch (e) { /* fall back to formatTodayET() above */ }
    }

    var figures = null;
    var week = 1;
    if (type === "weekly") {
      var weekly = participantStateCache.weekly;
      if (!ch.demo && (String(weekly.date) !== date || Number(weekly.day) !== Number(day))) {
        MRB.ui.setStatus("preflight", "Server schedule changed while starting. Run preflight again.");
        MRB.ui.byId("btn-preflight-start").disabled = false;
        return;
      }
      date = String(weekly.date);
      day = Number(weekly.day);
      week = Number(weekly.week);
      ch.day = day;
      var weekStart = weekStartIso(participantStateCache.projectStart, week);
      if (!weekStart) {
        MRB.ui.setStatus("preflight", "Server project start is invalid. Filing remains blocked.");
        MRB.ui.byId("btn-preflight-start").disabled = false;
        return;
      }
      figures = MRB.scripts.weeklyFigures(recordCache, weekStart, 340);
    }

    try {
      await MRB.audio.ensureRunning();
    } catch (e) {
      MRB.ui.setStatus("preflight", "Audio: " + e.message);
      MRB.ui.byId("btn-preflight-start").disabled = false;
      return;
    }

    MRB.camera.stop(); // session will reacquire on capture-video

    try {
      var outcome = await MRB.session.run({
        type: type,
        day: day,
        date: date,
        code: ch.code,
        weight: type === "daily" ? (ch.weight || null) : type === "weekly" ? figures.endW : weight,
        level: level,
        minutes: type === "corrective" ? entry.minutes : pending.minutes,
        version: version,
        week: week,
        vRef: entry ? entry.id : "",
        assignmentId: entry ? entry.assignmentId : "",
        attemptId: entry ? entry.attemptId : "",
        violation: entry ? entry.violation : "",
        violationDate: entry ? entry.date : date,
        record: recordCache,
        figures: figures,
      });

      showResult(outcome, type, ch, { date: date, day: day, level: level, week: week,
        version: version, vRef: entry ? entry.id : "", assignmentId: entry ? entry.assignmentId : "",
        attemptId: entry ? entry.attemptId : "",
        violation: entry ? entry.violation : "" });
    } catch (e) {
      MRB.camera.stop();
      MRB.ui.showError(e.message || String(e));
    }
  }


  function ytPad3(n) { return String(n == null ? "" : n).padStart(3, "0"); }

  /** Ready-made YouTube title + description for each session type. */
  function ytMeta(type, ctx) {
    var base = "https://michealrayberry.com";
    var brand = " | Micheal Ray Berry"; // short suffix survives YouTube's ~70-char truncation; the project name lives in the channel + description
    var dayN = ytPad3(ctx.day);
    var tail =
      "\n\nMicheal Ray Berry Public Accountability Project — 340 lb declared start, 200 lb goal, documented daily under his real name from August 31, 2026. " +
      "Every recording is made through the official Recording Assistant with a burned-in day, weight, verification code and date; the Accountability Partner verifies each filing against the record.\n" +
      "The record: " + base + "/\nThe agreement: " + base + "/agreement\nRecord issues: " + base + "/report/ · ap@michealrayberry.com";
    if (type === "corrective") {
      var ref = String(ctx.vRef || "").trim().toUpperCase();
      if (!/^V-[A-F0-9]{12}$/.test(ref)) {
        throw new Error("Corrective entry reference unavailable.");
      }
      return {
        title: "Corrective Session — " + ref + " · Level " + (ctx.level || 1) + " Corner Time · " + ctx.date + brand,
        desc:
          "Corner time, Level " + (ctx.level || 1) + ", recorded in one continuous unedited take against violation " + ref +
          (ctx.violation ? " — missed requirement: " + ctx.violation + "." : ".") +
          " Filed to the record under §8 and published beside the entry once the Accountability Partner accepts it." +
          "\nViolation log: " + base + "/violations/\nThe standard: " + base + "/corrections/" + tail,
      };
    }
    if (type === "weekly") {
      return {
        title: "Weekly Review — Week " + (ctx.week || "") + " · " + ctx.date + brand,
        desc:
          "Week " + (ctx.week || "") + " read from the record to camera: days documented, the weight and its change, entries still open. " +
          "A review of the completed week, not a consequence." +
          "\nWeekly record: " + base + "/weeks/" + tail,
      };
    }
    if (type === "confirmation") {
      return {
        title: "Recorded Consent Statement · " + ctx.date + brand,
        desc:
          "Micheal Ray Berry's recorded consent to the Public Accountability Project Agreement, made on " + ctx.date + ". " +
          "The statement is read by a synthetic voice while he appears on camera; participation is confirmed by entering the Inspection position and consent by a deliberate nod inside the timed confirmation window. " +
          "Submitted to the Accountability Partner for review; the agreement takes effect only when both signatures and this recording are verified." +
          "\nAgreement: " + base + "/agreement" + tail,
      };
    }
    if (type === "announcement") {
      return {
        title: "Project Announcement — Day 1 · " + ctx.date + brand,
        desc:
          "Announcement of the Micheal Ray Berry Public Accountability Project: 340 lb declared start, 200 lb goal, and a daily public documentation standard under a written agreement. Day 1 is August 31, 2026." +
          "\nThe record: " + base + "/\nThe agreement: " + base + "/agreement" + tail,
      };
    }
    if (type === "demo") {
      return {
        title: "Corrective Session Standard — Demonstration (not a session)" + brand,
        desc:
          "A demonstration of the corrective-session position and standard. This is an explainer, " +
          "not a corrective session: it answers no violation and is filed against no entry." +
          "\nThe standard: " + base + "/corrections/" + tail,
      };
    }
    return {
      title: "Daily Inspection — Day " + dayN + " · " + ctx.date + brand,
      desc:
        "Day " + dayN + " of the record (" + ctx.date + "): the standardized four-angle daily inspection, filed with the day's scale-synced weight and four documentation photographs before the 10:00 PM ET deadline." +
        "\nDay page: " + base + "/daily/" + ctx.date + "-day-" + dayN + "/" + tail,
    };
  }

  function isCanonicalYouTubeUrl(value) {
    try {
      var raw = String(value || "").trim();
      var parsed = new URL(raw);
      var host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return false;
      if (host === "youtu.be") {
        return /^\/[A-Za-z0-9_-]{11}$/.test(parsed.pathname) && !parsed.search
          && raw === "https://youtu.be" + parsed.pathname;
      }
      if (host !== "youtube.com" && host !== "www.youtube.com") return false;
      var id = parsed.searchParams.get("v") || "";
      return parsed.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(id)
        && parsed.search === "?v=" + id && raw === "https://" + host + "/watch?v=" + id;
    } catch (error) {
      return false;
    }
  }

  /** Post-to-YouTube step on the result screen: copyable title/description and
   *  a link filer. The YouTube URL is what the record embeds (§2/§8). */
  function renderYtPublish(type, ctx, ch) {
    var dl = document.getElementById("result-downloads");
    if (!dl || !dl.parentNode) return;
    var old = document.getElementById("yt-publish");
    if (old) old.remove();
    var meta = ytMeta(type, ctx);
    var wrap = document.createElement("div");
    wrap.id = "yt-publish";
    wrap.style.cssText = "margin:18px 0;border:1px solid #141412;padding:16px;display:flex;flex-direction:column;gap:10px;text-align:left";
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
    wrap.innerHTML =
      '<div class="mono" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#B3261E">Post to YouTube — public — then file the link</div>' +
      '<div style="font-size:13px;line-height:1.6;color:#3A3935">Upload the take publicly to @michealrayberry with this title and description, paste the video link, and file it — the record embeds the YouTube video.</div>' +
      '<label class="mono" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6B6A64">Title <button type="button" data-copy="yt-title" class="mono" style="margin-left:8px;font-size:11px;cursor:pointer">Copy</button></label>' +
      '<textarea id="yt-title" readonly rows="2" class="mono" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px;border:1px solid #D8D6CF;background:#F1F0EA;resize:vertical">' + esc(meta.title) + "</textarea>" +
      '<label class="mono" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6B6A64">Description <button type="button" data-copy="yt-desc" class="mono" style="margin-left:8px;font-size:11px;cursor:pointer">Copy</button></label>' +
      '<textarea id="yt-desc" readonly rows="7" class="mono" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px;border:1px solid #D8D6CF;background:#F1F0EA;resize:vertical">' + esc(meta.desc) + "</textarea>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<input id="yt-url" type="url" placeholder="https://youtu.be/…" class="mono" style="flex:1;min-width:180px;font-size:12px;padding:10px;border:1px solid #141412;background:#FAFAF7">' +
      '<button type="button" id="yt-file" class="btn btn-primary">File the link</button></div>' +
      '<div id="yt-msg" class="mono" style="font-size:12px;color:#B3261E;min-height:14px"></div>';
    dl.parentNode.insertBefore(wrap, dl.nextSibling);
    wrap.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var el = document.getElementById(b.getAttribute("data-copy"));
        el.select();
        try { navigator.clipboard.writeText(el.value); } catch (e) { try { document.execCommand("copy"); } catch (e2) {} }
        b.textContent = "Copied ✓";
        setTimeout(function () { b.textContent = "Copy"; }, 1600);
      });
    });
    var btn = wrap.querySelector("#yt-file");
    btn.addEventListener("click", async function () {
      var msg = wrap.querySelector("#yt-msg");
      var u = (wrap.querySelector("#yt-url").value || "").trim();
      if (!isCanonicalYouTubeUrl(u)) { msg.textContent = "Paste a canonical HTTPS YouTube watch or youtu.be link."; return; }
      btn.disabled = true; msg.textContent = "Filing…";
      try {
        var j = await MRB.api.postJson({
          action: "ytfiled",
          key: MRB.config.get().deviceKey,
          kind: type === "confirmation" ? "consent" : type,
          date: ctx.date,
          ref: type === "corrective" ? ctx.vRef : "",
          assignment_id: type === "corrective" ? ctx.assignmentId : "",
          attempt_id: type === "corrective" ? ctx.attemptId : "",
          url: u,
          attestation_seal: ctx.attestationSeal || "",
        });
        if (!j || !j.ok) {
          msg.textContent = "Filing failed" + (j && j.error ? ": " + j.error : " — send the link to the AP.");
        } else if (type === "corrective") {
          msg.textContent = j.status === "resolved"
            ? "Already filed ✓ — " + ctx.vRef + " is resolved."
            : j.status === "completed-awaiting-resolution"
              ? "Already filed ✓ — assignment completed; source resolution is pending."
              : "Filed ✓ — " + ctx.vRef + " remains unresolved pending AP verification.";
        } else if (type === "confirmation") {
          msg.textContent = "Participant statement submitted ✓ — awaiting separate AP verification.";
        } else {
          msg.textContent = "Filed ✓ — the record will embed the posting on the next build.";
        }
      } catch (e) { msg.textContent = "Filing failed — send the link to the AP."; }
      btn.disabled = false;
    });
  }

  function showResult(outcome, type, ch, ctx) {
    if ((!outcome.downloads || !outcome.downloads.length) && MRB.download && MRB.download.revokeAll) MRB.download.revokeAll();
    var stalePublish = document.getElementById("yt-publish");
    if (stalePublish) stalePublish.remove();
    var staleDownloads = MRB.ui.byId("result-downloads");
    if (staleDownloads) { staleDownloads.innerHTML = ""; staleDownloads.hidden = true; }
    MRB.ui.showView("result");
    var title = MRB.ui.byId("result-title");
    var sub = MRB.ui.byId("result-subtitle");
    var body = MRB.ui.byId("result-body");

    if (outcome.outcome === "invalidated") {
      title.textContent = "Session discarded";
      sub.textContent = "Invalidated — nothing filed";
      body.textContent =
        "Reason: " +
        (outcome.reason || "invalidation") +
        "\n\nAn invalidated session is discarded in full. " +
        "No partial corrective is saved as a shorter session. Restart from zero when ready.";
      return;
    }


    if (outcome.outcome === "error") {
      title.textContent = "Session not filed";
      sub.textContent = "Guard refused filing";
      body.textContent = outcome.error || "Unknown error";
      return;
    }

    var demo = type === "demo";
    var filed = outcome.filed || {};
    title.textContent = "Session complete";
    sub.textContent = demo
      ? "Demo — nothing sent to the record"
      : filed.ok
        ? filed.publicLinkPending
          ? "Capture sealed · public link filing pending"
          : "Filed to the record"
        : "Saved locally · filing pending";
    var lines = [
      "Type: " + type,
      "Challenge code: " + ch.code,
      "Day: " + (ch.day != null ? ch.day : "—"),
      "Issued: " + (ch.issuedAt || "—"),
    ];
    if (outcome.result) {
      lines.push(
        "Duration: " + outcome.result.durationSec.toFixed(1) + "s",
        "Size: " + MRB.queue.formatBytes(outcome.result.size),
        "Frames: " + outcome.result.frameCount,
        "Chunks: " + outcome.result.chunk_count,
        "Chain: " + (outcome.result.chunk_chain || "").slice(0, 16) + "…",
        "Audio track: " + (outcome.result.hasAudio || MRB.audio.hasAudioTrackEvidence() ? "yes" : "NO")
      );
    }
    if (outcome.photos) {
      lines.push("Photographs: " + outcome.photos.length);
    }
    if (type === "corrective" && ctx && ctx.vRef) {
      lines.push("Violation: " + ctx.vRef);
      lines.push("Assignment: " + ctx.assignmentId);
      lines.push("Attempt: " + ctx.attemptId);
    }
    if (!demo && filed.publicLinkPending) {
      lines.push("", "Private backup sealed. Public YouTube filing and Accountability Partner verification remain pending.");
    }
    if (!demo && !filed.ok) {
      lines.push("", "Filing is pending in the upload queue: " + (filed.error || "retry required"));
    }
    lines.push("", "Filing: " + JSON.stringify(filed, null, 2));
    body.textContent = lines.join("\n");

    // Auto-download + visible field links
    var dl = MRB.ui.byId("result-downloads");
    var links = outcome.downloads || [];
    if ((!links || !links.length) && outcome.result && outcome.result.blob && MRB.download) {
      links = MRB.download.saveArtifacts({
        videoBlob: outcome.result.blob,
        photos: outcome.photos || [],
        meta: {
          kind: type,
          day: ch.day,
          date: (ctx || {}).date,
          code: ch.code,
          mime: outcome.result.mime,
        },
      });
    }
    if (MRB.download) MRB.download.renderLinks(dl, links);

    var publishContext = Object.assign({}, ctx || {}, { attestationSeal: filed.attestationSeal || "" });
    var exactSealRequired = ["daily", "corrective", "weekly", "confirmation"].indexOf(type) !== -1;
    if (demo || (filed.ok && (!exactSealRequired || /^[a-f0-9]{64}$/.test(publishContext.attestationSeal)))) {
      renderYtPublish(type, publishContext, ch);
    }
  }

  function ensurePortraitGeometry() {
    if (MRB.camera && MRB.camera.sizePortraitCanvases) {
      MRB.camera.sizePortraitCanvases();
    }
    if (MRB.wake && MRB.wake.lockPortrait) {
      MRB.wake.lockPortrait().catch(function () {});
    }
  }

  function bindHandlers() {
    if (handlersBound) return;
    handlersBound = true;

    // Session cards
    ["daily", "corrective", "weekly", "confirmation", "demo", "announcement"].forEach(function (t) {
      var card = MRB.ui.byId("card-" + t);
      if (card) {
        card.addEventListener("click", function () {
          beginSessionFlow(t).catch(function (e) {
            MRB.ui.showError(e.message || String(e));
          });
        });
      }
    });

    MRB.ui.byId("btn-preflight-back").addEventListener("click", function () {
      MRB.camera.stop();
      MRB.ui.showView("home");
      refreshHome();
    });

    MRB.ui.byId("btn-preflight-start").addEventListener("click", function () {
      onStartSession().catch(function (e) {
        MRB.ui.showError(e.message || String(e));
      });
    });

    MRB.ui.byId("btn-flip-camera").addEventListener("click", function () {
      var pv = MRB.ui.byId("preflight-video");
      MRB.camera.flip(pv).catch(function (e) {
        MRB.ui.setStatus("preflight", "Flip failed: " + e.message);
      });
    });

    MRB.ui.byId("btn-result-home").addEventListener("click", function () {
      MRB.camera.stop();
      if (MRB.download && MRB.download.revokeAll) MRB.download.revokeAll();
      var publish = document.getElementById("yt-publish");
      if (publish) publish.remove();
      var dl = MRB.ui.byId("result-downloads");
      if (dl) { dl.innerHTML = ""; dl.hidden = true; }
      MRB.ui.showView("home");
      refreshHome();
    });

    MRB.ui.byId("btn-error-retry").addEventListener("click", function () {
      location.reload();
    });

    var toggle = MRB.ui.byId("btn-settings-toggle");
    var body = MRB.ui.byId("settings-body");
    toggle.addEventListener("click", function () {
      var open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    MRB.ui.byId("btn-save-settings").addEventListener("click", function () {
      var wasDemo = MRB.config.get().demoMode;
      var settings = MRB.ui.readSettingsForm();
      settings.demoMode = false;
      MRB.config.save(settings);
      if (wasDemo) { lockNow(); return; }
      MRB.ui.setStatus("preflight", "Settings saved");
      refreshHome();
    });

    MRB.ui.byId("lock-form").addEventListener("submit", isolate("unlock", tryUnlock));
    MRB.ui.byId("btn-demo-unlock").addEventListener("click", function () {
      localStorage.removeItem("mrb_unlock_token");
      localStorage.removeItem("mrb_unlock_until");
      MRB.config.save({ demoMode: true });
      MRB.ui.showView("home");
      refreshHome();
    });
    MRB.ui.byId("btn-lock").addEventListener("click", lockNow);
    MRB.ui.byId("btn-clear-settings").addEventListener("click", function () {
      MRB.config.save({
        deviceKey: "",
        execUrl: "",
        elKey: "",
        elVoice: MRB.config.DEFAULT_EL_VOICE,
        demoMode: false,
      });
      MRB.ui.fillSettingsForm();
      lockNow();
    });

    window.addEventListener("online", function () {
      MRB.queue.processQueue().then(function () {
        return MRB.queue.queueSummary();
      }).then(function (s) {
        MRB.ui.renderQueue(s);
      });
    });
  }

  /* ── Two-key lock ─────────────────────────────────────────────────────
     The instrument opens only after the record server has accepted BOTH the
     participant's device key and the AP's unlock code (action "unlock").
     The server returns a sealed token with its authoritative expiry and checks
     that token again on every participant action. Explicit offline demonstration
     mode is local-only and permits only the demonstration session. */
  function isUnlocked() {
    var c = MRB.config.get();
    if (c.demoMode) return true;
    var tok = localStorage.getItem("mrb_unlock_token") || "";
    var until = Number(localStorage.getItem("mrb_unlock_until") || 0);
    return !!tok && until > Date.now();
  }
  function lockNow() {
    localStorage.removeItem("mrb_unlock_token");
    localStorage.removeItem("mrb_unlock_until");
    MRB.config.save({ demoMode: false });
    MRB.ui.showView("lock");
  }
  async function tryUnlock(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var dk = (MRB.ui.byId("lock-device-key").value || "").trim();
    var ac = (MRB.ui.byId("lock-ap-code").value || "").trim();
    var err = MRB.ui.byId("lock-error");
    var btn = MRB.ui.byId("btn-unlock");
    err.hidden = true;
    if (!dk || !ac) { err.textContent = "Both keys are required."; err.hidden = false; return; }
    btn.disabled = true;
    try {
      MRB.config.save({ demoMode: false });
      var r = await MRB.api.postJson({ action: "unlock", key: dk, code: ac });
      var expires = Number(r && r.expires);
      if (!r || !r.ok || !r.token || !isFinite(expires) || expires <= Date.now()) {
        throw new Error((r && r.error) || "Server returned an invalid unlock grant");
      }
      MRB.config.save({ deviceKey: dk });
      localStorage.setItem("mrb_unlock_token", String(r.token));
      localStorage.setItem("mrb_unlock_until", String(expires));
      MRB.ui.byId("lock-device-key").value = "";
      MRB.ui.byId("lock-ap-code").value = "";
      MRB.ui.showView("home");
      await refreshHome();
    } catch (e) {
      err.textContent = "Refused: " + (e && e.message ? e.message : "keys not accepted");
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function init() {
    if (initDone) return;
    initDone = true;

    // Selector integrity first — highest-yield setup check
    var integrity = MRB.ui.selectorIntegrity(document);
    if (!integrity.ok) {
      MRB.ui.showError(
        "Selector integrity failed. Missing: " + integrity.missing.join(", ")
      );
      return;
    }

    ensurePortraitGeometry();
    bindHandlers();
    if (MRB.wake) {
      MRB.wake.bind();
      MRB.wake.setStatusHandler(function (s) {
        var el = MRB.ui.byId("key-status");
        /* optional: surface only failures via console */
        if (!s.ok) console.warn("[wake]", s.message);
      });
    }
    deadlineTimer = MRB.ui.startDeadlineTicker();
    if (isUnlocked()) {
      MRB.ui.showView("home");
      await refreshHome();
    } else {
      MRB.ui.showView("lock");
    }


    // SW for PWA
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }

    MRB._ready = true;
  }

  // Register DOMContentLoaded ONCE
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", isolate("init", init), {
        once: true,
      });
    } else {
      isolate("init", init)();
    }
  }

  MRB.app = {
    init: init,
    refreshHome: refreshHome,
    beginSessionFlow: beginSessionFlow,
  };
})(window.MRB);
