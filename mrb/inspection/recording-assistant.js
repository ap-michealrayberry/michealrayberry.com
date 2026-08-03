/* Recording Assistant — vanilla web component <recording-assistant>
   Records a 9:16 canvas-composited video with a branded overlay.
   BUILT FILE — do not edit. Source: tools/recording-assistant/src/
   Rebuild with: npm run build:ra   (then run: npm test) */
(() => {
  // tools/recording-assistant/src/constants.js
  var START_DATE = "2026-07-20";
  var SEGMENTS = [
    { label: "INSPECTION POSITION", tag: "FRONT VIEW · HANDS BEHIND HEAD", dur: 26, speak: "" },
    {
      label: "LEFT SIDE",
      tag: "VIEW 2 OF 4",
      dur: 11,
      speak: "Turn to your left. Hold the position. This view records the left profile."
    },
    {
      label: "REAR",
      tag: "VIEW 3 OF 4",
      dur: 11,
      speak: "Turn to the rear. Hold the position. This view records the back, shoulders to heels."
    },
    {
      label: "RIGHT SIDE",
      tag: "VIEW 4 OF 4",
      dur: 11,
      speak: "Turn to your right. Hold the position. This view records the right profile."
    },
    {
      label: "FRONT",
      tag: "CLOSING VIEW",
      dur: 11,
      speak: "Return to the front. Face the camera. Hands behind the head. This closing view confirms identity against the opening frame."
    },
    {
      label: "COMPLETE",
      tag: "DAILY INSPECTION",
      dur: 22,
      speak: "All four required views are recorded. This inspection documents the result exactly as it is, with no adjustment and no commentary. The remaining requirements of the Daily Compliance Packet are due by ten PM Eastern: the four accountability photographs, the weight entry, and the record update. Nothing is complete until the record accepts all of them. Up, down, or flat, it gets posted. Daily Inspection complete."
    }
  ];
  var PHOTO_SEGS = [
    { label: "FRONT", say: "Now the photos. Front view. Hold still.", wait: 6 },
    { label: "LEFT SIDE", say: "Turn to your left. Hold still.", wait: 6 },
    { label: "REAR", say: "Turn to the rear. Hold still.", wait: 6 },
    { label: "RIGHT SIDE", say: "Turn to your right. Hold still.", wait: 6 }
  ];
  var TITLE_SEC = 2.5;
  var SHEET_CSV = "https://docs.google.com/spreadsheets/d/1BKNAGZEchYs2P5ZoWql6Ct_4GTyAKJxUqEsXVsJyeDM/gviz/tq?tqx=out:csv";
  var ATTEST_ENDPOINT = "https://script.google.com/macros/s/AKfycbyJ7PV4NAmK2WcP-pBMLW78orrw_i7KndnKEkWLT_Xd0GtyeRztQpOxd2oSaitEHJM7/exec";
  var WEIGHT_AUTO_START = "2026-07-30";
  var VIEW_W = 1080;
  var VIEW_H = 1920;
  var HUD_W = 720;
  var HUD_H = 1280;
  var EL_DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB";
  var EL_TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech/";
  var MEDIAPIPE_VISION_MJS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
  var MEDIAPIPE_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
  var MEDIAPIPE_FOOD_MODEL = "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite";
  var FOOD_RE = /pizza|plate|soup|bowl|burrito|hotdog|hot ?dog|sandwich|salad|broccoli|carbonara|meat|loaf|potato|mushroom|pretzel|bagel|burger|french|fries|guacamole|ice ?cream|espresso|cup|banana|apple|orange|lemon|strawberry|pineapple|fig|pomegranate|corn|cucumber|pepper|squash|cauliflower|cabbage|artichoke|spaghetti|noodle|rice|omelet|pancake|waffle|dough|pie|cake|chocolate|trifle|eggnog|menu|restaurant|dining|frying ?pan|pot,|^pot$|wok|tray|dutch oven|lemon|zucchini|eggplant|acorn squash|butternut/i;

  // tools/recording-assistant/src/ui.js
  var CSS = `
    .ra-root{background:#FAFAF7;color:#141412;font-family:'IBM Plex Sans',system-ui,sans-serif;display:flex;flex-direction:column;width:100%;}
    .ra-root *{box-sizing:border-box;margin:0;padding:0;}
    .ra-stage{display:flex;align-items:center;justify-content:center;padding:24px 10px 8px;position:relative;min-height:0;}
    .ra-view{width:100%;max-width:420px;max-height:70vh;aspect-ratio:9/16;object-fit:contain;border:1px solid #141412;background:#000;}
    @media(max-width:640px){.ra-view{max-width:none;max-height:78vh;}.ra-viewwrap{display:block;}}
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
  var HTML = `
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
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid #D8D6CF">
        <label style="display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6B6A64;margin-bottom:8px">Corrective session</label>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#3A3935">
          Corrective sessions are recorded with the dedicated tool, which runs the
          full assigned sequence and monitors position, posture and attire throughout.
          <a href="/mrb/corrective/" style="color:#B3261E">Open the corrective tool →</a>
        </p>
      </div>
    </div>
  `;
  function ensureStyles(doc) {
    if (doc.getElementById("ra-styles")) return;
    const st = doc.createElement("style");
    st.id = "ra-styles";
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  // tools/recording-assistant/src/overlay.js
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
  function drawCameraFrame(ctx, cam, s) {
    const { W, H, facing } = s;
    const vw = cam.videoWidth, vh = cam.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    if (facing === "user") {
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(cam, W - dx - dw, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(cam, dx, dy, dw, dh);
    }
  }
  function drawLiveOverlay(ctx, s) {
    const { W, H, isoStr, dayLabel, weight, code } = s;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const topY = Math.round(H * 0.055);
    const eb = "PUBLIC ACCOUNTABILITY PROJECT" + (code ? " · CODE " + code : "");
    ctx.font = "600 " + Math.round(H * 0.016) + "px 'IBM Plex Mono', monospace";
    const ebW = ctx.measureText(eb).width;
    const ebX = (W - ebW) / 2;
    const topPadX = Math.round(W * 0.02);
    const topH = Math.round(H * 0.034);
    ctx.fillStyle = "rgba(10,12,14,.68)";
    roundRect(ctx, ebX - topPadX, topY - topH / 2, ebW + topPadX * 2, topH, 12);
    ctx.fillStyle = "#D8DBDE";
    ctx.fillText(eb, ebX, topY);
    const bandW = Math.round(W * 0.67);
    const bandH = Math.round(H * 0.066);
    const bandX = Math.round((W - bandW) / 2);
    const blockY = Math.round(H * 0.9) - bandH;
    const accentW = Math.max(5, Math.round(W * 6e-3));
    ctx.fillStyle = "rgba(10,12,14,.78)";
    roundRect(ctx, bandX, blockY, bandW, bandH, 14);
    ctx.fillStyle = "#B3261E";
    ctx.fillRect(bandX, blockY, accentW, bandH);
    ctx.textAlign = "center";
    ctx.fillStyle = "#B9BEC4";
    ctx.font = "600 " + Math.round(H * 0.014) + "px 'IBM Plex Mono', monospace";
    ctx.fillText("MICHEAL RAY BERRY · " + isoStr, W / 2, blockY + bandH * 0.3);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 " + Math.round(H * 0.028) + "px 'IBM Plex Sans Condensed', sans-serif";
    ctx.fillText(
      dayLabel + (isNaN(weight) ? "" : " · " + weight.toFixed(1) + " LB"),
      W / 2,
      blockY + bandH * 0.71
    );
    ctx.textAlign = "left";
  }
  function drawCountdown(ctx, s, countdownLeft) {
    const { W, H } = s;
    ctx.fillStyle = "rgba(10,12,14,.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 " + Math.round(H * 0.22) + "px 'IBM Plex Sans Condensed', sans-serif";
    ctx.fillText(String(Math.ceil(countdownLeft)), W / 2, H / 2);
    ctx.font = "600 " + Math.round(H * 0.018) + "px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#B9BEC4";
    ctx.fillText("RECORDING STARTS IN", W / 2, H / 2 - Math.round(H * 0.14));
    ctx.textAlign = "left";
  }
  function drawTitleCard(ctx, s, elapsed) {
    const { W, H, isoStr, dayLabel, weight, code, titleSec } = s;
    const fade = Math.min(1, Math.max(0, (titleSec - elapsed) / 0.5));
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#141412";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#B3261E";
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, H - 12, W, 12);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#B3261E";
    ctx.font = "600 " + Math.round(H * 0.018) + "px 'IBM Plex Mono', monospace";
    ctx.fillText("PUBLIC ACCOUNTABILITY PROJECT", W / 2, H * 0.3);
    ctx.fillStyle = "#FAFAF7";
    ctx.font = "700 " + Math.round(H * 0.105) + "px 'IBM Plex Sans Condensed', sans-serif";
    ctx.fillText(dayLabel, W / 2, H * 0.42);
    if (!isNaN(weight)) {
      ctx.font = "600 " + Math.round(H * 0.065) + "px 'IBM Plex Mono', monospace";
      ctx.fillText(weight.toFixed(1) + " LB", W / 2, H * 0.53);
    }
    ctx.fillStyle = "#8A8983";
    ctx.font = "600 " + Math.round(H * 0.018) + "px 'IBM Plex Mono', monospace";
    ctx.fillText("MICHEAL RAY BERRY · DAILY INSPECTION · " + isoStr, W / 2, H * 0.62);
    ctx.fillStyle = "#FAFAF7";
    ctx.fillText("MICHEALRAYBERRY.COM", W / 2, H * 0.7);
    if (code) {
      ctx.fillStyle = "#B3261E";
      ctx.fillText("VERIFICATION CODE " + code, W / 2, H * 0.76);
    }
    ctx.restore();
    ctx.textAlign = "left";
  }
  function drawPhotoPhase(ctx, s, photoPhase) {
    const { W, H } = s;
    ctx.fillStyle = "rgba(10,12,14,.45)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#B9BEC4";
    ctx.font = "600 " + Math.round(H * 0.02) + "px 'IBM Plex Mono', monospace";
    ctx.fillText("PHOTO · " + photoPhase.label, W / 2, H / 2 - Math.round(H * 0.14));
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 " + Math.round(H * 0.22) + "px 'IBM Plex Sans Condensed', sans-serif";
    ctx.fillText(String(photoPhase.count), W / 2, H / 2);
    ctx.textAlign = "left";
  }
  function drawRehearsalBackdrop(ctx, s) {
    const { W, H } = s;
    ctx.fillStyle = "#1B1B19";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#4A4A45";
    ctx.font = "600 " + Math.round(H * 0.024) + "px 'IBM Plex Mono', monospace";
    ctx.fillText("REHEARSAL — NO CAMERA · NOTHING IS RECORDED", W / 2, H / 2);
    ctx.textAlign = "left";
  }
  function stampStill(p, s) {
    const { PW, PH, k, label, isoStr, dayLabel, weight, code } = s;
    p.textBaseline = "middle";
    p.fillStyle = "rgba(15,15,13,0.82)";
    p.fillRect(0, 0, PW, Math.round(128 * k));
    p.fillStyle = "#FAFAF7";
    p.font = "700 " + Math.round(44 * k) + 'px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
    p.fillText("MICHEAL RAY BERRY", Math.round(40 * k), Math.round(50 * k));
    p.fillStyle = "#FF6B61";
    p.font = "600 " + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
    p.fillText("PUBLIC ACCOUNTABILITY PROJECT", Math.round(40 * k), Math.round(94 * k));
    p.font = "700 " + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
    p.fillStyle = "#FAFAF7";
    p.fillText(label, PW - p.measureText(label).width - Math.round(40 * k), Math.round(62 * k));
    p.fillStyle = "rgba(15,15,13,0.82)";
    p.fillRect(0, PH - Math.round(128 * k), PW, Math.round(128 * k));
    p.fillStyle = "#FAFAF7";
    p.font = "600 " + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
    p.fillText(dayLabel + " — " + isoStr + (isNaN(weight) ? "" : " · " + weight.toFixed(1) + " LB"), Math.round(40 * k), PH - Math.round(82 * k));
    p.fillStyle = "#B9B8B2";
    p.font = "400 " + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
    p.fillText(label + " · DAILY PHOTO · MICHEALRAYBERRY.COM" + (code ? " · CODE " + code : ""), Math.round(40 * k), PH - Math.round(40 * k));
  }
  function stampMeal(p, s) {
    const { PW, PH, k, isoStr, dayLabel, timeStr, planTag, code } = s;
    p.textBaseline = "middle";
    p.fillStyle = "rgba(15,15,13,0.82)";
    p.fillRect(0, 0, PW, Math.round(128 * k));
    p.fillStyle = "#FAFAF7";
    p.font = "700 " + Math.round(44 * k) + 'px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
    p.fillText("MICHEAL RAY BERRY", Math.round(40 * k), Math.round(50 * k));
    p.fillStyle = "#FF6B61";
    p.font = "600 " + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
    p.fillText("PUBLIC ACCOUNTABILITY PROJECT", Math.round(40 * k), Math.round(94 * k));
    const tag = "EVENING MEAL" + (planTag || "");
    p.font = "700 " + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
    p.fillStyle = "#FAFAF7";
    p.fillText(tag, PW - p.measureText(tag).width - Math.round(40 * k), Math.round(62 * k));
    p.fillStyle = "rgba(15,15,13,0.82)";
    p.fillRect(0, PH - Math.round(128 * k), PW, Math.round(128 * k));
    p.fillStyle = "#FAFAF7";
    p.font = "600 " + Math.round(34 * k) + 'px "IBM Plex Mono",monospace';
    p.fillText(dayLabel + " — " + isoStr + " · " + timeStr, Math.round(40 * k), PH - Math.round(82 * k));
    p.fillStyle = "#B9B8B2";
    p.font = "400 " + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
    p.fillText("EVENING MEAL · AS SERVED · LIVE CAPTURE" + (code ? " · CODE " + code : "") + " · MICHEALRAYBERRY.COM", Math.round(40 * k), PH - Math.round(40 * k));
  }
  function drawXCard(p, img, s) {
    const { CW, CH, isoStr, dayLabel, weight } = s;
    p.fillStyle = "#FAFAF7";
    p.fillRect(0, 0, CW, CH);
    p.textBaseline = "middle";
    p.fillStyle = "#141412";
    p.font = '700 54px "IBM Plex Sans Condensed","Arial Narrow",sans-serif';
    p.fillText("MICHEAL RAY BERRY", 48, 64);
    p.fillStyle = "#B3261E";
    p.font = '600 26px "IBM Plex Mono",monospace';
    p.fillText("PUBLIC ACCOUNTABILITY PROJECT", 48, 116);
    p.fillStyle = "#141412";
    p.font = '700 44px "IBM Plex Mono",monospace';
    const dTxt = dayLabel.toUpperCase();
    p.fillText(dTxt, CW - p.measureText(dTxt).width - 48, 88);
    const PT = 160, PB = 190, PX = 48;
    const panW = CW - PX * 2, panH = CH - PT - PB;
    p.fillStyle = "#F1F0EA";
    p.fillRect(PX, PT, panW, panH);
    const sc = Math.min(panW / img.width, panH / img.height);
    const dw = img.width * sc, dh = img.height * sc;
    p.drawImage(img, PX + (panW - dw) / 2, PT + (panH - dh) / 2, dw, dh);
    p.strokeStyle = "#141412";
    p.lineWidth = 3;
    p.strokeRect(PX + 1.5, PT + 1.5, panW - 3, panH - 3);
    const fy = CH - PB + 62;
    p.fillStyle = "#141412";
    p.font = '700 46px "IBM Plex Mono",monospace';
    p.fillText(isoStr + (isNaN(weight) ? "" : " · " + weight.toFixed(1) + " LB"), 48, fy);
    p.fillStyle = "#B3261E";
    p.font = '600 28px "IBM Plex Mono",monospace';
    p.fillText("340 → 175 · MICHEALRAYBERRY.COM", 48, fy + 56);
  }

  // tools/recording-assistant/src/hud.js
  function pathRound(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r.tl, y);
    c.arcTo(x + w, y, x + w, y + h, r.tr);
    c.arcTo(x + w, y + h, x, y + h, r.br);
    c.arcTo(x, y + h, x, y, r.bl);
    c.arcTo(x, y, x + w, y, r.tl);
    c.closePath();
  }
  function hudPill(hctx, HW, text, cy, color, big) {
    hctx.font = big ? '700 26px "IBM Plex Sans Condensed",sans-serif' : '600 15px "IBM Plex Mono",monospace';
    const tw = hctx.measureText(text).width;
    const ph = big ? 40 : 30;
    hctx.fillStyle = "rgba(10,12,14,.66)";
    pathRound(hctx, HW / 2 - tw / 2 - 14, cy - ph / 2, tw + 28, ph, { tl: 8, tr: 8, bl: 8, br: 8 });
    hctx.fill();
    hctx.fillStyle = color;
    hctx.fillText(text, HW / 2, cy);
  }
  function drawHud(hctx, s) {
    const { HW, HH, segments } = s;
    hctx.clearRect(0, 0, HW, HH);
    hctx.textAlign = "center";
    hctx.textBaseline = "middle";
    if (s.recording) {
      const elapsed = s.elapsed;
      const n = segments.length, gap = 4, bx = HW * 0.06, bw = HW * 0.88;
      const segW = (bw - gap * (n - 1)) / n;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const start = acc;
        acc += segments[i].dur;
        const f = elapsed <= start ? 0 : elapsed >= acc ? 1 : (elapsed - start) / segments[i].dur;
        hctx.fillStyle = "rgba(250,250,247,.28)";
        hctx.fillRect(bx + i * (segW + gap), 14, segW, 5);
        if (f > 0) {
          hctx.fillStyle = f >= 1 ? "#7BC67E" : "#F2B01E";
          hctx.fillRect(bx + i * (segW + gap), 14, segW * f, 5);
        }
      }
      if (s.angleIdx >= 0) {
        let acc2 = 0;
        for (let i = 0; i < s.angleIdx; i++) acc2 += segments[i].dur;
        const rem = Math.max(0, Math.ceil(acc2 + segments[s.angleIdx].dur - elapsed));
        hudPill(hctx, HW, "NOW · " + rem + "S LEFT", HH * 0.095, "#B9BEC4");
        hudPill(hctx, HW, segments[s.angleIdx].label, HH * 0.135, "#FFFFFF", true);
        if (s.angleIdx + 1 < segments.length) {
          hudPill(hctx, HW, "NEXT → " + segments[s.angleIdx + 1].label, HH * 0.175, "rgba(250,250,247,.75)");
        }
      }
    } else if (s.showGuide) {
      hctx.strokeStyle = "rgba(250,250,247,.14)";
      hctx.lineWidth = 1;
      for (const f of [1 / 3, 2 / 3]) {
        hctx.beginPath();
        hctx.moveTo(HW * f, 0);
        hctx.lineTo(HW * f, HH);
        hctx.stroke();
        hctx.beginPath();
        hctx.moveTo(0, HH * f);
        hctx.lineTo(HW, HH * f);
        hctx.stroke();
      }
      const gx = HW * 0.28, gw = HW * 0.44, gy = HH * 0.12, gh = HH * 0.78;
      const ok = s.frameStatus && s.frameStatus.ok;
      hctx.setLineDash([14, 10]);
      hctx.strokeStyle = ok ? "rgba(123,198,126,.9)" : "rgba(242,176,30,.85)";
      hctx.lineWidth = 3;
      pathRound(hctx, gx, gy, gw, gh, { tl: gw / 2, tr: gw / 2, bl: 10, br: 10 });
      hctx.stroke();
      hctx.setLineDash([]);
      hudPill(hctx, HW, "FILL THE GUIDE · HEAD TO ANKLES", HH * 0.095, "#F2B01E");
      const st = s.frameStatus || { ok: false, msg: "CHECKING FRAMING…" };
      hudPill(hctx, HW, (st.ok ? "✓ " : "") + st.msg, HH * 0.945, st.ok ? "#7BC67E" : "#F2B01E");
    }
  }

  // tools/recording-assistant/src/session.js
  function seqTotal(segments) {
    return segments.reduce((t, s) => t + s.dur, 0);
  }
  function segmentIndexAt(segments, elapsed) {
    let idx = 0, acc = 0;
    for (let i = 0; i < segments.length; i++) {
      if (elapsed >= acc) idx = i;
      acc += segments[i].dur;
    }
    return idx;
  }
  function finishDecision(durMs, totalSec) {
    if (durMs < (totalSec - 1) * 1e3) {
      return { accept: false, reason: "stopped at " + (durMs / 1e3).toFixed(1) + "s of " + totalSec + "s" };
    }
    return { accept: true };
  }
  function buildIntroLine({ dayNum, spokenDate, weightSpoken }) {
    return "This is the official Daily Inspection for Micheal Ray Berry, Day " + dayNum + " of the Public Accountability Project. Today is " + spokenDate + "." + (weightSpoken ? " Documented weight this morning: " + weightSpoken + " pounds." : "") + " Stand at attention facing the camera. Feet together, hands behind the head, eyes forward. You do not speak during this recording. The voice speaks for the record. This is one continuous take. Four views are required, and the verification code shown on screen was issued moments ago by the record itself, so this footage cannot be older than it claims. Beginning with the front view. Hold the position.";
  }
  function spokenWeight(w) {
    return isNaN(w) ? "" : w % 1 === 0 ? String(Math.round(w)) : w.toFixed(1);
  }
  function dayInfo(now, startDate) {
    const rawDay = Math.floor((now - /* @__PURE__ */ new Date(startDate + "T00:00:00")) / 864e5) + 1;
    const preStart = rawDay < 1;
    const dayNum = Math.max(1, rawDay);
    return {
      rawDay,
      preStart,
      dayNum,
      dayLabel: preStart ? "PRE-START" : "DAY " + dayNum,
      isoStr: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0")
    };
  }

  // tools/recording-assistant/src/capture.js
  function pickMimeType(isTypeSupported) {
    return isTypeSupported("video/mp4") ? "video/mp4" : isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : isTypeSupported("video/webm") ? "video/webm" : "";
  }
  function lumaPlane(data, n) {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      g[i] = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
    }
    return g;
  }
  function sharpnessScore(data, sw, sh) {
    const g = lumaPlane(data, sw * sh);
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
  var FRAME_W = 90;
  var FRAME_H = 160;
  function framingStatus(data) {
    const lum = lumaPlane(data, FRAME_W * FRAME_H);
    const y0 = 19, y1 = 144;
    let occ = 0;
    for (let y = y0; y < y1; y++) {
      let inE = 0, outE = 0;
      for (let x = 26; x < 64; x++) {
        const i = y * FRAME_W + x;
        inE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - FRAME_W]);
      }
      for (let x = 3; x < 22; x++) {
        const i = y * FRAME_W + x;
        outE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - FRAME_W]);
      }
      for (let x = 68; x < 87; x++) {
        const i = y * FRAME_W + x;
        outE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - FRAME_W]);
      }
      if (inE / 38 > outE / 38 * 1.3 + 5) occ++;
    }
    const cov = occ / (y1 - y0);
    return cov > 0.55 ? { ok: true, msg: "FRAMED — WHOLE BODY IN VIEW" } : { ok: false, msg: "ADJUST — FILL THE GUIDE TOP TO BOTTOM" };
  }
  function daySuffix(d) {
    return d.preStart ? "-pre-start" : "-day-" + String(d.dayNum).padStart(3, "0");
  }
  function videoFileName(d, ext) {
    return "micheal-ray-berry-daily-inspection-" + d.isoStr + daySuffix(d) + "." + ext;
  }
  function photoFileName(d, slug) {
    return "micheal-ray-berry-daily-photo-" + d.isoStr + "-" + slug + ".jpg";
  }
  function mealFileName(d) {
    return "micheal-ray-berry-evening-meal-" + d.isoStr + daySuffix(d) + ".jpg";
  }
  function xCardFileName(d) {
    return "micheal-ray-berry-x-card-" + d.isoStr + daySuffix(d) + ".jpg";
  }
  function photoSlug(label) {
    return label.toLowerCase().replace(/ side$/, "");
  }

  // tools/recording-assistant/src/voice.js
  function createVoice(env) {
    const _elCache = {};
    let _elAudio = null;
    let _sayGen = 0;
    function ttsRequest(text, key, voice) {
      return env.fetchFn(EL_TTS_BASE + voice + "?output_format=mp3_44100_64", {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.55, similarity_boost: 0.75 } })
      });
    }
    async function say(text) {
      if (!text) return;
      const mySay = ++_sayGen;
      if (_elAudio) {
        try {
          _elAudio.pause();
        } catch (e) {
        }
        _elAudio = null;
      }
      try {
        env.speech().cancel();
      } catch (e) {
      }
      const key = env.getKey();
      const voice = env.getVoiceId() || EL_DEFAULT_VOICE;
      if (key) {
        try {
          if (!_elCache[text]) {
            const r = await ttsRequest(text, key, voice);
            if (!r.ok) throw new Error(r.status);
            _elCache[text] = env.createObjectURL(await r.blob());
          }
          if (mySay !== _sayGen) return;
          if (_elAudio) {
            try {
              _elAudio.pause();
            } catch (e) {
            }
          }
          _elAudio = env.createAudio(_elCache[text]);
          try {
            env.wireAudio(_elAudio);
          } catch (e) {
          }
          await _elAudio.play();
          return;
        } catch (e) {
        }
      }
      if (mySay !== _sayGen) return;
      try {
        env.speech().cancel();
        const u = new env.Utterance(text);
        u.rate = 1.05;
        env.speech().speak(u);
      } catch (e) {
      }
    }
    async function prefetchTexts(texts) {
      const key = env.getKey();
      if (!key) return;
      const voice = env.getVoiceId() || EL_DEFAULT_VOICE;
      for (const text of texts.filter((t) => t && !_elCache[t])) {
        try {
          const r = await ttsRequest(text, key, voice);
          if (r.ok) _elCache[text] = env.createObjectURL(await r.blob());
        } catch (e) {
        }
      }
    }
    return { say, prefetchTexts };
  }

  // tools/recording-assistant/src/record.js
  async function sha256Blob(blob) {
    const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function createRecordClient(cfg) {
    const fetchFn = cfg.fetchFn || ((...a) => fetch(...a));
    async function fetchChallenge(kind) {
      try {
        const r = await fetchFn(cfg.endpoint + "?action=challenge&kind=" + kind + "&key=" + encodeURIComponent(cfg.deviceKey()));
        const j = await r.json();
        return j && j.ok && j.code ? j : null;
      } catch (e) {
        return null;
      }
    }
    async function attestPost(payload) {
      try {
        const r = await fetchFn(cfg.endpoint, { method: "POST", body: JSON.stringify(Object.assign({ action: "attest", date: cfg.isoStr, day: cfg.dayNum, key: cfg.deviceKey() }, payload)) });
        const j = await r.json();
        return !!(j && j.ok);
      } catch (e) {
        return false;
      }
    }
    async function postPacket(payload) {
      try {
        const r = await fetchFn(cfg.endpoint, { method: "POST", body: JSON.stringify(Object.assign({ action: "packet", date: cfg.isoStr, day: cfg.dayNum, key: cfg.deviceKey() }, payload)) });
        return !!(await r.json()).ok;
      } catch (e) {
        return false;
      }
    }
    return { fetchChallenge, attestPost, postPacket };
  }
  function parseChecklist(text, isoStr) {
    const line = text.split(/\r?\n/).find((l) => l.indexOf('"' + isoStr + '"') === 0);
    const cols = line ? line.split('","').map((s) => s.replace(/^"|"$/g, "")) : [];
    return {
      weight: !!parseFloat(cols[1]),
      photos: !!(cols[3] || "").trim(),
      video: !!(cols[7] || "").trim()
    };
  }
  function parseWeightPrefill(text, isoStr) {
    const rows = text.trim().split(/\r?\n/);
    let todayWeight = null, lastLogged = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const cols = rows[i].split(",");
      const dateStr = (cols[0] || "").replace(/"/g, "").trim();
      const w = parseFloat((cols[1] || "").replace(/"/g, ""));
      if (isNaN(w)) continue;
      if (lastLogged === null) lastLogged = w;
      if (dateStr === isoStr && todayWeight === null) todayWeight = w;
    }
    return { todayWeight, lastLogged };
  }
  function parseHealthWeight(text, isoStr) {
    const rows = text.trim().split(/\r?\n/);
    for (let i = rows.length - 1; i >= 1; i--) {
      const cols = rows[i].split(",").map((c) => c.replace(/"/g, "").trim());
      if (cols[0] === isoStr && parseFloat(cols[7])) return parseFloat(cols[7]);
    }
    return null;
  }
  function parseMealPlan(text, isoStr) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.split('","').map((s) => s.replace(/^"|"$/g, "")));
    if (!lines[0] || String(lines[0][1]).toLowerCase() !== "meal") return null;
    const row = lines.find((l) => (l[0] || "").trim() === isoStr);
    if (row && (row[1] || "").trim()) {
      return { meal: row[1].trim(), labels: (row[2] || "").split(",").map((x) => x.trim()).filter(Boolean) };
    }
    return null;
  }
  function minutesToDeadline(now) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "numeric", minute: "numeric" }).formatToParts(now);
    return 22 * 60 - (+p.find((x) => x.type === "hour").value * 60 + +p.find((x) => x.type === "minute").value);
  }

  // tools/recording-assistant/src/upload.js
  function createR2Uploader(cfg) {
    const fetchFn = cfg.fetchFn || ((...a) => fetch(...a));
    const XhrCtor = cfg.XhrCtor || XMLHttpRequest;
    return async function uploadVideoToR2(blob, onProgress) {
      const sign = await (await fetchFn(cfg.endpoint, {
        method: "POST",
        body: JSON.stringify({ action: "r2sign", key: cfg.deviceKey(), date: cfg.isoStr, kind: "daily", mime: blob.type || "video/mp4" })
      })).json();
      if (!sign || !sign.ok) throw new Error(sign && sign.error || "could not sign upload");
      await new Promise((resolve, reject) => {
        const xhr = new XhrCtor();
        xhr.open("PUT", sign.uploadUrl, true);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
        };
        xhr.onload = () => xhr.status === 200 || xhr.status === 201 ? resolve() : reject(new Error("R2 " + xhr.status + " " + String(xhr.responseText || "").slice(0, 120)));
        xhr.onerror = () => reject(new Error("the storage bucket refused the upload (CORS) — add https://michealrayberry.com to the R2 bucket’s CORS policy with PUT allowed"));
        xhr.send(blob);
      });
      return sign.publicUrl;
    };
  }

  // tools/recording-assistant/src/main.js
  var SEQ_TOTAL = seqTotal(SEGMENTS);
  var RecordingAssistant = class extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      ensureStyles(document);
      const root = document.createElement("div");
      root.className = "ra-root";
      root.innerHTML = HTML;
      this.appendChild(root);
      const $ = (sel) => root.querySelector(sel);
      const cam = $(".ra-cam");
      const view = $(".ra-view");
      const ctx = view.getContext("2d");
      const hud = $(".ra-hud");
      const hctx = hud.getContext("2d");
      const W = VIEW_W, H = VIEW_H;
      view.width = W;
      view.height = H;
      let stream = null, mediaRecorder = null, chunks = [];
      let facing = "environment", recStart = 0, timerInt = null;
      let countdownLeft = 0, recording = false, audioCtx = null;
      let rehearse = false;
      let angleIdx = -1;
      let photos = [], photoPhase = null;
      let frameStatus = null, lastVideoUrl = null;
      try {
        $(".ra-elkey").value = localStorage.getItem("mrb_el_key") || "";
        $(".ra-elvoice").value = localStorage.getItem("mrb_el_voice") || "";
        $(".ra-pkey").value = localStorage.getItem("mrb_packet_key") || "";
        if (!localStorage.getItem("mrb_el_key")) $(".ra-voice").open = true;
        $(".ra-elkey").addEventListener("change", (e) => localStorage.setItem("mrb_el_key", e.target.value.trim()));
        $(".ra-elvoice").addEventListener("change", (e) => localStorage.setItem("mrb_el_voice", e.target.value.trim()));
        $(".ra-pkey").addEventListener("change", (e) => localStorage.setItem("mrb_packet_key", e.target.value.trim()));
      } catch (e) {
      }
      let elDest = null;
      function ensureAC() {
        try {
          audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
          if (audioCtx.state === "suspended") audioCtx.resume();
          elDest = elDest || audioCtx.createMediaStreamDestination();
        } catch (e) {
        }
      }
      const voice = createVoice({
        getKey: () => {
          try {
            return localStorage.getItem("mrb_el_key") || "";
          } catch (e) {
            return "";
          }
        },
        getVoiceId: () => {
          try {
            return localStorage.getItem("mrb_el_voice") || "";
          } catch (e) {
            return "";
          }
        },
        fetchFn: (...a) => fetch(...a),
        createObjectURL: (b) => URL.createObjectURL(b),
        createAudio: (u) => new Audio(u),
        wireAudio: (el) => {
          ensureAC();
          const src = audioCtx.createMediaElementSource(el);
          src.connect(audioCtx.destination);
        },
        speech: () => speechSynthesis,
        Utterance: typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : function() {
        }
      });
      const say = voice.say;
      function prefetchLines() {
        return voice.prefetchTexts(SEGMENTS.map((s) => s.speak).concat(PHOTO_SEGS.map((s) => s.say)));
      }
      const today = /* @__PURE__ */ new Date();
      const day = dayInfo(today, START_DATE);
      const { dayNum, dayLabel, isoStr } = day;
      $(".ra-day").value = isoStr + " · " + dayLabel;
      const ov = () => ({
        W,
        H,
        isoStr,
        dayLabel,
        weight: parseFloat($(".ra-w").value),
        code: challenge ? challenge.code : null,
        titleSec: TITLE_SEC
      });
      let challenge = null, lastVideoBlob = null;
      const deviceKey = () => {
        try {
          return localStorage.getItem("mrb_packet_key") || "";
        } catch (e) {
          return "";
        }
      };
      const record = createRecordClient({
        endpoint: ATTEST_ENDPOINT,
        deviceKey,
        isoStr,
        dayNum,
        fetchFn: (...a) => fetch(...a)
      });
      const { fetchChallenge, attestPost, postPacket } = record;
      async function attestDaily() {
        try {
          const vh = lastVideoBlob ? await sha256Blob(lastVideoBlob) : "";
          const phs = [];
          for (const p of photos) phs.push(await sha256Blob(await (await fetch(p.dataUrl)).blob()));
          const ok = await attestPost({ kind: "daily", code: challenge ? challenge.code : "", weight: parseFloat($(".ra-w").value) || "", video_sha256: vh, photo_sha256s: phs });
          setNote((ok ? "ATTESTED ✓ — code and file fingerprints logged with server time. " : "ATTESTATION FAILED — fingerprints were not logged; flag it to the AP. ") + "Review the video and photos below (retake any photo), then file the packet — the video uploads itself to the record.", false);
        } catch (e) {
        }
      }
      const uploadVideoToR2 = createR2Uploader({
        endpoint: ATTEST_ENDPOINT,
        deviceKey,
        isoStr,
        fetchFn: (...a) => fetch(...a)
      });
      async function filePacket() {
        setNote("Filing photos and weight to the record…", false);
        let okAll = photos.length > 0;
        for (const p of photos) {
          const ok = await postPacket({
            name: photoFileName(day, p.slug),
            image_b64: String(p.dataUrl).split(",")[1],
            weight: parseFloat($(".ra-w").value) || ""
          });
          okAll = okAll && ok;
        }
        if (lastVideoBlob) {
          try {
            const mb = (lastVideoBlob.size / 1048576).toFixed(0);
            setNote("Uploading the inspection video (" + mb + " MB) — 0%. Keep this page open.", false);
            const publicUrl = await uploadVideoToR2(lastVideoBlob, (pct) => {
              setNote("Uploading the inspection video (" + mb + " MB) — " + pct + "%. Keep this page open.", false);
            });
            await postPacket({ video_url: publicUrl });
          } catch (e) {
            okAll = false;
            setNote("VIDEO UPLOAD FAILED (" + e.message + ") — download the video below and give it to the AP.");
          }
        }
        await postPacket({ finalize: true });
        refreshChecklist();
        setNote(okAll ? "Photos + weight are ON THE RECORD ✓ (attested). The video uploads itself to the record. The downloads below are backups." : "Some photos failed to file automatically — use Download All and upload them to the Drive folder manually.", false);
      }
      let checklistData = null;
      async function refreshChecklist() {
        try {
          const t = await (await fetch(SHEET_CSV + "&cb=" + Date.now())).text();
          checklistData = parseChecklist(t, isoStr);
        } catch (e) {
          checklistData = null;
        }
        drawChecklist();
      }
      function drawChecklist() {
        const el = $(".ra-check");
        if (!el) return;
        try {
          const mins = minutesToDeadline(/* @__PURE__ */ new Date());
          const done = checklistData && checklistData.weight && checklistData.photos && checklistData.video;
          const clockEl = el.querySelector(".ra-clock");
          clockEl.textContent = mins > 0 ? Math.floor(mins / 60) + "h " + mins % 60 + "m to 10:00 PM ET" : done ? "Past 10:00 PM ET — packet complete" : "PAST 10:00 PM ET — OVERDUE";
          clockEl.style.color = mins > 0 && mins >= 60 ? "#6B6A64" : mins <= 0 && done ? "#6B6A64" : "#B3261E";
          clockEl.style.fontWeight = mins < 60 ? "600" : "400";
        } catch (e) {
        }
        const c = checklistData || {};
        const mark = (sel, on, label) => {
          const n = el.querySelector(sel);
          n.textContent = (on ? "✓ " : "○ ") + label + (on ? " — on the record" : " — not yet on the record");
          n.style.color = on ? "#141412" : "#B3261E";
        };
        mark(".ra-ck-w", c.weight, "Weight");
        mark(".ra-ck-p", c.photos, "Daily photos");
        mark(".ra-ck-v", c.video, "Inspection video (Drive archive)");
      }
      setInterval(drawChecklist, 3e4);
      setInterval(refreshChecklist, 3e5);
      refreshChecklist();
      fetch(SHEET_CSV).then((r) => r.ok ? r.text() : null).then((t) => {
        if (!t) return;
        const { todayWeight, lastLogged } = parseWeightPrefill(t, isoStr);
        if (todayWeight !== null) $(".ra-w").value = todayWeight.toFixed(1);
        else if (lastLogged !== null) $(".ra-w").placeholder = lastLogged.toFixed(1) + " (last logged)";
      }).catch(() => {
      });
      if (isoStr >= WEIGHT_AUTO_START) {
        const wl = $(".ra-w").closest(".ra-field").querySelector("label");
        if (wl) wl.textContent = "Today's Weight (scale-synced)";
        $(".ra-w").placeholder = "step on the scale…";
        const lockWeight = () => fetch(SHEET_CSV.split("?")[0] + "?tqx=out:csv&sheet=Health").then((r) => r.ok ? r.text() : null).then((t) => {
          if (!t) return;
          const w = parseHealthWeight(t, isoStr);
          if (w !== null) {
            $(".ra-w").value = w.toFixed(1);
            $(".ra-w").readOnly = true;
            return;
          }
          setTimeout(lockWeight, 12e4);
        }).catch(() => {
        });
        lockWeight();
      }
      let mealPlan = null, _mealPlanOk = null, _mealOverride = false;
      fetch(SHEET_CSV.split("?")[0] + "?tqx=out:csv&sheet=" + encodeURIComponent("Meal Plan")).then((r) => r.ok ? r.text() : null).then((t) => {
        if (!t) return;
        mealPlan = parseMealPlan(t, isoStr);
        if (mealPlan) setMealNote("ASSIGNED MEAL TODAY: " + mealPlan.meal + " — the camera will check for it at capture.");
      }).catch(() => {
      });
      const setMealNote = (msg) => {
        $(".ra-mealnote").textContent = msg;
      };
      const setNote = (msg) => {
        $(".ra-note").textContent = msg;
      };
      async function startCamera() {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          });
        } catch (e) {
          setNote("Camera failed: " + e.message + " — needs HTTPS and camera permission.");
          return;
        }
        cam.srcObject = stream;
        await cam.play();
        startLoop();
        keepAwake();
      }
      let wakeLock = null;
      async function keepAwake() {
        try {
          wakeLock = await navigator.wakeLock.request("screen");
        } catch (e) {
        }
      }
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && stream) keepAwake();
      });
      async function setVideoRes(w, h) {
        try {
          const t = stream && stream.getVideoTracks()[0];
          if (t) {
            await t.applyConstraints({ width: { ideal: w }, height: { ideal: h } });
            await new Promise((r) => setTimeout(r, 250));
          }
        } catch (e) {
        }
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
            const elapsed = (Date.now() - recStart) / 1e3;
            if (elapsed < TITLE_SEC) drawTitleCard(ctx, ov(), elapsed);
          }
          if (photoPhase) drawPhotoPhase(ctx, ov(), photoPhase);
          if (countdownLeft > 0) drawCountdown(ctx, ov(), countdownLeft);
        }
        drawHud(hctx, {
          HW: HUD_W,
          HH: HUD_H,
          recording,
          elapsed: recording ? (Date.now() - recStart) / 1e3 : 0,
          segments: SEGMENTS,
          angleIdx,
          showGuide: !!(stream && !photoPhase && countdownLeft <= 0 && cam.readyState >= 2 && !rehearse),
          frameStatus
        });
        requestAnimationFrame(drawLoop);
      }
      const _anal = document.createElement("canvas");
      _anal.width = FRAME_W;
      _anal.height = FRAME_H;
      function checkFraming() {
        if (!stream || recording || countdownLeft > 0 || photoPhase || rehearse || cam.readyState < 2) {
          frameStatus = null;
          return;
        }
        try {
          const a = _anal.getContext("2d", { willReadFrequently: true });
          a.drawImage(cam, 0, 0, FRAME_W, FRAME_H);
          const d = a.getImageData(0, 0, FRAME_W, FRAME_H).data;
          frameStatus = framingStatus(d);
        } catch (e) {
          frameStatus = null;
        }
      }
      setInterval(checkFraming, 500);
      function beep(freq, durMs, when = 0) {
        try {
          ensureAC();
          if (!audioCtx) return;
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.frequency.value = freq;
          o.type = "sine";
          g.gain.setValueAtTime(0.4, audioCtx.currentTime + when);
          g.gain.exponentialRampToValueAtTime(1e-3, audioCtx.currentTime + when + durMs / 1e3);
          o.connect(g);
          g.connect(audioCtx.destination);
          if (elDest) g.connect(elDest);
          o.start(audioCtx.currentTime + when);
          o.stop(audioCtx.currentTime + when + durMs / 1e3 + 0.05);
        } catch (e) {
        }
      }
      function grabFrame() {
        const vw = cam.videoWidth, vh = cam.videoHeight;
        if (!vw || !vh) return null;
        const PW = Math.min(2160, vw), PH = Math.round(PW * vh / vw);
        const c = document.createElement("canvas");
        c.width = PW;
        c.height = PH;
        const p = c.getContext("2d");
        if (facing === "user") {
          p.save();
          p.translate(PW, 0);
          p.scale(-1, 1);
          p.drawImage(cam, 0, 0, PW, PH);
          p.restore();
        } else {
          p.drawImage(cam, 0, 0, PW, PH);
        }
        return c;
      }
      function sharpness(c) {
        const sw = 120, sh = Math.max(2, Math.round(c.height * 120 / c.width));
        const s = document.createElement("canvas");
        s.width = sw;
        s.height = sh;
        const q = s.getContext("2d");
        q.drawImage(c, 0, 0, sw, sh);
        return sharpnessScore(q.getImageData(0, 0, sw, sh).data, sw, sh);
      }
      async function captureStill(label) {
        const shots = [];
        for (let s = 0; s < 3; s++) {
          const f = grabFrame();
          if (f) shots.push(f);
          if (s < 2) await new Promise((r) => setTimeout(r, 160));
        }
        if (!shots.length) return;
        let c = shots[0], bestV = -1;
        for (const f of shots) {
          const v = sharpness(f);
          if (v > bestV) {
            bestV = v;
            c = f;
          }
        }
        const PW = c.width, PH = c.height;
        const k = PW / 1080;
        stampStill(c.getContext("2d"), {
          PW,
          PH,
          k,
          label,
          isoStr,
          dayLabel,
          weight: parseFloat($(".ra-w").value),
          code: challenge ? challenge.code : null
        });
        const entry = {
          label,
          slug: photoSlug(label),
          dataUrl: c.toDataURL("image/jpeg", 0.92)
        };
        const ix = photos.findIndex((p) => p.label === label);
        if (ix >= 0) photos[ix] = entry;
        else photos.push(entry);
      }
      function buildXCard() {
        const front = photos.find((p) => p.slug === "front") || photos[0];
        if (!front) return false;
        const img = new Image();
        img.onload = () => {
          const CW = 1080, CH = 1350;
          const c = document.createElement("canvas");
          c.width = CW;
          c.height = CH;
          drawXCard(c.getContext("2d"), img, {
            CW,
            CH,
            isoStr,
            dayLabel,
            weight: parseFloat($(".ra-w").value)
          });
          const a = document.createElement("a");
          a.href = c.toDataURL("image/jpeg", 0.92);
          a.download = xCardFileName(day);
          a.click();
        };
        img.src = front.dataUrl;
        return true;
      }
      function captureMeal(code, planTag) {
        const vw = cam.videoWidth, vh = cam.videoHeight;
        if (!vw || !vh) return false;
        const PW = Math.min(2160, vw), PH = Math.round(PW * vh / vw);
        const k = PW / 1080;
        const c = document.createElement("canvas");
        c.width = PW;
        c.height = PH;
        const p = c.getContext("2d");
        if (facing === "user") {
          p.save();
          p.translate(PW, 0);
          p.scale(-1, 1);
          p.drawImage(cam, 0, 0, PW, PH);
          p.restore();
        } else {
          p.drawImage(cam, 0, 0, PW, PH);
        }
        stampMeal(p, {
          PW,
          PH,
          k,
          isoStr,
          dayLabel,
          planTag,
          code,
          timeStr: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false })
        });
        const dl = $(".ra-mealdl");
        dl.href = c.toDataURL("image/jpeg", 0.92);
        dl.download = mealFileName(day);
        dl.textContent = "Download Meal Photo (" + dayLabel + ")";
        dl.classList.remove("ra-hide");
        return true;
      }
      async function runPhotoPhase() {
        await setVideoRes(3840, 2160);
        for (let i = 0; i < PHOTO_SEGS.length; i++) {
          const seg = PHOTO_SEGS[i];
          say(seg.say);
          for (let t = seg.wait; t > 0; t--) {
            photoPhase = { label: seg.label, count: t };
            if (t <= 3) beep(660, 100);
            await new Promise((r) => setTimeout(r, 1e3));
          }
          photoPhase = null;
          await captureStill(seg.label);
          beep(880, 150);
        }
        say("Session complete. Review the video and photos below.");
        $(".ra-photos").classList.remove("ra-hide");
        $(".ra-xcard").classList.remove("ra-hide");
        $(".ra-all").classList.remove("ra-hide");
        showReview();
        attestDaily().then(() => filePacket());
        setNote(
          "Review the video and all four photos below — retake any photo individually if needed. Then Download All — the downloads are backups; everything required has already filed itself to the record.",
          true
        );
      }
      function refreshThumbs() {
        const grid = $(".ra-thumbs");
        grid.innerHTML = "";
        photos.forEach((p, i) => {
          const cell = document.createElement("div");
          cell.style.cssText = "text-align:center";
          const img = document.createElement("img");
          img.src = p.dataUrl;
          img.style.cssText = "width:100%;display:block;border:1px solid #141412";
          const lab = document.createElement("div");
          lab.textContent = p.label;
          lab.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;margin:5px 0";
          const b = document.createElement("button");
          b.textContent = "Retake";
          b.className = "ra-ghost";
          b.style.cssText = "padding:7px 4px;font-size:10px";
          b.addEventListener("click", () => retakePhoto(i));
          cell.appendChild(img);
          cell.appendChild(lab);
          cell.appendChild(b);
          grid.appendChild(cell);
        });
      }
      function showReview() {
        if (lastVideoUrl) $(".ra-replay").src = lastVideoUrl;
        refreshThumbs();
        $(".ra-reviewbox").classList.remove("ra-hide");
      }
      async function retakePhoto(i) {
        if (recording || countdownLeft > 0 || photoPhase) return;
        if (!stream) {
          setNote("Camera is off — tap Begin Daily Inspection to restart it, then retake.");
          return;
        }
        await setVideoRes(3840, 2160);
        const p = photos[i];
        const seg = PHOTO_SEGS.find((s) => s.label === p.label) || PHOTO_SEGS[0];
        say(seg.say);
        for (let t = seg.wait; t > 0; t--) {
          photoPhase = { label: p.label, count: t };
          if (t <= 3) beep(660, 100);
          await new Promise((r) => setTimeout(r, 1e3));
        }
        photoPhase = null;
        await captureStill(p.label);
        beep(880, 150);
        refreshThumbs();
        say("Retake captured.");
        attestDaily().then(() => filePacket());
      }
      function beginRecording() {
        chunks = [];
        photos = [];
        if (!rehearse) {
          const canvasStream = view.captureStream(30);
          ensureAC();
          try {
            const micTracks = stream ? stream.getAudioTracks() : [];
            if (micTracks.length && audioCtx && elDest && !audioCtx.__micWired) {
              const micSrc = audioCtx.createMediaStreamSource(new MediaStream(micTracks));
              micSrc.connect(elDest);
              audioCtx.__micWired = 1;
            }
          } catch (e) {
          }
          if (elDest) elDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
          const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
          mediaRecorder = new MediaRecorder(
            canvasStream,
            mime ? { mimeType: mime, videoBitsPerSecond: 9e6 } : { videoBitsPerSecond: 9e6 }
          );
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          mediaRecorder.onstop = finishRecording;
          mediaRecorder.start(1e3);
        }
        recording = true;
        recStart = Date.now();
        angleIdx = 0;
        beep(880, 150);
        beep(880, 150, 0.22);
        say(SEGMENTS[0].speak);
        $(".ra-recdot").classList.add("on");
        $(".ra-stopbtn").classList.remove("ra-hide");
        $(".ra-dl").classList.add("ra-hide");
        $(".ra-all").classList.add("ra-hide");
        timerInt = setInterval(() => {
          const elapsed = (Date.now() - recStart) / 1e3;
          const seconds = Math.floor(elapsed);
          const timer = $(".ra-timer");
          timer.textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
          timer.classList.toggle("warn", seconds >= SEQ_TOTAL - 3);
          const idx = segmentIndexAt(SEGMENTS, elapsed);
          if (idx !== angleIdx) {
            angleIdx = idx;
            beep(660, 120);
            say(SEGMENTS[idx].speak);
          }
          if (elapsed >= SEQ_TOTAL) {
            stopRecording();
            if (rehearse) {
              say("Rehearsal complete. Nothing was recorded.");
              setNote("Rehearsal complete — no video, no photos, nothing to upload. Run the real inspection with the camera when ready.", true);
              rehearse = false;
              $(".ra-start").textContent = "Begin Daily Inspection";
            } else {
              runPhotoPhase();
            }
          }
        }, 200);
      }
      function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
        clearInterval(timerInt);
        recording = false;
        angleIdx = -1;
        beep(440, 450);
        $(".ra-recdot").classList.remove("on");
        $(".ra-stopbtn").classList.add("ra-hide");
        $(".ra-start").classList.remove("ra-hide");
        $(".ra-start").textContent = "Re-record Inspection";
      }
      function finishRecording() {
        const durMs = Date.now() - recStart;
        const weight = parseFloat($(".ra-w").value);
        const type = mediaRecorder.mimeType || "video/webm";
        const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type });
        if (!finishDecision(durMs, SEQ_TOTAL).accept) {
          setNote("Stopped at " + (durMs / 1e3).toFixed(1) + "s — the inspection requires the full guided sequence (" + SEQ_TOTAL + "s). Re-record from the start.");
          return;
        }
        const deliver = (finalBlob) => {
          const dl = $(".ra-dl");
          dl.href = URL.createObjectURL(finalBlob);
          dl.download = videoFileName(day, ext);
          dl.textContent = "Download Video (" + dayLabel + " · " + (finalBlob.size / 1048576).toFixed(1) + " MB · " + Math.round(durMs / 1e3) + "s)";
          dl.classList.remove("ra-hide");
          lastVideoUrl = dl.href;
          lastVideoBlob = finalBlob;
          $(".ra-yt").value = "Micheal Ray Berry — " + dayLabel + " Daily Inspection" + (isNaN(weight) ? "" : " · " + weight.toFixed(1) + " LB") + " | Public Accountability Project";
          $(".ra-titlebox").classList.remove("ra-hide");
          $(".ra-desc").value = dayLabel + " — official daily inspection. The public weight loss accountability record of Micheal Ray Berry: 340 → 175 lbs, documented every single day" + (isNaN(weight) ? "." : ". Weight today: " + weight.toFixed(1) + " lb.") + "\n\nEvery day: a standardized four-angle inspection video, a public weigh-in, and daily accountability photos. Up, down, or flat — it gets posted.\n\nFull record, weigh-in log, progress photos, violation log, and the signed agreement:\nhttps://michealrayberry.com";
          $(".ra-descbox").classList.remove("ra-hide");
          setNote("Video ready — posed photo sequence running…", false);
        };
        if (ext === "webm" && typeof ysFixWebmDuration === "function") {
          ysFixWebmDuration(blob, durMs, deliver);
        } else {
          deliver(blob);
        }
      }
      function buildIntro() {
        const w = parseFloat($(".ra-w").value);
        SEGMENTS[0].speak = buildIntroLine({
          dayNum,
          spokenDate: (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          weightSpoken: spokenWeight(w)
        });
      }
      $(".ra-start").addEventListener("click", async () => {
        if (recording || countdownLeft > 0) return;
        const weight = parseFloat($(".ra-w").value);
        if (isNaN(weight)) {
          setNote("Enter today's weight first — it goes on the overlay.");
          $(".ra-w").focus();
          return;
        }
        if (!stream) {
          await startCamera();
          if (!stream) return;
        }
        $(".ra-reviewbox").classList.add("ra-hide");
        await setVideoRes(1920, 1080);
        setNote("Requesting verification code…", false);
        challenge = await fetchChallenge("daily");
        if (!challenge) {
          setNote("Verification code unavailable — check the connection and try again. The inspection cannot start unverified.");
          return;
        }
        buildIntro();
        setNote("Preparing voice lines…", false);
        await prefetchLines();
        setNote("", false);
        countdownLeft = parseInt($(".ra-cd").value, 10);
        say(countdownLeft + " seconds. Take the inspection position.");
        $(".ra-start").classList.add("ra-hide");
        const cd = setInterval(() => {
          countdownLeft -= 0.1;
          if (countdownLeft <= 0) {
            countdownLeft = 0;
            clearInterval(cd);
            beginRecording();
          }
        }, 100);
      });
      $(".ra-stopbtn").addEventListener("click", () => {
        if (recording) stopRecording();
      });
      $(".ra-rehearse").addEventListener("click", () => {
        if (recording || countdownLeft > 0) return;
        rehearse = true;
        startLoop();
        buildIntro();
        (async () => {
          setNote("Preparing voice lines…", false);
          await prefetchLines();
          setNote("", false);
          countdownLeft = parseInt($(".ra-cd").value, 10);
          say(countdownLeft + " seconds. Rehearsal only — nothing is recorded. Take the inspection position.");
          $(".ra-start").classList.add("ra-hide");
          const cd = setInterval(() => {
            countdownLeft -= 0.1;
            if (countdownLeft <= 0) {
              countdownLeft = 0;
              clearInterval(cd);
              beginRecording();
            }
          }, 100);
        })();
      });
      $(".ra-flip").addEventListener("click", () => {
        facing = facing === "user" ? "environment" : "user";
        if (stream) startCamera();
      });
      $(".ra-all").addEventListener("click", () => {
        $(".ra-dl").click();
        photos.forEach((p, i) => {
          setTimeout(() => {
            const a = document.createElement("a");
            a.href = p.dataUrl;
            a.download = photoFileName(day, p.slug);
            a.click();
          }, 500 + i * 450);
        });
        setTimeout(() => buildXCard(), 500 + photos.length * 450 + 300);
      });
      $(".ra-photos").addEventListener("click", () => {
        photos.forEach((p, i) => {
          setTimeout(() => {
            const a = document.createElement("a");
            a.href = p.dataUrl;
            a.download = photoFileName(day, p.slug);
            a.click();
          }, i * 400);
        });
      });
      $(".ra-xcard").addEventListener("click", () => {
        buildXCard();
      });
      $(".ra-copy").addEventListener("click", () => {
        const input = $(".ra-yt");
        navigator.clipboard.writeText(input.value).then(() => {
          $(".ra-copy").textContent = "Copied";
          setTimeout(() => {
            $(".ra-copy").textContent = "Copy";
          }, 1500);
        }).catch(() => {
          input.select();
          document.execCommand("copy");
        });
      });
      $(".ra-copydesc").addEventListener("click", () => {
        const ta = $(".ra-desc");
        navigator.clipboard.writeText(ta.value).then(() => {
          $(".ra-copydesc").textContent = "Copied";
          setTimeout(() => {
            $(".ra-copydesc").textContent = "Copy description";
          }, 1500);
        }).catch(() => {
          ta.select();
          document.execCommand("copy");
        });
      });
      let _foodClf = null;
      async function loadFoodClf() {
        if (_foodClf) return _foodClf;
        const v = await import(MEDIAPIPE_VISION_MJS);
        const files = await v.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
        _foodClf = await v.ImageClassifier.createFromOptions(files, {
          baseOptions: { modelAssetPath: MEDIAPIPE_FOOD_MODEL },
          maxResults: 10,
          runningMode: "IMAGE"
        });
        return _foodClf;
      }
      $(".ra-meal").addEventListener("click", async () => {
        if (recording || countdownLeft > 0) return;
        if (!stream) {
          setMealNote("Tap Begin Daily Inspection (or just allow the camera) first, then capture.");
          return;
        }
        await setVideoRes(3840, 2160);
        setMealNote("Requesting verification code…");
        const ch = await fetchChallenge("meal");
        if (!ch) {
          setMealNote("Verification code unavailable — check the connection. The meal photo cannot be captured unverified.");
          return;
        }
        setMealNote("Checking for food…");
        let foodOk = false, seen = "";
        try {
          const clf = await loadFoodClf();
          const f = grabFrame();
          const sc = document.createElement("canvas");
          sc.width = 480;
          sc.height = Math.max(2, Math.round(480 * f.height / f.width));
          sc.getContext("2d").drawImage(f, 0, 0, sc.width, sc.height);
          const res = clf.classify(sc);
          const cats = res.classifications && res.classifications[0] && res.classifications[0].categories || [];
          seen = cats.slice(0, 3).map((c) => c.categoryName).join(", ");
          foodOk = cats.some((c) => FOOD_RE.test(c.categoryName) && c.score >= 0.08);
          if (mealPlan && mealPlan.labels.length) {
            _mealPlanOk = cats.some((c) => mealPlan.labels.some((L) => c.categoryName.toLowerCase().indexOf(L.toLowerCase()) !== -1) && c.score >= 0.06);
          }
        } catch (e) {
          foodOk = true;
          seen = "check unavailable — accepted";
        }
        if (!foodOk) {
          beep(220, 400);
          setMealNote("NO FOOD DETECTED (saw: " + (seen || "nothing recognizable") + "). Point the camera at the meal as served — fill the frame with the plate — and capture again. Nothing was filed.");
          return;
        }
        if (mealPlan && mealPlan.labels.length && _mealPlanOk === false && !_mealOverride) {
          _mealOverride = true;
          beep(220, 400);
          setMealNote("ASSIGNED MEAL NOT CONFIRMED — today’s plan is “" + mealPlan.meal + "” but the camera saw: " + seen + ". Re-frame and capture again, or tap Capture once more to file anyway (it will be attested as PLAN NOT CONFIRMED for the AP).");
          return;
        }
        const planTag = mealPlan && mealPlan.labels.length ? _mealPlanOk ? " · PLAN ✓" : " · PLAN NOT CONFIRMED" : "";
        if (captureMeal(ch.code, planTag)) {
          _mealOverride = false;
          beep(880, 150);
          setMealNote("Food verified ✓ — filing to the record…");
          const mdl = $(".ra-mealdl");
          try {
            const blob = await (await fetch(mdl.href)).blob();
            const hash = await sha256Blob(blob);
            const filed = await postPacket({ name: mdl.download, image_b64: String(mdl.href).split(",")[1] });
            const att = await attestPost({ kind: "meal" + (mealPlan && mealPlan.labels.length ? _mealPlanOk ? "-plan-confirmed" : "-plan-NOT-confirmed" : ""), code: ch.code, weight: "", video_sha256: "", photo_sha256s: [hash] });
            setMealNote(filed && att ? "Meal is ON THE RECORD ✓ — live-captured, food-verified" + (mealPlan && mealPlan.labels.length ? _mealPlanOk ? ", assigned meal confirmed ✓" : ", PLAN NOT CONFIRMED (logged for AP review)" : "") + ", code " + ch.code + " stamped, fingerprint attested. Download below is a backup." : "Captured and code-stamped, but filing/attestation had a problem — download the photo and upload it to the Drive folder manually.");
          } catch (e) {
            setMealNote("Captured, but filing failed — download the photo and upload it manually.");
          }
        }
      });
      startCamera();
      this._cleanup = () => {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (wakeLock) {
          try {
            wakeLock.release();
          } catch (e) {
          }
          wakeLock = null;
        }
      };
    }
    disconnectedCallback() {
      if (this._cleanup) this._cleanup();
      this._init = false;
      this.innerHTML = "";
    }
  };
  if (!customElements.get("recording-assistant")) {
    customElements.define("recording-assistant", RecordingAssistant);
  }
})();
