(function () {
  "use strict";

  var TZ = "America/New_York";
  var START = "2026-08-13";
  var DEADLINE_HOUR = 22;
  var STORE_KEY = "mrb_file_packet_v1";
  var BASE = "https://michealrayberry.com";
  var MISSABLE = [
    { id: "video", label: "Daily inspection video" },
    { id: "photos", label: "Four-angle photographs" },
    { id: "weight", label: "Weight entry" },
    { id: "youtube", label: "YouTube posting" },
    { id: "late", label: "Missed 10:00 PM ET deadline" },
    { id: "packet", label: "Entire daily packet" },
  ];

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function pad3(n) {
    return String(n == null ? "" : n).padStart(3, "0");
  }

  function todayEt(now) {
    now = now || new Date();
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch (e) {
      return now.toISOString().slice(0, 10);
    }
  }

  function dayNumber(date) {
    var start = Date.parse(START + "T00:00:00Z");
    var cur = Date.parse(date + "T00:00:00Z");
    return Math.floor((cur - start) / 86400000) + 1;
  }

  function deadlineUtc(date) {
    var parts = date.split("-").map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2], DEADLINE_HOUR + 4, 0, 0);
    function etHour(ms) {
      var bag = {};
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "2-digit",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(ms)).forEach(function (p) {
        if (p.type !== "literal") bag[p.type] = p.value;
      });
      return {
        hour: bag.hour === "24" ? 0 : Number(bag.hour),
        y: Number(bag.year),
        m: Number(bag.month),
        d: Number(bag.day),
      };
    }
    for (var i = 0; i < 6; i++) {
      var got = etHour(utc);
      var deltaDays = Date.UTC(parts[0], parts[1] - 1, parts[2]) - Date.UTC(got.y, got.m - 1, got.d);
      var delta = deltaDays + (DEADLINE_HOUR - got.hour) * 3600000;
      utc += delta;
      if (delta === 0) break;
    }
    return utc;
  }

  function isPastDeadline(date, now) {
    return (now || new Date()).getTime() >= deadlineUtc(date);
  }

  function msUntil(date, now) {
    return deadlineUtc(date) - (now || new Date()).getTime();
  }

  function formatCountdown(ms) {
    if (ms <= 0) return "00:00:00";
    var t = Math.floor(ms / 1000);
    return pad(Math.floor(t / 3600)) + ":" + pad(Math.floor((t % 3600) / 60)) + ":" + pad(t % 60);
  }

  function classify(date, now) {
    var today = todayEt(now);
    if (date > today) return "future-day";
    if (date < today) return "past-day";
    if (isPastDeadline(date, now)) return "after-deadline";
    return "open";
  }

  function dailyCheck(date, now) {
    now = now || new Date();
    var today = todayEt(now);
    var window = classify(date, now);
    var isToday = date === today;
    var checks = [
      { label: "Calendar day", ok: isToday, detail: isToday ? date + " is today (ET)" : date + " is not today" },
      { label: "Not a future day", ok: date <= today, detail: date > today ? "Future packets cannot be filed" : "Not future" },
      { label: "Not a past day", ok: date >= today, detail: date < today ? "Past packets are closed" : "Not past" },
      { label: "Before 10:00 PM ET", ok: window === "open", detail: window === "after-deadline" ? "Daily filing closed at 10:00 PM ET" : isToday ? "Window open until 10:00 PM ET" : "Deadline only applies to today" },
    ];
    var reason =
      window === "future-day" ? "Cannot file a future day."
        : window === "past-day" ? "Cannot file a past day. The packet for that date is closed."
          : window === "after-deadline" ? "Daily filing closed at 10:00 PM ET. File a failure if tonight missed."
            : "Daily filing is open.";
    return { ok: window === "open", window: window, reason: reason, checks: checks, today: today };
  }

  function failCheck(date, now) {
    now = now || new Date();
    var today = todayEt(now);
    var ok = date === today;
    var window = classify(date, now);
    var checks = [
      { label: "Calendar day", ok: ok, detail: ok ? date + " is today (ET)" : date + " is not today" },
      { label: "Not a future day", ok: date <= today, detail: date > today ? "Cannot open a future failure" : "Not future" },
      { label: "Not a past day", ok: date >= today, detail: date < today ? "Cannot open a failure on a closed day" : "Not past" },
    ];
    var reason = ok
      ? window === "after-deadline"
        ? "Deadline passed. A failure may be filed for today only."
        : "Failure filing is open for today."
      : date > today ? "Cannot file a future day." : "Cannot file a past day.";
    return { ok: ok, window: window, reason: reason, checks: checks, today: today };
  }

  function consentCheck(date, now) {
    var today = todayEt(now);
    return {
      ok: true,
      window: "open",
      reason: "Consent filing is open any day. Re-record after every amendment.",
      checks: [
        { label: "Calendar day", ok: true, detail: today + " (ET)" },
        { label: "Filing window", ok: true, detail: "No deadline — consent is amendment-driven, not daily" },
      ],
      today: today,
    };
  }

  function correctiveCheck(date) {
    return {
      ok: true,
      window: "open",
      reason: "Corrective filing is open until the 72-hour deadline on the notice.",
      checks: [
        { label: "Calendar day", ok: true, detail: todayEt() + " (ET)" },
        { label: "Filing window", ok: true, detail: "Within 72 hours of the violation notice (\u00a78.3)" },
        { label: "Recording", ok: true, detail: "Recorded in the assistant \u2014 Corner Time session" },
      ],
      today: todayEt(),
    };
  }

  function ytMeta(type, ctx) {
    var brand = " | Micheal Ray Berry";
    var dayN = pad3(ctx.day);
    var tail =
      "\n\nPublic Accountability Project — 340 to 175 lb, documented daily in public. " +
      "The official record is " + BASE + "/. Recorded through the official Recording Assistant; " +
      "the burned-in verification code and clocks date the footage.\n" +
      "Agreement: " + BASE + "/agreement\nContact: ap@michealrayberry.com";
    if (type === "corrective") {
      var ref = "V-" + pad3(ctx.vNum || 1);
      return {
        title: "Corrective Session — " + ref + " · Level " + (ctx.level || 1) + " Corner Time · " + ctx.date + brand,
        desc: "Corner time recorded in one continuous, unedited take against violation " + ref + "." + tail,
      };
    }
    if (type === "corrective") {
      var vid = (($("cv-id") && $("cv-id").value) || "").trim().toUpperCase() || "V-000";
      return {
        title: "Corrective Session — " + vid + " \u00b7 " + ctx.date + brand,
        desc:
          "Corrective session filed against " + vid + " on the official record of the Micheal Ray Berry " +
          "Public Accountability Project. One continuous take. Unlisted: embedded beside the entry at " +
          "https://michealrayberry.com/violations/" + vid.toLowerCase() + "/" + tail,
      };
    }
    if (type === "consent") {
      return {
        title: "Consent Confirmation — Agreement as amended · " + ctx.date + brand,
        desc:
          "Recorded statement of informed, voluntary consent to the Public Accountability Agreement " +
          "as amended through " + ctx.date + ". Re-recorded after every amendment." + tail,
      };
    }
    return {
      title: "Daily Inspection — Day " + dayN + " · " + ctx.date + brand,
      desc:
        "Standardized four-angle daily inspection for Day " + dayN + " (" + ctx.date + "), " +
        "filed with the day's weight and four documentation photographs.\n" +
        "Day page: " + BASE + "/daily/" + ctx.date + "-day-" + dayN + "/" + tail,
    };
  }

  function isYt(url) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test((url || "").trim());
  }

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function emptyDay(date) {
    return {
      date: date,
      day: dayNumber(date),
      weight: null,
      videoName: null,
      videoBytes: 0,
      photos: 0,
      notes: "",
      youtubeUrl: null,
      youtubeTitle: null,
      youtubeDesc: null,
      takeCount: 0,
      lastTakeAt: null,
      filedAt: null,
      failedAt: null,
    };
  }

  function getDay(date) {
    var all = loadAll();
    return all[date] || emptyDay(date);
  }

  function saveDay(packet) {
    var all = loadAll();
    all[packet.date] = packet;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  }

  function deviceKey() {
    try { return localStorage.getItem("mrb_packet_key") || ""; } catch (e) { return ""; }
  }
  function execUrl() {
    try { return localStorage.getItem("mrb_exec_url") || ""; } catch (e) { return ""; }
  }

  async function postCorrectiveFiled(vId, date, url) {
    var cfg = loadCfg();
    if (!cfg.exec || !cfg.key) return { ok: false };
    var body = new URLSearchParams({
      action: "correctivefiled", key: cfg.key, id: vId, date: date, url: url,
    });
    var r = await fetch(cfg.exec, { method: "POST", body: body });
    return await r.json();
  }

  async function postYtFiled(kind, date, url) {
    var endpoint = execUrl();
    var key = deviceKey();
    if (!endpoint || !key) return { ok: true, local: true };
    var res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "ytfiled", key: key, kind: kind, date: date, url: url }),
    });
    return res.json();
  }

  var mode = "daily";
  var videoFile = null;
  var photoFiles = [];

  function $(id) { return document.getElementById(id); }

  function renderChecks() {
    var date = todayEt();
    var check = mode === "fail" ? failCheck(date)
      : mode === "consent" ? consentCheck(date)
      : mode === "corrective" ? correctiveCheck(date)
      : dailyCheck(date);
    var ul = $("check-list");
    ul.innerHTML = "";
    check.checks.forEach(function (c) {
      var li = document.createElement("li");
      var left = document.createElement("span");
      left.textContent = c.label;
      var right = document.createElement("span");
      right.className = c.ok ? "check-ok" : "check-fail";
      right.textContent = (c.ok ? "Pass" : "Block") + " · " + c.detail;
      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    });
    $("check-reason").textContent = check.reason;
    $("check-reason").style.color = check.ok ? "" : "#B3261E";

    var locked = !check.ok;
    $("yt-file").disabled = locked;
    $("yt-file").textContent = locked && mode === "daily" ? "Filing closed" : "File the link";
    $("packet-panel").hidden = mode === "consent" || mode === "corrective";
    $("corrective-panel").hidden = mode !== "corrective";
    $("yt-url").disabled = locked && mode === "daily";
    $("input-weight").disabled = locked && mode === "daily";
    $("input-video").disabled = locked && mode === "daily";
    $("input-photos").disabled = locked && mode === "daily";
    $("input-notes").disabled = locked && mode === "daily";
    $("btn-file-packet").disabled = locked && mode === "daily";
    $("btn-file-fail").disabled = mode === "fail" && !failCheck(date).ok;
    $("btn-file-fail").hidden = mode !== "fail";
    $("btn-file-packet").hidden = mode === "fail";
    $("fail-panel").hidden = mode !== "fail";
    return check;
  }

  function renderMeta() {
    var date = todayEt();
    var packet = getDay(date);
    var meta = ytMeta(mode === "consent" ? "consent" : mode === "corrective" ? "corrective" : "daily", { date: date, day: packet.day });
    $("yt-title").value = meta.title;
    $("yt-desc").value = meta.desc;
    $("yt-url").value = packet.youtubeUrl || "";
    $("input-weight").value = packet.weight != null ? packet.weight : "";
    $("input-notes").value = packet.notes || "";
    $("filing-day").textContent = date + " · Day " + pad3(packet.day);
    $("take-status").textContent = packet.takeCount
      ? "Take " + packet.takeCount + (packet.videoName ? " · " + packet.videoName : "")
      : "None";
    if (packet.youtubeUrl) $("yt-msg").textContent = "On file: " + packet.youtubeUrl;
  }

  function tick() {
    var date = todayEt();
    var left = msUntil(date);
    $("deadline-countdown").textContent =
      (left <= 0 ? "00:00:00" : formatCountdown(left)) + " to 10 PM ET";
    renderChecks();
  }

  function setMode(next) {
    mode = next;
    $("mode-daily").className = next === "daily" ? "btn btn-primary" : "btn btn-ghost";
    $("mode-consent").className = next === "consent" ? "btn btn-primary" : "btn btn-ghost";
    $("mode-corrective").className = next === "corrective" ? "btn btn-primary" : "btn btn-ghost";
    $("mode-fail").className = next === "fail" ? "btn btn-primary" : "btn btn-ghost";
    renderChecks();
    renderMeta();
  }

  function copyFrom(id, btn) {
    var el = $(id);
    el.select();
    try { navigator.clipboard.writeText(el.value); } catch (e) {
      try { document.execCommand("copy"); } catch (e2) {}
    }
    btn.textContent = "Copied ✓";
    setTimeout(function () { btn.textContent = "Copy"; }, 1600);
  }

  async function fileLink() {
    var date = todayEt();
    var kind = mode === "consent" ? "consent" : mode === "corrective" ? "corrective" : "daily";
    var check = kind === "consent" ? consentCheck(date) : kind === "corrective" ? correctiveCheck(date) : dailyCheck(date);
    var msg = $("yt-msg");
    if (!check.ok) { msg.textContent = check.reason; return; }
    var url = ($("yt-url").value || "").trim();
    if (!isYt(url)) { msg.textContent = "Paste the full YouTube link."; return; }
    if (kind === "corrective") {
      var vId = (($("cv-id") && $("cv-id").value) || "").trim().toUpperCase();
      if (!/^V-\d{3}$/.test(vId)) { msg.textContent = "Enter the violation id as V-001."; return; }
      $("yt-file").disabled = true;
      msg.textContent = "Filing\u2026";
      try {
        var rc = await postCorrectiveFiled(vId, date, url);
        msg.textContent = rc && rc.ok === false
          ? "Local file saved \u2014 server rejected it. Send the link and id to the AP."
          : "Corrective session filed \u2713 \u2014 " + vId + " resolves on submission (\u00a78.2).";
      } catch (e) {
        msg.textContent = "Filing failed \u2014 send the link and id to the AP.";
      }
      $("yt-file").disabled = false;
      return;
    }
    if (kind === "consent") {
      $("yt-file").disabled = true;
      msg.textContent = "Filing…";
      try {
        var r = await postYtFiled("consent", date, url);
        var all = loadAll();
        all.__consent = { url: url, date: date, filedAt: new Date().toISOString() };
        localStorage.setItem(STORE_KEY, JSON.stringify(all));
        msg.textContent = r && r.ok === false
          ? "Local file saved — server rejected the link. Send it to the AP."
          : "Consent confirmation filed \u2713 — the AP attaches it to the agreement page.";
      } catch (e) {
        msg.textContent = "Filing failed — send the link to the AP.";
      }
      $("yt-file").disabled = false;
      return;
    }
    var packet = getDay(date);
    var meta = ytMeta("daily", { date: date, day: packet.day });
    $("yt-file").disabled = true;
    msg.textContent = "Filing…";
    try {
      var remote = await postYtFiled("daily", date, url);
      packet.youtubeUrl = url;
      packet.youtubeTitle = meta.title;
      packet.youtubeDesc = meta.desc;
      packet.filedAt = new Date().toISOString();
      var w = parseFloat($("input-weight").value);
      if (w && !isNaN(w)) packet.weight = w;
      packet.notes = $("input-notes").value || "";
      saveDay(packet);
      msg.textContent = remote && remote.ok === false
        ? "Local file saved — server rejected the link. Send it to the AP."
        : "Filed ✓ — latest link is on this day's packet.";
    } catch (e) {
      msg.textContent = "Filing failed — send the link to the AP.";
    }
    $("yt-file").disabled = false;
    renderMeta();
  }

  function attachVideo(file) {
    var date = todayEt();
    var check = dailyCheck(date);
    if (!check.ok) { $("file-msg").textContent = check.reason; return; }
    videoFile = file;
    var packet = getDay(date);
    var replacing = packet.takeCount > 0;
    packet.takeCount = (packet.takeCount || 0) + 1;
    packet.lastTakeAt = new Date().toISOString();
    packet.videoName = file.name;
    packet.videoBytes = file.size;
    if (replacing) {
      packet.youtubeUrl = null;
      packet.youtubeTitle = null;
      packet.youtubeDesc = null;
      packet.filedAt = null;
    }
    saveDay(packet);
    $("video-status").textContent = replacing
      ? "Take " + packet.takeCount + " replaced the previous take · " + file.name
      : "Take 1 stored · " + file.name;
    $("yt-msg").textContent = replacing ? "Previous YouTube link cleared — file the new posting." : "";
    renderMeta();
  }

  function attachPhotos(list) {
    var date = todayEt();
    if (!dailyCheck(date).ok) return;
    photoFiles = Array.prototype.slice.call(list || []).slice(0, 4);
    var packet = getDay(date);
    packet.photos = photoFiles.length;
    saveDay(packet);
    $("photo-status").textContent = photoFiles.length + "/4 photographs attached (latest replace).";
  }

  function filePacket() {
    var date = todayEt();
    var check = dailyCheck(date);
    if (!check.ok) { $("file-msg").textContent = check.reason; return; }
    var packet = getDay(date);
    var w = parseFloat($("input-weight").value);
    packet.weight = w && !isNaN(w) ? w : packet.weight;
    packet.notes = $("input-notes").value || "";
    packet.filedAt = new Date().toISOString();
    saveDay(packet);
    $("file-msg").textContent = "Packet saved for " + date + ". Latest take is the only take on this day.";
    renderMeta();
  }

  function fileFail() {
    var date = todayEt();
    var check = failCheck(date);
    if (!check.ok) { $("file-msg").textContent = check.reason; return; }
    var picked = Array.prototype.slice.call(document.querySelectorAll("#fail-missed input:checked"))
      .map(function (el) { return el.value; });
    if (!picked.length) { $("file-msg").textContent = "Mark at least one missed requirement."; return; }
    var packet = getDay(date);
    packet.failedAt = new Date().toISOString();
    packet.notes = $("input-notes").value || packet.notes;
    packet.missed = picked;
    saveDay(packet);
    $("file-msg").textContent = "Failure filed for today: " + picked.join(", ") + ".";
  }

  function buildMissed() {
    var wrap = $("fail-missed");
    wrap.innerHTML = "";
    var after = isPastDeadline(todayEt());
    MISSABLE.forEach(function (m) {
      var lab = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.value = m.id;
      if (m.id === "late" && after) box.checked = true;
      lab.appendChild(box);
      lab.appendChild(document.createTextNode(m.label));
      wrap.appendChild(lab);
    });
  }

  function bind() {
    $("mode-daily").addEventListener("click", function () { setMode("daily"); });
    $("mode-consent").addEventListener("click", function () { setMode("consent"); });
    $("mode-corrective").addEventListener("click", function () { setMode("corrective"); });
    if ($("cv-id")) $("cv-id").addEventListener("input", renderMeta);
    $("mode-fail").addEventListener("click", function () { setMode("fail"); });
    $("yt-file").addEventListener("click", function () { fileLink(); });
    $("btn-file-packet").addEventListener("click", filePacket);
    $("btn-file-fail").addEventListener("click", fileFail);
    $("input-video").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) attachVideo(e.target.files[0]);
    });
    $("input-photos").addEventListener("change", function (e) {
      attachPhotos(e.target.files);
    });
    document.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () { copyFrom(b.getAttribute("data-copy"), b); });
    });
    buildMissed();
    renderMeta();
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();
