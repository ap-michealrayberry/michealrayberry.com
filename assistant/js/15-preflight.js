(function (MRB) {
  "use strict";

  /**
   * Pre-flight checks — verify and report, never silently.
   */
  async function runChecks(sessionType, options) {
    options = options || {};
    var minutes = options.minutes || estimateMinutes(sessionType, options.level);
    var checks = [];

    checks.push(await checkMedia());
    checks.push(checkOrientation());
    checks.push(await checkStorage());
    checks.push(await checkBattery(minutes));
    checks.push(checkVoice());
    checks.push(await checkServer());
    checks.push(checkWakeLockSupport());

    if (sessionType === "corrective") {
      checks.push(checkCorrectiveEntry(options.entry, options.level));
    }

    var hardFail = checks.some(function (c) {
      return c.level === "fail" && c.blocking;
    });

    return {
      checks: checks,
      ok: !hardFail,
      canStart: !hardFail,
      minutes: minutes,
    };
  }

  function estimateMinutes(type, level) {
    if (type === "corrective") return MRB.config.cornerMinutes(level || 1);
    if (type === "weekly") return 10;
    if (type === "daily") return 3;
    if (type === "confirmation") return 2;
    if (type === "announcement") return 3;
    return 2;
  }

  async function checkMedia() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return {
          id: "media",
          label: "Camera & microphone",
          level: "fail",
          blocking: true,
          detail: "getUserMedia unavailable",
        };
      }
      if (navigator.permissions && navigator.permissions.query) {
        try {
          var cam = await navigator.permissions.query({ name: "camera" });
          if (cam.state === "denied") {
            return {
              id: "media",
              label: "Camera & microphone",
              level: "fail",
              blocking: true,
              detail: "Camera permission denied",
            };
          }
        } catch (e) {
          /* name may not be supported */
        }
      }
      return {
        id: "media",
        label: "Camera & microphone",
        level: "ok",
        blocking: true,
        detail: "Will request on start",
      };
    } catch (e) {
      return {
        id: "media",
        label: "Camera & microphone",
        level: "fail",
        blocking: true,
        detail: e.message,
      };
    }
  }

  function isPortrait() {
    if (window.matchMedia && window.matchMedia("(orientation: portrait)").matches) {
      return true;
    }
    // Fallback: taller than wide
    return window.innerHeight >= window.innerWidth;
  }

  /**
   * All capture is vertical phone only — no landscape option.
   * Fail closed if the device is landscape.
   */
  function checkOrientation() {
    if (!isPortrait()) {
      return {
        id: "orientation",
        label: "Portrait orientation",
        level: "fail",
        blocking: true,
        detail: "Rotate phone upright. All video is vertical — landscape is not available.",
      };
    }
    return {
      id: "orientation",
      label: "Portrait orientation",
      level: "ok",
      blocking: true,
      detail: "Vertical (1080×1920) — locked",
    };
  }

  async function checkStorage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var est = await navigator.storage.estimate();
        var free = (est.quota || 0) - (est.usage || 0);
        if (free < 50 * 1024 * 1024) {
          return {
            id: "storage",
            label: "Storage",
            level: "warn",
            blocking: false,
            detail: "Low free storage (" + MRB.queue.formatBytes(free) + ")",
          };
        }
        return {
          id: "storage",
          label: "Storage",
          level: "ok",
          blocking: false,
          detail: MRB.queue.formatBytes(free) + " free",
        };
      }
      return {
        id: "storage",
        label: "Storage",
        level: "ok",
        blocking: false,
        detail: "Estimate unavailable",
      };
    } catch (e) {
      return {
        id: "storage",
        label: "Storage",
        level: "warn",
        blocking: false,
        detail: e.message,
      };
    }
  }

  async function checkBattery(minutes) {
    try {
      if (!navigator.getBattery) {
        return {
          id: "battery",
          label: "Battery",
          level: "warn",
          blocking: false,
          detail: "API unavailable — ensure charge for " + minutes + " min",
        };
      }
      var bat = await navigator.getBattery();
      var need = (minutes / 60) * 0.15;
      var pct = Math.round(bat.level * 100);
      if (!bat.charging && bat.level < Math.max(0.15, need)) {
        return {
          id: "battery",
          label: "Battery",
          level: "fail",
          blocking: true,
          detail: pct + "% — insufficient for " + minutes + " min session",
        };
      }
      return {
        id: "battery",
        label: "Battery",
        level: "ok",
        blocking: true,
        detail: pct + "%" + (bat.charging ? " charging" : ""),
      };
    } catch (e) {
      return {
        id: "battery",
        label: "Battery",
        level: "warn",
        blocking: false,
        detail: e.message,
      };
    }
  }

  function checkVoice() {
    var mode = MRB.audio.voiceMode();
    if (mode === "none") {
      return {
        id: "voice",
        label: "Voice",
        level: "fail",
        blocking: true,
        detail: "No ElevenLabs key and no speechSynthesis",
      };
    }
    return {
      id: "voice",
      label: "Voice",
      level: "ok",
      blocking: true,
      detail:
        mode === "elevenlabs"
          ? "ElevenLabs"
          : "Device speechSynthesis (room mic path)",
    };
  }

  async function checkServer() {
    var c = MRB.config.get();
    if (!c.deviceKey && !c.demoMode) {
      return {
        id: "server",
        label: "Server & device key",
        level: "fail",
        blocking: true,
        detail: "Device key required",
      };
    }
    var ping = await MRB.api.pingServer();
    if (!ping.ok) {
      return {
        id: "server",
        label: "Server & device key",
        level: c.demoMode ? "warn" : "fail",
        blocking: !c.demoMode,
        detail: ping.message,
      };
    }
    return {
      id: "server",
      label: "Server & device key",
      level: "ok",
      blocking: true,
      detail: ping.demo ? "Demo mode" : ping.message,
    };
  }

  function checkWakeLockSupport() {
    if (navigator.wakeLock) {
      return {
        id: "wakelock",
        label: "Wake lock",
        level: "ok",
        blocking: false,
        detail: "Supported — held while on this page",
      };
    }
    return {
      id: "wakelock",
      label: "Wake lock",
      level: "warn",
      blocking: false,
      detail: "Not supported — keep screen on manually",
    };
  }

  function checkCorrectiveEntry(entry, level) {
    if (!entry) {
      return {
        id: "entry",
        label: "Violation entry",
        level: "fail",
        blocking: true,
        detail: "No open entry selected",
      };
    }
    return {
      id: "entry",
      label: "Violation entry",
      level: "ok",
      blocking: true,
      detail:
        (entry.date || "") +
        " · Level " +
        (level || 1) +
        " · " +
        (entry.violation || "").slice(0, 40),
    };
  }

  MRB.preflight = {
    runChecks: runChecks,
    estimateMinutes: estimateMinutes,
  };
})(window.MRB);
