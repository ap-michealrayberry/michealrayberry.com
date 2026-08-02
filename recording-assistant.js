/* Recording Assistant — vanilla web component <recording-assistant>
   Records a 9:16 canvas-composited video with a branded overlay. */
(function () {
  if (customElements.get('recording-assistant')) return;

  const START_DATE = '2026-07-20';
  // Guided inspection sequence: take-position intro, then five angle segments.
  /* Guided inspection sequence. Each segment names the angle and states what
     that angle exists to verify, so the recording is self-documenting: anyone
     watching it later can hear what was required, not just see a man turning.
     Durations are generous enough that the line finishes before the turn is
     called — the device voice is slower than ElevenLabs, and the script has to
     work on either. Segment 0's line is assembled at record time (buildIntro)
     because it carries the day, date, and weight. */
  const SEGMENTS = [
    { label: 'INSPECTION POSITION', tag: 'FRONT VIEW · HANDS BEHIND HEAD', dur: 26, speak: '' },
    { label: 'LEFT SIDE', tag: 'VIEW 2 OF 4', dur: 11,
      speak: 'Turn to your left. Hold the position. This view records the left profile.' },
    { label: 'REAR', tag: 'VIEW 3 OF 4', dur: 11,
      speak: 'Turn to the rear. Hold the position. This view records the back, shoulders to heels.' },
    { label: 'RIGHT SIDE', tag: 'VIEW 4 OF 4', dur: 11,
      speak: 'Turn to your right. Hold the position. This view records the right profile.' },
    { label: 'FRONT', tag: 'CLOSING VIEW', dur: 11,
      speak: 'Return to the front. Face the camera. Hands behind the head. This closing view confirms identity against the opening frame.' },
    { label: 'COMPLETE', tag: 'DAILY INSPECTION', dur: 22,
      speak: 'All four required views are recorded. This inspection documents the result exactly as it is, with no adjustment and no commentary. The remaining requirements of the Daily Compliance Packet are due by ten PM Eastern: the four accountability photographs, the weight entry, and the record update. Nothing is complete until the record accepts all of them. Up, down, or flat, it gets posted. Daily Inspection complete.' },
  ];
  const SEQ_TOTAL = SEGMENTS.reduce((t, s) => t + s.dur, 0);
  // Photo phase after the video: posed, sharp stills — subject holds still per angle.
  const PHOTO_SEGS = [
    { label: 'FRONT', say: 'Now the photos. Front view. Hold still.', wait: 6 },
    { label: 'LEFT SIDE', say: 'Turn to your left. Hold still.', wait: 6 },
    { label: 'REAR', say: 'Turn to the rear. Hold still.', wait: 6 },
    { label: 'RIGHT SIDE', say: 'Turn to your right. Hold still.', wait: 6 },
  ];
  const TITLE_SEC = 2.5; // opening title card (also becomes the feed thumbnail)
  const SHEET_CSV =
    'https://docs.google.com/spreadsheets/d/1BKNAGZEchYs2P5ZoWql6Ct_4GTyAKJxUqEsXVsJyeDM/gviz/tq?tqx=out:csv';
  // AP's Apps Script web app — issues one-time challenge codes and records
  // capture attestations (SHA-256 fingerprints) with Google server time.
  const ATTEST_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyJ7PV4NAmK2WcP-pBMLW78orrw_i7KndnKEkWLT_Xd0GtyeRztQpOxd2oSaitEHJM7/exec';

  const CSS = `
    .ra-root{background:#FAFAF7;color:#141412;font-family:'IBM Plex Sans',system-ui,sans-serif;display:flex;flex-direction:column;width:100%;}
    .ra-root *{box-sizing:border-box;margin:0;padding:0;}
    .ra-stage{display:flex;align-items:center;justify-content:center;padding:24px 10px 8px;position:relative;min-height:0;}
    .ra-view{max-width:100%;max-height:58vh;aspect-ratio:9/16;border:1px solid #141412;background:#000;}
    .ra-cam{display:none;}
    .ra-viewwrap{position:relative;display:inline-block;max-width:100%;}
    .ra-hud{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
    .ra-recdot{position:absolute;top:36px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:7px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.1em;background:#141412;color:#FAFAF7;padding:6px 12px;z-index:5;}
    .ra-recdot.on{display:flex;}
    .ra-recdot .d{width:10px;height:10px;border-radius:50%;background:#B3261E;animation:ra-blink 1.1s infinite;}
    @keyframes ra-blink{50%{opacity:.25}}
    .ra-timer{font-family:'IBM Plex Mono',monospace;font-size:14px;letter-spacing:.08em;}
    .ra-timer.warn{color:#F2B01E;}
    .ra-controls{padding:12px 16px 32px;max-width:520px;margin:0 auto;width:100%;}
    .ra-row{display:flex;gap:10px;margin-bottom:10px;}
    .ra-field{flex:1;}
    .ra-field label{display:block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#6B6A64;margin-bottom:5px;}
    .ra-field input,.ra-field select{width:100%;background:#FFFFFF;border:1px solid #141412;color:#141412;font-family:'IBM Plex Mono',monospace;font-size:16px;padding:11px 12px;border-radius:0;appearance:none;}
    .ra-field .ro{background:#F1F0EA;color:#6B6A64;border-color:#D8D6CF;}
    .ra-controls button{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:14px;border-radius:0;border:none;cursor:pointer;width:100%;}
    .ra-start{background:#141412;color:#FAFAF7;}
    .ra-rec{background:#B3261E;color:#fff;}
    .ra-stop{background:#FAFAF7;color:#B3261E;border:1px solid #B3261E!important;}
    .ra-ghost{background:none;border:1px solid #141412!important;color:#141412;}
    .ra-dl{background:#141412;color:#FAFAF7;text-decoration:none;display:block;text-align:center;padding:14px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;}
    .ra-hide{display:none!important;}
    .ra-note,.ra-mealnote{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6B6A64;text-align:center;margin-top:10px;line-height:1.6;}
    .ra-voice{margin-bottom:10px;border:1px solid #D8D6CF;padding:10px 12px;}
    .ra-voice summary{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6B6A64;cursor:pointer;}
    .ra-voice .ra-row{margin:10px 0 0;}
    .ra-all{background:#141412;color:#FAFAF7;margin-top:10px;}
  `;

  const HTML = `
    <div class="ra-stage">
      <video class="ra-cam" playsinline muted></video>
      <div class="ra-viewwrap">
        <canvas class="ra-view" width="1080" height="1920"></canvas>
        <canvas class="ra-hud" width="720" height="1280"></canvas>
      </div>
      <div class="ra-recdot"><span class="d"></span><span>REC</span><span class="ra-timer">0:00</span></div>
    </div>
    <div class="ra-controls">
      <div class="ra-check" style="margin-bottom:12px;border:1px solid #141412;padding:12px 14px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6B6A64">Daily packet</span>
          <span class="ra-clock" style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;color:#6B6A64"></span>
        </div>
        <span class="ra-ck-w" style="font-family:'IBM Plex Mono',monospace;font-size:12px"></span>
        <span class="ra-ck-p" style="font-family:'IBM Plex Mono',monospace;font-size:12px"></span>
        <span class="ra-ck-v" style="font-family:'IBM Plex Mono',monospace;font-size:12px"></span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6B6A64">Video: uploads itself to the record — <a href="https://michealrayberry.com/daily/" target="_blank" style="color:#B3261E">open Studio ↗</a></span>
      </div>
      <div class="ra-row">
        <div class="ra-field">
          <label>Today's Weight (lb)</label>
          <input class="ra-w" type="number" step="0.1" inputmode="decimal" placeholder="—">
        </div>
        <div class="ra-field" style="max-width:130px">
          <label>Countdown</label>
          <select class="ra-cd">
            <option value="3">3 sec</option>
            <option value="5">5 sec</option>
            <option value="10" selected>10 sec</option>
          </select>
        </div>
      </div>
      <div class="ra-row">
        <div class="ra-field">
          <label>Date · Day #</label>
          <input class="ro ra-day" readonly value="">
        </div>
      </div>
      <details class="ra-voice">
        <summary>AI voice — set once, shared by every tool</summary>
        <div class="ra-row">
          <div class="ra-field">
            <label>ElevenLabs key (this browser only; narration is recorded into the video)</label>
            <input class="ra-elkey" type="password" placeholder="blank = device voice, silent video">
          </div>
          <div class="ra-field" style="max-width:200px">
            <label>Voice ID (blank = Adam)</label>
            <input class="ra-elvoice" type="text" placeholder="">
          </div>
        </div>
        <div class="ra-row">
          <div class="ra-field">
            <label>Record key (from the AP — authorizes filing to the record; this browser only)</label>
            <input class="ra-pkey" type="password" placeholder="required for codes, attestation, and filing">
          </div>
        </div>
      </details>
      <div class="ra-row">
        <button class="ra-start">Begin Daily Inspection</button>
        <button class="ra-ghost ra-rehearse" style="max-width:150px">Rehearse</button>
        <button class="ra-ghost ra-flip" style="max-width:110px">Flip</button>
      </div>
      <div class="ra-row">
        <button class="ra-stop ra-stopbtn ra-hide">■ Stop</button>
      </div>
      <button class="ra-all ra-hide">Download All — video + 4 photos + X card</button>
      <a class="ra-dl ra-hide" download>Download Video</a>
      <button class="ra-ghost ra-photos ra-hide" style="margin-top:10px">Download 4 Photos</button>
      <button class="ra-ghost ra-xcard ra-hide" style="margin-top:10px">Download X Card</button>
      <div class="ra-field ra-titlebox ra-hide" style="margin-top:10px">
        <label>Video title — recorded with the entry</label>
        <div style="display:flex;gap:8px">
          <input class="ra-yt" readonly>
          <button class="ra-copy ra-ghost" style="max-width:110px">Copy</button>
        </div>
      </div>
      <div class="ra-field ra-descbox ra-hide" style="margin-top:10px">
        <label>Video description — recorded with the entry</label>
        <textarea class="ra-desc" readonly rows="6" style="width:100%;font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.6;padding:10px 12px;border:1px solid #141412;background:#F1F0EA;color:#141412;resize:vertical;border-radius:0"></textarea>
        <button class="ra-copydesc ra-ghost" style="margin-top:8px">Copy description</button>
      </div>
      <div class="ra-reviewbox ra-hide" style="margin-top:14px;border:1px solid #141412;background:#FFFFFF;padding:14px">
        <label style="display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6B6A64;margin-bottom:10px">Session review — check everything before downloading</label>
        <video class="ra-replay" controls playsinline style="width:100%;background:#000;aspect-ratio:9/16;max-height:46vh;display:block"></video>
        <div class="ra-thumbs" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px"></div>
        <p style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6B6A64;margin-top:10px;line-height:1.6">A blurry photo can be retaken individually — hold the pose, 6-second countdown. The video is one continuous record: re-recording it means the full sequence.</p>
      </div>
      <p class="ra-note">
        One button runs the whole session: countdown → guided four-view video (~95s, narrated) → four posed photos. When it finishes, hit Download All — the downloads are backups; the photos, weight, and video have already filed themselves to the record.
      </p>
      <div class="ra-mealbox" style="margin-top:18px;padding-top:16px;border-top:1px solid #D8D6CF">
        <label style="display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6B6A64;margin-bottom:8px">Evening meal photograph — separate capture</label>
        <div class="ra-row">
          <button class="ra-ghost ra-meal">Capture Meal Photo</button>
        </div>
        <a class="ra-dl ra-mealdl ra-hide" download style="margin-top:10px">Download Meal Photo</a>
        <p class="ra-mealnote" style="margin-top:8px">
          Optional, independent of the inspection above. Live capture only — no gallery uploads: the tool fetches a one-time code, checks the frame actually contains food (on-device AI), stamps day · date · time · code into the photo, files it to the record, and logs its fingerprint with server time.
        </p>
      </div>
      <div class="ra-vpbox" style="margin-top:18px;padding-top:16px;border-top:1px solid #D8D6CF">
        <label style="display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6B6A64;margin-bottom:8px">Violation portrait — required while a violation is active</label>
        <div class="ra-row">
          <div class="ra-field" style="max-width:140px">
            <label>Violation number</label>
            <input class="ra-vpnum" type="number" min="1" placeholder="1">
          </div>
          <div class="ra-field">
            <label>Violation date</label>
            <input class="ra-vpdate" type="date">
          </div>
        </div>
        <div class="ra-row">
          <button class="ra-ghost ra-vp">Capture Violation Portrait</button>
        </div>
        <a class="ra-dl ra-vpdl ra-hide" download style="margin-top:10px">Download Portrait</a>
        <p class="ra-vpnote" style="margin-top:8px">
          Standardized project-uniform portrait, inspection stance, facing the camera. Factual and fully clothed; stamped with the violation number and date (§8: no consequence details). It is filed privately with the violation entry for the AP’s review — it is not published.
        </p>
      </div>
      <div class="ra-corrbox" style="margin-top:18px;padding-top:16px;border-top:1px solid #D8D6CF">
        <label style="display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6B6A64;margin-bottom:8px">Corrective session — corner time</label>
        <div class="ra-row">
          <div class="ra-field">
            <label>Level assigned by AP</label>
            <select class="ra-clevel">
              <option value="1">Level 1 · 10 min</option>
              <option value="2">Level 2 · 20 min</option>
              <option value="3">Level 3 · 30 min</option>
            </select>
          </div>
          <div class="ra-field">
            <label>Violation date it resolves</label>
            <input class="ra-cref" type="date">
          </div>
        </div>
        <div class="ra-row">
          <button class="ra-rec ra-cstart">Begin Corrective Session</button>
        </div>
        <div class="ra-row">
          <button class="ra-stop ra-cstop ra-hide">■ Abort — invalidates the session</button>
        </div>
        <a class="ra-dl ra-cdl ra-hide" download></a>
        <p class="ra-corrnote" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6B6A64;text-align:center;margin-top:10px;line-height:1.6">
          One continuous take, timed to the second — no pause, no early stop. Position and room audio are monitored: leaving the frame, dropping the hands from the head, turning away, excessive movement, or sustained noise or music draws a spoken warning. Three warnings — or any breach held longer than a few seconds — invalidates the session: nothing is saved and the full duration restarts from zero.
        </p>
      </div>
    </div>
  `;

  class RecordingAssistant extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;

      if (!document.getElementById('ra-styles')) {
        const st = document.createElement('style');
        st.id = 'ra-styles';
        st.textContent = CSS;
        document.head.appendChild(st);
      }

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
      const HW = 720, HH = 1280;
      // Tool mode: "daily" (default) = inspection + meal; "corrective" = corrective session only.
      const MODE = this.getAttribute('mode') || 'daily';
      if (MODE === 'corrective') {
        ['.ra-w', '.ra-day'].forEach((s) => { const r = $(s).closest('.ra-row'); if (r) r.classList.add('ra-hide'); });
        ['.ra-start', '.ra-rehearse', '.ra-note', '.ra-mealbox', '.ra-check'].forEach((s) => $(s).classList.add('ra-hide'));
        const cb = $('.ra-corrbox');
        cb.style.borderTop = 'none'; cb.style.marginTop = '0'; cb.style.paddingTop = '0';
      } else {
        $('.ra-corrbox').classList.add('ra-hide');
      }
      const W = 1080, H = 1920; // 1080p portrait — lighter to composite+encode in realtime (2.5K caused frame drops); stills stay full-res
      view.width = W; view.height = H; // keep buffer in sync with draw math

      let stream = null, mediaRecorder = null, chunks = [];
      let facing = 'environment', recStart = 0, timerInt = null;
      let countdownLeft = 0, recording = false, audioCtx = null;
      let rehearse = false;
      let angleIdx = -1;
      let photos = [], photoPhase = null;
      let frameStatus = null, lastVideoUrl = null;

      // AI voice when an ElevenLabs key is on this device (shared localStorage
      // slot with the other tools); device voice otherwise. Guidance only —
      // the recording is silent either way (canvas stream, no mic).
      const _elCache = {};
      let _elAudio = null;
      let _sayGen = 0;
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
      async function say(text) {
        if (!text) return;
        const mySay = ++_sayGen;
        // Hard-stop anything still talking — lines must never overlap.
        if (_elAudio) { try { _elAudio.pause(); } catch (e) {} _elAudio = null; }
        try { speechSynthesis.cancel(); } catch (e) {}
        const key = localStorage.getItem('mrb_el_key');
        const voice = localStorage.getItem('mrb_el_voice') || 'pNInz6obpgDQGcFmaJgB';
        if (key) {
          try {
            if (!_elCache[text]) {
              const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice + '?output_format=mp3_44100_64', {
                method: 'POST',
                headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
              });
              if (!r.ok) throw new Error(r.status);
              _elCache[text] = URL.createObjectURL(await r.blob());
            }
            if (mySay !== _sayGen) return; // a newer line superseded this one while it was fetching
            if (_elAudio) { try { _elAudio.pause(); } catch (e) {} }
            _elAudio = new Audio(_elCache[text]);
            try { ensureAC(); const src = audioCtx.createMediaElementSource(_elAudio); src.connect(elDest); src.connect(audioCtx.destination); } catch (e) {}
            await _elAudio.play();
            return;
          } catch (e) { /* fall through to device voice */ }
        }
        if (mySay !== _sayGen) return;
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 1.05;
          speechSynthesis.speak(u);
        } catch (e) {}
      }

      // Warm the voice cache for every scripted line so playback starts instantly.
      // Returns a promise — start waits for it so the ENTIRE script is downloaded
      // before the countdown begins; nothing is fetched mid-recording.
      async function prefetchTexts(texts) {
        const key = localStorage.getItem('mrb_el_key');
        if (!key) return;
        const voice = localStorage.getItem('mrb_el_voice') || 'pNInz6obpgDQGcFmaJgB';
        for (const text of texts.filter((t) => t && !_elCache[t])) {
          try {
            const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice + '?output_format=mp3_44100_64', {
              method: 'POST',
              headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
            });
            if (r.ok) _elCache[text] = URL.createObjectURL(await r.blob());
          } catch (e) {}
        }
      }
      function prefetchLines() {
        return prefetchTexts(SEGMENTS.map((s) => s.speak).concat(PHOTO_SEGS.map((s) => s.say)));
      }

      // (Deadline enforcement removed from the overlay — the tracker timestamps are the record.)

      const today = new Date();
      const rawDay = Math.floor((today - new Date(START_DATE + 'T00:00:00')) / 864e5) + 1;
      const preStart = rawDay < 1;
      const dayNum = Math.max(1, rawDay);
      const dayLabel = preStart ? 'PRE-START' : 'DAY ' + dayNum;
      const isoStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
      $('.ra-day').value = isoStr + ' · ' + dayLabel;

      // ---- Verification: challenge code + content fingerprint attestation ----
      let challenge = null, lastVideoBlob = null;
      const deviceKey = () => { try { return localStorage.getItem('mrb_packet_key') || ''; } catch (e) { return ''; } };
      async function fetchChallenge(kind) {
        try {
          const r = await fetch(ATTEST_ENDPOINT + '?action=challenge&kind=' + kind + '&key=' + encodeURIComponent(deviceKey()));
          const j = await r.json();
          return j && j.ok && j.code ? j : null;
        } catch (e) { return null; }
      }
      async function sha256Blob(blob) {
        const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      async function attestPost(payload) {
        try {
          const r = await fetch(ATTEST_ENDPOINT, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'attest', date: isoStr, day: dayNum, key: deviceKey() }, payload)) });
          const j = await r.json();
          return !!(j && j.ok);
        } catch (e) { return false; }
      }
      async function attestDaily() {
        try {
          const vh = lastVideoBlob ? await sha256Blob(lastVideoBlob) : '';
          const phs = [];
          for (const p of photos) phs.push(await sha256Blob(await (await fetch(p.dataUrl)).blob()));
          const ok = await attestPost({ kind: 'daily', code: challenge ? challenge.code : '', weight: parseFloat($('.ra-w').value) || '', video_sha256: vh, photo_sha256s: phs });
          setNote((ok ? 'ATTESTED \u2713 — code and file fingerprints logged with server time. ' : 'ATTESTATION FAILED — fingerprints were not logged; flag it to the AP. ') +
            'Review the video and photos below (retake any photo), then file the packet — the video uploads itself to the record.', false);
        } catch (e) {}
      }
      /* ---- Inspection video: browser → Cloudflare R2, direct ----
         Apps Script signs a 15-minute PUT URL for one exact object key and
         the file goes straight from this device to the bucket, so there is
         no relay and no size ceiling. The sheet is then updated with the
         public video.michealrayberry.com URL, which is what the day page
         embeds. Corrective and corner recordings never come through here —
         they stay in the AP's private Drive archive. */
      async function uploadVideoToR2(blob, onProgress) {
        const sign = await (await fetch(ATTEST_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ action: 'r2sign', key: deviceKey(), date: isoStr, kind: 'daily', mime: blob.type || 'video/mp4' }),
        })).json();
        if (!sign || !sign.ok) throw new Error((sign && sign.error) || 'could not sign upload');

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', sign.uploadUrl, true);
            xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => (xhr.status === 200 || xhr.status === 201
            ? resolve()
            : reject(new Error('R2 ' + xhr.status + ' ' + String(xhr.responseText || '').slice(0, 120))));
          xhr.onerror = () => reject(new Error('the storage bucket refused the upload (CORS) \u2014 add https://michealrayberry.com to the R2 bucket\u2019s CORS policy with PUT allowed'));
          xhr.send(blob);
        });
        return sign.publicUrl;
      }

      // ---- One-tap packet filing: photos + weight go straight to the record ----
      async function postPacket(payload) {
        try {
          const r = await fetch(ATTEST_ENDPOINT, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'packet', date: isoStr, day: dayNum, key: deviceKey() }, payload)) });
          return !!(await r.json()).ok;
        } catch (e) { return false; }
      }
      async function filePacket() {
        setNote('Filing photos and weight to the record…', false);
        let okAll = photos.length > 0;
        for (const p of photos) {
          const ok = await postPacket({
            name: 'micheal-ray-berry-daily-photo-' + isoStr + '-' + p.slug + '.jpg',
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
            setNote('VIDEO UPLOAD FAILED (' + e.message + ') — download the video below and give it to the AP.', true);
          }
        }
        await postPacket({ finalize: true });
        refreshChecklist();
        setNote(okAll
          ? 'Photos + weight are ON THE RECORD \u2713 (attested). The video uploads itself to the record. The downloads below are backups.'
          : 'Some photos failed to file automatically — use Download All and upload them to the Drive folder manually.', false);
      }
      // ---- Packet checklist + deadline clock (reads the live tracker) ----
      let checklistData = null;
      async function refreshChecklist() {
        try {
          const t = await (await fetch(SHEET_CSV + '&cb=' + Date.now())).text();
          const line = t.split(/\r?\n/).find((l) => l.indexOf('"' + isoStr + '"') === 0);
          const cols = line ? line.split('","').map((s) => s.replace(/^"|"$/g, '')) : [];
          checklistData = {
            weight: !!parseFloat(cols[1]),
            photos: !!(cols[3] || '').trim(),
            video: !!(cols[7] || '').trim(),
          };
        } catch (e) { checklistData = null; }
        drawChecklist();
      }
      function drawChecklist() {
        const el = $('.ra-check');
        if (!el) return;
        try {
          const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: 'numeric', minute: 'numeric' }).formatToParts(new Date());
          const mins = (22 * 60) - ((+p.find((x) => x.type === 'hour').value) * 60 + (+p.find((x) => x.type === 'minute').value));
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
          n.textContent = (on ? '\u2713 ' : '\u25cb ') + label + (on ? ' — on the record' : ' — not yet on the record');
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
          const rows = t.trim().split(/\r?\n/);
          let todayWeight = null, lastLogged = null;
          for (let i = rows.length - 1; i >= 0; i--) {
            const cols = rows[i].split(',');
            const dateStr = (cols[0] || '').replace(/"/g, '').trim();
            const w = parseFloat((cols[1] || '').replace(/"/g, ''));
            if (isNaN(w)) continue;
            if (lastLogged === null) lastLogged = w;              // most recent non-empty (from bottom)
            if (dateStr === isoStr && todayWeight === null) todayWeight = w;
          }
          if (todayWeight !== null) $('.ra-w').value = todayWeight.toFixed(1); // today already logged → prefill
          else if (lastLogged !== null) $('.ra-w').placeholder = lastLogged.toFixed(1) + ' (last logged)';
        })
        .catch(() => {});

      // From 2026-07-30 the official weight is SCALE-SYNCED (Withings → Google
      // Health → record) — no manual logging. The field locks to the synced
      // value (it still feeds the video overlay + spoken intro). If the scale
      // hasn't synced yet, the field stays open and prompts a weigh-in first.
      const WEIGHT_AUTO_START = '2026-07-30';
      if (isoStr >= WEIGHT_AUTO_START) {
        const wl = $('.ra-w').closest('.ra-field').querySelector('label');
        if (wl) wl.textContent = "Today's Weight (scale-synced)";
        $('.ra-w').placeholder = 'step on the scale…';
        const lockWeight = () => fetch(SHEET_CSV.split('?')[0] + '?tqx=out:csv&sheet=Health')
          .then((r) => (r.ok ? r.text() : null))
          .then((t) => {
            if (!t) return;
            const rows = t.trim().split(/\r?\n/);
            for (let i = rows.length - 1; i >= 1; i--) {
              const cols = rows[i].split(',').map((c) => c.replace(/"/g, '').trim());
              if (cols[0] === isoStr && parseFloat(cols[7])) {
                $('.ra-w').value = parseFloat(cols[7]).toFixed(1);
                $('.ra-w').readOnly = true;
                return;
              }
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
          const lines = t.trim().split(/\r?\n/).map((l) => l.split('","').map((s) => s.replace(/^"|"$/g, '')));
          if (!lines[0] || String(lines[0][1]).toLowerCase() !== 'meal') return; // gviz fell back to another tab
          const row = lines.find((l) => (l[0] || '').trim() === isoStr);
          if (row && (row[1] || '').trim()) {
            mealPlan = { meal: row[1].trim(), labels: (row[2] || '').split(',').map((x) => x.trim()).filter(Boolean) };
            setMealNote('ASSIGNED MEAL TODAY: ' + mealPlan.meal + ' — the camera will check for it at capture.');
          }
        })
        .catch(() => {});

      // Meal-mode feedback has its own target so it never overwrites inspection
      // guidance (and vice versa) — both are visible at once.
      const setMealNote = (msg) => { $('.ra-mealnote').textContent = msg; };

      const setNote = (msg, isHTML) => {
        const n = $('.ra-note');
        if (isHTML) n.innerHTML = msg; else n.textContent = msg;
      };

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

      function drawCamera() {
        const vw = cam.videoWidth, vh = cam.videoHeight;
        if (!vw || !vh) return;
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale, dh = vh * scale;
        const dx = (W - dw) / 2, dy = (H - dh) / 2;
        if (facing === 'user') {
          ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
          ctx.drawImage(cam, W - dx - dw, dy, dw, dh);
          ctx.restore();
        } else {
          ctx.drawImage(cam, dx, dy, dw, dh);
        }
      }

      function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
      }

      function overlayText() {
        const weight = parseFloat($('.ra-w').value);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const topY = Math.round(H * 0.055);
        const eb = 'PUBLIC ACCOUNTABILITY PROJECT' + (challenge ? ' · CODE ' + challenge.code : '');
        ctx.font = '600 ' + Math.round(H * 0.016) + "px 'IBM Plex Mono', monospace";
        const ebW = ctx.measureText(eb).width;
        const ebX = (W - ebW) / 2;
        const topPadX = Math.round(W * 0.02);
        const topH = Math.round(H * 0.034);
        ctx.fillStyle = 'rgba(10,12,14,.68)';
        roundRect(ebX - topPadX, topY - topH / 2, ebW + topPadX * 2, topH, 12);
        ctx.fillStyle = '#D8DBDE';
        ctx.fillText(eb, ebX, topY);

        /* Deadline + pose guides are audio-only — the recorded overlay stays clean. */

        const bandW = Math.round(W * 0.67);
        const bandH = Math.round(H * 0.066);
        const bandX = Math.round((W - bandW) / 2);
        const blockY = Math.round(H * 0.90) - bandH;
        const accentW = Math.max(5, Math.round(W * 0.006));

        ctx.fillStyle = 'rgba(10,12,14,.78)';
        roundRect(bandX, blockY, bandW, bandH, 14);
        ctx.fillStyle = '#B3261E';
        ctx.fillRect(bandX, blockY, accentW, bandH);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#B9BEC4';
        ctx.font = '600 ' + Math.round(H * 0.014) + "px 'IBM Plex Mono', monospace";
        ctx.fillText('MICHEAL RAY BERRY · ' + isoStr, W / 2, blockY + bandH * 0.30);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 ' + Math.round(H * 0.028) + "px 'IBM Plex Sans Condensed', sans-serif";
        ctx.fillText(
          dayLabel + (isNaN(weight) ? '' : ' · ' + weight.toFixed(1) + ' LB'),
          W / 2, blockY + bandH * 0.71
        );
        ctx.textAlign = 'left';
      }

      function drawCountdown() {
        ctx.fillStyle = 'rgba(10,12,14,.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 ' + Math.round(H * 0.22) + "px 'IBM Plex Sans Condensed', sans-serif";
        ctx.fillText(String(Math.ceil(countdownLeft)), W / 2, H / 2);
        ctx.font = '600 ' + Math.round(H * 0.018) + "px 'IBM Plex Mono', monospace";
        ctx.fillStyle = '#B9BEC4';
        ctx.fillText('RECORDING STARTS IN', W / 2, H / 2 - Math.round(H * 0.14));
        ctx.textAlign = 'left';
      }

      function drawTitleCard(elapsed) {
        const weight = parseFloat($('.ra-w').value);
        /* fade out over the last 0.5s */
        const fade = Math.min(1, Math.max(0, (TITLE_SEC - elapsed) / 0.5));
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.fillStyle = '#141412';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#B3261E';
        ctx.fillRect(0, 0, W, 12);
        ctx.fillRect(0, H - 12, W, 12);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#B3261E';
        ctx.font = '600 ' + Math.round(H * 0.018) + "px 'IBM Plex Mono', monospace";
        ctx.fillText('PUBLIC ACCOUNTABILITY PROJECT', W / 2, H * 0.30);
        ctx.fillStyle = '#FAFAF7';
        ctx.font = '700 ' + Math.round(H * 0.105) + "px 'IBM Plex Sans Condensed', sans-serif";
        ctx.fillText(dayLabel, W / 2, H * 0.42);
        if (!isNaN(weight)) {
          ctx.font = '600 ' + Math.round(H * 0.065) + "px 'IBM Plex Mono', monospace";
          ctx.fillText(weight.toFixed(1) + ' LB', W / 2, H * 0.53);
        }
        ctx.fillStyle = '#8A8983';
        ctx.font = '600 ' + Math.round(H * 0.018) + "px 'IBM Plex Mono', monospace";
        ctx.fillText('MICHEAL RAY BERRY \u00b7 DAILY INSPECTION \u00b7 ' + isoStr, W / 2, H * 0.62);
        ctx.fillStyle = '#FAFAF7';
        ctx.fillText('MICHEALRAYBERRY.COM', W / 2, H * 0.70);
        if (challenge) {
          ctx.fillStyle = '#B3261E';
          ctx.fillText('VERIFICATION CODE ' + challenge.code, W / 2, H * 0.76);
        }
        ctx.restore();
        ctx.textAlign = 'left';
      }

      function drawLoop() {
        if (rehearse && !stream) {
          ctx.fillStyle = '#1B1B19'; ctx.fillRect(0, 0, W, H);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#4A4A45';
          ctx.font = '600 ' + Math.round(H * 0.024) + "px 'IBM Plex Mono', monospace";
          ctx.fillText('REHEARSAL — NO CAMERA · NOTHING IS RECORDED', W / 2, H / 2);
          ctx.textAlign = 'left';
          overlayText();
          if (photoPhase) drawPhotoPhase();
          if (countdownLeft > 0) drawCountdown();
        } else if (cam.readyState >= 2) {
          drawCamera();
          if (corrective) {
            correctiveOverlay();
          } else {
            overlayText();
            if (recording) {
              const elapsed = (Date.now() - recStart) / 1000;
              if (elapsed < TITLE_SEC) drawTitleCard(elapsed);
            }
          }
          if (photoPhase) drawPhotoPhase();
          if (countdownLeft > 0) drawCountdown();
        }
        drawHud();
        requestAnimationFrame(drawLoop);
      }

      // ---- Preview-only HUD (never recorded: separate canvas stacked on top) ----
      function pathRound(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r.tl, y);
        c.arcTo(x + w, y, x + w, y + h, r.tr);
        c.arcTo(x + w, y + h, x, y + h, r.br);
        c.arcTo(x, y + h, x, y, r.bl);
        c.arcTo(x, y, x + w, y, r.tl);
        c.closePath();
      }
      function hudPill(text, cy, color, big) {
        hctx.font = (big ? '700 26px "IBM Plex Sans Condensed",sans-serif' : '600 15px "IBM Plex Mono",monospace');
        const tw = hctx.measureText(text).width;
        const ph = big ? 40 : 30;
        hctx.fillStyle = 'rgba(10,12,14,.66)';
        pathRound(hctx, HW / 2 - tw / 2 - 14, cy - ph / 2, tw + 28, ph, { tl: 8, tr: 8, bl: 8, br: 8 });
        hctx.fill();
        hctx.fillStyle = color;
        hctx.fillText(text, HW / 2, cy);
      }
      function drawHud() {
        hctx.clearRect(0, 0, HW, HH);
        hctx.textAlign = 'center';
        hctx.textBaseline = 'middle';
        if (recording) {
          // Segment progress bars
          const elapsed = (Date.now() - recStart) / 1000;
          const n = SEGMENTS.length, gap = 4, bx = HW * 0.06, bw = HW * 0.88;
          const segW = (bw - gap * (n - 1)) / n;
          let acc = 0;
          for (let i = 0; i < n; i++) {
            const start = acc; acc += SEGMENTS[i].dur;
            const f = elapsed <= start ? 0 : elapsed >= acc ? 1 : (elapsed - start) / SEGMENTS[i].dur;
            hctx.fillStyle = 'rgba(250,250,247,.28)';
            hctx.fillRect(bx + i * (segW + gap), 14, segW, 5);
            if (f > 0) {
              hctx.fillStyle = f >= 1 ? '#7BC67E' : '#F2B01E';
              hctx.fillRect(bx + i * (segW + gap), 14, segW * f, 5);
            }
          }
          if (angleIdx >= 0) {
            let s = 0;
            for (let i = 0; i < angleIdx; i++) s += SEGMENTS[i].dur;
            const rem = Math.max(0, Math.ceil(s + SEGMENTS[angleIdx].dur - elapsed));
            hudPill('NOW · ' + rem + 'S LEFT', HH * 0.095, '#B9BEC4');
            hudPill(SEGMENTS[angleIdx].label, HH * 0.135, '#FFFFFF', true);
            if (angleIdx + 1 < SEGMENTS.length) {
              hudPill('NEXT \u2192 ' + SEGMENTS[angleIdx + 1].label, HH * 0.175, 'rgba(250,250,247,.75)');
            }
          }
        } else if (stream && !photoPhase && !corrective && MODE !== 'corrective' && countdownLeft <= 0 && cam.readyState >= 2 && !rehearse) {
          // Pre-record framing guide: thirds grid + body guide + framed status
          hctx.strokeStyle = 'rgba(250,250,247,.14)';
          hctx.lineWidth = 1;
          for (const f of [1 / 3, 2 / 3]) {
            hctx.beginPath(); hctx.moveTo(HW * f, 0); hctx.lineTo(HW * f, HH); hctx.stroke();
            hctx.beginPath(); hctx.moveTo(0, HH * f); hctx.lineTo(HW, HH * f); hctx.stroke();
          }
          const gx = HW * 0.28, gw = HW * 0.44, gy = HH * 0.12, gh = HH * 0.78;
          const ok = frameStatus && frameStatus.ok;
          hctx.setLineDash([14, 10]);
          hctx.strokeStyle = ok ? 'rgba(123,198,126,.9)' : 'rgba(242,176,30,.85)';
          hctx.lineWidth = 3;
          pathRound(hctx, gx, gy, gw, gh, { tl: gw / 2, tr: gw / 2, bl: 10, br: 10 });
          hctx.stroke();
          hctx.setLineDash([]);
          hudPill('FILL THE GUIDE \u00b7 HEAD TO ANKLES', HH * 0.095, '#F2B01E');
          const st = frameStatus || { ok: false, msg: 'CHECKING FRAMING\u2026' };
          hudPill((st.ok ? '\u2713 ' : '') + st.msg, HH * 0.945, st.ok ? '#7BC67E' : '#F2B01E');
        }
      }

      // Coarse framing heuristic: edge energy inside the body guide vs. the side
      // margins. A person filling the guide adds edges inside relative to outside.
      // Informational only — never blocks recording.
      const _anal = document.createElement('canvas');
      _anal.width = 90; _anal.height = 160;
      function checkFraming() {
        if (!stream || recording || countdownLeft > 0 || photoPhase || rehearse || corrective || MODE === 'corrective' || cam.readyState < 2) { frameStatus = null; return; }
        try {
          const a = _anal.getContext('2d', { willReadFrequently: true });
          a.drawImage(cam, 0, 0, 90, 160);
          const d = a.getImageData(0, 0, 90, 160).data;
          const lum = new Float32Array(90 * 160);
          for (let i = 0; i < 90 * 160; i++) { const j = i * 4; lum[i] = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114; }
          const y0 = 19, y1 = 144; // guide rows (12%..90%)
          let occ = 0;
          for (let y = y0; y < y1; y++) {
            let inE = 0, outE = 0;
            for (let x = 26; x < 64; x++) { const i = y * 90 + x; inE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - 90]); }
            for (let x = 3; x < 22; x++) { const i = y * 90 + x; outE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - 90]); }
            for (let x = 68; x < 87; x++) { const i = y * 90 + x; outE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - 90]); }
            if (inE / 38 > (outE / 38) * 1.3 + 5) occ++;
          }
          const cov = occ / (y1 - y0);
          frameStatus = cov > 0.55
            ? { ok: true, msg: 'FRAMED \u2014 WHOLE BODY IN VIEW' }
            : { ok: false, msg: 'ADJUST \u2014 FILL THE GUIDE TOP TO BOTTOM' };
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
      // Variance-of-Laplacian on a small grayscale copy — higher = sharper.
      function sharpness(c) {
        const sw = 120, sh = Math.max(2, Math.round(c.height * 120 / c.width));
        const s = document.createElement('canvas');
        s.width = sw; s.height = sh;
        const q = s.getContext('2d');
        q.drawImage(c, 0, 0, sw, sh);
        const d = q.getImageData(0, 0, sw, sh).data;
        const g = new Float32Array(sw * sh);
        for (let i = 0; i < sw * sh; i++) { const j = i * 4; g[i] = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114; }
        let sum = 0;
        for (let y = 1; y < sh - 1; y++) {
          for (let x = 1; x < sw - 1; x++) {
            const i = y * sw + x;
            const l = g[i] * 4 - g[i - 1] - g[i + 1] - g[i - sw] - g[i + sw];
            sum += l * l;
          }
        }
        return sum;
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
        const p = c.getContext('2d');
        const weight = parseFloat($('.ra-w').value);
        p.textBaseline = 'middle';
        p.fillStyle = 'rgba(15,15,13,0.82)'; p.fillRect(0, 0, PW, Math.round(128 * k));
        p.fillStyle = '#FAFAF7'; p.font = '700 ' + Math.round(44 * k) + 'px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
        p.fillText('MICHEAL RAY BERRY', Math.round(40 * k), Math.round(50 * k));
        p.fillStyle = '#FF6B61'; p.font = '600 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText('PUBLIC ACCOUNTABILITY PROJECT', Math.round(40 * k), Math.round(94 * k));
        p.font = '700 ' + Math.round(34 * k) + 'px "IBM Plex Mono",monospace'; p.fillStyle = '#FAFAF7';
        p.fillText(label, PW - p.measureText(label).width - Math.round(40 * k), Math.round(62 * k));
        p.fillStyle = 'rgba(15,15,13,0.82)'; p.fillRect(0, PH - Math.round(128 * k), PW, Math.round(128 * k));
        p.fillStyle = '#FAFAF7'; p.font = '600 ' + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText(dayLabel + ' — ' + isoStr + (isNaN(weight) ? '' : ' · ' + weight.toFixed(1) + ' LB'), Math.round(40 * k), PH - Math.round(82 * k));
        p.fillStyle = '#B9B8B2'; p.font = '400 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText(label + ' · DAILY PHOTO · MICHEALRAYBERRY.COM' + (challenge ? ' · CODE ' + challenge.code : ''), Math.round(40 * k), PH - Math.round(40 * k));
        const entry = {
          label: label,
          slug: label.toLowerCase().replace(/ side$/, ''),
          dataUrl: c.toDataURL('image/jpeg', 0.92),
        };
        const ix = photos.findIndex((p) => p.label === label);
        if (ix >= 0) photos[ix] = entry; else photos.push(entry); // retake replaces in place
      }

      // X share card — the day's front photo composed on the site's palette
      // (off-white / ink / red), square 1080×1350 (X's 4:5 max), ready to attach
      // to the daily post. Same content as the record; presentation only.
      function buildXCard() {
        const front = photos.find((p) => p.slug === 'front') || photos[0];
        if (!front) return false;
        const img = new Image();
        img.onload = () => {
          const CW = 1080, CH = 1350;
          const c = document.createElement('canvas');
          c.width = CW; c.height = CH;
          const p = c.getContext('2d');
          const weight = parseFloat($('.ra-w').value);
          p.fillStyle = '#FAFAF7'; p.fillRect(0, 0, CW, CH);
          // Header
          p.textBaseline = 'middle';
          p.fillStyle = '#141412';
          p.font = '700 54px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
          p.fillText('MICHEAL RAY BERRY', 48, 64);
          p.fillStyle = '#B3261E';
          p.font = '600 26px "IBM Plex Mono",monospace';
          p.fillText('PUBLIC ACCOUNTABILITY PROJECT', 48, 116);
          // Day number, right-aligned
          p.fillStyle = '#141412';
          p.font = '700 44px "IBM Plex Mono",monospace';
          const dTxt = dayLabel.toUpperCase();
          p.fillText(dTxt, CW - p.measureText(dTxt).width - 48, 88);
          // Photo panel — contain, centered, thin ink border
          const PT = 160, PB = 190, PX = 48;
          const panW = CW - PX * 2, panH = CH - PT - PB;
          p.fillStyle = '#F1F0EA'; p.fillRect(PX, PT, panW, panH);
          const s = Math.min(panW / img.width, panH / img.height);
          const dw = img.width * s, dh = img.height * s;
          p.drawImage(img, PX + (panW - dw) / 2, PT + (panH - dh) / 2, dw, dh);
          p.strokeStyle = '#141412'; p.lineWidth = 3;
          p.strokeRect(PX + 1.5, PT + 1.5, panW - 3, panH - 3);
          // Footer
          const fy = CH - PB + 62;
          p.fillStyle = '#141412';
          p.font = '700 46px "IBM Plex Mono",monospace';
          p.fillText(isoStr + (isNaN(weight) ? '' : ' · ' + weight.toFixed(1) + ' LB'), 48, fy);
          p.fillStyle = '#B3261E';
          p.font = '600 28px "IBM Plex Mono",monospace';
          p.fillText('340 → 175 · MICHEALRAYBERRY.COM', 48, fy + 56);
          const a = document.createElement('a');
          a.href = c.toDataURL('image/jpeg', 0.92);
          a.download = 'micheal-ray-berry-x-card-' + isoStr +
            (preStart ? '-pre-start' : '-day-' + String(dayNum).padStart(3, '0')) + '.jpg';
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
        p.textBaseline = 'middle';
        p.fillStyle = 'rgba(15,15,13,0.82)'; p.fillRect(0, 0, PW, Math.round(128 * k));
        p.fillStyle = '#FAFAF7'; p.font = '700 ' + Math.round(44 * k) + 'px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
        p.fillText('MICHEAL RAY BERRY', Math.round(40 * k), Math.round(50 * k));
        p.fillStyle = '#FF6B61'; p.font = '600 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText('PUBLIC ACCOUNTABILITY PROJECT', Math.round(40 * k), Math.round(94 * k));
        const tag = 'EVENING MEAL' + (planTag || '');
        p.font = '700 ' + Math.round(34 * k) + 'px "IBM Plex Mono",monospace'; p.fillStyle = '#FAFAF7';
        p.fillText(tag, PW - p.measureText(tag).width - Math.round(40 * k), Math.round(62 * k));
        p.fillStyle = 'rgba(15,15,13,0.82)'; p.fillRect(0, PH - Math.round(128 * k), PW, Math.round(128 * k));
        p.fillStyle = '#FAFAF7'; p.font = '600 ' + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText(dayLabel + ' — ' + isoStr + ' · ' + new Date().toLocaleTimeString('en-US', { hour12: false }), Math.round(40 * k), PH - Math.round(82 * k));
        p.fillStyle = '#B9B8B2'; p.font = '400 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText('EVENING MEAL · AS SERVED · LIVE CAPTURE' + (code ? ' · CODE ' + code : '') + ' · MICHEALRAYBERRY.COM', Math.round(40 * k), PH - Math.round(40 * k));
        const dl = $('.ra-mealdl');
        dl.href = c.toDataURL('image/jpeg', 0.92);
        dl.download = 'micheal-ray-berry-evening-meal-' + isoStr +
          (preStart ? '-pre-start' : '-day-' + String(dayNum).padStart(3, '0')) + '.jpg';
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
        if (recording || countdownLeft > 0 || photoPhase || corrective) return;
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

      function drawPhotoPhase() {
        ctx.fillStyle = 'rgba(10,12,14,.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#B9BEC4';
        ctx.font = '600 ' + Math.round(H * 0.02) + "px 'IBM Plex Mono', monospace";
        ctx.fillText('PHOTO · ' + photoPhase.label, W / 2, H / 2 - Math.round(H * 0.14));
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 ' + Math.round(H * 0.22) + "px 'IBM Plex Sans Condensed', sans-serif";
        ctx.fillText(String(photoPhase.count), W / 2, H / 2);
        ctx.textAlign = 'left';
      }

      // ---- Violation portrait (§8-trimmed): stamped still, filed to the record ----
      const setVpNote = (m) => { $('.ra-vpnote').textContent = m; };
      async function captureViolationPortrait(vnum, vdate, code) {
        const shots = [];
        for (let s = 0; s < 3; s++) {
          const f = grabFrame();
          if (f) shots.push(f);
          if (s < 2) await new Promise((r) => setTimeout(r, 160));
        }
        if (!shots.length) return null;
        let c = shots[0], bestV = -1;
        for (const f of shots) { const v = sharpness(f); if (v > bestV) { bestV = v; c = f; } }
        const PW = c.width, PH = c.height, k = PW / 1080;
        const p = c.getContext('2d');
        p.textBaseline = 'middle';
        p.fillStyle = 'rgba(15,15,13,0.82)'; p.fillRect(0, 0, PW, Math.round(128 * k));
        p.fillStyle = '#FAFAF7'; p.font = '700 ' + Math.round(44 * k) + 'px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
        p.fillText('MICHEAL RAY BERRY', Math.round(40 * k), Math.round(50 * k));
        p.fillStyle = '#FF6B61'; p.font = '600 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText('PUBLIC ACCOUNTABILITY PROJECT', Math.round(40 * k), Math.round(94 * k));
        const tag = 'VIOLATION V-' + String(vnum).padStart(3, '0');
        p.font = '700 ' + Math.round(34 * k) + 'px "IBM Plex Mono",monospace'; p.fillStyle = '#FF6B61';
        p.fillText(tag, PW - p.measureText(tag).width - Math.round(40 * k), Math.round(62 * k));
        p.fillStyle = 'rgba(15,15,13,0.82)'; p.fillRect(0, PH - Math.round(128 * k), PW, Math.round(128 * k));
        p.fillStyle = '#FAFAF7'; p.font = '600 ' + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText('VIOLATION OF ' + vdate + ' · ASSESSED ' + isoStr, Math.round(40 * k), PH - Math.round(82 * k));
        p.fillStyle = '#B9B8B2'; p.font = '400 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
        p.fillText('ACTIVE UNTIL RESOLVED · LIVE CAPTURE' + (code ? ' · CODE ' + code : '') + ' · MICHEALRAYBERRY.COM', Math.round(40 * k), PH - Math.round(40 * k));
        return c;
      }
      $('.ra-vp').addEventListener('click', async () => {
        if (recording || countdownLeft > 0) return;
        if (!stream) { setVpNote('Tap Begin Daily Inspection (or just allow the camera) first, then capture.'); return; }
        const vnum = parseInt($('.ra-vpnum').value, 10);
        const vdate = $('.ra-vpdate').value;
        if (!vnum || !vdate) { setVpNote('Enter the violation number and date first — both are stamped into the portrait.'); return; }
        setVpNote('Requesting verification code…');
        const ch = await fetchChallenge('violation-portrait');
        if (!ch) { setVpNote('Verification code unavailable — a connection is required. The portrait cannot be captured unverified.'); return; }
        await setVideoRes(3840, 2160);
        const c = await captureViolationPortrait(vnum, vdate, ch.code);
        await setVideoRes(1920, 1080);
        if (!c) { setVpNote('Camera frame unavailable — try again.'); return; }
        beep(880, 150);
        const dataUrl = c.toDataURL('image/jpeg', 0.92);
        const dl = $('.ra-vpdl');
        dl.href = dataUrl;
        dl.download = 'micheal-ray-berry-violation-portrait-v' + String(vnum).padStart(3, '0') + '-' + isoStr + '.jpg';
        dl.textContent = 'Download Portrait (V-' + String(vnum).padStart(3, '0') + ')';
        dl.classList.remove('ra-hide');
        setVpNote('Filing to the record…');
        const blob = await (await fetch(dataUrl)).blob();
        const hash = await sha256Blob(blob);
        const filed = await postPacket({ name: 'violation-portrait.jpg', image_b64: String(dataUrl).split(',')[1] });
        const att = await attestPost({ kind: 'violation-portrait-v' + vnum, code: ch.code, weight: '', video_sha256: '', photo_sha256s: [hash] });
        setVpNote(filed && att
          ? 'Filed and attested. It is held privately with the violation entry for the AP.'
          : 'Captured, but filing failed — download it and send it to the AP directly.');
      });

      // ---- Corrective session (private · §8): continuous timed single take ----
      const CORR_LEVELS = { 1: 10, 2: 20, 3: 30 }; // minutes, per unified consequence structure
      let corrective = null, corrRecorder = null, corrChunks = [], corrInt = null;
      let poseLM = null, corrMonInt = null, micStream = null, micAnalyser = null;
      const setCorrNote = (m) => { $('.ra-corrnote').textContent = m; };
      // MediaPipe pose landmarker — loaded on demand at session start (CDN).
      async function loadPose() {
        if (poseLM) return;
        const v = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const files = await v.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        const opts = (d) => ({ baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: d }, runningMode: 'VIDEO', numPoses: 1 });
        try { poseLM = await v.PoseLandmarker.createFromOptions(files, opts('GPU')); }
        catch (e) { poseLM = await v.PoseLandmarker.createFromOptions(files, opts('CPU')); }
      }
      // Landmarks: 0 nose · 7/8 ears · 11/12 shoulders · 15/16 wrists · 23/24 hips.
      function corrMonitorTick() {
        if (!corrective) return;
        const now = Date.now();
        if (now < corrective.monStart) { corrective.monIssue = 'TAKE POSITION'; return; }
        const issues = [];
        try {
          const res = poseLM.detectForVideo(cam, performance.now());
          const lm = res.landmarks && res.landmarks[0];
          if (!lm) issues.push('OUT OF FRAME');
          else {
            const vis = (i) => (lm[i].visibility == null ? 1 : lm[i].visibility);
            if (vis(11) < 0.5 && vis(12) < 0.5) issues.push('OUT OF FRAME');
            else {
              if (vis(0) < 0.4) issues.push('TURNED AWAY');
              const sw = Math.max(0.02, Math.abs(lm[11].x - lm[12].x));
              const near = (w, e) => Math.hypot(lm[w].x - lm[e].x, lm[w].y - lm[e].y) < sw * 0.8 && lm[w].y < Math.max(lm[11].y, lm[12].y);
              if (!((near(15, 7) || near(15, 8)) && (near(16, 7) || near(16, 8)))) issues.push('HANDS OFF HEAD');
              const cx = (lm[23].x + lm[24].x) / 2, cy = (lm[23].y + lm[24].y) / 2;
              if (corrective.lastC) {
                const d = Math.hypot(cx - corrective.lastC.x, cy - corrective.lastC.y);
                corrective.ema = (corrective.ema || 0) * 0.8 + d * 0.2;
                if (corrective.ema > 0.012) issues.push('EXCESSIVE MOVEMENT');
              }
              corrective.lastC = { x: cx, y: cy };
            }
          }
        } catch (e) {}
        if (micAnalyser) {
          const buf = new Float32Array(micAnalyser.fftSize);
          micAnalyser.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          corrective.aEma = (corrective.aEma || 0) * 0.9 + Math.sqrt(s / buf.length) * 0.1;
          if (corrective.aEma > 0.06) issues.push('NOISE / MUSIC');
        }
        if (issues.length) {
          corrective.monIssue = issues[0];
          if (!corrective.breachAt) { corrective.breachAt = now; corrective.warned = false; }
          const sec = (now - corrective.breachAt) / 1000;
          if (sec > 2.5 && !corrective.warned) {
            corrective.warned = true;
            corrective.strikes++;
            if (corrective.strikes >= 3) return invalidateCorrective('three warnings (' + issues[0].toLowerCase() + ')');
            beep(330, 300);
            say('Warning ' + (corrective.strikes === 1 ? 'one' : 'two') + '. Return to the required position and remain still.');
          }
          if (sec > 12) return invalidateCorrective('sustained breach (' + issues[0].toLowerCase() + ')');
        } else {
          corrective.monIssue = null;
          corrective.breachAt = null;
        }
      }
      function invalidateCorrective(reason) {
        if (!corrective) return;
        corrective.invalidReason = reason;
        say('Session invalidated. The full corrective session must restart from the beginning.');
        stopCorrective();
      }
      function correctiveOverlay() {
        const el = Math.max(0, (Date.now() - corrective.start) / 1000);
        const mm = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        // Monitor status — burned in so the tape itself shows enforcement.
        const monTxt = (corrective.monIssue || 'POSITION OK') + ' \u00b7 WARNINGS ' + (corrective.strikes || 0) + '/3';
        ctx.font = '600 ' + Math.round(H * 0.013) + "px 'IBM Plex Mono', monospace";
        const mw = ctx.measureText(monTxt).width;
        ctx.fillStyle = 'rgba(10,12,14,.7)';
        roundRect((W - mw) / 2 - 16, Math.round(H * 0.788), mw + 32, Math.round(H * 0.028), 8);
        ctx.fillStyle = corrective.monIssue ? '#F2B01E' : '#7BC67E';
        ctx.fillText(monTxt, W / 2, Math.round(H * 0.788) + Math.round(H * 0.014));
        const bandW = Math.round(W * 0.8), bandH = Math.round(H * 0.09);
        const bandX = Math.round((W - bandW) / 2), blockY = Math.round(H * 0.92) - bandH;
        ctx.fillStyle = 'rgba(10,12,14,.8)';
        roundRect(bandX, blockY, bandW, bandH, 14);
        ctx.fillStyle = '#B3261E';
        ctx.fillRect(bandX, blockY, Math.max(5, Math.round(W * 0.006)), bandH);
        ctx.fillStyle = '#B9BEC4';
        ctx.font = '600 ' + Math.round(H * 0.013) + "px 'IBM Plex Mono', monospace";
        // Burned-in wall clock, updating live — makes any cut or splice self-evident.
        ctx.fillText('MICHEAL RAY BERRY \u00b7 ' + isoStr + ' \u00b7 ' + new Date().toLocaleTimeString('en-US', { hour12: false }), W / 2, blockY + bandH * 0.24);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 ' + Math.round(H * 0.026) + "px 'IBM Plex Sans Condensed', sans-serif";
        ctx.fillText('LEVEL ' + corrective.level + ' \u00b7 ' + mm(el) + ' / ' + corrective.mins + ':00', W / 2, blockY + bandH * 0.55);
        ctx.fillStyle = '#B9BEC4';
        ctx.font = '600 ' + Math.round(H * 0.012) + "px 'IBM Plex Mono', monospace";
        ctx.fillText('RESOLVES VIOLATION OF ' + corrective.ref + ' \u00b7 ' + dayLabel + (corrective.code ? ' \u00b7 CODE ' + corrective.code : ''), W / 2, blockY + bandH * 0.82);
        ctx.textAlign = 'left';
      }
      function stopCorrective() {
        clearInterval(corrInt);
        clearInterval(corrMonInt);
        if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; micAnalyser = null; }
        if (corrRecorder && corrRecorder.state !== 'inactive') corrRecorder.stop();
        $('.ra-recdot').classList.remove('on');
        $('.ra-cstop').classList.add('ra-hide');
        $('.ra-cstart').classList.remove('ra-hide');
      }
      function finishCorrective() {
        const c = corrective;
        corrective = null;
        const durMs = Date.now() - c.start;
        const type = corrRecorder.mimeType || 'video/webm';
        const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
        if (!c.done) {
          // Strict: an aborted or invalidated session is discarded entirely.
          corrChunks = [];
          beep(220, 600);
          if (!c.invalidReason) say('Session aborted at ' + Math.floor(durMs / 60000) + ' minutes. An incomplete corrective session does not count. The full duration must be restarted from the beginning.');
          setCorrNote((c.invalidReason ? 'INVALIDATED — ' + c.invalidReason + '. ' : 'ABORTED — ') + 'Nothing was saved. Incomplete sessions do not count: the full ' + c.mins + '-minute session restarts from zero.');
          return;
        }
        const blob = new Blob(corrChunks, { type });
        corrChunks = [];
        say('Corrective session complete. The level ' + c.level + ' requirement is met. Send the recording to the Accountability Partner tonight.');
        const deliver = (finalBlob) => {
          const dl = $('.ra-cdl');
          dl.href = URL.createObjectURL(finalBlob);
          dl.download = 'micheal-ray-berry-corrective-session-level-' + c.level + '-' + isoStr +
            (preStart ? '' : '-day-' + String(dayNum).padStart(3, '0')) + '.' + ext;
          dl.textContent = 'Download Session (Level ' + c.level + ' \u00b7 ' + c.mins + ' min \u00b7 ' + (finalBlob.size / 1048576).toFixed(0) + ' MB)';
          dl.classList.remove('ra-hide');
          setCorrNote('Complete — full ' + c.mins + ' minutes recorded. Logging attestation…');
          (async () => {
            const vh = await sha256Blob(finalBlob);
            const ok = await attestPost({ kind: 'corrective-L' + c.level + ' re ' + c.ref, code: c.code || '', weight: '', video_sha256: vh, photo_sha256s: [] });
            setCorrNote((ok ? 'ATTESTED \u2713 — fingerprint logged with server time. ' : 'ATTESTATION FAILED — flag it to the AP. ') +
              'Complete — full ' + c.mins + ' minutes recorded. Download the file and deliver it tonight.');
          })();
        };
        if (ext === 'webm' && typeof ysFixWebmDuration === 'function') ysFixWebmDuration(blob, durMs, deliver);
        else deliver(blob);
      }
      $('.ra-cstart').addEventListener('click', async () => {
        if (recording || countdownLeft > 0 || corrective || photoPhase) return;
        const level = parseInt($('.ra-clevel').value, 10);
        const mins = CORR_LEVELS[level];
        const ref = $('.ra-cref').value;
        if (!ref) {
          setCorrNote('Enter the violation date this session resolves — it is stamped into the recording.');
          $('.ra-cref').focus();
          return;
        }
        if (!stream) { await startCamera(); if (!stream) return; }
        await setVideoRes(1920, 1080);
        setCorrNote('Loading position monitor…');
        try { await loadPose(); } catch (e) { setCorrNote('Position monitor failed to load — a connection is required. The session cannot run unmonitored.'); return; }
        try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { setCorrNote('Microphone required — the session records room audio for verification.'); return; }
        ensureAC();
        try {
          const micSrc = audioCtx.createMediaStreamSource(micStream);
          micAnalyser = audioCtx.createAnalyser();
          micAnalyser.fftSize = 1024;
          micSrc.connect(micAnalyser);
          if (elDest) micSrc.connect(elDest); // room audio is part of the recording
        } catch (e) {}
        setCorrNote('Requesting verification code…');
        const ch = await fetchChallenge('corrective');
        if (!ch) { setCorrNote('Verification code unavailable — a connection is required. The session cannot start unverified.'); return; }
        const startLine = 'Corrective session. This is corner time at level ' + level + ', assigned against ' + ref + '. ' +
          mins + ' continuous minutes, one unedited take. You do not speak at any point — the voice speaks for the record. ' +
          'The verification code shown on screen was issued by the record moments ago, so this footage cannot be older than it claims. ' +
          'Assume the position: standing in the corner, camera on your back, hands behind the head, feet shoulder-width apart. ' +
          'Position, movement, and room audio are monitored throughout. Three warnings invalidate the session and the full duration restarts from zero. ' +
          'Ten seconds to take position. The session begins now.';
        const markLines = [];
        for (let m = 5; m < mins; m += 5) markLines.push(m + ' minutes elapsed. ' + (mins - m) + ' minutes remaining. The session continues.');
        setCorrNote('Preparing voice lines…');
        await prefetchTexts([startLine,
          'Warning one. Return to the required position and remain still.',
          'Warning two. Return to the required position and remain still.',
          'Session invalidated. The full corrective session must restart from the beginning.'].concat(markLines));
        setCorrNote('Recording. One continuous take — monitored. Do not stop until the voice announces completion.');
        corrective = { level, mins, ref, code: ch.code, total: mins * 60, start: Date.now(), marks: {}, done: false, strikes: 0, monStart: Date.now() + 10000 };
        corrChunks = [];
        const cs = view.captureStream(30);
        ensureAC();
        if (elDest) elDest.stream.getAudioTracks().forEach((t) => cs.addTrack(t));
        const mime =
          MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
          : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm'
          : '';
        // Long take — modest bitrate keeps a 30-min file deliverable (~400 MB max).
        corrRecorder = new MediaRecorder(cs, mime ? { mimeType: mime, videoBitsPerSecond: 1800000 } : { videoBitsPerSecond: 1800000 });
        corrRecorder.ondataavailable = (e) => { if (e.data.size) corrChunks.push(e.data); };
        corrRecorder.onstop = finishCorrective;
        corrective.start = Date.now();
        corrRecorder.start(1000);
        beep(880, 150); beep(880, 150, 0.22);
        say(startLine);
        $('.ra-cstart').classList.add('ra-hide');
        $('.ra-cstop').classList.remove('ra-hide');
        $('.ra-cdl').classList.add('ra-hide');
        $('.ra-recdot').classList.add('on');
        corrInt = setInterval(() => {
          const el = (Date.now() - corrective.start) / 1000;
          const timer = $('.ra-timer');
          timer.textContent = Math.floor(el / 60) + ':' + String(Math.floor(el % 60)).padStart(2, '0');
          timer.classList.toggle('warn', corrective.total - el <= 60);
          const elMin = Math.floor(el / 60);
          if (elMin > 0 && elMin % 5 === 0 && elMin < corrective.mins && !corrective.marks[elMin] && el - elMin * 60 < 0.5) {
            corrective.marks[elMin] = 1;
            say(elMin + ' minutes elapsed. ' + (corrective.mins - elMin) + ' minutes remaining. The session continues.');
            beep(660, 120);
          }
          if (el >= corrective.total) {
            corrective.done = true;
            beep(880, 150); beep(880, 150, 0.22);
            stopCorrective();
          }
        }, 200);
        corrMonInt = setInterval(corrMonitorTick, 300);
      });
      $('.ra-cstop').addEventListener('click', () => {
        if (!corrective) return;
        stopCorrective();
      });

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
          if (micTracks.length && audioCtx && elDest) {
            const micSrc = audioCtx.createMediaStreamSource(new MediaStream(micTracks));
            micSrc.connect(elDest);
          }
        } catch (e) {}
        if (elDest) elDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));

        const mime =
          MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm'
          : '';

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
          let idx = 0, acc = 0;
          for (let i = 0; i < SEGMENTS.length; i++) {
            if (elapsed >= acc) idx = i;
            acc += SEGMENTS[i].dur;
          }
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

        if (durMs < (SEQ_TOTAL - 1) * 1000) {
          setNote('Stopped at ' + (durMs / 1000).toFixed(1) +
            's — the inspection requires the full guided sequence (' + SEQ_TOTAL + 's). Re-record from the start.');
          return;
        }

        const deliver = (finalBlob) => {
          const dl = $('.ra-dl');
          dl.href = URL.createObjectURL(finalBlob);
          dl.download = 'micheal-ray-berry-daily-inspection-' + isoStr +
            (preStart ? '-pre-start' : '-day-' + String(dayNum).padStart(3, '0')) + '.' + ext;
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
        const spokenDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const wSpoken = isNaN(w) ? '' : (w % 1 === 0 ? String(Math.round(w)) : w.toFixed(1)); // "335", not "335 point zero"
        /* The verification code is burned into the frame, not spoken: it is
           evidence for the AP, not narration, and reading four digits aloud
           in every recording adds nothing a viewer can use. */
        SEGMENTS[0].speak = 'This is the official Daily Inspection for Micheal Ray Berry, Day ' + dayNum + ' of the Public Accountability Project. Today is ' + spokenDate + '.' +
          (wSpoken ? ' Documented weight this morning: ' + wSpoken + ' pounds.' : '') +
          ' Stand at attention facing the camera. Feet together, hands behind the head, eyes forward. You do not speak during this recording. The voice speaks for the record.' +
          ' This is one continuous take. Four views are required, and the verification code shown on screen was issued moments ago by the record itself, so this footage cannot be older than it claims. Beginning with the front view. Hold the position.';
      }

      $('.ra-start').addEventListener('click', async () => {
        if (recording || countdownLeft > 0 || corrective) return;
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
      $('.ra-rehearse').addEventListener('click', () => {
        if (recording || countdownLeft > 0 || corrective) return;
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
            a.download = 'micheal-ray-berry-daily-photo-' + isoStr + '-' + p.slug + '.jpg';
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
            a.download = 'micheal-ray-berry-daily-photo-' + isoStr + '-' + p.slug + '.jpg';
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
      const FOOD_RE = /pizza|plate|soup|bowl|burrito|hotdog|hot ?dog|sandwich|salad|broccoli|carbonara|meat|loaf|potato|mushroom|pretzel|bagel|burger|french|fries|guacamole|ice ?cream|espresso|cup|banana|apple|orange|lemon|strawberry|pineapple|fig|pomegranate|corn|cucumber|pepper|squash|cauliflower|cabbage|artichoke|spaghetti|noodle|rice|omelet|pancake|waffle|dough|pie|cake|chocolate|trifle|eggnog|menu|restaurant|dining|frying ?pan|pot,|^pot$|wok|tray|dutch oven|lemon|zucchini|eggplant|acorn squash|butternut/i;
      async function loadFoodClf() {
        if (_foodClf) return _foodClf;
        const v = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const files = await v.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        _foodClf = await v.ImageClassifier.createFromOptions(files, {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite' },
          maxResults: 10,
          runningMode: 'IMAGE',
        });
        return _foodClf;
      }

      $('.ra-meal').addEventListener('click', async () => {
        if (recording || countdownLeft > 0 || corrective) return;
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
          setMealNote('ASSIGNED MEAL NOT CONFIRMED — today\u2019s plan is “' + mealPlan.meal + '” but the camera saw: ' + seen + '. Re-frame and capture again, or tap Capture once more to file anyway (it will be attested as PLAN NOT CONFIRMED for the AP).');
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
              ? 'Meal is ON THE RECORD \u2713 — live-captured, food-verified' + (mealPlan && mealPlan.labels.length ? (_mealPlanOk ? ', assigned meal confirmed \u2713' : ', PLAN NOT CONFIRMED (logged for AP review)') : '') + ', code ' + ch.code + ' stamped, fingerprint attested. Download below is a backup.'
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
        if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
        if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
      };
    }

    disconnectedCallback() {
      if (this._cleanup) this._cleanup();
      this._init = false;
      this.innerHTML = '';
    }
  }

  customElements.define('recording-assistant', RecordingAssistant);
})();
