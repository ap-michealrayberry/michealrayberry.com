(function () {
  "use strict";

  var TZ = "America/New_York";
  var projectStart = "2026-08-31";
  var DEADLINE_HOUR = 22;
  var STORE_KEY = "mrb_file_packet_v1";
  var SEAL_STORE_KEY = "mrb_attestation_seals_v1";
  var BASE = "https://michealrayberry.com";
  var agreementState = { loaded: false, active: false, message: "Checking agreement status…" };
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
    var start = Date.parse(projectStart + "T00:00:00Z");
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

  function inactiveCheck(label) {
    var waiting = !agreementState.loaded;
    return {
      ok: false,
      window: "inactive",
      reason: waiting
        ? "Agreement status is still being checked. Filing remains locked."
        : "The agreement is pending counter-signature. " + label + " is proposed and is not currently due or enforceable.",
      checks: [{
        label: "Agreement execution",
        ok: false,
        detail: waiting ? "Status unavailable" : "Not verified · requirements inactive",
      }],
      today: todayEt(),
    };
  }

  function dailyCheck(date, now) {
    if (!agreementState.active) return inactiveCheck("Daily filing");
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
    if (!agreementState.active) return inactiveCheck("Failure note");
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
        ? "Deadline passed. A private failure note may be saved for today only."
        : "A private failure note may be saved for today."
      : date > today ? "Cannot save a note for a future day." : "Cannot save a note for a past day.";
    return { ok: ok, window: window, reason: reason, checks: checks, today: today };
  }

  function consentCheck(date, now) {
    var today = todayEt(now);
    return {
      ok: true,
      window: "open",
      reason: "A participant statement may be submitted for Accountability Partner review. It is not automatic proof of consent or execution.",
      checks: [
        { label: "Calendar day", ok: true, detail: today + " (ET)" },
        { label: "Review state", ok: true, detail: "Submission remains pending until separately verified" },
      ],
      today: today,
    };
  }

  function supervisionCheck(date) {
    return { ok: false, day: dayNumber(date), reason: 'Public supervision video and archive filing are disabled pending a separate safety and privacy review.', checks: [
      { label: 'Public supervision media', ok: false, detail: 'Feature disabled' },
    ] };
  }

  function correctiveCheck(date) {
    if (!agreementState.active) return inactiveCheck("Corrective filing");
    return {
      ok: true,
      window: "server-verified",
      reason: "The server accepts only the exact open AP assignment identity. A rejected session may be repeated against that same assignment after its initial due date.",
      checks: [
        { label: "Calendar day", ok: true, detail: todayEt() + " (ET)" },
        { label: "Eligibility gate", ok: true, detail: "Assignment and due date checked server-side when filed" },
        { label: "Recording", ok: true, detail: "Recorded in the assistant \u2014 Corner Time session" },
      ],
      today: todayEt(),
    };
  }

  function ytMeta(type, ctx) {
    var brand = " | Micheal Ray Berry";
    var dayN = pad3(ctx.day);
    var tail =
      "\n\nMicheal Ray Berry Public Accountability Project — 340 lb declared start, 200 lb goal, documented daily under his real name from August 31, 2026. " +
      "Every recording is made through the official Recording Assistant with a burned-in day, weight, verification code and date; the Accountability Partner verifies each filing against the record.\n" +
      "The record: " + BASE + "/\nThe agreement: " + BASE + "/agreement\nQuestions or reports: " + BASE + "/observer/ · ap@michealrayberry.com";
    if (type === "supervision") {
      return {
        title: "Evening Supervision — Day " + dayN + " · " + ctx.date + brand,
        desc:
          "Evening Supervision archive for Day " + dayN + " (" + ctx.date + "), 6:00–10:00 PM ET, on a night assigned by the Accountability Partner under §3.4. " +
          "Fixed camera, normal evening activity, published rules. Status is ruled on the record." +
          "\nSupervision: " + BASE + "/live/" + tail,
      };
    }
    if (type === "corrective") {
      var vid = (($("cv-id") && $("cv-id").value) || "").trim().toUpperCase() || "ENTRY REQUIRED";
      return {
        title: "Corrective Session — " + vid + " \u00b7 " + ctx.date + brand,
        desc:
          "Corner time recorded in one continuous unedited take against violation " + vid + ". " +
          "Filed to the record under §8 and published beside the entry once the Accountability Partner accepts it.\n" +
          "Entry: " + BASE + "/violations/" + vid.toLowerCase() + "/\nThe standard: " + BASE + "/corrections/" + tail,
      };
    }
    if (type === "consent") {
      return {
        title: "Recorded Consent Statement · " + ctx.date + brand,
        desc:
          "Micheal Ray Berry's recorded consent to the Public Accountability Project Agreement, made on " + ctx.date + ". " +
          "The statement is read by a synthetic voice while he appears on camera; participation is confirmed by entering the Inspection position and consent by a deliberate nod inside the timed confirmation window. " +
          "Submitted to the Accountability Partner for review; the agreement takes effect only when both signatures and this recording are verified.\n" +
          "Agreement: " + BASE + "/agreement" + tail,
      };
    }
    return {
      title: "Daily Inspection — Day " + dayN + " · " + ctx.date + brand,
      desc:
        "Day " + dayN + " of the record (" + ctx.date + "): the standardized four-angle daily inspection, filed with the day's scale-synced weight and four documentation photographs before the 10:00 PM ET deadline.\n" +
        "Day page: " + BASE + "/daily/" + ctx.date + "-day-" + dayN + "/" + tail,
    };
  }

  function isYt(url) {
    try {
      var raw = (url || "").trim();
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
      serverFiled: null,
      serverFiledAt: null,
      serverFilingError: null,
      failedAt: null,
    };
  }

  function getDay(date) {
    var all = loadAll();
    var packet = all[date] || emptyDay(date);
    packet.day = dayNumber(date);
    return packet;
  }

  function saveDay(packet) {
    var all = loadAll();
    all[packet.date] = packet;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  }

  function correctiveDraftKey(vId, assignmentId, attemptId) {
    return String(vId || "").trim().toUpperCase() + "|" +
      String(assignmentId || "").trim().toUpperCase() + "|" +
      String(attemptId || "").trim().toUpperCase();
  }

  function saveCorrectiveDraft(vId, assignmentId, attemptId, draft) {
    try {
      var all = loadAll();
      if (!all.__correctiveDrafts || typeof all.__correctiveDrafts !== "object") {
        all.__correctiveDrafts = {};
      }
      all.__correctiveDrafts[correctiveDraftKey(vId, assignmentId, attemptId)] = draft;
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
      return true;
    } catch (error) {
      return false;
    }
  }

  function deviceKey() {
    try { return localStorage.getItem("mrb_packet_key") || ""; } catch (e) { return ""; }
  }
  function execUrl() {
    try { return localStorage.getItem("mrb_exec_url") || ""; } catch (e) { return ""; }
  }
  function unlockToken() {
    try { return localStorage.getItem("mrb_unlock_token") || ""; } catch (e) { return ""; }
  }

  function filingSeal(kind, date, ref, assignmentId, attemptId) {
    var key = kind + "|" + date;
    if (kind === "corrective") {
      var canonicalRef = String(ref || "").trim().toUpperCase();
      var canonicalAssignmentId = String(assignmentId || "").trim().toUpperCase();
      var canonicalAttemptId = String(attemptId || "").trim().toUpperCase();
      if (!/^V-[A-F0-9]{12}$/.test(canonicalRef) || !/^C-[A-F0-9]{24}$/.test(canonicalAssignmentId) ||
          !/^A-[A-F0-9]{24}$/.test(canonicalAttemptId)) return "";
      key += "|" + canonicalRef + "|" + canonicalAssignmentId + "|" + canonicalAttemptId;
    }
    try {
      var stored = JSON.parse(localStorage.getItem(SEAL_STORE_KEY) || "{}");
      var seal = String(stored && stored[key] || "").trim().toLowerCase();
      return /^[a-f0-9]{64}$/.test(seal) ? seal : "";
    } catch (error) {
      return "";
    }
  }

  function readCaptureReceipts() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === "undefined") { resolve([]); return; }
      var request;
      try { request = indexedDB.open("mrb_record_queue"); }
      catch (error) { resolve([]); return; }
      request.onupgradeneeded = function () { request.transaction.abort(); };
      request.onerror = request.onblocked = function () { resolve([]); };
      request.onsuccess = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains("sessions")) { db.close(); resolve([]); return; }
        try {
          var tx = db.transaction("sessions", "readonly");
          var records = tx.objectStore("sessions").getAll();
          records.onsuccess = function () { db.close(); resolve(records.result || []); };
          records.onerror = function () { db.close(); resolve([]); };
        } catch (error) { db.close(); resolve([]); }
      };
    });
  }

  async function correctiveCaptureReceipts(ref, assignmentId, attemptId) {
    var candidates = [];
    try {
      var stored = JSON.parse(localStorage.getItem(SEAL_STORE_KEY) || "{}");
      Object.keys(stored).forEach(function (key) {
        var parts = key.split("|");
        if (parts.length !== 5 || parts[0] !== "corrective" || parts[2] !== ref ||
            parts[3] !== assignmentId || parts[4] !== attemptId) return;
        var bucket = stored[key];
        if (typeof bucket === "string") candidates.push({ seal: bucket, date: parts[1] });
        else if (bucket && bucket.version === 2 && bucket.captures) {
          Object.keys(bucket.captures).forEach(function (seal) {
            var capture = bucket.captures[seal] || {};
            candidates.push({ seal: seal, date: parts[1], video_sha256: capture.videoHash,
              sealed_at: capture.sealedAt, code: capture.code });
          });
        }
      });
    } catch (error) { /* IndexedDB remains an independent recovery source. */ }
    (await readCaptureReceipts()).forEach(function (capture) {
      if (capture.kind === "corrective" && capture.vRef === ref &&
          capture.assignmentId === assignmentId && capture.attemptId === attemptId) candidates.push(capture);
    });
    var unique = {};
    candidates.forEach(function (capture) {
      if (/^[a-f0-9]{64}$/.test(String(capture.seal || "")) &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(capture.date || ""))) unique[capture.seal] = capture;
    });
    return Object.keys(unique).map(function (seal) { return unique[seal]; });
  }

  async function loadCorrectiveCaptures() {
    var ref = $("cv-id").value.trim().toUpperCase();
    var assignmentId = $("cv-assignment-id").value.trim().toUpperCase();
    var attemptId = $("cv-attempt-id").value.trim().toUpperCase();
    var select = $("cv-capture");
    var previous = select.value;
    var captures = await correctiveCaptureReceipts(ref, assignmentId, attemptId);
    if ($("cv-id").value.trim().toUpperCase() !== ref ||
        $("cv-assignment-id").value.trim().toUpperCase() !== assignmentId ||
        $("cv-attempt-id").value.trim().toUpperCase() !== attemptId) return [];
    select.replaceChildren();
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = captures.length ? "Choose the take you posted" : "No matching sealed capture found";
    select.appendChild(placeholder);
    captures.forEach(function (capture) {
      var option = document.createElement("option");
      option.value = capture.seal;
      option.dataset.captureDate = capture.date;
      option.textContent = capture.date + " · code " + (capture.code || "—") +
        " · video " + String(capture.video_sha256 || capture.seal).slice(0, 16);
      select.appendChild(option);
    });
    if (captures.some(function (capture) { return capture.seal === previous; })) select.value = previous;
    else if (captures.length === 1) select.value = captures[0].seal;
    renderCorrectiveCaptureMeta();
    return captures;
  }

  function renderCorrectiveCaptureMeta() {
    var option = $("cv-capture").selectedOptions[0];
    var date = option && option.dataset.captureDate;
    if (mode !== "corrective" || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return;
    var meta = ytMeta("corrective", { date: date, day: dayNumber(date) });
    $("yt-title").value = meta.title;
    $("yt-desc").value = meta.desc;
    $("filing-day").textContent = date + " · Day " + pad3(dayNumber(date)) + " · sealed capture";
  }

  async function postCorrectiveFiled(vId, assignmentId, attemptId, date, url, seal) {
    var endpoint = execUrl();
    var key = deviceKey();
    if (!endpoint || !key) return { ok: false, error: "Not configured" };
    var res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "correctivefiled", key: key, unlock: unlockToken(), id: vId,
        assignment_id: assignmentId, attempt_id: attemptId, date: date, url: url, attestation_seal: seal }),
    });
    return res.json();
  }

  async function postYtFiled(kind, date, url, seal) {
    var endpoint = execUrl();
    var key = deviceKey();
    if (!endpoint || !key) return { ok: false, error: "Not configured", local: true };
    var res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "ytfiled", key: key, unlock: unlockToken(), kind: kind, date: date, url: url,
        attestation_seal: seal || "" }),
    });
    return res.json();
  }

  async function postMyState() {
    var endpoint = execUrl();
    var key = deviceKey();
    if (!endpoint || !key) throw new Error("Participant server is not configured");
    var res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "mystate", key: key, unlock: unlockToken() }),
    });
    var state = await res.json();
    if (!state || !state.ok || !/^\d{4}-\d{2}-\d{2}$/.test(String(state.projectStart || "")) ||
        typeof state.agreementActive !== "boolean") {
      throw new Error((state && state.error) || "Participant state is unavailable");
    }
    return state;
  }

  var mode = "daily";
  var videoFile = null;
  var photoFiles = [];

  function $(id) { return document.getElementById(id); }

  async function loadAgreementState() {
    try {
      var responses = await Promise.all([
        fetch("/data/feed-manifest.json", { credentials: "omit", cache: "no-store" }),
        fetch("/data/supervision.json", { credentials: "omit", cache: "no-store" }),
      ]);
      if (!responses[0].ok || !responses[1].ok) throw new Error("status feed unavailable");
      var values = await Promise.all([responses[0].json(), responses[1].json()]);
      var manifest = values[0];
      var supervision = values[1];
      var participantState = await postMyState();
      var stamp = Date.parse(manifest && manifest.published_at || "");
      if (!manifest || manifest.schema_version !== 1 || !isFinite(stamp) || Date.now() - stamp > 48 * 60 * 60 * 1000 || stamp - Date.now() > 5 * 60 * 1000) {
        throw new Error("status feed stale");
      }
      if (!supervision || supervision.schema_version !== 1 || typeof supervision.agreement_active !== "boolean" || supervision.published_at !== manifest.published_at) {
        throw new Error("status feed inconsistent");
      }
      projectStart = String(participantState.projectStart);
      agreementState = {
        loaded: true,
        active: supervision.agreement_active === true && participantState.agreementActive === true,
        message: supervision.agreement_active === true && participantState.agreementActive === true
          ? "Agreement active"
          : "Not verified · requirements inactive",
      };
    } catch (error) {
      agreementState = { loaded: true, active: false, message: "Unavailable · filing locked" };
    }
    if ($("agreement-state")) $("agreement-state").textContent = agreementState.message;
    renderChecks();
    renderMeta();
  }

  function renderChecks() {
    var date = todayEt();
    var check = mode === "fail" ? failCheck(date)
      : mode === "consent" ? consentCheck(date)
      : mode === "corrective" ? correctiveCheck(date)
      : mode === "supervision" ? supervisionCheck(date)
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

    ["mode-daily", "mode-corrective", "mode-fail"].forEach(function (id) {
      if ($(id)) $(id).disabled = !agreementState.active;
    });
    if ($("mode-supervision")) $("mode-supervision").disabled = true;

    var locked = !check.ok;
    $("yt-file").disabled = locked;
    $("yt-file").textContent = locked && mode === "daily" ? "Filing closed" : "File the link";
    $("yt-publish").hidden = mode === "fail" || mode === "supervision";
    $("packet-panel").hidden = mode !== "daily";
    $("corrective-panel").hidden = mode !== "corrective";
    if ($("supervision-panel")) $("supervision-panel").hidden = mode !== "supervision";
    $("yt-url").disabled = locked && mode === "daily";
    $("input-weight").disabled = locked && mode === "daily";
    $("input-video").disabled = locked && mode === "daily";
    $("input-photos").disabled = locked && mode === "daily";
    $("input-notes").disabled = locked && mode === "daily";
    $("btn-file-packet").disabled = locked && mode === "daily";
    $("btn-file-fail").disabled = mode === "fail" && !failCheck(date).ok;
    $("btn-file-fail").hidden = mode !== "fail";
    $("btn-file-packet").hidden = mode !== "daily";
    $("fail-panel").hidden = mode !== "fail";
    return check;
  }

  function renderMeta(preserveStatus) {
    var date = todayEt();
    var packet = getDay(date);
    var all = loadAll();
    var linkRecord = packet;
    if (mode === "consent") {
      linkRecord = all.__consent || {};
    } else if (mode === "corrective") {
      var correctiveId = (($("cv-id") && $("cv-id").value) || "").trim().toUpperCase();
      var correctiveAssignmentId = (($("cv-assignment-id") && $("cv-assignment-id").value) || "").trim().toUpperCase();
      var correctiveAttemptId = (($("cv-attempt-id") && $("cv-attempt-id").value) || "").trim().toUpperCase();
      linkRecord = (all.__correctiveDrafts &&
        all.__correctiveDrafts[correctiveDraftKey(correctiveId, correctiveAssignmentId, correctiveAttemptId)]) || {};
    }
    var meta = ytMeta(mode === "consent" ? "consent" : mode === "corrective" ? "corrective" : mode === "supervision" ? "supervision" : "daily", { date: date, day: packet.day });
    $("yt-title").value = meta.title;
    $("yt-desc").value = meta.desc;
    $("yt-url").value = linkRecord.url || linkRecord.youtubeUrl || "";
    $("input-weight").value = packet.weight != null ? packet.weight : "";
    $("input-notes").value = packet.notes || "";
    $("filing-day").textContent = date + " · Day " + pad3(packet.day);
    $("take-status").textContent = packet.takeCount
      ? "Take " + packet.takeCount + (packet.videoName ? " · " + packet.videoName : "")
      : "None";
    if (!preserveStatus) {
      var savedUrl = linkRecord.url || linkRecord.youtubeUrl || "";
      if (!savedUrl) {
        $("yt-msg").textContent = "";
      } else if (linkRecord.serverFiled === true) {
        $("yt-msg").textContent = "Server filing accepted: " + savedUrl;
      } else if (linkRecord.serverFiled === false) {
        $("yt-msg").textContent = "Saved locally on this device; not accepted by the server: " + savedUrl;
      } else {
        $("yt-msg").textContent = "Saved locally on this device; server filing status is unknown: " + savedUrl;
      }
    }
  }

  function tick() {
    var date = todayEt();
    var left = msUntil(date);
    $("deadline-countdown").textContent = agreementState.active
      ? (left <= 0 ? "00:00:00" : formatCountdown(left)) + " to 10 PM ET"
      : "Proposed · not currently due";
    renderChecks();
  }

  function setMode(next) {
    mode = next;
    $("mode-daily").className = next === "daily" ? "btn btn-primary" : "btn btn-ghost";
    $("mode-consent").className = next === "consent" ? "btn btn-primary" : "btn btn-ghost";
    $("mode-corrective").className = next === "corrective" ? "btn btn-primary" : "btn btn-ghost";
    $("mode-fail").className = next === "fail" ? "btn btn-primary" : "btn btn-ghost";
    if ($("mode-supervision")) $("mode-supervision").className = next === "supervision" ? "btn btn-primary" : "btn btn-ghost";
    document.querySelectorAll('[data-mode]').forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-mode') === next ? 'true' : 'false');
    });
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
    var kind = mode === "consent" ? "consent" : mode === "corrective" ? "corrective" : mode === "supervision" ? "supervision" : "daily";
    var check = kind === "consent" ? consentCheck(date) : kind === "corrective" ? correctiveCheck(date) : kind === "supervision" ? supervisionCheck(date) : dailyCheck(date);
    var msg = $("yt-msg");
    if (!check.ok) { msg.textContent = check.reason; return; }
    var url = ($("yt-url").value || "").trim();
    if (!isYt(url)) { msg.textContent = "Paste the full YouTube link."; return; }
    if (kind === "supervision") {
      $("yt-file").disabled = true;
      msg.textContent = "Filing\u2026";
      try {
        var rs = await postYtFiled("supervision", date, url);
        msg.textContent = rs && rs.ok === false
          ? "Server rejected the link \u2014 send it to the AP before 10:20 PM."
          : "Evening Supervision archive submitted — awaiting Accountability Partner review.";
      } catch (e) {
        msg.textContent = "Filing failed \u2014 send the link to the AP before 10:20 PM.";
      }
      $("yt-file").disabled = false;
      return;
    }
    if (kind === "corrective") {
      var vId = (($("cv-id") && $("cv-id").value) || "").trim().toUpperCase();
      if (!/^V-[0-9A-F]{12}$/.test(vId)) {
        msg.textContent = "Enter the opaque AP-issued id from the recorded session, such as V-A1B2C3D4E5F6.";
        return;
      }
      var assignmentId = (($("cv-assignment-id") && $("cv-assignment-id").value) || "").trim().toUpperCase();
      if (!/^C-[0-9A-F]{24}$/.test(assignmentId)) {
        msg.textContent = "Enter the opaque assignment id from the recorded session, such as C-00112233445566778899AABB.";
        return;
      }
      var attemptId = (($("cv-attempt-id") && $("cv-attempt-id").value) || "").trim().toUpperCase();
      if (!/^A-[0-9A-F]{24}$/.test(attemptId)) {
        msg.textContent = "Enter the current attempt id from the recorded session, such as A-00112233445566778899AABB.";
        return;
      }
      var captures = await loadCorrectiveCaptures();
      var capture = captures.find(function (candidate) { return candidate.seal === $("cv-capture").value; });
      var correctiveSeal = capture ? capture.seal : "";
      if (capture) date = capture.date;
      if (!correctiveSeal) {
        saveCorrectiveDraft(vId, assignmentId, attemptId, { url: url, date: date, attemptedAt: new Date().toISOString(),
          serverFiled: false, serverFiledAt: null,
          serverFilingError: "No exact attestation seal is available for this recorded corrective context" });
        msg.textContent = captures.length
          ? "Choose the matching sealed take above, then file its public link."
          : "Not filed. No matching sealed capture was found on this device.";
        return;
      }
      $("yt-file").disabled = true;
      msg.textContent = "Filing\u2026";
      try {
        var rc = await postCorrectiveFiled(vId, assignmentId, attemptId, date, url, correctiveSeal);
        var correctiveAccepted = !!(rc && rc.ok === true);
        saveCorrectiveDraft(vId, assignmentId, attemptId, {
          url: url,
          date: date,
          attemptedAt: new Date().toISOString(),
          serverFiled: correctiveAccepted,
          serverFiledAt: correctiveAccepted ? new Date().toISOString() : null,
          serverFilingError: correctiveAccepted ? null : String(rc && rc.error || "Server did not confirm the filing"),
        });
        msg.textContent = correctiveAccepted
          ? rc.status === "resolved" ? "Already filed — " + vId + " is resolved."
            : rc.status === "completed-awaiting-resolution" ? "Already filed — assignment completed; source resolution is pending."
              : "Corrective session submitted \u2713 \u2014 " + vId + " awaits AP verification."
          : "The server rejected the link. Send the link and all three opaque ids to the AP.";
      } catch (e) {
        saveCorrectiveDraft(vId, assignmentId, attemptId, {
          url: url,
          date: date,
          attemptedAt: new Date().toISOString(),
          serverFiled: false,
          serverFiledAt: null,
          serverFilingError: e && e.message ? e.message : "Filing request failed",
        });
        msg.textContent = "Filing failed. Send the link and all three opaque ids to the AP.";
      }
      $("yt-file").disabled = false;
      return;
    }
    if (kind === "consent") {
      $("yt-file").disabled = true;
      msg.textContent = "Filing…";
      try {
        var r = await postYtFiled("consent", date, url);
        var consentAccepted = !!(r && r.ok === true);
        var all = loadAll();
        all.__consent = {
          url: url,
          date: date,
          attemptedAt: new Date().toISOString(),
          serverFiled: consentAccepted,
          serverFiledAt: consentAccepted ? new Date().toISOString() : null,
          serverFilingError: consentAccepted ? null : String(r && r.error || "Server did not confirm the filing"),
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(all));
        msg.textContent = consentAccepted
          ? "Participant statement submitted — awaiting separate Accountability Partner verification."
          : "Saved locally on this device; the server rejected the link. Send it to the AP.";
      } catch (e) {
        var failedConsent = loadAll();
        failedConsent.__consent = {
          url: url,
          date: date,
          attemptedAt: new Date().toISOString(),
          serverFiled: false,
          serverFiledAt: null,
          serverFilingError: e && e.message ? e.message : "Filing request failed",
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(failedConsent));
        msg.textContent = "Saved locally on this device; filing failed. Send the link to the AP.";
      }
      $("yt-file").disabled = false;
      return;
    }
    var packet = getDay(date);
    var meta = ytMeta("daily", { date: date, day: packet.day });
    var dailySeal = filingSeal("daily", date);
    if (!dailySeal) {
      packet.youtubeUrl = url;
      packet.youtubeTitle = meta.title;
      packet.youtubeDesc = meta.desc;
      packet.filedAt = new Date().toISOString();
      packet.serverFiled = false;
      packet.serverFiledAt = null;
      packet.serverFilingError = "No exact same-day daily attestation seal is available";
      saveDay(packet);
      msg.textContent = "Saved locally only. Complete and seal today's daily capture in the assistant before server filing.";
      renderMeta(true);
      return;
    }
    $("yt-file").disabled = true;
    msg.textContent = "Filing…";
    try {
      var remote = await postYtFiled("daily", date, url, dailySeal);
      var dailyAccepted = !!(remote && remote.ok === true);
      packet.youtubeUrl = url;
      packet.youtubeTitle = meta.title;
      packet.youtubeDesc = meta.desc;
      packet.filedAt = new Date().toISOString();
      packet.serverFiled = dailyAccepted;
      packet.serverFiledAt = dailyAccepted ? new Date().toISOString() : null;
      packet.serverFilingError = dailyAccepted ? null : String(remote && remote.error || "Server did not confirm the filing");
      var w = parseFloat($("input-weight").value);
      if (w && !isNaN(w)) packet.weight = w;
      packet.notes = $("input-notes").value || "";
      saveDay(packet);
      msg.textContent = dailyAccepted
        ? "Filed ✓ — the server accepted this day's public link."
        : "Saved locally on this device; the server rejected the link. Send it to the AP.";
    } catch (e) {
      packet.youtubeUrl = url;
      packet.youtubeTitle = meta.title;
      packet.youtubeDesc = meta.desc;
      packet.filedAt = new Date().toISOString();
      packet.serverFiled = false;
      packet.serverFiledAt = null;
      packet.serverFilingError = e && e.message ? e.message : "Filing request failed";
      saveDay(packet);
      msg.textContent = "Saved locally on this device; filing failed. Send the link to the AP.";
    }
    $("yt-file").disabled = false;
    renderMeta(true);
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
      packet.serverFiled = null;
      packet.serverFiledAt = null;
      packet.serverFilingError = null;
    }
    saveDay(packet);
    $("video-status").textContent = replacing
      ? "Take " + packet.takeCount + " selected on this page · " + file.name
      : "Take 1 selected on this page · " + file.name;
    $("yt-msg").textContent = replacing ? "Previous YouTube link cleared — file the new posting." : "";
    renderMeta(true);
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
    $("file-msg").textContent = "Packet details saved on this device for " + date + ". No media or packet was uploaded.";
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
    $("file-msg").textContent = "Private failure note saved on this device: " + picked.join(", ") + ". No violation was opened.";
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
    if ($("cv-assignment-id")) $("cv-assignment-id").addEventListener("input", renderMeta);
    if ($("cv-attempt-id")) $("cv-attempt-id").addEventListener("input", renderMeta);
    $("cv-load-captures").addEventListener("click", function () {
      loadCorrectiveCaptures().catch(function () { $("yt-msg").textContent = "Unable to load local capture receipts."; });
    });
    $("cv-capture").addEventListener("change", renderCorrectiveCaptureMeta);
    $("mode-fail").addEventListener("click", function () { setMode("fail"); });
    if ($("mode-supervision")) $("mode-supervision").addEventListener("click", function () { setMode("supervision"); });
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
    loadAgreementState();
    setInterval(tick, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();
