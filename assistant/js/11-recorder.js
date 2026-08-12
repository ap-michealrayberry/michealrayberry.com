(function (MRB) {
  "use strict";

  /**
   * One continuous MediaRecorder run. Canvas captureStream(30) + mixed audio.
   * Hash chain over chunks. Encoded-size guard before filing.
   */
  function createSessionRecorder(options) {
    var canvas = options.canvas;
    var challengeCode = options.challengeCode;
    // Output is always vertical phone geometry
    if (canvas && canvas.width >= canvas.height) {
      throw new Error("Capture canvas must be portrait (720×1280). Landscape recording is not available.");
    }
    var mimePrefer = options.mimePrefer || [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];

    var recorder = null;
    var chunks = [];
    var chain = MRB.crypto.createHashChain(challengeCode);
    var startedAt = 0;
    var stoppedAt = 0;
    var mime = "";
    var frameLoop = null;
    var captureStream = null;
    var mixedStream = null;
    var audioAdded = false;

    function pickMime() {
      if (typeof MediaRecorder === "undefined") return "";
      for (var i = 0; i < mimePrefer.length; i++) {
        if (MediaRecorder.isTypeSupported(mimePrefer[i])) return mimePrefer[i];
      }
      return "";
    }

    function mixAudioTracks(videoStream) {
      mixedStream = new MediaStream();
      videoStream.getVideoTracks().forEach(function (t) {
        mixedStream.addTrack(t);
      });

      // Mic tracks (device voice room path)
      var micTracks = MRB.camera.getAudioTracks();
      micTracks.forEach(function (t) {
        mixedStream.addTrack(t);
        audioAdded = true;
      });

      // Synthetic voice graph tracks
      try {
        var synth = MRB.audio.getMixTracks();
        synth.forEach(function (t) {
          mixedStream.addTrack(t);
          audioAdded = true;
        });
      } catch (e) {
        /* optional */
      }

      return mixedStream;
    }

    async function start(drawFn) {
      await chain.ready;
      mime = pickMime();
      captureStream = canvas.captureStream(30);
      var track = captureStream.getVideoTracks()[0] || null;
      mixAudioTracks(captureStream);

      var recOpts = mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : { videoBitsPerSecond: 2_500_000 };
      try {
        recorder = new MediaRecorder(mixedStream, recOpts);
      } catch (e) {
        recorder = new MediaRecorder(mixedStream);
        mime = recorder.mimeType || "";
      }

      chunks = [];
      recorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
          // async chain update
          ev.data.arrayBuffer().then(function (buf) {
            chain.addChunk(buf);
          });
        }
      };

      frameLoop = MRB.frameLoop.create({
        canvas: canvas,
        draw: drawFn,
      });
      if (track) frameLoop.setCaptureTrack(track);
      frameLoop.start();

      recorder.start(1000); // 1s chunks for chain + resumable evidence
      startedAt = performance.now();
      return { mime: mime, track: track };
    }

    function stop() {
      return new Promise(function (resolve, reject) {
        if (!recorder) {
          reject(new Error("Recorder not started"));
          return;
        }
        if (frameLoop) frameLoop.stop();

        recorder.onstop = async function () {
          stoppedAt = performance.now();
          // Allow pending chain updates
          await new Promise(function (r) {
            setTimeout(r, 50);
          });
          // Recompute chain synchronously from all chunks for accuracy
          var finalChain = await recomputeChain();
          var blob = new Blob(chunks, { type: mime || "video/webm" });
          var durationSec = (stoppedAt - startedAt) / 1000;
          var frames = frameLoop ? frameLoop.getFrameCount() : 0;
          resolve({
            blob: blob,
            mime: mime || blob.type,
            durationSec: durationSec,
            frameCount: frames,
            chunk_chain: finalChain.chain,
            chunk_count: finalChain.chunk_count,
            hasAudio: audioAdded,
            size: blob.size,
          });
        };
        recorder.onerror = function (ev) {
          reject(ev.error || new Error("MediaRecorder error"));
        };
        try {
          if (recorder.state !== "inactive") recorder.stop();
          else recorder.onstop();
        } catch (e) {
          reject(e);
        }
      });
    }

    async function recomputeChain() {
      var c = MRB.crypto.createHashChain(challengeCode);
      await c.ready;
      for (var i = 0; i < chunks.length; i++) {
        var buf = await chunks[i].arrayBuffer();
        await c.addChunk(buf);
      }
      return c.getFinal();
    }

    /**
     * Guard on encoded size, not elapsed time.
     * Refuse implausibly small files for duration.
     * Rough floor: ~8 KB/s minimum for any real video+audio encode.
     */
    function assertPlausibleSize(result) {
      var minBytes = Math.max(8_000, result.durationSec * 8_000);
      if (result.size < minBytes) {
        var err = new Error(
          "Encoded file implausibly small for duration (" +
            result.size +
            " bytes over " +
            result.durationSec.toFixed(1) +
            "s). Refusing to file — likely black/empty capture."
        );
        err.code = "ENCODED_SIZE";
        throw err;
      }
      if (!result.hasAudio && !MRB.audio.hasAudioTrackEvidence()) {
        var errA = new Error("Session completed with no audio track evidence");
        errA.code = "NO_AUDIO";
        throw errA;
      }
      return true;
    }

    function getFrameCount() {
      return frameLoop ? frameLoop.getFrameCount() : 0;
    }

    return {
      start: start,
      stop: stop,
      assertPlausibleSize: assertPlausibleSize,
      getFrameCount: getFrameCount,
      recomputeChain: recomputeChain,
    };
  }

  /** Min size helper for tests */
  function minBytesForDuration(durationSec) {
    return Math.max(8_000, durationSec * 8_000);
  }

  function isPlausibleSize(size, durationSec) {
    return size >= minBytesForDuration(durationSec);
  }

  MRB.recorder = {
    create: createSessionRecorder,
    minBytesForDuration: minBytesForDuration,
    isPlausibleSize: isPlausibleSize,
  };
})(window.MRB);
