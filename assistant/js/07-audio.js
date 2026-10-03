(function (MRB) {
  "use strict";

  var audioCtx = null;
  var destNode = null;
  var activeSource = null;
  var speakQueue = [];
  var speaking = false;
  var lastMode = "none";
  var audioTrackPresent = false;

  function getContext() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("Web Audio API unavailable");
      audioCtx = new AC();
      destNode = audioCtx.createMediaStreamDestination();
    }
    return audioCtx;
  }

  async function ensureRunning() {
    var ctx = getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ctx.state !== "running") {
      throw new Error("AudioContext failed to reach running state (was " + ctx.state + "). User gesture required.");
    }
    return ctx;
  }

  function getDestinationStream() {
    getContext();
    return destNode.stream;
  }

  function getMixTracks() {
    var tracks = [];
    try {
      var s = getDestinationStream();
      s.getAudioTracks().forEach(function (t) {
        tracks.push(t);
      });
    } catch (e) {
      /* ignore */
    }
    return tracks;
  }

  function voiceMode() {
    var c = MRB.config.get();
    if (c.elKey) return "elevenlabs";
    if (typeof speechSynthesis !== "undefined") return "device";
    return "none";
  }

  lastMode = voiceMode();

  async function fetchElevenLabs(text) {
    var c = MRB.config.get();
    var voice = c.elVoice || MRB.config.DEFAULT_EL_VOICE;
    var url = "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice);
    var res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": c.elKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      throw new Error("ElevenLabs " + res.status);
    }
    return await res.arrayBuffer();
  }

  async function playBuffer(arrayBuffer) {
    var ctx = await ensureRunning();
    var audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return new Promise(function (resolve, reject) {
      try {
        if (activeSource) {
          try {
            activeSource.stop();
          } catch (e) {
            /* ignore */
          }
        }
        var src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(destNode);
        // Also to speakers so room mic (fallback path) is not the only one for EL
        src.connect(ctx.destination);
        activeSource = src;
        audioTrackPresent = true;
        src.onended = function () {
          activeSource = null;
          resolve();
        };
        src.start(0);
      } catch (err) {
        reject(err);
      }
    });
  }

  function speakDevice(text) {
    return new Promise(function (resolve, reject) {
      if (typeof speechSynthesis === "undefined") {
        reject(new Error("speechSynthesis unavailable"));
        return;
      }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92;
      u.pitch = 1;
      u.onend = function () {
        audioTrackPresent = true; // room capture path
        resolve();
      };
      u.onerror = function (ev) {
        reject(new Error("speechSynthesis error: " + (ev.error || "unknown")));
      };
      speechSynthesis.speak(u);
    });
  }

  /**
   * Speak narration via ElevenLabs (routed into graph) or device voice (room mic).
   * Two independent paths per §7.
   */
  async function speak(text) {
    if (!text) return;
    lastMode = voiceMode();
    if (lastMode === "elevenlabs") {
      try {
        var buf = await fetchElevenLabs(text);
        await playBuffer(buf);
        return { mode: "elevenlabs" };
      } catch (e) {
        // Fall through to device
        lastMode = "device";
      }
    }
    if (typeof speechSynthesis !== "undefined") {
      await speakDevice(text);
      return { mode: "device" };
    }
    throw new Error("No voice available for narration");
  }

  function stop() {
    try {
      if (activeSource) activeSource.stop();
    } catch (e) {
      /* ignore */
    }
    activeSource = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  function hasAudioTrackEvidence() {
    return audioTrackPresent;
  }

  function resetAudioEvidence() {
    audioTrackPresent = false;
  }

  function markAudioPresent() {
    audioTrackPresent = true;
  }

  /**
   * Mic constraints: echoCancellation OFF so device voice in the room is captured.
   */
  function micConstraints() {
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
  }

  MRB.audio = {
    ensureRunning: ensureRunning,
    getContext: getContext,
    getDestinationStream: getDestinationStream,
    getMixTracks: getMixTracks,
    voiceMode: voiceMode,
    speak: speak,
    stop: stop,
    hasAudioTrackEvidence: hasAudioTrackEvidence,
    resetAudioEvidence: resetAudioEvidence,
    markAudioPresent: markAudioPresent,
    micConstraints: micConstraints,
    getLastMode: function () {
      return lastMode;
    },
  };
})(window.MRB);
