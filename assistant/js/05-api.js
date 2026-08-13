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
    var res = await fetch(url, { method: "GET", credentials: "omit" });
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
    if (!c.execUrl) {
      return mockPost(body);
    }
    var res = await fetch(c.execUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
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
    if (action === "packet" || action === "apweekly" || action === "apconfirmation") {
      return Promise.resolve({ ok: true, demo: true });
    }
    return Promise.resolve({ ok: false, error: "Unknown mock action " + action });
  }

  async function challenge(kind) {
    var c = cfg();
    var key = ensureKey();
    var k = MRB.config.KIND_MAP[kind] || kind;
    if (!c.execUrl) {
      mockIssued += 1;
      var code = String(1000 + (mockIssued % 9000));
      return {
        ok: true,
        code: code,
        day: mockDay,
        issuedAt: new Date().toISOString(),
        demo: true,
      };
    }
    var data = await postJson({ action: "challenge", key: key, kind: k });
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Challenge request failed");
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

  async function apweekly(payload) {
    var key = ensureKey();
    return postJson(Object.assign({ action: "apweekly", key: key }, payload));
  }

  async function apconfirmation(payload) {
    var key = ensureKey();
    return postJson(Object.assign({ action: "apconfirmation", key: key }, payload));
  }

  async function fetchSheetCsv(sheetName) {
    var c = cfg();
    if (!c.sheetId) {
      return mockSheet(sheetName);
    }
    var url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(c.sheetId) +
      "/gviz/tq?tqx=out:csv&sheet=" +
      encodeURIComponent(sheetName);
    var res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error("Sheet fetch failed: " + sheetName + " (" + res.status + ")");
    return res.text();
  }

  function mockSheet(sheetName) {
    if (sheetName === "Weigh-ins" || sheetName.indexOf("Weigh") === 0) {
      return Promise.resolve(
        "date,weight_lb,note,photo_front,photo_left,photo_rear,photo_right,video\n" +
          "2026-08-15,338.2,,,,,,\n" +
          "8/14/2026,339.0,,,,,,\n" +
          "2026-08-13,340.0,,,,,,\n"
      );
    }
    // Violation Log with mixed date formats + open entries
    return Promise.resolve(
      "date,violation,status,submitted,resolved,ap_verification,corrections\n" +
        "2026-08-20,Missed inspection,open,2026-08-20,,,\n" +
        "8/18/2026,Late packet,confirmed — corrective assigned,8/18/2026,,,\n" +
        "2026-08-15,Missed photos,resolved — verified,2026-08-15,2026-08-16,,\n"
    );
  }

  async function loadRecord() {
    var weighText = await fetchSheetCsv("Weigh-ins");
    var violText = await fetchSheetCsv("Violation Log");
    return {
      weighIns: MRB.csv.parseWeighIns(weighText),
      violations: MRB.csv.parseViolationLog(violText),
    };
  }

  async function pingServer() {
    var c = cfg();
    if (!c.execUrl) {
      return { ok: true, demo: true, message: "Demo mode (no exec URL)" };
    }
    if (!c.deviceKey) {
      return { ok: false, message: "Device key not set" };
    }
    try {
      // Lightweight probe: challenge for demo kind
      var ch = await challenge("demo");
      return { ok: !!ch.ok, message: ch.ok ? "Server accepted device key" : "Rejected", challenge: ch };
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
    apweekly: apweekly,
    apconfirmation: apconfirmation,
    loadRecord: loadRecord,
    fetchSheetCsv: fetchSheetCsv,
    pingServer: pingServer,
    buildR2SignBody: buildR2SignBody,
    readUploadUrl: readUploadUrl,
    postJson: postJson,
  };
})(window.MRB);
