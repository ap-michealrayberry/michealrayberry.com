(function (MRB) {
  "use strict";

  /**
   * Pure compositor: drawOverlay(ctx, state) — no DOM, no globals, no clock.
   * Snapshot tests depend on this purity.
   *
   * state fields:
   *   sessionTag, name, projectLine, bottomPrimary, bottomSecondary,
   *   monitorText, monitorTone ('ok'|'warn'|'off'|null),
   *   videoEl (optional HTMLVideoElement), letterbox (default true)
   */
  var W = 720;
  var H = 1280;
  var TOP = 85;
  var BOTTOM = 85;

  function drawLetterboxedVideo(ctx, video) {
    if (!video) return;
    var vw = video.videoWidth || 0;
    var vh = video.videoHeight || 0;
    if (!vw || !vh) {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    // Contain (letterbox), never crop
    var scale = Math.min(W / vw, H / vh);
    var dw = vw * scale;
    var dh = vh * scale;
    var dx = (W - dw) / 2;
    var dy = (H - dh) / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(video, dx, dy, dw, dh);
  }

  function drawBands(ctx, state) {
    // Top band
    ctx.fillStyle = "rgba(15,15,13,0.82)";
    ctx.fillRect(0, 0, W, TOP);

    // Name — IBM Plex Sans Condensed 29px bold
    ctx.fillStyle = "#FAFAF7";
    ctx.font = "700 29px 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(state.name || "MICHEAL RAY BERRY", 16, 14);

    // Project line — mono 16px accent
    ctx.fillStyle = "#FF6B61";
    ctx.font = "500 16px 'IBM Plex Mono', monospace";
    ctx.fillText(state.projectLine || "PUBLIC ACCOUNTABILITY PROJECT", 16, 48);

    // Session tag — right, 23px bold mono
    ctx.fillStyle = "#FAFAF7";
    ctx.font = "700 18px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    var tag = state.sessionTag || "";
    // Wrap long tags
    if (tag.length > 16) {
      ctx.font = "700 15px 'IBM Plex Mono', monospace";
    }
    ctx.fillText(tag, W - 16, 28);
    ctx.textAlign = "left";

    // Bottom band
    ctx.fillStyle = "rgba(15,15,13,0.82)";
    ctx.fillRect(0, H - BOTTOM, W, BOTTOM);

    ctx.fillStyle = "#FAFAF7";
    ctx.font = "500 20px 'IBM Plex Mono', monospace";
    ctx.textBaseline = "top";
    ctx.fillText(state.bottomPrimary || "", 16, H - BOTTOM + 14);

    ctx.fillStyle = "#B9B8B2";
    ctx.font = "400 15px 'IBM Plex Mono', monospace";
    ctx.fillText(state.bottomSecondary || "", 16, H - BOTTOM + 44);
  }

  function drawMonitorChip(ctx, state) {
    if (!state.monitorText) return;
    var text = state.monitorText;
    var tone = state.monitorTone || "ok";
    var bg = tone === "warn" ? "rgba(138,106,30,0.92)" : tone === "fail" ? "rgba(179,38,30,0.92)" : "rgba(58,107,58,0.92)";
    ctx.font = "600 16px 'IBM Plex Mono', monospace";
    var tw = ctx.measureText(text).width;
    var padX = 14;
    var chipW = tw + padX * 2;
    var chipH = 32;
    var x = (W - chipW) / 2;
    var y = H - BOTTOM - chipH - 12;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, chipW, chipH);
    ctx.fillStyle = "#FAFAF7";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, x + padX, y + chipH / 2);
  }

  /**
   * Pure function of (ctx, state). Snapshot-testable.
   */
  function drawOverlay(ctx, state) {
    state = state || {};
    // Frame
    if (state.imageBitmap) {
      ctx.drawImage(state.imageBitmap, 0, 0, W, H);
    } else if (state.videoEl) {
      drawLetterboxedVideo(ctx, state.videoEl);
    } else if (state.fillStyle) {
      ctx.fillStyle = state.fillStyle;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#1a1a18";
      ctx.fillRect(0, 0, W, H);
    }

    drawBands(ctx, state);
    drawMonitorChip(ctx, state);

    // Optional framing guides (pre-flight only)
    if (state.showGuides) {
      ctx.strokeStyle = "rgba(255,107,97,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W * 0.08, H * 0.12);
      ctx.lineTo(W * 0.92, H * 0.12);
      ctx.moveTo(W * 0.08, H * 0.9);
      ctx.lineTo(W * 0.92, H * 0.9);
      ctx.stroke();
    }
  }

  function buildDailyBottom(day, code) {
    return "DAY " + MRB.dates.padDay(day) + " · CODE " + code;
  }

  function buildCornerBottom(vNum, level, remainingMmSs) {
    return "V-" + String(vNum).padStart(3, "0") + " — LEVEL " + level + " · REMAINING " + remainingMmSs;
  }

  function buildSecondary(dateIso) {
    return MRB.dates.formatOverlayDate(dateIso) + " · MICHEALRAYBERRY.COM";
  }

  function demoTag() {
    return "DEMONSTRATION · NOT A SESSION";
  }

  MRB.overlay = {
    W: W,
    H: H,
    TOP: TOP,
    BOTTOM: BOTTOM,
    drawOverlay: drawOverlay,
    drawLetterboxedVideo: drawLetterboxedVideo,
    buildDailyBottom: buildDailyBottom,
    buildCornerBottom: buildCornerBottom,
    buildSecondary: buildSecondary,
    demoTag: demoTag,
  };
})(window.MRB);
