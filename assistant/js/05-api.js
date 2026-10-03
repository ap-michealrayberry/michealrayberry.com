(function (MRB) {
  "use strict";

  var mockDay = 20;
  var mockIssued = 0;

  function cfg() {
    return MRB.config.get();
  }

  function ensureKey() {
    var c = cfg();
    if (!c.deviceKey && !c.demoMode) {
      throw new Error("Device key missing. Set mrb_packet_key in configuration.");
    }
    return c.deviceKey || "demo-key";
  }

  async function getJson(url) {
    var res = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store" });
    var text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Non-JSON response from server (" + res.status + ")");
    }
  }

  /**
   * POST JSON to Apps Script. Field names are load-bearing:
   * - r2sign sends `mime` (not contentType)
   * - response uses `uploadUrl` (not url)
   */
  async function postJson(body) {
    var c = cfg();
    var payload = Object.assign({}, body || {});
    if (payload.action !== "unlock") {
      try {
        var unlock = localStorage.getItem("mrb_unlock_token") || "";
        if (unlock) payload.unlock = unlock;
      } catch (e) {
        /* Storage can be unavailable in private browsing; the server fails closed. */
      }
    }
    if (c.demoMode) {
      return mockPost(payload);
    }
    if (!c.execUrl) throw new Error("Apps Script exec URL missing; offline demo was not explicitly enabled");
    var res = await fetch(c.execUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      credentials: "omit",
      redirect: "follow",
    });
    var text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Non-JSON response from exec (" + res.status + "): " + text.slice(0, 120));
    }
  }

  function mockPost(body) {
    var action = body.action;
    if (action === "unlock") {
      return Promise.resolve({
        ok: true,
        token: "DEMO-UNLOCK-TOKEN",
        expires: 4102444799000,
        demo: true,
      });
    }
    if (action === "attest") {
      return Promise.resolve({
        ok: true,
        status: "VALID — demo seal (no server)",
        seal: "DEMO-SEAL-" + (body.code || "0000"),
        sealed_at: new Date().toISOString(),
      });
    }
    if (action === "r2sign") {
      // Field name contract: mime in, uploadUrl out
      var mime = body.mime || "application/octet-stream";
      return Promise.resolve({
        ok: true,
        uploadUrl: "https://example.invalid/demo-upload?mime=" + encodeURIComponent(mime),
        publicUrl: "https://example.invalid/demo/" + (body.kind || "x") + "/" + (body.date || "d"),
        objectKey: "demo/" + (body.kind || "x") + "/" + (body.date || "d"),
        demo: true,
      });
    }
    if (action === "mystate") {
      return Promise.resolve({
        ok: true,
        projectStart: "2026-08-31",
        agreementActive: false,
        corrective: [],
        weekly: {
          eligible: false,
          reason: "Offline demonstration cannot activate agreement-gated sessions.",
          date: "",
          day: 0,
          week: 0,
        },
        demo: true,
      });
    }
    if (action === "packet" || action === "weeklyfiled" || action === "confirmationfiled" || action === "ping" || action === "challenge" || action === "ytfiled" || action === "correctivefiled") {
      return Promise.resolve({ ok: true, demo: true, code: action === "challenge" ? "1001" : undefined });
    }
    return Promise.resolve({ ok: false, error: "Unknown mock action " + action });
  }

  async function challenge(kind, ref, assignmentId, attemptId) {
    var c = cfg();
    var key = ensureKey();
    var k = MRB.config.KIND_MAP[kind] || kind;
    if (c.demoMode) {
      if (k !== "demo") throw new Error("Offline demo permits only the demonstration session");
      mockIssued += 1;
      var code = String(1000 + (mockIssued % 9000));
      return {
        ok: true,
        code: code,
        day: mockDay,
        issuedAt: new Date().toISOString(),
        weight: 331.4, // offline stand-in for the scale-synced figure
        demo: true,
      };
    }
    if (!c.execUrl) throw new Error("Apps Script exec URL missing");
    var body = { action: "challenge", key: key, kind: k };
    if (k === "corrective") {
      body.ref = String(ref || "").trim().toUpperCase();
      body.assignment_id = String(assignmentId || "").trim().toUpperCase();
      body.attempt_id = String(attemptId || "").trim().toUpperCase();
      if (!/^V-[A-F0-9]{12}$/.test(body.ref) || !/^C-[A-F0-9]{24}$/.test(body.assignment_id) ||
          !/^A-[A-F0-9]{24}$/.test(body.attempt_id)) {
        throw new Error("Corrective assignment or attempt identity is incomplete");
      }
    }
    var data = await postJson(body);
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Challenge request failed");
    }
    if (k === "corrective" &&
        (String(data.ref || "").trim().toUpperCase() !== body.ref ||
         String(data.assignment_id || "").trim().toUpperCase() !== body.assignment_id ||
         String(data.attempt_id || "").trim().toUpperCase() !== body.attempt_id)) {
      throw new Error("Challenge response does not match the selected corrective assignment");
    }
    return data;
  }

  async function attest(payload) {
    var key = ensureKey();
    var body = Object.assign({ action: "attest", key: key }, payload);
    var data = await postJson(body);
    if (!data || !data.ok) {
      throw new Error((data && (data.error || data.status)) || "Attestation failed");
    }
    return data;
  }

  /**
   * Presigned upload. MUST send `mime`, MUST read `uploadUrl`.
   */
  async function r2sign(kind, date, mime) {
    var key = ensureKey();
    var body = {
      action: "r2sign",
      key: key,
      kind: kind,
      date: date,
      mime: mime, // NOT contentType
    };
    var data = await postJson(body);
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "r2sign failed");
    }
    if (!data.uploadUrl) {
      throw new Error("r2sign response missing uploadUrl (do not read url)");
    }
    return data;
  }

  async function packet(payload) {
    var key = ensureKey();
    var body = Object.assign({ action: "packet", key: key }, payload);
    var data = await postJson(body);
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Packet filing failed");
    }
    return data;
  }

  async function weeklyfiled(payload) {
    var key = ensureKey();
    var data = await postJson(Object.assign({ action: "weeklyfiled", key: key }, payload));
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Weekly filing failed");
    }
    return data;
  }

  async function confirmationfiled(payload) {
    var key = ensureKey();
    var data = await postJson(Object.assign({ action: "confirmationfiled", key: key }, payload));
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Confirmation filing failed");
    }
    return data;
  }

  async function myState() {
    var key = ensureKey();
    var data = await postJson({ action: "mystate", key: key });
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Participant state request failed");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.projectStart || "")) ||
        typeof data.agreementActive !== "boolean" || !Array.isArray(data.corrective) ||
        !data.weekly || typeof data.weekly.eligible !== "boolean") {
      throw new Error("Participant state response is incomplete");
    }
    return data;
  }

  async function fetchSheetCsv(sheetName) {
    var feeds = {
      "Weigh-ins": "/data/weigh-ins.csv",
      "Violation Log": "/data/violations.csv",
    };
    var expected = {
      "Weigh-ins": ["date", "weight_lb", "note", "photo_front", "photo_left", "photo_rear", "photo_right", "video", "published_at"],
      "Violation Log": ["id", "date", "violation", "status", "submitted", "resolved", "ap_verification", "corrections", "recording", "published_at"],
    };
    var url = feeds[sheetName];
    if (!url) throw new Error("Unknown public record feed: " + sheetName);
    var res = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("Public record feed failed: " + sheetName + " (" + res.status + ")");
    var text = await res.text();
    var rows = MRB.csv.parseCsv(text);
    var header = (rows[0] || []).map(function (value) { return String(value || "").trim().toLowerCase(); });
    if (header.length !== expected[sheetName].length || expected[sheetName].some(function (value, index) { return header[index] !== value; })) {
      throw new Error("Public record feed schema mismatch: " + sheetName);
    }
    if (rows.length > 1) {
      var publishedIndex = header.indexOf("published_at");
      var stamp = Date.parse(String(rows[1][publishedIndex] || ""));
      if (!isFinite(stamp) || Date.now() - stamp > 48 * 60 * 60 * 1000 || stamp - Date.now() > 5 * 60 * 1000) {
        throw new Error("Public record feed is stale: " + sheetName);
      }
    }
    return text;
  }

  async function loadRecord() {
    var manifest = await getJson("/data/feed-manifest.json");
    var published = Date.parse(manifest && manifest.published_at || "");
    if (!manifest || manifest.schema_version !== 1 || !isFinite(published) || Date.now() - published > 48 * 60 * 60 * 1000 || published - Date.now() > 5 * 60 * 1000) {
      throw new Error("Public record feed manifest is missing or stale");
    }
    var results = await Promise.all([
      fetchSheetCsv("Weigh-ins"),
      fetchSheetCsv("Violation Log"),
      getJson("/data/supervision.json"),
    ]);
    var weighText = results[0];
    var violText = results[1];
    var supervision = results[2];
    if (!supervision || supervision.schema_version !== 1 || typeof supervision.agreement_active !== "boolean" || supervision.published_at !== manifest.published_at) {
      throw new Error("Agreement status feed is missing or inconsistent");
    }
    return {
      weighIns: MRB.csv.parseWeighIns(weighText),
      violations: MRB.csv.parseViolationLog(violText),
      agreementActive: supervision.agreement_active === true,
    };
  }

  async function pingServer() {
    var c = cfg();
    if (c.demoMode) return { ok: true, demo: true, message: "Explicit offline demonstration" };
    if (!c.execUrl) return { ok: false, message: "Apps Script exec URL not set" };
    if (!c.deviceKey) {
      return { ok: false, message: "Device key not set" };
    }
    try {
      var data = await postJson({ action: "ping", key: c.deviceKey });
      if (data && data.ok) {
        return { ok: true, message: "Server accepted device key" };
      }
      return { ok: false, message: (data && data.error) || "Rejected" };
    } catch (e) {
      return { ok: false, message: e.message || String(e) };
    }
  }

  /** Build the exact r2sign request body — used by field-name tests. */
  function buildR2SignBody(key, kind, date, mime) {
    return { action: "r2sign", key: key, kind: kind, date: date, mime: mime };
  }

  function readUploadUrl(response) {
    return response && response.uploadUrl;
  }

  MRB.api = {
    challenge: challenge,
    attest: attest,
    r2sign: r2sign,
    packet: packet,
    weeklyfiled: weeklyfiled,
    confirmationfiled: confirmationfiled,
    myState: myState,
    loadRecord: loadRecord,
    fetchSheetCsv: fetchSheetCsv,
    pingServer: pingServer,
    buildR2SignBody: buildR2SignBody,
    readUploadUrl: readUploadUrl,
    postJson: postJson,
  };
})(window.MRB);
