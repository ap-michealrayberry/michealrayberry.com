(function (MRB) {
  "use strict";

  var stream = null;
  var facing = "environment"; // rear default
  var videoEl = null;


  /** Force all capture canvases to fixed portrait 1080×1920. No landscape geometry. */
  function sizePortraitCanvases() {
    var w = (MRB.config && MRB.config.CANVAS_W) || 1080;
    var h = (MRB.config && MRB.config.CANVAS_H) || 1920;
    if (w >= h) {
      // Guard: config must never be landscape
      w = 1080;
      h = 1920;
    }
    ["compose-canvas", "preview-canvas", "photo-canvas", "preflight-guide"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
    });
    return { w: w, h: h };
  }

  function getFacing() {
    return facing;
  }

  function setFacing(mode) {
    facing = mode === "user" ? "user" : "environment";
  }

  function toggleFacing() {
    facing = facing === "environment" ? "user" : "environment";
    return facing;
  }

  /**
   * Soft HD request: "ideal" never hard-fails and never forces a cropped
   * sensor mode (the old feet-out-of-frame bug came from exact/aspectRatio
   * constraints, which stay banned). Preflight's framing preview remains the
   * check that the full body is in frame.
   */
  function videoConstraints() {
    return {
      facingMode: { ideal: facing },
      width: { ideal: 1080 },
      height: { ideal: 1920 },
    };
  }

  async function start(targetVideo) {
    stop();
    sizePortraitCanvases();
    videoEl = targetVideo || document.getElementById("capture-video") || document.getElementById("parked-video");
    if (!videoEl) throw new Error("No video element for camera");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia unavailable on this device");
    }

    var constraints = {
      video: videoConstraints(),
      audio: MRB.audio.micConstraints(),
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // Retry video-only if audio denied
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
      } catch (e2) {
        throw new Error("Camera permission failed: " + (e2.message || e.message || e));
      }
    }

    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    // Must be in document; wait for loadeddata before drawing
    await videoEl.play().catch(function () {
      /* autoplay policies — play may need gesture; preflight has one */
    });
    await waitLoadedData(videoEl);
    return stream;
  }

  function waitLoadedData(video) {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        cleanup();
        // Resolve anyway if we have some dimensions
        if (video.videoWidth > 0) resolve();
        else reject(new Error("Camera loadeddata timeout — dimensions not ready"));
      }, 8000);
      function onData() {
        cleanup();
        resolve();
      }
      function cleanup() {
        clearTimeout(t);
        video.removeEventListener("loadeddata", onData);
      }
      video.addEventListener("loadeddata", onData);
    });
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (e) {
          /* ignore */
        }
      });
      stream = null;
    }
    if (videoEl) {
      try {
        videoEl.srcObject = null;
      } catch (e) {
        /* ignore */
      }
    }
  }

  function getStream() {
    return stream;
  }

  function getVideoEl() {
    return videoEl;
  }

  function getAudioTracks() {
    if (!stream) return [];
    return stream.getAudioTracks();
  }

  function getVideoTracks() {
    if (!stream) return [];
    return stream.getVideoTracks();
  }

  async function flip(targetVideo) {
    toggleFacing();
    return start(targetVideo || videoEl);
  }

  MRB.camera = {
    start: start,
    stop: stop,
    flip: flip,
    sizePortraitCanvases: sizePortraitCanvases,
    getStream: getStream,
    getVideoEl: getVideoEl,
    getAudioTracks: getAudioTracks,
    getVideoTracks: getVideoTracks,
    getFacing: getFacing,
    setFacing: setFacing,
    toggleFacing: toggleFacing,
    videoConstraints: videoConstraints,
    waitLoadedData: waitLoadedData,
  };
})(window.MRB);
