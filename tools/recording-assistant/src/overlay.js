/* Canvas compositor: the burned-in overlays that make the footage and stills
   self-evidencing (name, project, day, date, weight, verification code,
   timers, monitor status). Every function is a pure function of (ctx, state)
   — no DOM lookups, no globals — so the exact pixels are testable.

   The overlays are evidence: a regression that drops the verification code
   or the timer silently weakens the record. Snapshot tests pin them. */

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/* Camera frame, cover-fitted; front camera is mirrored so the preview moves
   the way a mirror does. cam only needs videoWidth/videoHeight/drawImage
   compatibility. */
export function drawCameraFrame(ctx, cam, s) {
  const { W, H, facing } = s;
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

/* Recorded live overlay: top project band (with the verification code) and
   the bottom name / day / weight band.
   s: { W, H, isoStr, dayLabel, weight, code } */
export function drawLiveOverlay(ctx, s) {
  const { W, H, isoStr, dayLabel, weight, code } = s;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const topY = Math.round(H * 0.055);
  const eb = 'PUBLIC ACCOUNTABILITY PROJECT' + (code ? ' · CODE ' + code : '');
  ctx.font = '600 ' + Math.round(H * 0.016) + "px 'IBM Plex Mono', monospace";
  const ebW = ctx.measureText(eb).width;
  const ebX = (W - ebW) / 2;
  const topPadX = Math.round(W * 0.02);
  const topH = Math.round(H * 0.034);
  ctx.fillStyle = 'rgba(10,12,14,.68)';
  roundRect(ctx, ebX - topPadX, topY - topH / 2, ebW + topPadX * 2, topH, 12);
  ctx.fillStyle = '#D8DBDE';
  ctx.fillText(eb, ebX, topY);

  /* Deadline + pose guides are audio-only — the recorded overlay stays clean. */

  const bandW = Math.round(W * 0.67);
  const bandH = Math.round(H * 0.066);
  const bandX = Math.round((W - bandW) / 2);
  const blockY = Math.round(H * 0.90) - bandH;
  const accentW = Math.max(5, Math.round(W * 0.006));

  ctx.fillStyle = 'rgba(10,12,14,.78)';
  roundRect(ctx, bandX, blockY, bandW, bandH, 14);
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

export function drawCountdown(ctx, s, countdownLeft) {
  const { W, H } = s;
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

/* Opening title card (also becomes the feed thumbnail); fades out over the
   last 0.5s of titleSec.
   s: { W, H, isoStr, dayLabel, weight, code, titleSec } */
export function drawTitleCard(ctx, s, elapsed) {
  const { W, H, isoStr, dayLabel, weight, code, titleSec } = s;
  const fade = Math.min(1, Math.max(0, (titleSec - elapsed) / 0.5));
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
  ctx.fillText('MICHEAL RAY BERRY · DAILY INSPECTION · ' + isoStr, W / 2, H * 0.62);
  ctx.fillStyle = '#FAFAF7';
  ctx.fillText('MICHEALRAYBERRY.COM', W / 2, H * 0.70);
  if (code) {
    ctx.fillStyle = '#B3261E';
    ctx.fillText('VERIFICATION CODE ' + code, W / 2, H * 0.76);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

export function drawPhotoPhase(ctx, s, photoPhase) {
  const { W, H } = s;
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

export function drawRehearsalBackdrop(ctx, s) {
  const { W, H } = s;
  ctx.fillStyle = '#1B1B19'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4A4A45';
  ctx.font = '600 ' + Math.round(H * 0.024) + "px 'IBM Plex Mono', monospace";
  ctx.fillText('REHEARSAL — NO CAMERA · NOTHING IS RECORDED', W / 2, H / 2);
  ctx.textAlign = 'left';
}

/* Info bands burned into a captured still (daily photo). p is the still's own
   2d context; the canvas adopts the camera's native aspect ratio, so bands
   are translucent overlays instead of solid crops.
   s: { PW, PH, k, label, isoStr, dayLabel, weight, code } */
export function stampStill(p, s) {
  const { PW, PH, k, label, isoStr, dayLabel, weight, code } = s;
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
  p.fillText(label + ' · DAILY PHOTO · MICHEALRAYBERRY.COM' + (code ? ' · CODE ' + code : ''), Math.round(40 * k), PH - Math.round(40 * k));
}

/* Meal photo bands — day-stamped so the archived file is self-evidencing
   about which Project Day it belongs to.
   s: { PW, PH, k, isoStr, dayLabel, timeStr, planTag, code } */
export function stampMeal(p, s) {
  const { PW, PH, k, isoStr, dayLabel, timeStr, planTag, code } = s;
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
  p.fillText(dayLabel + ' — ' + isoStr + ' · ' + timeStr, Math.round(40 * k), PH - Math.round(82 * k));
  p.fillStyle = '#B9B8B2'; p.font = '400 ' + Math.round(24 * k) + 'px "IBM Plex Mono",monospace';
  p.fillText('EVENING MEAL · AS SERVED · LIVE CAPTURE' + (code ? ' · CODE ' + code : '') + ' · MICHEALRAYBERRY.COM', Math.round(40 * k), PH - Math.round(40 * k));
}

/* Violation portrait bands (§8: factual, no consequence details). The capture
   flow for this is not wired up in the element yet — see the tools README —
   but the stamp is kept here, pinned by tests, so wiring it is UI-only.
   s: { PW, PH, k, isoStr, vnum, vdate, code } */
export function stampViolationPortrait(p, s) {
  const { PW, PH, k, isoStr, vnum, vdate, code } = s;
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
}

/* X share card — the day's front photo composed on the site's palette
   (off-white / ink / red), 1080×1350 (X's 4:5 max). Same content as the
   record; presentation only. img needs width/height/drawImage compatibility.
   s: { CW, CH, isoStr, dayLabel, weight } */
export function drawXCard(p, img, s) {
  const { CW, CH, isoStr, dayLabel, weight } = s;
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
  const sc = Math.min(panW / img.width, panH / img.height);
  const dw = img.width * sc, dh = img.height * sc;
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
}
