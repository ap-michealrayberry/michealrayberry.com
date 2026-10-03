(function (MRB) {
  "use strict";

  /**
   * Pose monitor — DISABLED for now.
   * Stub keeps the API so session/preflight code does not throw.
   * Re-enable by restoring MediaPipe sampling when ready.
   */
  var ENABLED = false;
  var lastStatus = {
    ok: true,
    text: "",
    tone: "ok",
    attireNote: "",
    disabled: true,
  };

  async function load() {
    return true;
  }

  function isReady() {
    return true;
  }

  function getLoadError() {
    return null;
  }

  function reset() {
    lastStatus = {
      ok: true,
      text: "",
      tone: "ok",
      attireNote: "",
      disabled: true,
    };
  }

  function setMode() {
    /* no-op while disabled */
  }

  function setHandlers() {
    /* no-op while disabled */
  }

  function sample() {
    return lastStatus;
  }

  function startSampling() {
    /* no-op while disabled */
  }

  function stopSampling() {
    /* no-op while disabled */
  }

  function getStatus() {
    return lastStatus;
  }

  function getWarnings() {
    return 0;
  }

  function evaluate() {
    return { issues: [], attireNote: "" };
  }

  MRB.pose = {
    ENABLED: ENABLED,
    load: load,
    isReady: isReady,
    getLoadError: getLoadError,
    reset: reset,
    setMode: setMode,
    setHandlers: setHandlers,
    sample: sample,
    startSampling: startSampling,
    stopSampling: stopSampling,
    getStatus: getStatus,
    getWarnings: getWarnings,
    evaluate: evaluate,
  };
})(window.MRB);
