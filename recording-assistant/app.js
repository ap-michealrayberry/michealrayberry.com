/* Recording Assistant — the Participant's only capture tool.
   Session core + canvas overlay engine + attestation + resumable auto-upload,
   shared by every capture mode. Custom element: <recording-assistant>.

   Contract invariants enforced here (see RECORDING-ASSISTANT-SPEC.md):
   - One take: pause/stop/app-switch/track-mute ends a take as INCOMPLETE
     (except the safety stop).
   - Server time only for deadlines: session timestamps come from the backend.
   - The challenge code is spoken aloud AND burned into every frame.
   - Publication routing is server-side; the client never picks a destination.
   - The safety stop cannot be removed and never declares a violation. */
(function () {
  'use strict';
  if (customElements.get('recording-assistant')) return;

  const API = '';
  const W = 1080, H = 1920; // 9:16 record canvas @ 1080p — do not raise (2.5K stutters)
  const PART_BYTES = (window.RAUploadQueue && window.RAUploadQueue.PART_BYTES) || 5 * 1024 * 1024;

  const MODE_LABELS = {
    'daily-inspection': 'Daily Inspection',
    'weigh-in': 'Weigh-in',
    'milestone-weigh-in': 'Milestone Weigh-in',
    'meal-photo': 'Meal Photo',
    'violation-portrait': 'Violation Portrait',
    'violation-resolution': 'Violation Resolution',
    'corrective-session': 'Corrective Session',
    'location-check-in': 'Location Check-in',
  };

  const CSS = `
    .ra-root{background:#FAFAF7;color:#141412;font-family:'IBM Plex Sans',system-ui,sans-serif;display:flex;flex-direction:column;width:100%;max-width:560px;margin:0 auto;}
    .ra-root *{box-sizing:border-box;margin:0;padding:0;}
    .ra-stage{position:relative;display:flex;justify-content:center;padding:16px 8px 4px;}
    .ra-cam{display:none;}
    .ra-view{max-width:100%;max-height:60vh;aspect-ratio:9/16;border:1px solid #141412;background:#000;}
    .ra-controls{padding:12px 16px 40px;}
    .ra-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;}
    .ra-mode{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:12px 8px;border:1px solid #141412;background:#FFFFFF;color:#141412;cursor:pointer;text-align:center;}
    .ra-mode[disabled]{opacity:.35;cursor:not-allowed;border-style:dashed;}
    .ra-mode.on{background:#141412;color:#FAFAF7;}
    .ra-safety{width:100%;background:#B3261E;color:#fff;font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.12em;text-transform:uppercase;padding:16px;border:none;cursor:pointer;margin-bottom:10px;}
    .ra-btn{width:100%;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:14px;border:1px solid #141412;background:#141412;color:#FAFAF7;cursor:pointer;margin-bottom:10px;}
    .ra-btn.ghost{background:none;color:#141412;}
    .ra-hide{display:none!important;}
    .ra-note{font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.6;color:#6B6A64;margin-top:10px;}
    .ra-note.warn{color:#B3261E;}
    .ra-field{margin-bottom:10px;}
    .ra-field label{display:block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#6B6A64;margin-bottom:5px;}
    .ra-field input{width:100%;background:#FFFFFF;border:1px solid #141412;font-family:'IBM Plex Mono',monospace;font-size:16px;padding:11px 12px;}
    .ra-uniform{font-family:'IBM Plex Mono',monospace;font-size:11px;padding:8px 10px;border:1px solid #141412;margin-bottom:12px;letter-spacing:.06em;}
    .ra-uniform.pink{background:#F7D6E0;border-color:#B3261E;}
    .ra-safety-conditions{border:1px solid #B3261E;padding:10px 12px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;line-height:1.6;color:#141412;margin-bottom:12px;}
    .ra-review a{color:#B3261E;font-family:'IBM Plex Mono',monospace;font-size:11px;}
  `;

  const HTML = `
    <div class="ra-stage">
      <video class="ra-cam" playsinline muted></video>
      <canvas class="ra-view" width="1080" height="1920"></canvas>
    </div>
    <div class="ra-controls">
      <button class="ra-safety ra-hide">■ SAFETY STOP — ends the take, no penalty</button>
      <div class="ra-uniform ra-uniform-box ra-hide"></div>
      <div class="ra-safety-conditions ra-hide">
        STOP for pain, dizziness, shortness of breath, weakness, loss of balance, equipment danger, or any reasonable safety concern. A good-faith safety stop is never an additional violation. §9 medical &amp; safety review: <a href="/#review" style="color:#B3261E">open review</a>.
      </div>
      <div class="ra-modes"></div>
      <div class="ra-field ra-key-box">
        <label>Record key (from the AP — authorizes filing; this browser only)</label>
        <input class="ra-key" type="password" placeholder="required to capture">
      </div>
      <div class="ra-mode-panel"></div>
      <button class="ra-btn ra-begin ra-hide">Begin</button>
      <div class="ra-review ra-hide"></div>
      <p class="ra-note"></p>
    </div>
  `;

  class RecordingAssistant extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      if (!document.getElementById('ra-styles')) {
        const st = document.createElement('style');
        st.id = 'ra-styles'; st.textContent = CSS;
        document.head.appendChild(st);
      }
      const root = document.createElement('div');
      root.className = 'ra-root';
      root.innerHTML = HTML;
      this.appendChild(root);
      this.$ = (s) => root.querySelector(s);

      this.stream = null;
      this.facing = 'environment';
      this.mode = null;
      this.session = null;
      this.recording = false;
      this.wakeLock = null;
      this.audioCtx = null;
      this.elDest = null;

      const cam = this.$('.ra-cam');
      const view = this.$('.ra-view');
      this.cam = cam; this.view = view;
      this.ctx = view.getContext('2d');
      view.width = W; view.height = H;

      try { this.$('.ra-key').value = localStorage.getItem('mrb_packet_key') || ''; } catch (e) {}
      this.$('.ra-key').addEventListener('change', (e) => {
        try { localStorage.setItem('mrb_packet_key', e.target.value.trim()); } catch (err) {}
      });

      this.$('.ra-safety').addEventListener('click', () => this.safetyStop());
      this.$('.ra-begin').addEventListener('click', () => this.begin());

      // Resume any upload that a crash or reload left mid-flight.
      this.resumePendingUploads();
      this.loadContext();
      this.startCamera();

      this._cleanup = () => {
        if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
        if (this.wakeLock) { try { this.wakeLock.release(); } catch (e) {} }
      };
    }
    disconnectedCallback() { if (this._cleanup) this._cleanup(); this._init = false; this.innerHTML = ''; }

    key() { try { return localStorage.getItem('mrb_packet_key') || ''; } catch (e) { return ''; } }
    headers() { return { 'x-packet-key': this.key() }; }
    setNote(msg, warn) { const n = this.$('.ra-note'); n.textContent = msg || ''; n.classList.toggle('warn', !!warn); }

    async loadContext() {
      try {
        const r = await fetch(API + '/api/recording/context', { headers: this.headers() });
        if (!r.ok) { this.renderModes({}); return; }
        this.context = await r.json();
        this.renderModes(this.context.modes || {});
        if (this.context.uniform === 'penalty-pink') this.showUniform(true);
      } catch (e) { this.renderModes({}); }
    }

    renderModes(available) {
      const box = this.$('.ra-modes');
      box.innerHTML = '';
      Object.keys(MODE_LABELS).forEach((mode) => {
        const b = document.createElement('button');
        b.className = 'ra-mode';
        b.textContent = MODE_LABELS[mode];
        const enabled = available[mode] !== false;
        if (!enabled) { b.disabled = true; b.title = 'Ships dark until the signed rule is active'; }
        b.addEventListener('click', () => this.selectMode(mode));
        box.appendChild(b);
      });
    }

    selectMode(mode) {
      if (this.recording) return;
      this.mode = mode;
      Array.from(this.$('.ra-modes').children).forEach((b) =>
        b.classList.toggle('on', b.textContent === MODE_LABELS[mode]));
      const panel = this.$('.ra-mode-panel');
      panel.innerHTML = '';
      // Corrective sessions need a level; everything else reads requirements
      // from the server-issued session.
      if (mode === 'corrective-session') {
        panel.innerHTML =
          '<div class="ra-field"><label>Level assigned by AP</label>' +
          '<select class="ra-level" style="width:100%;font-family:IBM Plex Mono,monospace;font-size:16px;padding:11px 12px;border:1px solid #141412">' +
          '<option value="15">Level 1 · 15 min</option><option value="20">Level 2 · 20 min</option><option value="30">Level 3 · 30 min</option>' +
          '</select></div>';
      }
      this.$('.ra-begin').classList.remove('ra-hide');
      this.$('.ra-begin').textContent = 'Begin ' + MODE_LABELS[mode];
      this.setNote('');
    }

    showUniform(pink) {
      const box = this.$('.ra-uniform-box');
      box.classList.remove('ra-hide');
      box.classList.toggle('pink', !!pink);
      box.textContent = pink
        ? 'PENALTY UNIFORM REQUIRED — plain pink unitard, plain black shoes, no name tag, fully opaque.'
        : 'STANDARD UNIFORM — plain black unitard.';
    }

    // ---- Camera + wake lock ----
    async startCamera() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        this.setNote('Camera unavailable: ' + e.message + '. Needs HTTPS and camera permission — enable it in your browser settings, then reload.', true);
        return;
      }
      this.cam.srcObject = this.stream;
      await this.cam.play();
      this.keepAwake();
      if (!this._loop) { this._loop = true; requestAnimationFrame(() => this.draw()); }
    }
    async keepAwake() { try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }

    // ---- Overlay engine (burned into every recorded frame) ----
    draw() {
      const ctx = this.ctx, cam = this.cam;
      if (cam && cam.readyState >= 2) {
        const vw = cam.videoWidth, vh = cam.videoHeight;
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale, dh = vh * scale, dx = (W - dw) / 2, dy = (H - dh) / 2;
        if (this.facing === 'user') { ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(cam, W - dx - dw, dy, dw, dh); ctx.restore(); }
        else ctx.drawImage(cam, dx, dy, dw, dh);
        if (this.recording || this.session) this.overlay();
      } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
      requestAnimationFrame(() => this.draw());
    }
    overlay() {
      const ctx = this.ctx, s = this.session;
      const code = s ? s.challenge_code : '';
      const req = (s && s.requirements) || {};
      ctx.textBaseline = 'middle';
      // Top band: name · project · mode · code (Amendment 5 §1.2)
      const top = 'MICHEAL RAY BERRY · PUBLIC ACCOUNTABILITY PROJECT' + (code ? ' · CODE ' + code : '');
      ctx.font = '600 ' + Math.round(H * 0.016) + "px 'IBM Plex Mono', monospace";
      const tw = ctx.measureText(top).width, tpad = Math.round(W * 0.02);
      ctx.fillStyle = 'rgba(10,12,14,.72)';
      ctx.fillRect((W - tw) / 2 - tpad, Math.round(H * 0.038), tw + tpad * 2, Math.round(H * 0.036));
      ctx.fillStyle = '#EDEFF1'; ctx.textAlign = 'center';
      ctx.fillText(top, W / 2, Math.round(H * 0.056));
      // Bottom band: mode · date · violation/level/duration · elapsed · footer
      const el = this.recording ? Math.max(0, (Date.now() - this._recStart) / 1000) : 0;
      const mm = Math.floor(el / 60) + ':' + String(Math.floor(el % 60)).padStart(2, '0');
      let line2 = (MODE_LABELS[this.mode] || '').toUpperCase() + ' · ' + (s ? s.project_date : '');
      if (req.violation_number) line2 += ' · V-' + String(req.violation_number).padStart(3, '0');
      if (req.level) line2 += ' · LEVEL ' + req.level;
      if (req.corner_time_minutes) line2 += ' · ' + req.corner_time_minutes + ' MIN';
      const bandH = Math.round(H * 0.09), bandY = Math.round(H * 0.90) - bandH, bandX = Math.round(W * 0.06), bandW = W - bandX * 2;
      ctx.fillStyle = 'rgba(10,12,14,.8)';
      ctx.fillRect(bandX, bandY, bandW, bandH);
      ctx.fillStyle = '#B3261E'; ctx.fillRect(bandX, bandY, Math.max(5, Math.round(W * 0.006)), bandH);
      ctx.fillStyle = '#B9BEC4'; ctx.font = '600 ' + Math.round(H * 0.013) + "px 'IBM Plex Mono', monospace";
      ctx.fillText(line2, W / 2, bandY + bandH * 0.3);
      ctx.fillStyle = '#FFFFFF'; ctx.font = '700 ' + Math.round(H * 0.026) + "px 'IBM Plex Sans Condensed', sans-serif";
      ctx.fillText((this.recording ? mm : 'READY') + ' · MICHEALRAYBERRY.COM', W / 2, bandY + bandH * 0.66);
      ctx.textAlign = 'left';
    }

    // ---- Voice (ElevenLabs → browser TTS fallback) ----
    ensureAudio() {
      try {
        this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        this.elDest = this.elDest || this.audioCtx.createMediaStreamDestination();
      } catch (e) {}
    }
    async say(text) {
      if (!text) return;
      this.ensureAudio();
      const key = (function () { try { return localStorage.getItem('mrb_el_key'); } catch (e) { return ''; } })();
      if (key) {
        try {
          const voice = localStorage.getItem('mrb_el_voice') || 'pNInz6obpgDQGcFmaJgB';
          const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice + '?output_format=mp3_44100_64', {
            method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
          });
          if (r.ok) {
            const audio = new Audio(URL.createObjectURL(await r.blob()));
            try { const src = this.audioCtx.createMediaElementSource(audio); src.connect(this.elDest); src.connect(this.audioCtx.destination); } catch (e) {}
            await audio.play();
            return;
          }
        } catch (e) {}
      }
      try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) {}
    }
    beep(freq, ms) {
      try {
        this.ensureAudio();
        const o = this.audioCtx.createOscillator(), g = this.audioCtx.createGain();
        o.frequency.value = freq; o.type = 'sine';
        g.gain.setValueAtTime(0.4, this.audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + ms / 1000);
        o.connect(g); g.connect(this.audioCtx.destination);
        if (this.elDest) g.connect(this.elDest);
        o.start(); o.stop(this.audioCtx.currentTime + ms / 1000 + 0.05);
      } catch (e) {}
    }

    // ---- Session issue ----
    async issueSession() {
      if (!this.key()) { this.setNote('Enter the Record key from the AP first.', true); return null; }
      this.setNote('Requesting session and challenge code…');
      const body = { mode: this.mode, client_meta: { ua: navigator.userAgent } };
      if (this.mode === 'corrective-session') {
        const lv = this.$('.ra-level');
        body.level_minutes = lv ? parseInt(lv.value, 10) : 15;
      }
      try {
        const r = await fetch(API + '/api/recording/session', {
          method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()), body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!j.ok) {
          this.setNote('Cannot start: ' + (j.error || 'unknown') + '. The capture cannot proceed unverified.', true);
          return null;
        }
        this.session = j;
        if ((j.requirements || {}).uniform === 'penalty-pink') this.showUniform(true);
        return j;
      } catch (e) { this.setNote('Connection required to fetch a session. Try again when online.', true); return null; }
    }

    async postEvent(event, extra) {
      try {
        await fetch(API + '/api/recording/event', {
          method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
          body: JSON.stringify(Object.assign({ session_id: this.session.session_id, upload_token: this.session.upload_token, event }, extra || {})),
        });
      } catch (e) {}
    }

    async sha256(blob) {
      const buf = await blob.arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Attest (server stamps compliance time) then queue the resumable upload.
    // awaitUpload drains the queue before returning — used for the small frame
    // strip so it is fully filed before the video it describes is verified.
    async attestAndUpload(kind, blob, durationSeconds, awaitUpload) {
      const hash = await this.sha256(blob);
      let attested = false;
      try {
        const r = await fetch(API + '/api/recording/attest', {
          method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
          body: JSON.stringify({
            session_id: this.session.session_id, upload_token: this.session.upload_token,
            component_kind: kind, sha256: hash, bytes: blob.size,
            duration_seconds: durationSeconds == null ? null : durationSeconds,
            client_meta: { captured_at: new Date().toISOString() },
          }),
        });
        attested = (await r.json()).ok === true;
      } catch (e) {}
      // Queue regardless: attestation stamped the compliance time; bytes may
      // land later (airplane mode after capture is a supported case).
      await window.RAUploadQueue.enqueue(
        { session_id: this.session.session_id, component_kind: kind, upload_token: this.session.upload_token },
        blob,
      );
      this.setNote(attested
        ? 'Attested ✓ (server-timed). Uploading… you can leave this open; it resumes if interrupted.'
        : 'Attestation could not be confirmed — the file is queued and will retry. Flag it to the AP if it persists.', !attested);
      if (awaitUpload) await this.flushUploads();
      else this.flushUploads();
      return hash;
    }

    async flushUploads() {
      if (!window.RAUploadQueue) return;
      // Serialize: a queued flush and a fresh capture must not double-process.
      if (this._flushing) { this._flushAgain = true; return; }
      this._flushing = true;
      try { await this._drain(); }
      finally { this._flushing = false; }
      if (this._flushAgain) { this._flushAgain = false; return this.flushUploads(); }
    }
    async _drain() {
      const pending = await window.RAUploadQueue.pendingComponents();
      for (const comp of pending) {
        try {
          await window.RAUploadQueue.flushComponent(API, this.headers(), comp, (part, total) => {
            this.setNote('Uploading ' + comp.component_kind + ' — part ' + part + ' of ' + total + '…');
          });
        } catch (e) { this.setNote('Upload will retry when the connection is back (' + comp.component_kind + ').', true); return; }
      }
      const still = await window.RAUploadQueue.pendingComponents();
      if (!still.length) this.setNote('All captures filed ✓ — server verification is running. Statuses flip to Verified once it passes.');
    }
    async resumePendingUploads() {
      if (!window.RAUploadQueue) return;
      const pending = await window.RAUploadQueue.pendingComponents();
      if (pending.length) { this.setNote('Resuming ' + pending.length + ' interrupted upload(s)…'); this.flushUploads(); }
    }

    // ---- Capture: stills ----
    grabStill() {
      const vw = this.cam.videoWidth, vh = this.cam.videoHeight;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const p = c.getContext('2d');
      const scale = Math.max(W / vw, H / vh), dw = vw * scale, dh = vh * scale, dx = (W - dw) / 2, dy = (H - dh) / 2;
      if (this.facing === 'user') { p.save(); p.translate(W, 0); p.scale(-1, 1); p.drawImage(this.cam, W - dx - dw, dy, dw, dh); p.restore(); }
      else p.drawImage(this.cam, dx, dy, dw, dh);
      // Burn the same overlay onto the still.
      const savedCtx = this.ctx;
      this.ctx = p; this.overlay(); this.ctx = savedCtx;
      return c;
    }
    // ---- Recorder ----
    pickMime() {
      if (MediaRecorder.isTypeSupported('video/mp4')) return 'video/mp4';
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) return 'video/webm;codecs=vp8,opus';
      return MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
    }
    startRecorder(withMic) {
      const cs = this.view.captureStream(30);
      this.ensureAudio();
      if (this.elDest) this.elDest.stream.getAudioTracks().forEach((t) => cs.addTrack(t));
      if (withMic && this.micStream) this.micStream.getAudioTracks().forEach((t) => cs.addTrack(t));
      const mime = this.pickMime();
      const bits = this.mode === 'corrective-session' || this.mode === 'violation-resolution' ? 2000000 : 9000000;
      this.chunks = [];
      this.recorder = new MediaRecorder(cs, mime ? { mimeType: mime, videoBitsPerSecond: bits } : { videoBitsPerSecond: bits });
      // 1s chunks: a crash loses ≤1s and the partial stays attestable.
      this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.recorder.start(1000);
      this.recording = true;
      this._recStart = Date.now();
      this.$('.ra-safety').classList.remove('ra-hide');
      // A muted/ended track ends the take as incomplete (continuity rule).
      this.stream.getVideoTracks().forEach((t) => { t.onmute = () => this.endTake(true); t.onended = () => this.endTake(true); });
    }
    stopRecorder() {
      return new Promise((resolve) => {
        if (!this.recorder || this.recorder.state === 'inactive') return resolve(null);
        const type = this.recorder.mimeType || 'video/webm';
        this.recorder.onstop = () => resolve(new Blob(this.chunks, { type }));
        this.recorder.stop();
      });
    }

    // ---- Safety stop (contract-mandated; cannot be built away) ----
    async safetyStop() {
      if (!this.recording && !this.session) return;
      this.recording = false;
      this.beep(440, 400);
      const blob = await this.stopRecorder();
      const kind = this._activeVideoKind;
      if (this.session) await this.postEvent('safety-stop', { reason: 'participant invoked safety stop' });
      // A safety-stopped take is preserved as incomplete evidence, never a violation.
      if (blob && kind) await this.attestAndUpload(kind, blob, (Date.now() - this._recStart) / 1000);
      this.$('.ra-safety').classList.add('ra-hide');
      this.$('.ra-begin').classList.remove('ra-hide');
      this.setNote('Safety stop recorded — no penalty. The session is marked for AP review. Take care of yourself first.');
    }

    async endTake(incomplete) {
      if (!this.recording) return;
      this.recording = false;
      const blob = await this.stopRecorder();
      this.$('.ra-safety').classList.add('ra-hide');
      const kind = this._activeVideoKind;
      if (incomplete) {
        await this.postEvent('take-incomplete');
        if (blob) await this.attestAndUpload(kind, blob, (Date.now() - this._recStart) / 1000);
        this.setNote('The take ended before completion — recording is one continuous take. It is filed as incomplete evidence; re-record the full sequence.', true);
        this.$('.ra-begin').classList.remove('ra-hide');
        return blob;
      }
      return blob;
    }

    // ---- Begin: dispatch to the mode flow ----
    async begin() {
      if (this.recording) return;
      this.$('.ra-begin').classList.add('ra-hide');
      const s = await this.issueSession();
      if (!s) { this.$('.ra-begin').classList.remove('ra-hide'); return; }
      this.showSafetyConditions();
      try {
        if (this.mode === 'daily-inspection') await this.runDailyInspection();
        else if (this.mode === 'weigh-in') await this.runStill('scale-photo', 'Weigh-in. Step on the scale and hold the readout steady. Say the code aloud: ' + this.spelled());
        else if (this.mode === 'milestone-weigh-in') await this.runMilestone();
        else if (this.mode === 'meal-photo') await this.runStill('meal-photo', 'Evening meal. Fill the frame with the plate. Say the code aloud: ' + this.spelled());
        else if (this.mode === 'violation-portrait') await this.runStill('violation-portrait', 'Violation portrait. Inspection stance, facing the camera. Say the code aloud: ' + this.spelled());
        else if (this.mode === 'violation-resolution') await this.runResolution();
        else if (this.mode === 'corrective-session') await this.runCorrective();
        else if (this.mode === 'location-check-in') await this.runLocation();
      } catch (e) {
        this.setNote('Capture error: ' + e.message, true);
        this.$('.ra-begin').classList.remove('ra-hide');
      }
    }

    spelled() { return (this.session.challenge_code || '').split('').join(', '); }
    showSafetyConditions() {
      const wants = this.mode === 'violation-resolution' || this.mode === 'corrective-session';
      this.$('.ra-safety-conditions').classList.toggle('ra-hide', !wants);
    }

    // ---- Mode: single still capture ----
    async runStill(kind, prompt) {
      this._activeVideoKind = null;
      await this.postEvent('recording-started');
      await this.say(prompt);
      // Give the participant a beat to speak the code and frame up.
      for (let t = 5; t > 0; t--) { if (t <= 3) this.beep(660, 100); await this.sleep(1000); }
      this.beep(880, 150);
      const blob = await new Promise((r) => this.grabStill().toBlob(r, 'image/jpeg', 0.92));
      await this.attestAndUpload(kind, blob, null);
      this.$('.ra-begin').classList.remove('ra-hide');
      this.$('.ra-begin').textContent = 'Re-capture ' + MODE_LABELS[this.mode];
    }

    // ---- Mode: daily inspection (video + 4 photos + frame strip) ----
    async runDailyInspection() {
      const req = this.session.requirements || {};
      const angles = req.angles || ['front', 'left', 'rear', 'right', 'front-closing'];
      await this.postEvent('recording-started');
      await this.say('Daily inspection for Micheal Ray Berry. Verification code: ' + this.spelled() + '. Stand with your hands behind your head, facing the camera.');
      this._activeVideoKind = 'inspection-video';
      this._frames = [];
      this.startRecorder(false);
      const stripTimer = setInterval(() => this.captureFrame(), 15000);
      this.captureFrame();
      const perAngle = 7;
      for (let i = 0; i < angles.length; i++) {
        await this.say(angles[i].replace('-', ' ') + '.');
        for (let t = 0; t < perAngle; t++) { if (!this.recording) break; await this.sleep(1000); }
        if (!this.recording) { clearInterval(stripTimer); return; }
      }
      await this.say('All four required views recorded. Inspection complete.');
      clearInterval(stripTimer);
      const dur = (Date.now() - this._recStart) / 1000;
      const video = await this.endTakeClean();
      // Frame strip first (small, awaited) so the video verifier can read it.
      await this.uploadFrameStrip();
      await this.attestAndUpload('inspection-video', video, dur);
      // Posed photo phase — one still per angle.
      const photoAngles = [['photo-front', 'front'], ['photo-left', 'left'], ['photo-rear', 'rear'], ['photo-right', 'right']];
      for (const [kind, label] of photoAngles) {
        await this.say('Photo. ' + label + ' view. Hold still.');
        for (let t = 4; t > 0; t--) { if (t <= 3) this.beep(660, 100); await this.sleep(1000); }
        this.beep(880, 150);
        const blob = await new Promise((r) => this.grabStill().toBlob(r, 'image/jpeg', 0.92));
        await this.attestAndUpload(kind, blob, null);
      }
      await this.say('Daily packet captured. Filing to the record.');
      this.$('.ra-begin').classList.remove('ra-hide');
    }

    async endTakeClean() {
      this.recording = false;
      this.$('.ra-safety').classList.add('ra-hide');
      return await this.stopRecorder();
    }

    captureFrame() {
      try {
        const t = (Date.now() - this._recStart) / 1000;
        const c = this.grabStill();
        const small = document.createElement('canvas');
        small.width = 540; small.height = 960;
        small.getContext('2d').drawImage(c, 0, 0, 540, 960);
        this._frames = this._frames || [];
        this._frames.push({ t_seconds: Math.round(t), jpeg_b64: small.toDataURL('image/jpeg', 0.7).split(',')[1] });
      } catch (e) {}
    }
    async uploadFrameStrip() {
      if (!this._frames || !this._frames.length) return;
      const blob = new Blob([JSON.stringify({ frames: this._frames })], { type: 'application/json' });
      await this.attestAndUpload('frame-strip', blob, null, true);
      this._frames = [];
    }

    // ---- Mode: milestone weigh-in (video statement + scale photo) ----
    async runMilestone() {
      await this.postEvent('recording-started');
      await this.say('Official milestone weigh-in. Verification code: ' + this.spelled() + '. On camera, same scale. State the weight aloud.');
      this._activeVideoKind = 'milestone-video';
      this._frames = [];
      this.startRecorder(false);
      this.captureFrame();
      for (let t = 0; t < 20 && this.recording; t++) await this.sleep(1000);
      const dur = (Date.now() - this._recStart) / 1000;
      const video = await this.endTakeClean();
      await this.uploadFrameStrip();
      await this.attestAndUpload('milestone-video', video, dur);
      await this.say('Now the scale readout photo. Hold steady.');
      for (let t = 4; t > 0; t--) { if (t <= 3) this.beep(660, 100); await this.sleep(1000); }
      this.beep(880, 150);
      const blob = await new Promise((r) => this.grabStill().toBlob(r, 'image/jpeg', 0.92));
      await this.attestAndUpload('scale-photo', blob, null);
      this.$('.ra-begin').classList.remove('ra-hide');
    }

    // ---- Mode: violation resolution (acknowledgment + corner time, one code) ----
    async runResolution() {
      const req = this.session.requirements || {};
      const script = req.script || [];
      const minutes = Math.min(req.corner_time_minutes || 15, 30);
      // (a) Acknowledgment video — teleprompter from the generated script.
      await this.postEvent('recording-started');
      await this.say('Violation resolution. Verification code: ' + this.spelled() + '. Face the camera in the penalty uniform and read the acknowledgment.');
      this._activeVideoKind = 'acknowledgment-video';
      this._frames = [];
      this.startRecorder(false);
      this.captureFrame();
      for (const line of script) { if (!this.recording) break; await this.say(line); await this.sleep(Math.max(4000, line.length * 55)); }
      const ackDur = (Date.now() - this._recStart) / 1000;
      const ack = await this.endTakeClean();
      // The acknowledgment is short and face-forward; it has no frame strip and
      // falls back to AP review. The frame strip is scoped to the corner-time
      // video, which is the AI-critical one.
      this._frames = [];
      await this.attestAndUpload('acknowledgment-video', ack, ackDur);
      // (b) Corner time — continuous, back-to-back, no exit between.
      await this.say('Corner time begins now. ' + minutes + ' continuous minutes. Stand facing the corner, full body and corner in frame.');
      await this.runTimedCorner('corner-time-video', minutes);
      this.$('.ra-begin').classList.remove('ra-hide');
    }

    // ---- Mode: corrective session (private) ----
    async runCorrective() {
      const req = this.session.requirements || {};
      const minutes = Math.min(req.corner_time_minutes || 15, 30);
      await this.postEvent('recording-started');
      await this.say('Private corrective session. Verification code: ' + this.spelled() + '. ' + minutes + ' continuous minutes, single take.');
      await this.runTimedCorner('corrective-session-video', minutes);
      this.setNote('Corrective session complete — delivered to AP storage only. It never enters any public queue.');
      this.$('.ra-begin').classList.remove('ra-hide');
    }

    async runTimedCorner(kind, minutes) {
      this._activeVideoKind = kind;
      this._frames = [];
      // Optional room-audio track for the recording.
      try { this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { this.micStream = null; }
      this.startRecorder(true);
      this.captureFrame();
      const total = minutes * 60;
      const stripTimer = setInterval(() => this.captureFrame(), 15000);
      for (let el = 0; el < total && this.recording; el++) {
        if (el > 0 && el % 300 === 0) { this.beep(660, 120); await this.say(Math.floor(el / 60) + ' minutes elapsed. ' + (minutes - Math.floor(el / 60)) + ' remaining.'); }
        await this.sleep(1000);
      }
      clearInterval(stripTimer);
      if (this.micStream) { this.micStream.getTracks().forEach((t) => t.stop()); this.micStream = null; }
      if (!this.recording) return; // safety-stopped or interrupted
      this.beep(880, 150); this.beep(880, 150);
      const dur = (Date.now() - this._recStart) / 1000;
      const blob = await this.endTakeClean();
      await this.say('Complete. ' + minutes + ' minutes recorded.');
      // Frame strip first (small, awaited) so the corner-time verifier can read it.
      await this.uploadFrameStrip();
      await this.attestAndUpload(kind, blob, dur);
    }

    // ---- Mode: location check-in ----
    async runLocation() {
      this._activeVideoKind = null;
      this.setNote('Requesting your location…');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          await fetch(API + '/api/recording/location', {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
            body: JSON.stringify({
              session_id: this.session.session_id, upload_token: this.session.upload_token,
              lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), label: 'check-in',
            }),
          });
          this.setNote('Location sent to the AP privately — never on the public record.');
        } catch (e) { this.setNote('Could not send location — try again when online.', true); }
        this.$('.ra-begin').classList.remove('ra-hide');
      }, () => { this.setNote('Location permission denied — grant it in your browser to check in.', true); this.$('.ra-begin').classList.remove('ra-hide'); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    }

    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  }

  customElements.define('recording-assistant', RecordingAssistant);
})();
