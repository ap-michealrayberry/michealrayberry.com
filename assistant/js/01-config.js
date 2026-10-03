(function (MRB) {
  "use strict";

  try {
    localStorage.removeItem("mrb_packet_key"); localStorage.removeItem("mrb_exec_url");
    if (localStorage.getItem("mrb_unlock_token") !== "SERVER-SESSION") {
      localStorage.removeItem("mrb_unlock_token"); localStorage.removeItem("mrb_unlock_until");
    }
  } catch (e) {}
  var PROJECT = {"schemaVersion":1,"edition":2,"person":"Micheal Ray Berry","siteOrigin":"https://michealrayberry.com","startDate":"2026-10-11","testStartDate":"2026-10-03","startWeightLb":340,"goalWeightLb":200,"completionDays":28,"milestonesLb":[320,300,275,250,225,200],"deadlineEt":"22:00","supervision":{"section":"3.4","startDate":"2026-10-11","nights":[0,1,2,3,4],"startEt":"18:00","endEt":"22:00","publicLiveEnabled":true,"twitchChannel":"michealrayberry"},"amendmentSection":"12.1","correctionMinutes":[10,20,30]};

  var STORAGE = {
    unlockToken: "mrb_unlock_token",
    unlockUntil: "mrb_unlock_until",
    deviceKey: "mrb_packet_key",
    execUrl: "mrb_exec_url",
    demoMode: "mrb_demo_mode",
    elKey: "mrb_el_key",
    elVoice: "mrb_el_voice",
  };

  var DEFAULT_EL_VOICE = "pNInz6obpgDQGcFmaJgB";

  /** Fixed capture geometry — portrait phone only. No landscape mode. */
  var ORIENTATION = "portrait";
  var CANVAS_W = 1080;
  var CANVAS_H = 1920;
  var TOP_BAND = 85;
  var BOTTOM_BAND = 85;

  var SESSION_TAGS = {
    daily: "DAILY INSPECTION",
    corrective: "CORRECTIVE SESSION",
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
      deviceKey: "SERVER-MANAGED",
      execUrl: "/api/assistant",
      elKey: readStorage(STORAGE.elKey, ""),
      elVoice: readStorage(STORAGE.elVoice, DEFAULT_EL_VOICE) || DEFAULT_EL_VOICE,
      demoMode: readStorage(STORAGE.demoMode, "") === "enabled",
    };
  }

  function saveConfig(partial) {
    try { localStorage.removeItem(STORAGE.deviceKey); localStorage.removeItem(STORAGE.execUrl); } catch (e) {}
    
    if (partial.demoMode !== undefined) writeStorage(STORAGE.demoMode, partial.demoMode ? "enabled" : "");
    if (partial.elKey !== undefined) writeStorage(STORAGE.elKey, partial.elKey);
    if (partial.elVoice !== undefined) writeStorage(STORAGE.elVoice, partial.elVoice || DEFAULT_EL_VOICE);
    return getConfig();
  }

  /** External origins the app may fetch — for CSP tests. */
  var EXTERNAL_ORIGINS = [
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    "https://storage.googleapis.com",
    "https://api.elevenlabs.io",
    "blob:",
  ];

  MRB.config = {
    PROJECT: PROJECT,
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
