(function (MRB) {
  "use strict";

  var recordCache = null;
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
    MRB.ui.updateHomeStatus(recordCache);
    try {
      var q = await MRB.queue.queueSummary();
      MRB.ui.renderQueue(q);
    } catch (e) {
      /* ignore */
    }
    // Process queue in background
    if (navigator.onLine) {
      MRB.queue.processQueue().catch(function () {});
    }
  }

  function weekNumberFromDate(iso) {
    var p = MRB.dates.parseDate(iso);
    if (!p) return 1;
    // Approx week from a project day-one of 2026-01-01 — or use day field
    var start = Date.UTC(2026, 0, 1);
    var cur = Date.UTC(p.y, p.m - 1, p.d);
    return Math.max(1, Math.floor((cur - start) / (7 * 86400000)) + 1);
  }

  function sundayOfCurrentWeekET() {
    var et = MRB.dates.nowInET();
    var day = et.getDay(); // 0 Sun
    var d = new Date(et.getTime());
    d.setDate(d.getDate() - day);
    return (
      MRB.dates.pad4(d.getFullYear()) +
      "-" +
      MRB.dates.pad2(d.getMonth() + 1) +
      "-" +
      MRB.dates.pad2(d.getDate())
    );
  }

  async function beginSessionFlow(type) {
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
      var open = ((recordCache && recordCache.violations) || []).filter(function (v) {
        return v.open;
      });
      if (!open.length) {
        // Allow demo selection
        open = [
          {
            date: MRB.ui.formatTodayET(),
            violation: "Demo open entry",
            status: "open",
            open: true,
          },
        ];
      }
      level = MRB.csv.violationLevel((recordCache && recordCache.violations) || open);
      entry = open[0];
      fields.innerHTML =
        '<label class="field"><span>Open entry</span><select id="pf-entry" class="mono"></select></label>' +
        '<label class="field"><span>Level (1–3)</span><input id="pf-level" type="number" min="1" max="3" value="' +
        level +
        '" class="mono" /></label>';
      var sel = MRB.ui.byId("pf-entry");
      open.forEach(function (e, idx) {
        var opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = (e.date || "") + " — " + (e.violation || "").slice(0, 48);
        sel.appendChild(opt);
      });
      sel.onchange = function () {
        entry = open[+sel.value];
      };
    }

    if (type === "daily") {
      fields.innerHTML =
        '<label class="field"><span>Weight (lb)</span><input id="pf-weight" type="number" step="0.1" min="50" max="800" class="mono" placeholder="337.6" required /></label>';
    }

    if (type === "confirmation") {
      fields.innerHTML =
        '<label class="field"><span>Agreement version</span><input id="pf-version" type="text" class="mono" value="1" /></label>';
    }

    var minutes = MRB.preflight.estimateMinutes(
      type,
      type === "corrective" ? level : 1
    );

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
      MRB.ui.renderPreflightList(
        checkResult.checks.concat([
          {
            label: "Live camera",
            level: "fail",
            detail: e.message,
            blocking: true,
          },
        ])
      );
    }

    MRB.ui.byId("btn-preflight-start").disabled = !checkResult.canStart;
    MRB.ui.setStatus(
      "preflight",
      checkResult.canStart
        ? "All blocking checks passed. Frame full body, then begin."
        : "Blocking checks failed — fix before starting."
    );

    // Store context for start button
    MRB._pending = {
      type: type,
      level: level,
      entry: entry,
      minutes: minutes,
      open: ((recordCache && recordCache.violations) || []).filter(function (v) {
        return v.open;
      }),
    };
  }

  async function onStartSession() {
    var pending = MRB._pending;
    if (!pending) return;
    var type = pending.type;

    var weight = null;
    if (type === "daily") {
      var wEl = MRB.ui.byId("pf-weight");
      weight = wEl ? parseFloat(wEl.value) : NaN;
      if (!weight || isNaN(weight)) {
        MRB.ui.setStatus("preflight", "Enter documented weight before starting");
        return;
      }
    }

    var level = pending.level;
    var entry = pending.entry;
    if (type === "corrective") {
      var lv = MRB.ui.byId("pf-level");
      if (lv) level = Math.max(1, Math.min(3, parseInt(lv.value, 10) || 1));
      var sel = MRB.ui.byId("pf-entry");
      if (sel && pending.open) entry = pending.open[+sel.value] || entry;
    }

    var version = "1";
    if (type === "confirmation") {
      var vEl = MRB.ui.byId("pf-version");
      if (vEl) version = vEl.value || "1";
    }

    MRB.ui.byId("btn-preflight-start").disabled = true;
    MRB.ui.setStatus("preflight", "Requesting challenge code…");

    // One challenge per attempt — never reuse
    var kind = MRB.config.KIND_MAP[type];
    var ch;
    try {
      ch = await MRB.api.challenge(kind);
    } catch (e) {
      MRB.ui.setStatus("preflight", "Challenge failed: " + e.message);
      MRB.ui.byId("btn-preflight-start").disabled = false;
      return;
    }

    var date = MRB.ui.formatTodayET();
    // Prefer server-issued day; never device clock for day number
    var day = ch.day != null ? ch.day : 1;
    if (ch.issuedAt) {
      var issuedDay = MRB.dates.parseDate(ch.issuedAt.slice(0, 10));
      if (issuedDay) date = issuedDay.iso;
    }

    var figures = null;
    var week = weekNumberFromDate(date);
    if (type === "weekly") {
      var weekStart = sundayOfCurrentWeekET();
      var dayOneW = null;
      if (recordCache && recordCache.weighIns && recordCache.weighIns.length) {
        var sorted = recordCache.weighIns.slice().filter(function (w) {
          return w.weight_lb != null;
        });
        if (sorted.length) dayOneW = sorted[sorted.length - 1].weight_lb;
        // earliest
        sorted.sort(function (a, b) {
          return String(a.date).localeCompare(String(b.date));
        });
        if (sorted[0]) dayOneW = sorted[0].weight_lb;
      }
      figures = MRB.scripts.weeklyFigures(recordCache, weekStart, dayOneW);
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
        weight: weight,
        level: level,
        minutes: type === "corrective" ? MRB.config.cornerMinutes(level) : pending.minutes,
        version: version,
        week: week,
        vNum: entry ? 1 : level,
        violation: entry ? entry.violation : "",
        violationDate: entry ? entry.date : date,
        record: recordCache,
        figures: figures,
      });

      showResult(outcome, type, ch, { date: date, day: day, level: level, week: week, version: version, vNum: entry ? 1 : level, violation: entry ? entry.violation : "" });
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
      "\n\nPublic Accountability Project — 340 to 175 lb, documented daily in public. " +
      "The official record is " + base + "/. Recorded through the official Recording Assistant; " +
      "the burned-in verification code and clocks date the footage.\n" +
      "Agreement: " + base + "/agreement\nContact: ap@michealrayberry.com";
    if (type === "corrective") {
      var ref = "V-" + ytPad3(ctx.vNum || 1);
      return {
        title: "Corrective Session — " + ref + " · Level " + (ctx.level || 1) + " Corner Time · " + ctx.date + brand,
        desc:
          "Corner time recorded in one continuous, unedited take against violation " + ref +
          (ctx.violation ? " — missed requirement: " + ctx.violation + "." : ".") +
          " Published beside the entry per §8 of the signed agreement; completing it closes the obligation but removes nothing." +
          "\nViolation log: " + base + "/penalties\nThe standard: " + base + "/corner-time/" + tail,
      };
    }
    if (type === "weekly") {
      return {
        title: "Weekly Review — Week " + (ctx.week || "") + " · " + ctx.date + brand,
        desc:
          "The week read from the record: days documented, the weight, entries still open. " +
          "Not a consequence — a fixed ten-minute review." +
          "\nWeekly record: " + base + "/weeks/" + tail,
      };
    }
    if (type === "confirmation") {
      return {
        title: "Consent Confirmation — " + ctx.date + brand,
        desc:
          "Recorded statement of understanding of the Public Accountability Agreement as amended, " +
          "re-recorded on each amendment. The full agreement text is public." +
          "\nAgreement: " + base + "/agreement" + tail,
      };
    }
    if (type === "announcement") {
      return {
        title: "Project Announcement — Day 1 · " + ctx.date + brand,
        desc:
          "The official announcement of the Micheal Ray Berry Public Accountability Project: 340 to 175 lb, documented daily in public under his real name, administered by an independent Accountability Partner. Day 1 is August 13, 2026." +
          "\nThe record: " + base + "/\nThe agreement: " + base + "/agreement" + tail,
      };
    }
    if (type === "demo") {
      return {
        title: "Corrective Session Standard — Demonstration (not a session)" + brand,
        desc:
          "A demonstration of the corrective-session position and standard. This is an explainer, " +
          "not a corrective session: it answers no violation and is filed against no entry." +
          "\nThe standard: " + base + "/corner-time/" + tail,
      };
    }
    return {
      title: "Daily Inspection — Day " + dayN + " · " + ctx.date + brand,
      desc:
        "Standardized four-angle daily inspection for Day " + dayN + " (" + ctx.date + "), " +
        "filed with the day's weight and four documentation photographs." +
        "\nDay page: " + base + "/daily/" + ctx.date + "-day-" + dayN + "/" + tail,
    };
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
      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(u)) { msg.textContent = "Paste the full YouTube link."; return; }
      btn.disabled = true; msg.textContent = "Filing…";
      try {
        var j = await MRB.api.postJson({
          action: "ytfiled",
          key: MRB.config.get().deviceKey,
          kind: type,
          date: ctx.date,
          ref: type === "corrective" ? "V-" + ytPad3(ctx.vNum || 1) : "",
          url: u,
        });
        msg.textContent = j && j.ok ? "Filed ✓ — the entry is resolved; the record embeds the posting on the next build. The AP reviews it and may overrule." : "Filing failed — send the link to the AP.";
      } catch (e) { msg.textContent = "Filing failed — send the link to the AP."; }
      btn.disabled = false;
    });
  }

  function showResult(outcome, type, ch, ctx) {
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

    title.textContent = "Session complete";
    sub.textContent =
      type === "demo" ? "Demonstration filed" : "Filed to the record";
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
    lines.push("", "Filing: " + JSON.stringify(outcome.filed || {}, null, 2));
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

    renderYtPublish(type, ctx || {}, ch);
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
    ["daily", "corrective", "confirmation", "demo", "announcement"].forEach(function (t) {
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
      MRB.config.save(MRB.ui.readSettingsForm());
      MRB.ui.setStatus("preflight", "Settings saved");
      refreshHome();
    });

    MRB.ui.byId("btn-clear-settings").addEventListener("click", function () {
      MRB.config.save({
        deviceKey: "",
        execUrl: "",
        sheetId: "",
        elKey: "",
        elVoice: MRB.config.DEFAULT_EL_VOICE,
      });
      MRB.ui.fillSettingsForm();
      refreshHome();
    });

    window.addEventListener("online", function () {
      MRB.queue.processQueue().then(function () {
        return MRB.queue.queueSummary();
      }).then(function (s) {
        MRB.ui.renderQueue(s);
      });
    });
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
    MRB.ui.showView("home");
    await refreshHome();


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
