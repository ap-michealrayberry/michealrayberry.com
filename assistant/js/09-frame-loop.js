(function (MRB) {
  "use strict";

  /**
   * rAF draws + watchdog interval acts ONLY when rAF silent ~200ms.
   * Do not draw from both paths at once.
   * When tab hidden, requestFrame on the canvas capture track.
   */
  function createFrameLoop(options) {
    var draw = options.draw;
    var canvas = options.canvas;
    var fps = options.fps || 30;
    var running = false;
    var rafId = 0;
    var watchdogId = 0;
    var lastRaf = 0;
    var frameCount = 0;
    var captureTrack = null;

    function setCaptureTrack(track) {
      captureTrack = track;
    }

    function tick(now) {
      if (!running) return;
      lastRaf = now || performance.now();
      try {
        draw(lastRaf);
        frameCount += 1;
      } catch (e) {
        console.error("[frame-loop] draw error", e);
      }
      rafId = requestAnimationFrame(tick);
    }

    function watchdog() {
      if (!running) return;
      var now = performance.now();
      if (now - lastRaf > 200) {
        // rAF silent — do not double-draw if rAF is about to fire; only when silent
        try {
          draw(now);
          frameCount += 1;
        } catch (e) {
          console.error("[frame-loop] watchdog draw error", e);
        }
        if (captureTrack && typeof captureTrack.requestFrame === "function") {
          try {
            captureTrack.requestFrame();
          } catch (e2) {
            /* ignore */
          }
        }
        lastRaf = now;
      }
    }

    function start() {
      if (running) return;
      running = true;
      frameCount = 0;
      lastRaf = performance.now();
      rafId = requestAnimationFrame(tick);
      watchdogId = setInterval(watchdog, 100);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (watchdogId) clearInterval(watchdogId);
      watchdogId = 0;
    }

    return {
      start: start,
      stop: stop,
      setCaptureTrack: setCaptureTrack,
      getFrameCount: function () {
        return frameCount;
      },
      isRunning: function () {
        return running;
      },
    };
  }

  MRB.frameLoop = {
    create: createFrameLoop,
  };
})(window.MRB);
