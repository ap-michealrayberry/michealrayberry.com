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

  // Canvases may be any multiple of the 720×1280 design space (1080×1920 for
  // HD capture) — scale the context so every hardcoded coordinate still lands.
  function applyScale(ctx) {
    var s = ctx && ctx.canvas && ctx.canvas.width ? ctx.canvas.width / W : 1;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  function drawLetterboxedVideo(ctx, video) {
    if (!video) return;
    var vw = video.videoWidth || 0;
    var vh = video.videoHeight || 0;
    if (!vw || !vh) {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    // Fill the vertical frame (cover): scale up and center-crop the excess
    // instead of letterboxing — no black bars. The live monitor shows this
    // exact canvas, so framing is WYSIWYG; the preflight guides keep the
    // full body in frame.
    var scale = Math.max(W / vw, H / vh);
    var dw = vw * scale;
    var dh = vh * scale;
    var dx = (W - dw) / 2;
    var dy = (H - dh) / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(video, dx, dy, dw, dh);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Shorts / TikTok reserve the extreme top and bottom edges and the right
  // action rail for their own UI. The overlay floats inside that safe zone as
  // two inset cards so name / date / code / weight are never covered.
  var SIDE = 18;
  var SAFE_TOP = 118; // top card clears the app's top bar
  var SAFE_BOT = 300; // bottom card clears the handle/description + progress bar
  var RAIL = 200; // right-side action rail (Like / Share / Remix)

  // Shrink the font until the text fits maxW (keeps long lines inside cards).
  function fitFont(ctx, text, basePx, maxW, pre, post) {
    var px = basePx;
    ctx.font = pre + px + post;
    while (px > 11 && ctx.measureText(text).width > maxW) {
      px -= 1;
      ctx.font = pre + px + post;
    }
  }

  function drawBands(ctx, state) {
    // Lower-third evidence stamp: dark card with a red accent bar, a small
    // muted identity line (name · code · date) over a large bold record line
    // (day · weight). Sits in the bottom safe zone, clear of the action rail.
    var primary = state.bottomPrimary || "";
    var code = "";
    var m = primary.match(/\s*\u00b7\s*CODE\s+(\S+)/);
    if (m) { code = m[1]; primary = primary.replace(m[0], ""); }
    var date = state.bottomSecondary || "";
    date = date === "MICHEALRAYBERRY.COM" ? "" : date.replace(" \u00b7 MICHEALRAYBERRY.COM", "");
    var isDemo = state.sessionTag && state.sessionTag.indexOf("NOT A SESSION") !== -1;
    var big = primary;
    var smallParts = [];
    if (isDemo) { big = state.sessionTag; if (primary) smallParts.push(primary); }
    if (state.name) smallParts.push(state.name);
    if (code) smallParts.push("VERIFY " + code);
    if (date) smallParts.push(date);
    var small = smallParts.join(" \u00b7 ");
    if (!big && !small) return;
    var cx = W / 2; // centered in the frame, like the filed Shorts
    var maxW = W - 150 - 58; // side margins + accent bar/padding
    var MONO = "'IBM Plex Mono', monospace";
    var COND = "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif";
    function fitPx(text, basePx, weight, family) {
      var px = basePx;
      ctx.font = weight + " " + px + "px " + family;
      while (px > 11 && ctx.measureText(text).width > maxW) {
        px -= 1;
        ctx.font = weight + " " + px + "px " + family;
      }
      return px;
    }
    var smallPx = 0, smallW = 0, bigPx = 0, bigW = 0;
    if (small) {
      smallPx = fitPx(small, 20, "600", COND);
      smallW = ctx.measureText(small).width;
    }
    if (big) {
      bigPx = fitPx(big, 42, "700", COND);
      bigW = ctx.measureText(big).width;
    }
    var chipW = Math.max(smallW, bigW) + 58;
    var chipH = 12 + (small ? smallPx + 9 : 0) + (big ? bigPx + 5 : 0) + 12;
    var x = cx - chipW / 2;
    var y = H - SAFE_BOT - chipH;
    state._stampTop = y; // drawMonitorChip stacks above this
    state._stampCx = cx;
    // 0.72 alpha: the record stays visible through its own stamp (§4.4).
    ctx.fillStyle = "rgba(10,10,9,0.72)";
    roundRect(ctx, x, y, chipW, chipH, 6);
    ctx.fill();
    ctx.fillStyle = "#B3261E";
    ctx.fillRect(x, y + 3, 5, chipH - 6);
    var tx = x + 5 + (chipW - 5) / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    var ty = y + 12;
    if (small) {
      ctx.font = "600 " + smallPx + "px " + COND; // same face as the title card name
      ctx.fillStyle = "#B9B7B0";
      ty += smallPx;
      ctx.fillText(small, tx, ty);
      ty += 9;
    }
    if (big) {
      ctx.font = "700 " + bigPx + "px " + COND; // same face as the title card title
      ctx.fillStyle = "#FFFFFF";
      ty += bigPx;
      ctx.fillText(big, tx, ty);
    }
    ctx.textAlign = "left";
  }

  function drawMonitorChip(ctx, state) {
    if (!state.monitorText) return;
    var text = state.monitorText;
    var tone = state.monitorTone || "ok";
    // Neutral gray by default — green is reserved for computer-confirmed
    // posture compliance (pose monitor), which is currently disabled.
    var bg = tone === "warn" ? "rgba(138,106,30,0.92)" : tone === "fail" ? "rgba(179,38,30,0.92)" : tone === "confirmed" ? "rgba(58,107,58,0.92)" : "rgba(62,62,58,0.92)";
    ctx.font = "600 16px 'IBM Plex Mono', monospace";
    var tw = ctx.measureText(text).width;
    var padX = 14;
    var chipW = tw + padX * 2;
    var chipH = 32;
    var cx = state._stampCx || W / 2; // same center as the stamp
    var x = cx - chipW / 2;
    var y = (state._stampTop || H - SAFE_BOT - 34) - chipH - 10; // stacked above the stamp
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, chipW, chipH, 8);
    ctx.fill();
    ctx.fillStyle = "#FAFAF7";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, cx, y + chipH / 2);
    ctx.textAlign = "left";
  }

  /**
   * Full-frame title card. Burned in as the first frames of every recording
   * (it doubles as the pick-a-frame thumbnail on Shorts) and rendered alone
   * for the exported thumbnail PNG. Pure function of (ctx, state).
   * state: { name, projectLine, title, line1, line2 }
   */
  function drawTitleCard(ctx, state) {
    state = state || {};
    applyScale(ctx);
    ctx.fillStyle = "#0F0F0D";
    ctx.fillRect(0, 0, W, H);
    var cx = W / 2;
    var cy = H / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FF6B61";
    ctx.fillRect(cx - 32, cy - 214, 64, 4);
    ctx.fillStyle = "#FAFAF7";
    ctx.font = "700 58px 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif";
    ctx.fillText(state.name || "MICHEAL RAY BERRY", cx, cy - 144);
    ctx.fillStyle = "#FF6B61";
    ctx.font = "500 21px 'IBM Plex Mono', monospace";
    ctx.fillText(state.projectLine || "PUBLIC ACCOUNTABILITY PROJECT", cx, cy - 88);
    ctx.strokeStyle = "rgba(250,250,247,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 200, cy - 30);
    ctx.lineTo(cx + 200, cy - 30);
    ctx.stroke();
    ctx.fillStyle = "#FAFAF7";
    fitFont(ctx, state.title || "", 44, W - 70, "700 ", "px 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif");
    ctx.fillText(state.title || "", cx, cy + 34);
    var yNext = cy + 106;
    if (state.stat) {
      ctx.fillStyle = "#FAFAF7";
      ctx.font = "700 48px 'IBM Plex Mono', monospace";
      ctx.fillText(state.stat, cx, yNext);
      yNext += 66;
    }
    ctx.fillStyle = "#B9B8B2";
    fitFont(ctx, state.line1 || "", 26, W - 70, "500 ", "px 'IBM Plex Mono', monospace");
    ctx.fillText(state.line1 || "", cx, yNext);
    ctx.fillStyle = "#78776F";
    ctx.font = "400 19px 'IBM Plex Mono', monospace";
    ctx.fillText(state.line2 || "MICHEALRAYBERRY.COM", cx, yNext + 50);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  /**
   * Exported thumbnail (720x1280): a captured body frame with a LARGE
   * lower-third — small identity line (name · date) over a big record line
   * (day · weight) — matching the filed Shorts. state: { frame, big, small }
   */
  function drawThumbCard(ctx, state) {
    state = state || {};
    applyScale(ctx);
    if (state.frame) {
      ctx.drawImage(state.frame, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, W, H);
    }
    var big = state.big || "";
    var small = state.small || "";
    if (!big && !small) return;
    var cx = W / 2;
    var maxW = W - 132;
    function fitPx(text, basePx, weight) {
      var px = basePx;
      ctx.font = weight + " " + px + "px 'IBM Plex Mono', monospace";
      while (px > 14 && ctx.measureText(text).width > maxW) {
        px -= 1;
        ctx.font = weight + " " + px + "px 'IBM Plex Mono', monospace";
      }
      return px;
    }
    var smallPx = 0, smallW = 0, bigPx = 0, bigW = 0;
    if (small) {
      smallPx = fitPx(small, 26, "600");
      smallW = ctx.measureText(small).width;
    }
    if (big) {
      bigPx = fitPx(big, 58, "700");
      bigW = ctx.measureText(big).width;
    }
    var chipW = Math.max(smallW, bigW) + 84;
    var chipH = 22 + (small ? smallPx + 14 : 0) + (big ? bigPx + 8 : 0) + 22;
    var x = cx - chipW / 2;
    var y = H - 84 - chipH;
    ctx.fillStyle = "rgba(10,10,9,0.88)";
    roundRect(ctx, x, y, chipW, chipH, 8);
    ctx.fill();
    ctx.fillStyle = "#B3261E";
    ctx.fillRect(x, y + 5, 8, chipH - 10);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    var tx = x + 8 + (chipW - 8) / 2;
    var ty = y + 22;
    if (small) {
      ctx.font = "600 " + smallPx + "px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#C6C4BD";
      ty += smallPx;
      ctx.fillText(small, tx, ty);
      ty += 14;
    }
    if (big) {
      ctx.font = "700 " + bigPx + "px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#FFFFFF";
      ty += bigPx;
      ctx.fillText(big, tx, ty);
    }
    ctx.textAlign = "left";
  }

  /**
   * Pure function of (ctx, state). Snapshot-testable.
   */
  function drawOverlay(ctx, state) {
    state = state || {};
    applyScale(ctx);
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

  function buildDailyBottom(day, code, weight) {
    var base = "DAY " + MRB.dates.padDay(day);
    if (weight) base += " · " + weight + " LB";
    return base + " · CODE " + code;
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
    drawTitleCard: drawTitleCard,
    drawThumbCard: drawThumbCard,
    drawLetterboxedVideo: drawLetterboxedVideo,
    buildDailyBottom: buildDailyBottom,
    buildCornerBottom: buildCornerBottom,
    buildSecondary: buildSecondary,
    demoTag: demoTag,
  };
})(window.MRB);
