(function (MRB) {
  "use strict";

  /**
   * Keep the screen awake for the life of the page (field sessions die if the
   * phone sleeps). Re-request on visibility regain; report failures once.
   */
  var lock = null;
  var lastError = null;
  var listenersBound = false;
  var onStatus = null;

  async function acquire() {
    if (!navigator.wakeLock) {
      lastError = "Wake Lock API unavailable — keep screen on manually";
      if (onStatus) onStatus({ ok: false, message: lastError });
      return { ok: false, message: lastError };
    }
    try {
      // Release prior handle if any (re-acquire after hide)
      if (lock) {
        try {
          await lock.release();
        } catch (e) {
          /* ignore */
        }
        lock = null;
      }
      lock = await navigator.wakeLock.request("screen");
      lastError = null;
      lock.addEventListener("release", function () {
        lock = null;
        // Auto re-acquire if page still visible
        if (document.visibilityState === "visible") {
          acquire().catch(function () {});
        }
      });
      if (onStatus) onStatus({ ok: true, message: "Screen lock held" });
      return { ok: true };
    } catch (e) {
      lastError = e.message || String(e);
      if (onStatus) onStatus({ ok: false, message: lastError });
      return { ok: false, message: lastError };
    }
  }

  function release() {
    // Intentionally no-op for page lifetime — field tool stays awake.
    // Only release on pagehide if we must.
  }

  function forceRelease() {
    if (lock) {
      try {
        lock.release();
      } catch (e) {
        /* ignore */
      }
      lock = null;
    }
  }

  function isHeld() {
    return !!lock;
  }

  function getLastError() {
    return lastError;
  }


  /**
   * Lock device to portrait for the life of capture.
   * Failures are non-fatal on desktop; preflight already blocks landscape phones.
   */
  async function lockPortrait() {
    try {
      if (screen.orientation && typeof screen.orientation.lock === "function") {
        await screen.orientation.lock("portrait");
        return { ok: true };
      }
      if (typeof screen.lockOrientation === "function") {
        screen.lockOrientation("portrait");
        return { ok: true };
      }
      if (typeof screen.mozLockOrientation === "function") {
        screen.mozLockOrientation("portrait");
        return { ok: true };
      }
      return { ok: false, message: "orientation lock API unavailable" };
    } catch (e) {
      return { ok: false, message: e.message || String(e) };
    }
  }

  function unlockPortrait() {
    try {
      if (screen.orientation && typeof screen.orientation.unlock === "function") {
        screen.orientation.unlock();
      }
    } catch (e) {
      /* ignore */
    }
  }

  function bind() {
    if (listenersBound) return;
    listenersBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        acquire().catch(function () {});
      }
    });
    // First user gesture often required
    function onGesture() {
      lockPortrait().catch(function () {});
      acquire().catch(function () {});
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("touchstart", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
    }
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("touchstart", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
    window.addEventListener("pagehide", forceRelease);
    // Attempt immediately (may fail without gesture — gesture handler retries)
    acquire().catch(function () {});
  }

  function setStatusHandler(fn) {
    onStatus = fn;
  }

  MRB.wake = {
    lockPortrait: lockPortrait,
    unlockPortrait: unlockPortrait,
    acquire: acquire,
    release: release,
    forceRelease: forceRelease,
    isHeld: isHeld,
    getLastError: getLastError,
    bind: bind,
    setStatusHandler: setStatusHandler,
  };
})(window.MRB);
