/* Template and DOM shell for <recording-assistant>. Exported as strings so
   the selector-integrity check can compare the classes the code queries
   against the classes the template actually contains. */

export const CSS = `
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

export const HTML = `
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

// Injects the shared stylesheet once per document.
export function ensureStyles(doc) {
  if (doc.getElementById('ra-styles')) return;
  const st = doc.createElement('style');
  st.id = 'ra-styles';
  st.textContent = CSS;
  doc.head.appendChild(st);
}
