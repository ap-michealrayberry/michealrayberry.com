(function (MRB) {
  "use strict";

  var STORAGE = {
    deviceKey: "mrb_packet_key",
    execUrl: "mrb_exec_url",
    sheetId: "mrb_sheet_id",
    elKey: "mrb_el_key",
    elVoice: "mrb_el_voice",
  };

  var DEFAULT_EL_VOICE = "pNInz6obpgDQGcFmaJgB";

  /** Fixed capture geometry — portrait phone only. No landscape mode. */
  var ORIENTATION = "portrait";
  var CANVAS_W = 720;
  var CANVAS_H = 1280;
  var TOP_BAND = 85;
  var BOTTOM_BAND = 85;

  var SESSION_TAGS = {
    daily: "DAILY INSPECTION",
    corrective: "CORNER TIME",
    weekly: "WEEKLY REVIEW",
    confirmation: "CONFIRMATION",
    demo: "DEMONSTRATION",
    announcement: "PROJECT ANNOUNCEMENT",
  };

  var KIND_MAP = {
    daily: "daily",
    corrective: "corrective",
    weekly: "weekly",
    confirmation: "confirmation",
    demo: "demo",
    announcement: "announcement",
  };

  /** Level → minutes for corner time. Level capped at 3. */
  function cornerMinutes(level) {
    var n = Math.max(1, Math.min(3, level | 0));
    if (n === 1) return 10;
    if (n === 2) return 20;
    return 30;
  }

  function readStorage(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null || v === "" ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      if (value == null || value === "") localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function getConfig() {
    return {
      deviceKey: readStorage(STORAGE.deviceKey, ""),
      execUrl: readStorage(STORAGE.execUrl, ""),
      sheetId: readStorage(STORAGE.sheetId, ""),
      elKey: readStorage(STORAGE.elKey, ""),
      elVoice: readStorage(STORAGE.elVoice, DEFAULT_EL_VOICE) || DEFAULT_EL_VOICE,
      demoMode: !readStorage(STORAGE.execUrl, ""),
    };
  }

  function saveConfig(partial) {
    if (partial.deviceKey !== undefined) writeStorage(STORAGE.deviceKey, partial.deviceKey);
    if (partial.execUrl !== undefined) writeStorage(STORAGE.execUrl, partial.execUrl);
    if (partial.sheetId !== undefined) writeStorage(STORAGE.sheetId, partial.sheetId);
    if (partial.elKey !== undefined) writeStorage(STORAGE.elKey, partial.elKey);
    if (partial.elVoice !== undefined) writeStorage(STORAGE.elVoice, partial.elVoice || DEFAULT_EL_VOICE);
    return getConfig();
  }

  /** External origins the app may fetch — for CSP tests. */
  var EXTERNAL_ORIGINS = [
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    "https://cdn.jsdelivr.net",
    "https://storage.googleapis.com",
    "https://api.elevenlabs.io",
    "https://docs.google.com",
    "blob:",
  ];

  MRB.config = {
    STORAGE: STORAGE,
    DEFAULT_EL_VOICE: DEFAULT_EL_VOICE,
    ORIENTATION: ORIENTATION,
    CANVAS_W: CANVAS_W,
    CANVAS_H: CANVAS_H,
    TOP_BAND: TOP_BAND,
    BOTTOM_BAND: BOTTOM_BAND,
    SESSION_TAGS: SESSION_TAGS,
    KIND_MAP: KIND_MAP,
    EXTERNAL_ORIGINS: EXTERNAL_ORIGINS,
    cornerMinutes: cornerMinutes,
    get: getConfig,
    save: saveConfig,
    readStorage: readStorage,
    writeStorage: writeStorage,
  };
})(window.MRB);
