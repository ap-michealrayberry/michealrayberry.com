/* Recording Assistant — vanilla web component <recording-assistant>
   Records a 9:16 canvas-composited video with a branded overlay.

   This file is the DOM/media wiring. Everything decidable — overlays, HUD,
   sequence timing, monitors, parsers, endpoint calls — lives in the sibling
   modules, where it is unit-tested. Built with tools/recording-assistant/
   build.mjs into one self-contained classic script; the host page loads it
   with a plain <script src> and mounts the tag, unchanged. */

import {
  START_DATE, SEGMENTS, PHOTO_SEGS, TITLE_SEC, SHEET_CSV, ATTEST_ENDPOINT,
  WEIGHT_AUTO_START, VIEW_W, VIEW_H, HUD_W, HUD_H, FOOD_RE,
  MEDIAPIPE_VISION_MJS, MEDIAPIPE_WASM_ROOT, MEDIAPIPE_FOOD_MODEL,
} from './constants.js';
import { HTML, ensureStyles } from './ui.js';
import {
  drawCameraFrame, drawLiveOverlay, drawCountdown, drawTitleCard,
  drawPhotoPhase, drawRehearsalBackdrop, stampStill, stampMeal, drawXCard,
} from './overlay.js';
import { drawHud } from './hud.js';
import {
  seqTotal, segmentIndexAt, finishDecision, buildIntroLine, spokenWeight, dayInfo,
} from './session.js';
import {
  pickMimeType, sharpnessScore, framingStatus, FRAME_W, FRAME_H,
  videoFileName, photoFileName, mealFileName, xCardFileName, photoSlug,
} from './capture.js';
import { createVoice } from './voice.js';
import { createRecordClient, sha256Blob, parseChecklist, parseWeightPrefill, parseHealthWeight, parseMealPlan, minutesToDeadline } from './record.js';
import { createR2Uploader } from './upload.js';

const SEQ_TOTAL = seqTotal(SEGMENTS);

class RecordingAssistant extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;

    ensureStyles(document);

    const root = document.createElement('div');
    root.className = 'ra-root';
    root.innerHTML = HTML;
    this.appendChild(root);

    const $ = (sel) => root.querySelector(sel);
    const cam = $('.ra-cam');
    const view = $('.ra-view');
    const ctx = view.getContext('2d');
    const hud = $('.ra-hud');
    const hctx = hud.getContext('2d');
    // Daily inspection and the evening meal photo only. Corrective sessions
    // have their own tool at /mrb/corrective/, which owns the assigned
    // sequence and the position monitor.
    const W = VIEW_W, H = VIEW_H;
    view.width = W; view.height = H; // keep buffer in sync with draw math

    let stream = null, mediaRecorder = null, chunks = [];
    let facing = 'environment', recStart = 0, timerInt = null;
    let countdownLeft = 0, recording = false, audioCtx = null;
    let rehearse = false;
    let angleIdx = -1;
    let photos = [], photoPhase = null;
    let frameStatus = null, lastVideoUrl = null;

    // Key/voice fields → shared localStorage slots (same ones every tool reads).
    try {
      $('.ra-elkey').value = localStorage.getItem('mrb_el_key') || '';
      $('.ra-elvoice').value = localStorage.getItem('mrb_el_voice') || '';
      $('.ra-pkey').value = localStorage.getItem('mrb_packet_key') || '';
      if (!localStorage.getItem('mrb_el_key')) $('.ra-voice').open = true;
      $('.ra-elkey').addEventListener('change', (e) => localStorage.setItem('mrb_el_key', e.target.value.trim()));
      $('.ra-elvoice').addEventListener('change', (e) => localStorage.setItem('mrb_el_voice', e.target.value.trim()));
      $('.ra-pkey').addEventListener('change', (e) => localStorage.setItem('mrb_packet_key', e.target.value.trim()));
    } catch (e) {}

    let elDest = null;
    function ensureAC() {
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        // A context created before a user gesture starts suspended and
        // silently discards everything routed through it.
        if (audioCtx.state === 'suspended') audioCtx.resume();
        elDest = elDest || audioCtx.createMediaStreamDestination();
      } catch (e) {}
    }

    // AI voice when an ElevenLabs key is on this device (shared localStorage
    // slot with the other tools); device voice otherwise.
    const voice = createVoice({
      getKey: () => { try { return localStorage.getItem('mrb_el_key') || ''; } catch (e) { return ''; } },
      getVoiceId: () => { try { return localStorage.getItem('mrb_el_voice') || ''; } catch (e) { return ''; } },
      fetchFn: (...a) => fetch(...a),
      createObjectURL: (b) => URL.createObjectURL(b),
      createAudio: (u) => new Audio(u),
      wireAudio: (el) => { ensureAC(); const src = audioCtx.createMediaElementSource(el); src.connect(audioCtx.destination); },
      speech: () => speechSynthesis,
      Utterance: typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : function () {},
    });
    const say = voice.say;
    function prefetchLines() {
      return voice.prefetchTexts(SEGMENTS.map((s) => s.speak).concat(PHOTO_SEGS.map((s) => s.say)));
    }

    const today = new Date();
    const day = dayInfo(today, START_DATE);
    const { dayNum, dayLabel, isoStr } = day;
    $('.ra-day').value = isoStr + ' · ' + dayLabel;

    // Overlay state — read fresh each frame so the weight field edits show live.
    const ov = () => ({
      W, H, isoStr, dayLabel,
      weight: parseFloat($('.ra-w').value),
      code: challenge ? challenge.code : null,
      titleSec: TITLE_SEC,
    });

    // ---- Verification: challenge code + content fingerprint attestation ----
    let challenge = null, lastVideoBlob = null;
    const deviceKey = () => { try { return localStorage.getItem('mrb_packet_key') || ''; } catch (e) { return ''; } };
    const record = createRecordClient({
      endpoint: ATTEST_ENDPOINT, deviceKey, isoStr, dayNum, fetchFn: (...a) => fetch(...a),
    });
    const { fetchChallenge, attestPost, postPacket } = record;

    async function attestDaily() {
      try {
        const vh = lastVideoBlob ? await sha256Blob(lastVideoBlob) : '';
        const phs = [];
        for (const p of photos) phs.push(await sha256Blob(await (await fetch(p.dataUrl)).blob()));
        const ok = await attestPost({ kind: 'daily', code: challenge ? challenge.code : '', weight: parseFloat($('.ra-w').value) || '', video_sha256: vh, photo_sha256s: phs });
        setNote((ok ? 'ATTESTED ✓ — code and file fingerprints logged with server time. ' : 'ATTESTATION FAILED — fingerprints were not logged; flag it to the AP. ') +
          'Review the video and photos below (retake any photo), then file the packet — the video uploads itself to the record.', false);
      } catch (e) {}
    }

    const uploadVideoToR2 = createR2Uploader({
      endpoint: ATTEST_ENDPOINT, deviceKey, isoStr, fetchFn: (...a) => fetch(...a),
    });

    // ---- One-tap packet filing: photos + weight go straight to the record ----
    async function filePacket() {
      setNote('Filing photos and weight to the record…', false);
      let okAll = photos.length > 0;
      for (const p of photos) {
        const ok = await postPacket({
          name: photoFileName(day, p.slug),
          image_b64: String(p.dataUrl).split(',')[1],
          weight: parseFloat($('.ra-w').value) || '',
        });
        okAll = okAll && ok;
      }
      if (lastVideoBlob) {
        try {
          const mb = (lastVideoBlob.size / 1048576).toFixed(0);
          setNote('Uploading the inspection video (' + mb + ' MB) — 0%. Keep this page open.', false);
          const publicUrl = await uploadVideoToR2(lastVideoBlob, (pct) => {
            setNote('Uploading the inspection video (' + mb + ' MB) — ' + pct + '%. Keep this page open.', false);
          });
          await postPacket({ video_url: publicUrl });
        } catch (e) {
          okAll = false;
          setNote('VIDEO UPLOAD FAILED (' + e.message + ') — download the video below and give it to the AP.');
        }
      }
      await postPacket({ finalize: true });
      refreshChecklist();
      setNote(okAll
        ? 'Photos + weight are ON THE RECORD ✓ (attested). The video uploads itself to the record. The downloads below are backups.'
        : 'Some photos failed to file automatically — use Download All and upload them to the Drive folder manually.', false);
    }

    // ---- Packet checklist + deadline clock (reads the live tracker) ----
    let checklistData = null;
    async function refreshChecklist() {
      try {
        const t = await (await fetch(SHEET_CSV + '&cb=' + Date.now())).text();
        checklistData = parseChecklist(t, isoStr);
      } catch (e) { checklistData = null; }
      drawChecklist();
    }
    function drawChecklist() {
      const el = $('.ra-check');
      if (!el) return;
      try {
        const mins = minutesToDeadline(new Date());
        const done = checklistData && checklistData.weight && checklistData.photos && checklistData.video;
        const clockEl = el.querySelector('.ra-clock');
        clockEl.textContent = mins > 0
          ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm to 10:00 PM ET'
          : (done ? 'Past 10:00 PM ET — packet complete' : 'PAST 10:00 PM ET — OVERDUE');
        clockEl.style.color = (mins > 0 && mins >= 60) ? '#6B6A64' : (mins <= 0 && done ? '#6B6A64' : '#B3261E');
        clockEl.style.fontWeight = mins < 60 ? '600' : '400';
      } catch (e) {}
      const c = checklistData || {};
      const mark = (sel, on, label) => {
        const n = el.querySelector(sel);
        n.textContent = (on ? '✓ ' : '○ ') + label + (on ? ' — on the record' : ' — not yet on the record');
        n.style.color = on ? '#141412' : '#B3261E';
      };
      mark('.ra-ck-w', c.weight, 'Weight');
      mark('.ra-ck-p', c.photos, 'Daily photos');
      mark('.ra-ck-v', c.video, 'Inspection video (Drive archive)');
    }
    setInterval(drawChecklist, 30000);
    setInterval(refreshChecklist, 300000);
    refreshChecklist();

    fetch(SHEET_CSV)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => {
        if (!t) return;
        const { todayWeight, lastLogged } = parseWeightPrefill(t, isoStr);
        if (todayWeight !== null) $('.ra-w').value = todayWeight.toFixed(1); // today already logged → prefill
        else if (lastLogged !== null) $('.ra-w').placeholder = lastLogged.toFixed(1) + ' (last logged)';
      })
      .catch(() => {});

    // From WEIGHT_AUTO_START the official weight is SCALE-SYNCED (Withings →
    // Google Health → record) — no manual logging. The field locks to the
    // synced value (it still feeds the video overlay + spoken intro). If the
    // scale hasn't synced yet, the field stays open and prompts a weigh-in first.
    if (isoStr >= WEIGHT_AUTO_START) {
      const wl = $('.ra-w').closest('.ra-field').querySelector('label');
      if (wl) wl.textContent = "Today's Weight (scale-synced)";
      $('.ra-w').placeholder = 'step on the scale…';
      const lockWeight = () => fetch(SHEET_CSV.split('?')[0] + '?tqx=out:csv&sheet=Health')
        .then((r) => (r.ok ? r.text() : null))
        .then((t) => {
          if (!t) return;
          const w = parseHealthWeight(t, isoStr);
          if (w !== null) {
            $('.ra-w').value = w.toFixed(1);
            $('.ra-w').readOnly = true;
            return;
          }
          setTimeout(lockWeight, 120000); // scale not synced yet — keep checking
        })
        .catch(() => {});
      lockWeight();
    }

    // AP-assigned meal plan for today (optional 'Meal Plan' tab).
    let mealPlan = null, _mealPlanOk = null, _mealOverride = false;
    fetch(SHEET_CSV.split('?')[0] + '?tqx=out:csv&sheet=' + encodeURIComponent('Meal Plan'))
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => {
        if (!t) return;
        mealPlan = parseMealPlan(t, isoStr);
        if (mealPlan) setMealNote('ASSIGNED MEAL TODAY: ' + mealPlan.meal + ' — the camera will check for it at capture.');
      })
      .catch(() => {});

    // Meal-mode feedback has its own target so it never overwrites inspection
    // guidance (and vice versa) — both are visible at once.
    const setMealNote = (msg) => { $('.ra-mealnote').textContent = msg; };

    // textContent only: nothing written here is markup, and an error string
    // interpolated into innerHTML is a sink waiting for a message it did not
    // author (a device name, a filename, a server response).
    const setNote = (msg) => { $('.ra-note').textContent = msg; };

    async function startCamera() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      try {
        // 1080p for the live/recording phase — downscaling a 4K feed every frame
        // was the main stutter source. The photo phase bumps the track to 4K.
        /* Audio is captured, with echo cancellation OFF. The ElevenLabs voice
           is routed into the recording directly, but the device fallback voice
           only exists as sound in the room — and the browser would treat that
           as speaker bleed and subtract it, leaving a silent recording on any
           day the API is unavailable. */
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        setNote('Camera failed: ' + e.message + ' — needs HTTPS and camera permission.');
        return;
      }
      cam.srcObject = stream;
      await cam.play();
      startLoop();
      keepAwake();
    }

    // Screen wake lock — phone must not sleep mid-session or during setup.
    let wakeLock = null;
    async function keepAwake() {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && stream) keepAwake();
    });

    // Live-switch the camera resolution: low for smooth recording, high for stills.
    async function setVideoRes(w, h) {
      try {
        const t = stream && stream.getVideoTracks()[0];
        if (t) {
          await t.applyConstraints({ width: { ideal: w }, height: { ideal: h } });
          await new Promise((r) => setTimeout(r, 250)); // let exposure/focus settle
        }
      } catch (e) {}
    }

    let _loopOn = false;
    function startLoop() {
      if (_loopOn) return;
      _loopOn = true;
      requestAnimationFrame(drawLoop);
    }

    function drawLoop() {
      if (rehearse && !stream) {
        drawRehearsalBackdrop(ctx, ov());
        drawLiveOverlay(ctx, ov());
        if (photoPhase) drawPhotoPhase(ctx, ov(), photoPhase);
        if (countdownLeft > 0) drawCountdown(ctx, ov(), countdownLeft);
      } else if (cam.readyState >= 2) {
        drawCameraFrame(ctx, cam, { W, H, facing });
        drawLiveOverlay(ctx, ov());
        if (recording) {
          const elapsed = (Date.now() - recStart) / 1000;
          if (elapsed < TITLE_SEC) drawTitleCard(ctx, ov(), elapsed);
        }
        if (photoPhase) drawPhotoPhase(ctx, ov(), photoPhase);
        if (countdownLeft > 0) drawCountdown(ctx, ov(), countdownLeft);
      }
      drawHud(hctx, {
        HW: HUD_W, HH: HUD_H,
        recording,
        elapsed: recording ? (Date.now() - recStart) / 1000 : 0,
        segments: SEGMENTS,
        angleIdx,
        showGuide: !!(stream && !photoPhase && countdownLeft <= 0 && cam.readyState >= 2 && !rehearse),
        frameStatus,
      });
      requestAnimationFrame(drawLoop);
    }

    // Coarse framing heuristic — informational only, never blocks recording.
    const _anal = document.createElement('canvas');
    _anal.width = FRAME_W; _anal.height = FRAME_H;
    function checkFraming() {
      if (!stream || recording || countdownLeft > 0 || photoPhase || rehearse || cam.readyState < 2) { frameStatus = null; return; }
      try {
        const a = _anal.getContext('2d', { willReadFrequently: true });
        a.drawImage(cam, 0, 0, FRAME_W, FRAME_H);
        const d = a.getImageData(0, 0, FRAME_W, FRAME_H).data;
        frameStatus = framingStatus(d);
      } catch (e) { frameStatus = null; }
    }
    setInterval(checkFraming, 500);

    function beep(freq, durMs, when = 0) {
      try {
        ensureAC();
        if (!audioCtx) return;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = freq;
        o.type = 'sine';
        g.gain.setValueAtTime(0.4, audioCtx.currentTime + when);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + when + durMs / 1000);
        o.connect(g); g.connect(audioCtx.destination);
        if (elDest) g.connect(elDest);
        o.start(audioCtx.currentTime + when);
        o.stop(audioCtx.currentTime + when + durMs / 1000 + 0.05);
      } catch (e) {}
    }

    // Still photo captured during the posed photo phase (FRONT/LEFT/REAR/RIGHT).
    // Full camera frame — no cropping. The canvas adopts the video's native
    // aspect ratio (9:16 portrait on a phone) so nothing is zoomed or cut off;
    // the info bars are translucent overlays instead of solid crops.
    function grabFrame() {
      const vw = cam.videoWidth, vh = cam.videoHeight;
      if (!vw || !vh) return null;
      // Full native stream resolution, capped at 2160 wide (4K-class stills).
      const PW = Math.min(2160, vw), PH = Math.round(PW * vh / vw);
      const c = document.createElement('canvas');
      c.width = PW; c.height = PH;
      const p = c.getContext('2d');
      if (facing === 'user') {
        p.save(); p.translate(PW, 0); p.scale(-1, 1);
        p.drawImage(cam, 0, 0, PW, PH);
        p.restore();
      } else {
        p.drawImage(cam, 0, 0, PW, PH);
      }
      return c;
    }
    function sharpness(c) {
      const sw = 120, sh = Math.max(2, Math.round(c.height * 120 / c.width));
      const s = document.createElement('canvas');
      s.width = sw; s.height = sh;
      const q = s.getContext('2d');
      q.drawImage(c, 0, 0, sw, sh);
      return sharpnessScore(q.getImageData(0, 0, sw, sh).data, sw, sh);
    }
    async function captureStill(label) {
      // Anti-blur burst: grab 3 frames over ~320ms, keep the sharpest.
      const shots = [];
      for (let s = 0; s < 3; s++) {
        const f = grabFrame();
        if (f) shots.push(f);
        if (s < 2) await new Promise((r) => setTimeout(r, 160));
      }
      if (!shots.length) return;
      let c = shots[0], bestV = -1;
      for (const f of shots) { const v = sharpness(f); if (v > bestV) { bestV = v; c = f; } }
      const PW = c.width, PH = c.height;
      const k = PW / 1080; // scale factor for overlay text and bars
      stampStill(c.getContext('2d'), {
        PW, PH, k, label, isoStr, dayLabel,
        weight: parseFloat($('.ra-w').value),
        code: challenge ? challenge.code : null,
      });
      const entry = {
        label: label,
        slug: photoSlug(label),
        dataUrl: c.toDataURL('image/jpeg', 0.92),
      };
      const ix = photos.findIndex((p) => p.label === label);
      if (ix >= 0) photos[ix] = entry; else photos.push(entry); // retake replaces in place
    }

    // X share card — ready to attach to the daily post.
    function buildXCard() {
      const front = photos.find((p) => p.slug === 'front') || photos[0];
      if (!front) return false;
      const img = new Image();
      img.onload = () => {
        const CW = 1080, CH = 1350;
        const c = document.createElement('canvas');
        c.width = CW; c.height = CH;
        drawXCard(c.getContext('2d'), img, {
          CW, CH, isoStr, dayLabel,
          weight: parseFloat($('.ra-w').value),
        });
        const a = document.createElement('a');
        a.href = c.toDataURL('image/jpeg', 0.92);
        a.download = xCardFileName(day);
        a.click();
      };
      img.src = front.dataUrl;
      return true;
    }

    // Evening meal photograph (§3(5)). Independent of the inspection sequence:
    // no uniform, no pose, no weight, no countdown — one tap, day-stamped so the
    // archived file is self-evidencing about which Project Day it belongs to.
    function captureMeal(code, planTag) {
      const vw = cam.videoWidth, vh = cam.videoHeight;
      if (!vw || !vh) return false;
      const PW = Math.min(2160, vw), PH = Math.round(PW * vh / vw);
      const k = PW / 1080;
      const c = document.createElement('canvas');
      c.width = PW; c.height = PH;
      const p = c.getContext('2d');
      if (facing === 'user') {
        p.save(); p.translate(PW, 0); p.scale(-1, 1);
        p.drawImage(cam, 0, 0, PW, PH);
        p.restore();
      } else {
        p.drawImage(cam, 0, 0, PW, PH);
      }
      stampMeal(p, {
        PW, PH, k, isoStr, dayLabel, planTag, code,
        timeStr: new Date().toLocaleTimeString('en-US', { hour12: false }),
      });
      const dl = $('.ra-mealdl');
      dl.href = c.toDataURL('image/jpeg', 0.92);
      dl.download = mealFileName(day);
      dl.textContent = 'Download Meal Photo (' + dayLabel + ')';
      dl.classList.remove('ra-hide');
      return true;
    }

    // Guided posed-photo phase, run after the video ends — same session, one tap.
    async function runPhotoPhase() {
      await setVideoRes(3840, 2160); // 4K-class stills
      for (let i = 0; i < PHOTO_SEGS.length; i++) {
        const seg = PHOTO_SEGS[i];
        say(seg.say);
        for (let t = seg.wait; t > 0; t--) {
          photoPhase = { label: seg.label, count: t };
          if (t <= 3) beep(660, 100);
          await new Promise((r) => setTimeout(r, 1000));
        }
        photoPhase = null;
        await captureStill(seg.label);
        beep(880, 150);
      }
      say('Session complete. Review the video and photos below.');
      $('.ra-photos').classList.remove('ra-hide');
      $('.ra-xcard').classList.remove('ra-hide');
      $('.ra-all').classList.remove('ra-hide');
      showReview();
      attestDaily().then(() => filePacket());
      setNote(
        'Review the video and all four photos below — retake any photo individually if needed. Then Download All — the downloads are backups; everything required has already filed itself to the record.',
        true
      );
    }

    // ---- Review screen: playback + per-photo retake ----
    function refreshThumbs() {
      const grid = $('.ra-thumbs');
      grid.innerHTML = '';
      photos.forEach((p, i) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'text-align:center';
        const img = document.createElement('img');
        img.src = p.dataUrl;
        img.style.cssText = 'width:100%;display:block;border:1px solid #141412';
        const lab = document.createElement('div');
        lab.textContent = p.label;
        lab.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;margin:5px 0";
        const b = document.createElement('button');
        b.textContent = 'Retake';
        b.className = 'ra-ghost';
        b.style.cssText = 'padding:7px 4px;font-size:10px';
        b.addEventListener('click', () => retakePhoto(i));
        cell.appendChild(img); cell.appendChild(lab); cell.appendChild(b);
        grid.appendChild(cell);
      });
    }
    function showReview() {
      if (lastVideoUrl) $('.ra-replay').src = lastVideoUrl;
      refreshThumbs();
      $('.ra-reviewbox').classList.remove('ra-hide');
    }
    async function retakePhoto(i) {
      if (recording || countdownLeft > 0 || photoPhase) return;
      if (!stream) { setNote('Camera is off — tap Begin Daily Inspection to restart it, then retake.'); return; }
      await setVideoRes(3840, 2160);
      const p = photos[i];
      const seg = PHOTO_SEGS.find((s) => s.label === p.label) || PHOTO_SEGS[0];
      say(seg.say);
      for (let t = seg.wait; t > 0; t--) {
        photoPhase = { label: p.label, count: t };
        if (t <= 3) beep(660, 100);
        await new Promise((r) => setTimeout(r, 1000));
      }
      photoPhase = null;
      await captureStill(p.label);
      beep(880, 150);
      refreshThumbs();
      say('Retake captured.');
      attestDaily().then(() => filePacket()); // re-log fingerprints + re-file — the retaken photo changed a hash
    }

    function beginRecording() {
      chunks = [];
      photos = [];
      if (!rehearse) {
        const canvasStream = view.captureStream(30);
        /* Narration reaches the tape by two independent paths, so the recording
           is never silent: the ElevenLabs voice and the beeps are routed into
           the audio graph directly, and the camera's microphone (captured with
           echo cancellation disabled) picks up the device fallback voice from
           the room on any day the API is unavailable. */
        ensureAC();
        try {
          const micTracks = stream ? stream.getAudioTracks() : [];
          // Only wire the microphone if the daily path has not already done so.
          if (micTracks.length && audioCtx && elDest && !audioCtx.__micWired) {
            const micSrc = audioCtx.createMediaStreamSource(new MediaStream(micTracks));
            micSrc.connect(elDest);
            audioCtx.__micWired = 1;
          }
        } catch (e) {}
        if (elDest) elDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));

        const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t));

        mediaRecorder = new MediaRecorder(
          canvasStream,
          mime ? { mimeType: mime, videoBitsPerSecond: 9000000 } : { videoBitsPerSecond: 9000000 }
        );
        mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop = finishRecording;
        mediaRecorder.start(1000);
      }

      recording = true;
      recStart = Date.now();
      angleIdx = 0;
      // Intro line already built + prefetched at countdown start (buildIntro).
      beep(880, 150); beep(880, 150, 0.22);
      say(SEGMENTS[0].speak);

      $('.ra-recdot').classList.add('on');
      $('.ra-stopbtn').classList.remove('ra-hide');
      $('.ra-dl').classList.add('ra-hide');
      $('.ra-all').classList.add('ra-hide');

      timerInt = setInterval(() => {
        const elapsed = (Date.now() - recStart) / 1000;
        const seconds = Math.floor(elapsed);
        const timer = $('.ra-timer');
        timer.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        timer.classList.toggle('warn', seconds >= SEQ_TOTAL - 3);
        const idx = segmentIndexAt(SEGMENTS, elapsed);
        if (idx !== angleIdx) {
          angleIdx = idx;
          beep(660, 120);
          say(SEGMENTS[idx].speak);
        }
        if (elapsed >= SEQ_TOTAL) {
          stopRecording();
          if (rehearse) {
            say('Rehearsal complete. Nothing was recorded.');
            setNote('Rehearsal complete — no video, no photos, nothing to upload. Run the real inspection with the camera when ready.', true);
            rehearse = false;
            $('.ra-start').textContent = 'Begin Daily Inspection';
          } else {
            runPhotoPhase();
          }
        }
      }, 200);
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      clearInterval(timerInt);
      recording = false;
      angleIdx = -1;
      beep(440, 450);
      $('.ra-recdot').classList.remove('on');
      $('.ra-stopbtn').classList.add('ra-hide');
      $('.ra-start').classList.remove('ra-hide');
      $('.ra-start').textContent = 'Re-record Inspection';
    }

    function finishRecording() {
      const durMs = Date.now() - recStart;
      const weight = parseFloat($('.ra-w').value);
      const type = mediaRecorder.mimeType || 'video/webm';
      const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type });

      if (!finishDecision(durMs, SEQ_TOTAL).accept) {
        setNote('Stopped at ' + (durMs / 1000).toFixed(1) +
          's — the inspection requires the full guided sequence (' + SEQ_TOTAL + 's). Re-record from the start.');
        return;
      }

      const deliver = (finalBlob) => {
        const dl = $('.ra-dl');
        dl.href = URL.createObjectURL(finalBlob);
        dl.download = videoFileName(day, ext);
        dl.textContent = 'Download Video (' + dayLabel + ' · ' +
          (finalBlob.size / 1048576).toFixed(1) + ' MB · ' + Math.round(durMs / 1000) + 's)';
        dl.classList.remove('ra-hide');
        lastVideoUrl = dl.href;
        lastVideoBlob = finalBlob;
        $('.ra-yt').value = 'Micheal Ray Berry — ' + dayLabel + ' Daily Inspection' +
          (isNaN(weight) ? '' : ' · ' + weight.toFixed(1) + ' LB') +
          ' | Public Accountability Project';
        $('.ra-titlebox').classList.remove('ra-hide');
        $('.ra-desc').value =
          dayLabel + ' — official daily inspection. The public weight loss accountability record of Micheal Ray Berry: 340 → 175 lbs, documented every single day' +
          (isNaN(weight) ? '.' : '. Weight today: ' + weight.toFixed(1) + ' lb.') + '\n\n' +
          'Every day: a standardized four-angle inspection video, a public weigh-in, and daily accountability photos. Up, down, or flat — it gets posted.\n\n' +
          'Full record, weigh-in log, progress photos, violation log, and the signed agreement:\nhttps://michealrayberry.com';
        $('.ra-descbox').classList.remove('ra-hide');
        setNote('Video ready — posed photo sequence running…', false);
      };

      if (ext === 'webm' && typeof ysFixWebmDuration === 'function') {
        ysFixWebmDuration(blob, durMs, deliver);
      } else {
        deliver(blob);
      }
    }

    // Builds the intro line (day/date/weight) — called at countdown start so the
    // voice file is fetched during the countdown, not late into the recording.
    function buildIntro() {
      const w = parseFloat($('.ra-w').value);
      SEGMENTS[0].speak = buildIntroLine({
        dayNum,
        spokenDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        weightSpoken: spokenWeight(w),
      });
    }

    $('.ra-start').addEventListener('click', async () => {
      if (recording || countdownLeft > 0) return;
      const weight = parseFloat($('.ra-w').value);
      if (isNaN(weight)) {
        setNote("Enter today's weight first — it goes on the overlay.");
        $('.ra-w').focus();
        return;
      }
      if (!stream) { await startCamera(); if (!stream) return; }
      $('.ra-reviewbox').classList.add('ra-hide');
      await setVideoRes(1920, 1080); // back to the smooth recording resolution
      setNote('Requesting verification code…', false);
      challenge = await fetchChallenge('daily');
      if (!challenge) {
        setNote('Verification code unavailable — check the connection and try again. The inspection cannot start unverified.');
        return;
      }
      buildIntro();
      setNote('Preparing voice lines…', false);
      await prefetchLines();
      setNote('', false);
      countdownLeft = parseInt($('.ra-cd').value, 10);
      say(countdownLeft + ' seconds. Take the inspection position.');
      $('.ra-start').classList.add('ra-hide');
      const cd = setInterval(() => {
        countdownLeft -= 0.1;
        if (countdownLeft <= 0) { countdownLeft = 0; clearInterval(cd); beginRecording(); }
      }, 100);
    });
    /* Safety stop — always available during a take, never a violation. The
       take itself is then discarded by finishRecording (one continuous take:
       a partial recording is never delivered). The pre-refactor file showed
       this button but never attached its listener; the setup smoke test now
       pins it. */
    $('.ra-stopbtn').addEventListener('click', () => {
      if (recording) stopRecording();
    });
    $('.ra-rehearse').addEventListener('click', () => {
      if (recording || countdownLeft > 0) return;
      rehearse = true;
      startLoop(); // no camera — the loop draws the rehearsal panel
      buildIntro();
      (async () => {
        setNote('Preparing voice lines…', false);
        await prefetchLines();
        setNote('', false);
        countdownLeft = parseInt($('.ra-cd').value, 10);
        say(countdownLeft + ' seconds. Rehearsal only — nothing is recorded. Take the inspection position.');
        $('.ra-start').classList.add('ra-hide');
        const cd = setInterval(() => {
          countdownLeft -= 0.1;
          if (countdownLeft <= 0) { countdownLeft = 0; clearInterval(cd); beginRecording(); }
        }, 100);
      })();
    });
    $('.ra-flip').addEventListener('click', () => {
      facing = facing === 'user' ? 'environment' : 'user';
      if (stream) startCamera();
    });
    $('.ra-all').addEventListener('click', () => {
      $('.ra-dl').click();
      photos.forEach((p, i) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = p.dataUrl;
          a.download = photoFileName(day, p.slug);
          a.click();
        }, 500 + i * 450);
      });
      setTimeout(() => buildXCard(), 500 + photos.length * 450 + 300);
    });
    $('.ra-photos').addEventListener('click', () => {
      photos.forEach((p, i) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = p.dataUrl;
          a.download = photoFileName(day, p.slug);
          a.click();
        }, i * 400);
      });
    });
    $('.ra-xcard').addEventListener('click', () => { buildXCard(); });
    $('.ra-copy').addEventListener('click', () => {
      const input = $('.ra-yt');
      navigator.clipboard.writeText(input.value).then(() => {
        $('.ra-copy').textContent = 'Copied';
        setTimeout(() => { $('.ra-copy').textContent = 'Copy'; }, 1500);
      }).catch(() => {
        input.select();
        document.execCommand('copy');
      });
    });
    $('.ra-copydesc').addEventListener('click', () => {
      const ta = $('.ra-desc');
      navigator.clipboard.writeText(ta.value).then(() => {
        $('.ra-copydesc').textContent = 'Copied';
        setTimeout(() => { $('.ra-copydesc').textContent = 'Copy description'; }, 1500);
      }).catch(() => {
        ta.select();
        document.execCommand('copy');
      });
    });

    // ---- Food verification: on-device image classifier gates the meal photo ----
    let _foodClf = null;
    async function loadFoodClf() {
      if (_foodClf) return _foodClf;
      const v = await import(MEDIAPIPE_VISION_MJS);
      const files = await v.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
      _foodClf = await v.ImageClassifier.createFromOptions(files, {
        baseOptions: { modelAssetPath: MEDIAPIPE_FOOD_MODEL },
        maxResults: 10,
        runningMode: 'IMAGE',
      });
      return _foodClf;
    }

    $('.ra-meal').addEventListener('click', async () => {
      if (recording || countdownLeft > 0) return;
      if (!stream) {
        setMealNote('Tap Begin Daily Inspection (or just allow the camera) first, then capture.');
        return;
      }
      await setVideoRes(3840, 2160);
      setMealNote('Requesting verification code…');
      const ch = await fetchChallenge('meal');
      if (!ch) { setMealNote('Verification code unavailable — check the connection. The meal photo cannot be captured unverified.'); return; }
      setMealNote('Checking for food…');
      let foodOk = false, seen = '';
      try {
        const clf = await loadFoodClf();
        const f = grabFrame();
        const sc = document.createElement('canvas');
        sc.width = 480; sc.height = Math.max(2, Math.round((480 * f.height) / f.width));
        sc.getContext('2d').drawImage(f, 0, 0, sc.width, sc.height);
        const res = clf.classify(sc);
        const cats = (res.classifications && res.classifications[0] && res.classifications[0].categories) || [];
        seen = cats.slice(0, 3).map((c) => c.categoryName).join(', ');
        foodOk = cats.some((c) => FOOD_RE.test(c.categoryName) && c.score >= 0.08);
        if (mealPlan && mealPlan.labels.length) {
          _mealPlanOk = cats.some((c) => mealPlan.labels.some((L) => c.categoryName.toLowerCase().indexOf(L.toLowerCase()) !== -1) && c.score >= 0.06);
        }
      } catch (e) { foodOk = true; seen = 'check unavailable — accepted'; } // a classifier outage must never block the meal record
      if (!foodOk) {
        beep(220, 400);
        setMealNote('NO FOOD DETECTED (saw: ' + (seen || 'nothing recognizable') + '). Point the camera at the meal as served — fill the frame with the plate — and capture again. Nothing was filed.');
        return;
      }
      if (mealPlan && mealPlan.labels.length && _mealPlanOk === false && !_mealOverride) {
        _mealOverride = true;
        beep(220, 400);
        setMealNote('ASSIGNED MEAL NOT CONFIRMED — today’s plan is “' + mealPlan.meal + '” but the camera saw: ' + seen + '. Re-frame and capture again, or tap Capture once more to file anyway (it will be attested as PLAN NOT CONFIRMED for the AP).');
        return;
      }
      const planTag = mealPlan && mealPlan.labels.length ? (_mealPlanOk ? ' · PLAN ✓' : ' · PLAN NOT CONFIRMED') : '';
      if (captureMeal(ch.code, planTag)) {
        _mealOverride = false;
        beep(880, 150);
        setMealNote('Food verified ✓ — filing to the record…');
        const mdl = $('.ra-mealdl');
        try {
          const blob = await (await fetch(mdl.href)).blob();
          const hash = await sha256Blob(blob);
          const filed = await postPacket({ name: mdl.download, image_b64: String(mdl.href).split(',')[1] });
          const att = await attestPost({ kind: 'meal' + (mealPlan && mealPlan.labels.length ? (_mealPlanOk ? '-plan-confirmed' : '-plan-NOT-confirmed') : ''), code: ch.code, weight: '', video_sha256: '', photo_sha256s: [hash] });
          setMealNote(filed && att
            ? 'Meal is ON THE RECORD ✓ — live-captured, food-verified' + (mealPlan && mealPlan.labels.length ? (_mealPlanOk ? ', assigned meal confirmed ✓' : ', PLAN NOT CONFIRMED (logged for AP review)') : '') + ', code ' + ch.code + ' stamped, fingerprint attested. Download below is a backup.'
            : 'Captured and code-stamped, but filing/attestation had a problem — download the photo and upload it to the Drive folder manually.');
        } catch (e) {
          setMealNote('Captured, but filing failed — download the photo and upload it manually.');
        }
      }
    });

    // Camera comes on immediately so he can position with the framing guide
    // before starting — no recording until Begin is tapped.
    startCamera();

    this._cleanup = () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    };
  }

  disconnectedCallback() {
    if (this._cleanup) this._cleanup();
    this._init = false;
    this.innerHTML = '';
  }
}

if (!customElements.get('recording-assistant')) {
  customElements.define('recording-assistant', RecordingAssistant);
}
