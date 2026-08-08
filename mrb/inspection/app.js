// Daily Inspection only
// One continuous four-angle take. Subject never speaks.
// Official overlay burned into every frame.

const DAILY_SCRIPT = [
  {
    id: 0,
    name: "Inspection Position",
    duration: 26,
    angle: "front",
    text: "This is the official Daily Inspection for Micheal Ray Berry, Day {n} of the Public Accountability Project. Today is {date}. Documented weight this morning: {w} pounds. Stand at attention facing the camera. Feet together, hands behind the head, eyes forward. Project uniform in frame for verification. You do not speak during this recording. The voice speaks for the record. This is one continuous take. Four views are required, and the verification code shown on screen was issued moments ago by the record itself, so this footage cannot be older than it claims. Beginning with the front view. Hold the position."
  },
  {
    id: 1,
    name: "Left Side",
    duration: 11,
    angle: "left",
    text: "Turn to your left. Hold the position. This view records the left profile."
  },
  {
    id: 2,
    name: "Rear",
    duration: 11,
    angle: "rear",
    text: "Turn to the rear. Hold the position. This view records the back, shoulders to heels."
  },
  {
    id: 3,
    name: "Right Side",
    duration: 11,
    angle: "right",
    text: "Turn to your right. Hold the position. This view records the right profile."
  },
  {
    id: 4,
    name: "Front — Closing",
    duration: 11,
    angle: null,
    text: "Return to the front. Face the camera. Hands behind the head. This closing view confirms identity against the opening frame."
  },
  {
    id: 5,
    name: "Complete",
    duration: 22,
    angle: null,
    text: "All four required views are recorded. This inspection documents the result exactly as it is, with no adjustment and no commentary. The remaining requirements of the Daily Compliance Packet are due by ten PM Eastern: the four accountability photographs, the weight entry, and the record update. Nothing is complete until the record accepts all of them. Up, down, or flat, it gets posted. Daily Inspection complete."
  }
];

const state = {
  day: 20,
  weight: 337.6,
  date: "2026-08-08",
  code: "",
  sessionStart: null,
  sessionElapsed: 0,
  phase: "idle",
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  cameraStream: null,
  videoEl: null,
  animId: null,
  autoRecord: true,
  stepIndex: 0,
  cancelled: false,
  speaking: false,
  wakeLock: null,
  lastBlob: null,
  uploadToken: "",
  photos: [],
  lastDrawAt: 0,
  chunkChain: null,
  chunkCount: 0,
  chainQueue: Promise.resolve(),
  captureStream: null,
  frameTimer: null
};

// The AP-owned Apps Script endpoint. Every evidentiary call goes through it.
const EXEC = "https://script.google.com/macros/s/AKfycbyJ7PV4NAmK2WcP-pBMLW78orrw_i7KndnKEkWLT_Xd0GtyeRztQpOxd2oSaitEHJM7/exec";
const deviceKey = () => { try { return localStorage.getItem("mrb_packet_key") || ""; } catch (e) { return ""; } };

/* A one-time code issued by the record and stamped with Google's clock. It is
   burned into every frame and never spoken, so footage cannot be older than it
   claims. Requesting one per attempt also makes an abandoned attempt
   permanently visible server-side — the request IS the attempt log. */
async function fetchChallenge() {
  const key = deviceKey();
  if (!key) return null;
  try {
    const r = await fetch(EXEC + "?action=challenge&kind=daily&key=" + encodeURIComponent(key));
    const j = await r.json();
    return j && j.ok && j.code ? j : null;
  } catch (e) { return null; }
}

async function sha256Bytes(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, "0")).join("");

/* Rolling chain over each recorder chunk, seeded from the challenge code. The
   whole-file hash proves a file was not swapped; the chain additionally makes a
   mid-file edit detectable, because altering any chunk changes every value
   after it. */
function chainReset(seed) {
  state.chunkChain = null;
  state.chunkCount = 0;
  state.chainQueue = sha256Bytes(new TextEncoder().encode(String(seed || "")))
    .then(h => { state.chunkChain = h; });
}
function chainPush(blob) {
  state.chunkCount++;
  state.chainQueue = state.chainQueue.then(async () => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const prev = state.chunkChain || new Uint8Array(0);
    const joined = new Uint8Array(prev.length + bytes.length);
    joined.set(prev, 0);
    joined.set(bytes, prev.length);
    state.chunkChain = await sha256Bytes(joined);
  }).catch(() => {});
}
async function chainHex() {
  await state.chainQueue;
  return state.chunkChain ? hex(state.chunkChain) : "";
}

/* Posts the fingerprints to the record, which HMACs them with its own secret
   and clock and returns a seal. Everything the device sends is an assertion;
   the seal is the record's own attestation of what it received. */
async function attest(videoBlob) {
  const key = deviceKey();
  if (!key) return { ok: false, error: "no device key on this browser" };
  try {
    const videoSha = videoBlob ? hex(await sha256Bytes(new Uint8Array(await videoBlob.arrayBuffer()))) : "";
    const r = await fetch(EXEC, {
      method: "POST",
      body: JSON.stringify({
        action: "attest", key, kind: "daily",
        date: state.date, day: state.day, code: state.code,
        weight: state.weight, video_sha256: videoSha,
        photo_sha256s: await Promise.all((state.photos || []).map(async (p) =>
          hex(await sha256Bytes(new Uint8Array(await (await fetch(p.dataUrl)).arrayBuffer()))))),
        chunk_chain: await chainHex(), chunk_count: state.chunkCount
      })
    });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e) }; }
}

const $ = (id) => document.getElementById(id);
const canvas = $("previewCanvas");
const ctx = canvas.getContext("2d");

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(name + "Screen").classList.add("active");
  updateStatusBar();
}

function updateStatusBar() {
  const bar = $("statusBar");
  if (state.isRecording) {
    bar.textContent = "RECORDING";
    bar.className = "status-bar recording";
  } else if (state.phase === "running") {
    bar.textContent = "INSPECTION ACTIVE";
    bar.className = "status-bar active";
  } else {
    bar.textContent = "READY";
    bar.className = "status-bar";
  }
}

function fill(text) {
  return text
    .replace(/{n}/g, state.day)
    .replace(/{date}/g, state.date)
    .replace(/{w}/g, state.weight);
}

// ===== VOICE =====
function speak(text, onEnd) {
  if (!text) {
    if (onEnd) onEnd();
    return;
  }
  if (state.speaking) window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.92;
  utter.pitch = 0.85;
  utter.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    /male|daniel|google uk english male|microsoft david|alex/i.test(v.name)
  ) || voices.find(v => v.lang.startsWith("en"));
  if (preferred) utter.voice = preferred;

  state.speaking = true;
  $("voiceStatus").textContent = text.slice(0, 60) + (text.length > 60 ? "…" : "");
  utter.onend = () => {
    state.speaking = false;
    $("voiceStatus").textContent = "Voice ready";
    if (onEnd) onEnd();
  };
  window.speechSynthesis.speak(utter);
}

// ===== OVERLAY LOOP =====
function startOverlayLoop() {
  cancelAnimationFrame(state.animId);
  clearInterval(state.frameTimer);
  const draw = () => {
    const elapsed = state.sessionStart
      ? (Date.now() - state.sessionStart) / 1000
      : 0;
    state.sessionElapsed = Math.floor(elapsed);

    MRBOverlay.drawFrame(ctx, {
      video: state.videoEl,
      mirror: false,  // rear camera — do not mirror
      kind: "daily",
      date: state.date,
      day: state.day,
      code: state.code || null,
      elapsedSec: elapsed,
      monitor: { active: false }
    });

  };

  const loop = () => {
    draw();
    state.lastDrawAt = Date.now();
    state.animId = requestAnimationFrame(loop);
  };
  loop();

  /* Watchdog only. While rAF is firing this does nothing; if it stops — screen
     asleep, tab backgrounded — this resumes frame production so the recording
     does not silently become a still image. */
  state.frameTimer = setInterval(() => {
    if (Date.now() - (state.lastDrawAt || 0) < 200) return;
    draw();
    state.lastDrawAt = Date.now();
    const t = state.captureStream && state.captureStream.getVideoTracks()[0];
    if (t && typeof t.requestFrame === "function") t.requestFrame();
  }, 250);
}

function detachVideoEl() {
  if (state.videoEl && state.videoEl.parentNode) state.videoEl.parentNode.removeChild(state.videoEl);
}

function stopOverlayLoop() {
  clearInterval(state.frameTimer);
  cancelAnimationFrame(state.animId);
  state.animId = null;
}


// ===== SCREEN WAKE LOCK =====
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
      // Re-acquire if tab becomes visible again
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible" && state.phase === "running" && !state.wakeLock) {
          try { state.wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
        }
      });
    }
  } catch (err) {
    console.warn("Wake Lock not available:", err);
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

// ===== CAMERA + RECORDING =====
async function startCamera() {
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        // Prefer tall frames; many devices still deliver landscape — overlay rotates if needed
        width: { ideal: 1080 },
        height: { ideal: 1920 },
        aspectRatio: { ideal: 0.5625 }
      },
      // The device fallback voice exists only as sound in the room and cannot be
      // routed programmatically. With processing on, the browser classifies it
      // as speaker bleed and removes it — producing a silent recording on
      // exactly the days the synthetic voice is unavailable.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    state.videoEl = document.createElement("video");
    state.videoEl.srcObject = state.cameraStream;
    state.videoEl.muted = true;
    state.videoEl.defaultMuted = true;
    state.videoEl.playsInline = true;
    state.videoEl.autoplay = true;
    // iOS honours the attributes, not only the properties.
    state.videoEl.setAttribute("playsinline", "");
    state.videoEl.setAttribute("webkit-playsinline", "");
    state.videoEl.setAttribute("muted", "");
    state.videoEl.setAttribute("autoplay", "");
    state.videoEl.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.appendChild(state.videoEl);

    await state.videoEl.play();
    // Dimensions are not available the instant play() resolves; drawing before
    // then produces a blank first frame that never updates.
    if (!state.videoEl.videoWidth) {
      await new Promise((resolve) => {
        const done = () => { state.videoEl.removeEventListener("loadeddata", done); resolve(); };
        state.videoEl.addEventListener("loadeddata", done);
        setTimeout(resolve, 3000);
      });
    }
    startOverlayLoop();
    return true;
  } catch (err) {
    console.error(err);
    $("autoStatus").textContent = "Camera denied — overlay shows dark field";
    startOverlayLoop();
    return false;
  }
}

function stopCamera() {
  stopOverlayLoop();
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }
  state.videoEl = null;
}

async function startRecording() {
  if (state.isRecording) return;
  try {
    // captureStream(0) would need every frame pushed manually; 30 keeps the
    // automatic path and lets requestFrame() top it up when repaint stalls.
    const canvasStream = canvas.captureStream(30);
    state.captureStream = canvasStream;
    const tracks = [...canvasStream.getVideoTracks()];
    if (state.cameraStream) {
      const audioTracks = state.cameraStream.getAudioTracks();
      if (audioTracks.length) tracks.push(audioTracks[0]);
    }
    const combined = new MediaStream(tracks);

    state.recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    state.mediaRecorder = new MediaRecorder(combined, { mimeType: mime });
    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) { state.recordedChunks.push(e.data); chainPush(e.data); }
    };
    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.recordedChunks, { type: "video/webm" });
      state.lastBlob = blob;

      /* A wall-clock length check cannot detect an empty file: a session whose
         frame production stalled still runs its full duration. Guard on encoded
         size instead — this exact defect once filed a black video with valid
         hashes and a passing length check. */
      const expected = Math.max(1, state.sessionElapsed) * 40 * 1024; // ~0.3 Mbps floor
      if (blob.size < expected) {
        $("recordingStatus").textContent =
          "RECORDING FAILED — " + Math.round(blob.size / 1024) + " KB for " +
          state.sessionElapsed + "s is far below a usable file. Do not file this; record again.";
        return;
      }
      // Also download locally
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MRB_Daily_Day${state.day}_${state.date}_${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      $("recordingStatus").textContent = "Saved locally (overlay burned in). Attesting…";

      // Fingerprints go to the record, which seals them with its own clock.
      const res = await attest(blob);
      $("recordingStatus").textContent = res && res.ok
        ? "Attested \u2713 — " + (res.status || "logged") + ". Sealed " + (res.sealed_at || "") + "."
        : "ATTESTATION FAILED — fingerprints were not logged" +
          (res && res.error ? " (" + res.error + ")" : "") + ". Tell the AP before filing.";
    };
    state.mediaRecorder.start(1000);
    state.isRecording = true;
    $("recordingStatus").textContent = "Recording with official overlay…";
    updateStatusBar();
  } catch (err) {
    console.error(err);
    $("recordingStatus").textContent = "Recording failed";
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    updateStatusBar();
  }
}

// ===== TIMER =====
let timerInterval = null;
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!state.sessionStart) return;
    state.sessionElapsed = Math.floor((Date.now() - state.sessionStart) / 1000);
    const m = String(Math.floor(state.sessionElapsed / 60)).padStart(2, "0");
    const s = String(state.sessionElapsed % 60).padStart(2, "0");
    $("sessionTimer").textContent = `${m}:${s}`;
  }, 1000);
}

// ===== INSPECTION SEQUENCE =====
async function startInspection() {
  state.day = parseInt($("dayNumber").value) || 1;
  state.weight = parseFloat($("currentWeight").value) || 0;
  state.date = $("sessionDate").value.trim() || new Date().toISOString().slice(0, 10);
  const challenge = await fetchChallenge();
  if (!challenge) {
    alert("Verification code unavailable — check the connection and the device key. The inspection cannot start unverified.");
    return;
  }
  state.code = challenge.code;
  state.day = challenge.day || state.day;
  chainReset(state.code);
  state.autoRecord = $("autoRecord").checked;
  state.uploadToken = ($("uploadToken") && $("uploadToken").value) || localStorage.getItem("mrb_upload_token") || "";
  if (state.uploadToken) localStorage.setItem("mrb_upload_token", state.uploadToken);
  state.sessionStart = Date.now();
  state.sessionElapsed = 0;
  state.phase = "running";
  state.stepIndex = 0;
  state.cancelled = false;

  $("sessionMeta").textContent =
    `Day ${state.day} · ${state.weight} lb` +
    (state.code ? ` · CODE ${state.code}` : "");
  $("stepName").textContent = "—";
  $("autoStatus").textContent = "Starting continuous take…";

  showScreen("session");
  startTimer();
  await startCamera();
  await requestWakeLock();

  if (state.autoRecord) {
    setTimeout(() => startRecording(), 400);
  }

  runStep(0);
}

function runStep(index) {
  if (state.cancelled || index >= DAILY_SCRIPT.length) {
    if (!state.cancelled) finishInspection();
    return;
  }

  state.stepIndex = index;
  const item = DAILY_SCRIPT[index];
  const spoken = fill(item.text);

  $("stepName").textContent = item.name;
  $("autoStatus").textContent = `Step ${index + 1} of ${DAILY_SCRIPT.length} — video`;

  speak(spoken);

  const wordCount = spoken.split(/\s+/).length;
  const speechMs = wordCount * 340;
  const waitMs = Math.max(item.duration * 1000, speechMs + 400);

  setTimeout(() => {
    if (!state.cancelled) runStep(index + 1);
  }, waitMs);
}

async function finishInspection() {
  window.speechSynthesis.cancel();

  // 1) End the video recording first
  if (state.isRecording) stopRecording();
  $("autoStatus").textContent = "Video complete — photograph pass next";
  $("stepName").textContent = "Photographs";

  // 2) Keep camera live; redo the four poses and capture stills
  speak("Video complete. Now the four photographs. Same positions. You do not speak.");
  await new Promise(r => setTimeout(r, 3500));

  if (!state.cancelled) {
    await runPhotoSequence();
  }

  // 3) Shut down camera / wake lock and show post screen
  state.phase = "done";
  stopCamera();
  releaseWakeLock();

  const m = Math.floor(state.sessionElapsed / 60);
  const s = state.sessionElapsed % 60;

  $("sessionSummary").innerHTML = `
    <strong>Daily Inspection — Day ${state.day}</strong><br>
    Weight: ${state.weight} lb<br>
    Date: ${state.date}<br>
    ${state.code ? "Verification code: " + state.code + "<br>" : ""}
    Four-angle continuous video completed<br>
    Photographs: ${(state.photos || []).length}/4 captured in separate pass<br>
    Duration: ${m}m ${s}s
  `;

  showScreen("post");
}

function emergencyStop() {
  state.cancelled = true;
  window.speechSynthesis.cancel();
  state.phase = "idle";
  if (state.isRecording) stopRecording();
  stopCamera();
  releaseWakeLock();
  $("autoStatus").textContent = "EMERGENCY STOP";
  alert("Inspection stopped.");
  showScreen("setup");
}


// ===== ACCOUNTABILITY PHOTOGRAPHS =====
const ANGLES = ["front", "left", "rear", "right"];

/* Grabs the current composited frame — overlay bands included, so a photograph
   carries the same day, date and verification code as the video it accompanies. */
function capturePhoto(angle) {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  c.getContext("2d").drawImage(canvas, 0, 0);
  const dataUrl = c.toDataURL("image/jpeg", 0.92);
  const name = "micheal-ray-berry-day-" + String(state.day).padStart(3, "0") +
    "-" + angle + "-" + state.date + ".jpg";

  // Save to device immediately
  try {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.warn("photo download failed", e);
  }

  return { angle, dataUrl, name };
}

/* Walks the four angles with a spoken prompt and a short hold before each
   shutter, so the subject has time to turn. The voice runs the sequence; the
   subject never speaks. */
async function runPhotoSequence() {
  // Never fall back to #uploadStatus: that line reports filing progress, and
  // two writers on one element read as the status flickering between states.
  const status = $("autoStatus");
  state.photos = [];
  for (const angle of ANGLES) {
    $("stepName").textContent = "Photo — " + angle;
    if (status) status.textContent = "Pose again: " + angle + " (" + (state.photos.length + 1) + "/4)";
    await new Promise((resolve) => {
      speak("Photograph. " + angle + " view. Take the position again. Hold.", () => {});
      setTimeout(resolve, 4500);
    });
    await new Promise((r) => setTimeout(r, 800));
    if (state.cancelled) return state.photos;
    state.photos.push(capturePhoto(angle));
    if (status) status.textContent = "Captured " + state.photos.length + " of 4 photographs.";
  }
  speak("All four photographs are recorded.");
  return state.photos;
}

// ===== FILE TO THE RECORD =====
/* One upload route. The server signs a presigned PUT and builds the object key
   itself from a validated date, so a stolen device key cannot write arbitrary
   paths, and every file lands somewhere the record knows about. */
async function fileToRecord() {
  const status = $("uploadStatus");
  const btn = $("btnUpload");
  if (!state.lastBlob) {
    status.textContent = "No recording available to file.";
    status.className = "upload-status err";
    return;
  }
  const key = deviceKey();
  if (!key) {
    status.textContent = "No device key on this browser — it is set on the portal. The record cannot accept an unauthorised file.";
    status.className = "upload-status err";
    return;
  }

  btn.disabled = true;
  status.className = "upload-status";
  status.textContent = "Requesting upload authorisation…";

  const filename = "micheal-ray-berry-day-" + String(state.day).padStart(3, "0") +
    "-inspection-" + state.date + ".webm";

  try {
    const signRes = await fetch(EXEC, {
      method: "POST",
      body: JSON.stringify({
        action: "r2sign", key, kind: "daily",
        date: state.date, filename, mime: "video/webm"
      })
    });
    const sign = await signRes.json();
    if (!sign || !sign.ok || !sign.url) throw new Error((sign && sign.error) || "not authorised");

    status.textContent = "Uploading…";
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", sign.url, true);
      xhr.setRequestHeader("Content-Type", "video/webm");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          status.textContent = "Uploading… " + Math.round((ev.loaded / ev.total) * 100) + "%";
        }
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
        ? resolve() : reject(new Error("HTTP " + xhr.status));
      xhr.onerror = () => reject(new Error("network"));
      xhr.send(state.lastBlob);
    });

    // The four photographs, then the weight. finalize on the last call pulls
    // the day's row together server-side.
    let photos = state.photos || [];
    if (photos.length < 4) {
      status.textContent = "Missing photographs — capturing remaining angles…";
      await runPhotoSequence();
      photos = state.photos || [];
    }
    for (let i = 0; i < photos.length; i++) {
      status.textContent = "Filing photograph " + (i + 1) + " of " + photos.length + "…";
      markPacket(photos[i].angle, true);
      await fetch(EXEC, {
        method: "POST",
        body: JSON.stringify({
          action: "packet", key, date: state.date,
          name: photos[i].name,
          image_b64: photos[i].dataUrl.split(",")[1]
        })
      });
    }
    await fetch(EXEC, {
      method: "POST",
      body: JSON.stringify({
        action: "packet", key, date: state.date,
        weight: state.weight, finalize: true
      })
    });

    markPacket("weight", true);
    markPacket("video", true);
    status.textContent = "Filed to the record \u2713 — video, " + photos.length +
      " photographs and weight. " + (sign.publicUrl || "");
    status.className = "upload-status ok";
  } catch (err) {
    console.error(err);
    status.textContent = "Filing failed: " + err.message + " — the day is not documented until this succeeds.";
    status.className = "upload-status err";
  } finally {
    btn.disabled = false;
  }
}



// ===== INIT =====
function init() {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

  // Placeholder overlay
  MRBOverlay.drawFrame(ctx, {
    kind: "daily",
    date: "2026-08-08",
    day: 20,
    code: null,
    elapsedSec: 0
  });

  $("btnStart").addEventListener("click", startInspection);
  $("btnEmergency").addEventListener("click", emergencyStop);
  $("btnEndEarly").addEventListener("click", () => {
    state.cancelled = true;
    window.speechSynthesis.cancel();
    finishInspection();
  });
  $("btnNew").addEventListener("click", () => showScreen("setup"));
  if ($("btnUpload")) $("btnUpload").addEventListener("click", fileToRecord);

  // Device key UI
  function refreshKeyStatus() {
    const key = deviceKey();
    if ($("deviceKeyStatus")) {
      $("deviceKeyStatus").value = key
        ? "Present on this browser (" + key.slice(0, 4) + "…)"
        : "MISSING — enter key above and tap Save";
    }
    if ($("deviceKeyInput") && key && !$("deviceKeyInput").value) {
      // leave input empty for security; status shows presence
    }
  }
  refreshKeyStatus();

  if ($("btnSaveKey")) {
    $("btnSaveKey").addEventListener("click", () => {
      const v = ($("deviceKeyInput") && $("deviceKeyInput").value.trim()) || "";
      if (!v) {
        alert("Paste a device key first.");
        return;
      }
      try {
        localStorage.setItem("mrb_packet_key", v);
        $("deviceKeyInput").value = "";
        refreshKeyStatus();
        alert("Device key saved on this browser.");
      } catch (e) {
        alert("Could not save key: " + e.message);
      }
    });
  }
  if ($("btnClearKey")) {
    $("btnClearKey").addEventListener("click", () => {
      if (!confirm("Remove the device key from this browser?")) return;
      localStorage.removeItem("mrb_packet_key");
      if ($("deviceKeyInput")) $("deviceKeyInput").value = "";
      refreshKeyStatus();
    });
  }

  // PWA: service worker + install prompt
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW register failed", e));
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if ($("btnInstall")) $("btnInstall").hidden = false;
  });

  if ($("btnInstall")) {
    $("btnInstall").addEventListener("click", async () => {
      if (!deferredPrompt) {
        alert("Use your browser menu: Add to Home Screen / Install app.");
        return;
      }
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      $("btnInstall").hidden = true;
      if (choice && choice.outcome === "accepted" && $("installNote")) {
        $("installNote").hidden = false;
      }
    });
  }

  // Already running as installed PWA?
  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
    if ($("btnInstall")) $("btnInstall").hidden = true;
    if ($("installNote")) {
      $("installNote").hidden = false;
      $("installNote").textContent = "Running as installed app on this device.";
    }
  }
}

// Registration is owned by boot() at the end of this file, which isolates
// each initialiser so one failure cannot take the page down.


/* ===== DEADLINE, PACKET STATE, VOICE =====
   The three portal panels, driven locally. The countdown is derived from the
   date rather than a fixed offset so it holds across the DST change, and it
   stops counting rather than going negative once 10 PM has passed. */

function msToDeadline() {
  const now = new Date();
  // 10 PM Eastern today; EDT until early November, then EST.
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const deadline = new Date(et);
  deadline.setHours(22, 0, 0, 0);
  return deadline.getTime() - et.getTime();
}

function renderDeadline() {
  const box = $("deadlineBox");
  const el = $("deadlineClock");
  if (!box || !el) return;
  const ms = msToDeadline();
  box.classList.toggle("soon", ms > 0 && ms < 2 * 3600 * 1000);
  box.classList.toggle("past", ms <= 0);
  if (ms <= 0) {
    el.textContent = "PAST DUE";
    return;
  }
  const s = Math.floor(ms / 1000);
  el.textContent = String(Math.floor(s / 3600)).padStart(2, "0") + ":" +
    String(Math.floor((s % 3600) / 60)).padStart(2, "0") + ":" +
    String(s % 60).padStart(2, "0");
}

/* Reflects what THIS session has produced. It is a local view of progress, not
   a read of the record — the record's own state is what the AP sees, and the
   nightly check is what decides whether the day counted. */
function markPacket(item, done) {
  // Both grids: the setup screen's and the post screen's. The post screen is
  // the one on view at the moment of filing, so it is the one that matters.
  document.querySelectorAll('.packet-item[data-item="' + item + '"]').forEach((el) => {
    el.classList.toggle("done", !!done);
    const st = el.querySelector(".packet-state");
    if (st) st.textContent = done ? "Filed" : "Due";
  });
  document.querySelectorAll(".packet-grid").forEach((grid) => {
    const total = grid.querySelectorAll(".packet-item").length;
    const filed = grid.querySelectorAll(".packet-item.done").length;
    const head = grid.id === "postPacketGrid" ? $("postPacketHeading") : $("packetHeading");
    if (head) head.textContent = (grid.id === "postPacketGrid" ? "Daily compliance packet — " : "Today's compliance packet — ") +
      filed + " of " + total + " complete";
  });
}

function elKey() { try { return localStorage.getItem("mrb_el_key") || ""; } catch (e) { return ""; } }

function renderVoiceState() {
  const el = $("voiceState");
  if (!el) return;
  const on = !!elKey();
  el.textContent = on ? "ElevenLabs voice" : "Device fallback";
  el.classList.toggle("on", on);
}

function initPanels() {
  renderDeadline();
  setInterval(renderDeadline, 1000);
  renderVoiceState();

  const keyIn = $("elKeyInput");
  if (keyIn) keyIn.value = elKey();

  const save = $("btnSaveVoice");
  if (save) save.addEventListener("click", () => {
    const v = ($("elKeyInput").value || "").trim();
    try {
      if (v) localStorage.setItem("mrb_el_key", v);
      else localStorage.removeItem("mrb_el_key");
      $("voiceMsg").textContent = v
        ? "Saved. Sessions on this device will use the ElevenLabs voice."
        : "Cleared. Sessions will use the phone's built-in voice.";
      $("voiceMsg").className = "upload-status ok";
    } catch (e) {
      $("voiceMsg").textContent = "Could not write to this browser's storage.";
      $("voiceMsg").className = "upload-status err";
    }
    renderVoiceState();
  });

  const clear = $("btnClearVoice");
  if (clear) clear.addEventListener("click", () => {
    try { localStorage.removeItem("mrb_el_key"); } catch (e) {}
    if ($("elKeyInput")) $("elKeyInput").value = "";
    $("voiceMsg").textContent = "Cleared. Sessions will use the phone's built-in voice.";
    $("voiceMsg").className = "upload-status";
    renderVoiceState();
  });
}

function bootDiagnostics(err) {
  console.error("Startup error:", err);
  try {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#B3261E;color:#FAFAF7;" +
      "font:12px/1.5 ui-monospace,monospace;padding:10px 14px;white-space:pre-wrap";
    box.textContent = "Startup error — " + (err && err.message ? err.message : String(err));
    document.body.appendChild(box);
  } catch (e) {}
}

function boot() {
  // Separate try blocks: a failure in one panel must not stop the others, and
  // must never leave the page unresponsive with no explanation.
  try { initPanels(); } catch (e) { bootDiagnostics(e); }
  try { if (typeof init === "function") init(); } catch (e) { bootDiagnostics(e); }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
