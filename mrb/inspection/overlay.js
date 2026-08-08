/*
 * MRB Recording Assistant — overlay compositor.
 * Exact project version for burned-in evidence bands.
 */
(function (global) {
  'use strict';

  var W = 720, H = 1280;
  var BAND = 85;
  var PAD = 27;
  var INK = 'rgba(15, 15, 13, 0.82)';
  var PAPER = '#FAFAF7';
  var ACCENT = '#FF6B61';
  var MUTED = '#B9B8B2';
  var OK = '#7BC67E';
  var WARN = '#F2B01E';

  var COND = '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
  var MONO = '"IBM Plex Mono", ui-monospace, monospace';

  function pad(n, len) {
    var s = String(n);
    while (s.length < (len || 2)) s = '0' + s;
    return s;
  }

  function clock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(r) : m + ':' + pad(r);
  }

  function drawCameraFrame(ctx, video, mirror) {
    if (!video || !video.videoWidth || !video.videoHeight) {
      ctx.fillStyle = '#141412';
      ctx.fillRect(0, 0, W, H);
      return false;
    }
    ctx.fillStyle = '#141412';
    ctx.fillRect(0, 0, W, H);

    var vw = video.videoWidth;
    var vh = video.videoHeight;
    /* Many phones report the rear sensor as landscape even when the device is
       upright. If the stream is wider than tall, rotate it into the portrait
       canvas so the body fills the vertical frame. */
    var rotated = vw > vh;
    var srcW = rotated ? vh : vw;
    var srcH = rotated ? vw : vh;

    // Cover: fill the 9:16 canvas (crop edges if needed, never letterbox)
    var scale = Math.max(W / srcW, H / srcH);
    var dw = srcW * scale, dh = srcH * scale;
    var dx = (W - dw) / 2, dy = (H - dh) / 2;

    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    if (rotated) {
      // Rotate 90° CW around canvas center, then draw
      ctx.translate(W / 2, H / 2);
      ctx.rotate(Math.PI / 2);
      // After rotation, x maps to vertical and y to horizontal
      ctx.drawImage(video, -dh / 2, -dw / 2, dh, dw);
    } else {
      ctx.drawImage(video, dx, dy, dw, dh);
    }
    ctx.restore();
    return true;
  }

  function bandTop(ctx, tag) {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, BAND);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = PAPER;
    ctx.font = '700 29px ' + COND;
    ctx.fillText('MICHEAL RAY BERRY', PAD, 33);

    ctx.fillStyle = ACCENT;
    ctx.font = '600 16px ' + MONO;
    ctx.fillText('PUBLIC ACCOUNTABILITY PROJECT', PAD, 63);

    if (tag) {
      ctx.fillStyle = PAPER;
      ctx.font = '700 23px ' + MONO;
      ctx.textAlign = 'right';
      ctx.fillText(tag, W - PAD, 41);
      ctx.textAlign = 'left';
    }
  }

  function bandBottom(ctx, main, sub) {
    ctx.fillStyle = INK;
    ctx.fillRect(0, H - BAND, W, BAND);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = PAPER;
    ctx.font = '600 23px ' + MONO;
    ctx.fillText(main, PAD, H - 55);

    ctx.fillStyle = MUTED;
    ctx.font = '400 16px ' + MONO;
    ctx.fillText(sub, PAD, H - 27);
  }

  function monitorChip(ctx, issue, warnings, uniform) {
    var text = (issue || 'POSITION OK') + ' · WARNINGS ' + (warnings || 0) + '/3' +
      (uniform ? ' · UNIFORM ' + uniform : '');
    ctx.font = '600 15px ' + MONO;
    var w = ctx.measureText(text).width;
    var y = H - BAND - 40;

    ctx.fillStyle = 'rgba(10, 12, 14, 0.7)';
    ctx.fillRect((W - w) / 2 - 14, y - 16, w + 28, 32);

    ctx.fillStyle = issue ? WARN : OK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y);
    ctx.textAlign = 'left';
  }

  var TAGS = {
    daily: 'DAILY INSPECTION',
    corner: 'CORNER TIME',
    strokes: 'PENALTY SEQUENCE',
    both: 'RESOLUTION'
  };

  function drawFrame(ctx, state) {
    var s = state || {};
    drawCameraFrame(ctx, s.video, s.mirror !== false);
    bandTop(ctx, TAGS[s.kind] || TAGS.daily);

    var main, sub;
    if (s.kind === 'daily') {
      main = 'DAY ' + pad(s.day || 0, 3) + (s.code ? ' · CODE ' + s.code : '');
      sub = (s.date || '') + ' · MICHEALRAYBERRY.COM';
    } else {
      main = (s.violation || 'V-000') + ' — LEVEL ' + (s.level || 1);
      if (typeof s.remainingSec === 'number') {
        main += ' · REMAINING ' + clock(s.remainingSec);
      } else if (s.countTotal) {
        main += ' · ' + (s.count || 0) + ' OF ' + s.countTotal;
      } else {
        main += ' · ' + clock(s.elapsedSec);
      }
      sub = (s.date || '') + (s.code ? ' · CODE ' + s.code : '') + ' · MICHEALRAYBERRY.COM';
    }
    bandBottom(ctx, main, sub);

    if (s.monitor && s.monitor.active) {
      monitorChip(ctx, s.monitor.issue, s.monitor.warnings, s.monitor.uniform);
    }
  }

  global.MRBOverlay = {
    W: W, H: H,
    drawFrame: drawFrame,
    drawCameraFrame: drawCameraFrame,
    clock: clock
  };
})(typeof window !== 'undefined' ? window : this);
