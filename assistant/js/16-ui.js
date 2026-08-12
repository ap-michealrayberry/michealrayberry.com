(function (MRB) {
  "use strict";

  /** One status line, one writer — prevents flicker from dual writers. */
  var statusTargets = {
    preflight: "preflight-status",
    session: "session-status",
    photo: "photo-status",
  };

  function setStatus(which, text) {
    var id = statusTargets[which] || which;
    var el = typeof id === "string" ? document.getElementById(id) : id;
    if (el) el.textContent = text || "";
  }

  function showView(name) {
    var views = ["home", "preflight", "session", "photos", "result", "error"];
    views.forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (el) el.hidden = v !== name;
    });
  }

  function showError(message) {
    var el = document.getElementById("error-message");
    if (el) el.textContent = message || "Unknown error";
    showView("error");
  }

  function qs(sel) {
    return document.querySelector(sel);
  }
  function qsa(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }
  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * Selector integrity: every id/class queried in JS that we register must exist.
   * Used by tests and setup smoke.
   */
  var REQUIRED_IDS = [
    "app-root",
    "view-error",
    "error-message",
    "btn-error-retry",
    "view-home",
    "deadline-countdown",
    "packet-status",
    "voice-status",
    "key-status",
    "open-entries",
    "open-entries-list",
    "queue-status",
    "queue-status-body",
    "card-daily",
    "card-corrective",
    "card-confirmation",
    "card-demo",
    "card-announcement",
    "settings-panel",
    "btn-settings-toggle",
    "settings-body",
    "input-device-key",
    "input-exec-url",
    "input-sheet-id",
    "input-el-key",
    "input-el-voice",
    "btn-save-settings",
    "btn-clear-settings",
    "view-preflight",
    "preflight-title",
    "preflight-subtitle",
    "btn-preflight-back",
    "preflight-list",
    "preflight-video",
    "preflight-guide",
    "preflight-fields",
    "btn-flip-camera",
    "btn-preflight-start",
    "preflight-status",
    "view-session",
    "capture-video",
    "compose-canvas",
    "preview-canvas",
    "session-status",
    "session-meta",
    "btn-setup-ready",
    "setup-countdown",
    "setup-controls",
    "view-photos",
    "photo-step-label",
    "photo-canvas",
    "photo-prompt",
    "photo-status",
    "btn-photo-shutter",
    "view-result",
    "result-title",
    "result-subtitle",
    "result-body",
    "result-downloads",
    "btn-result-home",
    "parked-video",
    "narration-audio",
  ];

  function selectorIntegrity(doc) {
    doc = doc || document;
    var missing = [];
    REQUIRED_IDS.forEach(function (id) {
      if (!doc.getElementById(id)) missing.push("#" + id);
    });
    return { ok: missing.length === 0, missing: missing, required: REQUIRED_IDS.slice() };
  }

  function renderPreflightList(checks) {
    var ul = byId("preflight-list");
    if (!ul) return;
    ul.innerHTML = "";
    checks.forEach(function (c) {
      var li = document.createElement("li");
      var left = document.createElement("span");
      left.textContent = c.label;
      var right = document.createElement("span");
      right.className =
        c.level === "ok"
          ? "check-ok"
          : c.level === "fail"
            ? "check-fail"
            : c.level === "warn"
              ? "check-warn"
              : "check-pending";
      right.textContent = c.detail || c.level;
      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  function renderOpenEntries(entries) {
    var wrap = byId("open-entries");
    var list = byId("open-entries-list");
    if (!wrap || !list) return;
    var open = (entries || []).filter(function (e) {
      return e.open;
    });
    if (!open.length) {
      wrap.hidden = true;
      list.innerHTML = "";
      return;
    }
    wrap.hidden = false;
    list.innerHTML = "";
    open.forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML =
        '<div class="mono small">' +
        escapeHtml(e.date || "") +
        "</div><div>" +
        escapeHtml(e.violation || "Open entry") +
        '</div><div class="mono small">' +
        escapeHtml(e.status || "open") +
        "</div>";
      list.appendChild(li);
    });
  }

  function renderQueue(summary) {
    var wrap = byId("queue-status");
    var body = byId("queue-status-body");
    if (!wrap || !body) return;
    if (!summary || !summary.count) {
      wrap.hidden = true;
      body.textContent = "";
      return;
    }
    wrap.hidden = false;
    body.textContent = summary.items
      .map(function (i) {
        return (
          i.kind +
          " · " +
          MRB.queue.formatBytes(i.size) +
          " · " +
          i.status +
          (i.lastAttempt ? " · last " + i.lastAttempt : "") +
          (i.error ? " · " + i.error : "")
        );
      })
      .join("\n");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;");
  }

  function fillSettingsForm() {
    var c = MRB.config.get();
    var map = {
      "input-device-key": c.deviceKey,
      "input-exec-url": c.execUrl,
      "input-sheet-id": c.sheetId,
      "input-el-key": c.elKey,
      "input-el-voice": c.elVoice,
    };
    Object.keys(map).forEach(function (id) {
      var el = byId(id);
      if (el) el.value = map[id] || "";
    });
  }

  function readSettingsForm() {
    return {
      deviceKey: (byId("input-device-key") || {}).value || "",
      execUrl: (byId("input-exec-url") || {}).value || "",
      sheetId: (byId("input-sheet-id") || {}).value || "",
      elKey: (byId("input-el-key") || {}).value || "",
      elVoice: (byId("input-el-voice") || {}).value || "",
    };
  }

  function updateHomeStatus(record) {
    var c = MRB.config.get();
    var voice = byId("voice-status");
    if (voice) {
      var mode = MRB.audio.voiceMode();
      voice.textContent =
        mode === "elevenlabs" ? "ElevenLabs" : mode === "device" ? "Device fallback" : "None";
    }
    var key = byId("key-status");
    if (key) {
      key.textContent = c.deviceKey
        ? "Set" + (c.demoMode ? " · demo mode" : "")
        : c.demoMode
          ? "Demo mode"
          : "Missing";
    }

    var packet = byId("packet-status");
    if (packet && record) {
      var todayEt = formatTodayET();
      var row = (record.weighIns || []).find(function (w) {
        return w.date === todayEt;
      });
      if (!row) {
        packet.textContent = "Weight · photos · video due";
      } else {
        var parts = [];
        parts.push(row.weight_lb != null ? "Weight filed" : "Weight due");
        var photos =
          (row.photo_front ? 1 : 0) +
          (row.photo_left ? 1 : 0) +
          (row.photo_rear ? 1 : 0) +
          (row.photo_right ? 1 : 0);
        parts.push(photos === 4 ? "Photos filed" : "Photos " + photos + "/4");
        parts.push(row.video ? "Video filed" : "Video due");
        packet.textContent = parts.join(" · ");
      }
    } else if (packet) {
      packet.textContent = c.sheetId || c.demoMode ? "—" : "Configure sheet ID";
    }

    if (record) renderOpenEntries(record.violations);
  }

  function formatTodayET() {
    try {
      var fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return fmt.format(new Date());
    } catch (e) {
      var d = new Date();
      return (
        d.getFullYear() +
        "-" +
        MRB.dates.pad2(d.getMonth() + 1) +
        "-" +
        MRB.dates.pad2(d.getDate())
      );
    }
  }

  function startDeadlineTicker() {
    function tick() {
      var el = byId("deadline-countdown");
      if (!el) return;
      el.textContent = MRB.dates.formatCountdown(MRB.dates.msUntil10pmET()) + " to 10 PM ET";
    }
    tick();
    return setInterval(tick, 1000);
  }

  MRB.ui = {
    setStatus: setStatus,
    showView: showView,
    showError: showError,
    qs: qs,
    qsa: qsa,
    byId: byId,
    REQUIRED_IDS: REQUIRED_IDS,
    selectorIntegrity: selectorIntegrity,
    renderPreflightList: renderPreflightList,
    renderOpenEntries: renderOpenEntries,
    renderQueue: renderQueue,
    fillSettingsForm: fillSettingsForm,
    readSettingsForm: readSettingsForm,
    updateHomeStatus: updateHomeStatus,
    formatTodayET: formatTodayET,
    startDeadlineTicker: startDeadlineTicker,
    escapeHtml: escapeHtml,
  };
})(window.MRB);
