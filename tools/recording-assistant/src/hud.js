/* Preview-only HUD (never recorded: drawn on a separate canvas stacked on
   top of the recorded view). Pure function of (hctx, state). */

export function pathRound(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r.tl, y);
  c.arcTo(x + w, y, x + w, y + h, r.tr);
  c.arcTo(x + w, y + h, x, y + h, r.br);
  c.arcTo(x, y + h, x, y, r.bl);
  c.arcTo(x, y, x + w, y, r.tl);
  c.closePath();
}

export function hudPill(hctx, HW, text, cy, color, big) {
  hctx.font = (big ? '700 26px "IBM Plex Sans Condensed",sans-serif' : '600 15px "IBM Plex Mono",monospace');
  const tw = hctx.measureText(text).width;
  const ph = big ? 40 : 30;
  hctx.fillStyle = 'rgba(10,12,14,.66)';
  pathRound(hctx, HW / 2 - tw / 2 - 14, cy - ph / 2, tw + 28, ph, { tl: 8, tr: 8, bl: 8, br: 8 });
  hctx.fill();
  hctx.fillStyle = color;
  hctx.fillText(text, HW / 2, cy);
}

/* s: { HW, HH, recording, elapsed, segments, angleIdx, showGuide, frameStatus }
   - recording: segment progress bars + now/next pills
   - showGuide: pre-record framing guide (thirds grid + body guide + status);
     the caller decides when the guide applies (camera live, not posing,
     no countdown, not rehearsing). */
export function drawHud(hctx, s) {
  const { HW, HH, segments } = s;
  hctx.clearRect(0, 0, HW, HH);
  hctx.textAlign = 'center';
  hctx.textBaseline = 'middle';
  if (s.recording) {
    // Segment progress bars
    const elapsed = s.elapsed;
    const n = segments.length, gap = 4, bx = HW * 0.06, bw = HW * 0.88;
    const segW = (bw - gap * (n - 1)) / n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const start = acc; acc += segments[i].dur;
      const f = elapsed <= start ? 0 : elapsed >= acc ? 1 : (elapsed - start) / segments[i].dur;
      hctx.fillStyle = 'rgba(250,250,247,.28)';
      hctx.fillRect(bx + i * (segW + gap), 14, segW, 5);
      if (f > 0) {
        hctx.fillStyle = f >= 1 ? '#7BC67E' : '#F2B01E';
        hctx.fillRect(bx + i * (segW + gap), 14, segW * f, 5);
      }
    }
    if (s.angleIdx >= 0) {
      let acc2 = 0;
      for (let i = 0; i < s.angleIdx; i++) acc2 += segments[i].dur;
      const rem = Math.max(0, Math.ceil(acc2 + segments[s.angleIdx].dur - elapsed));
      hudPill(hctx, HW, 'NOW · ' + rem + 'S LEFT', HH * 0.095, '#B9BEC4');
      hudPill(hctx, HW, segments[s.angleIdx].label, HH * 0.135, '#FFFFFF', true);
      if (s.angleIdx + 1 < segments.length) {
        hudPill(hctx, HW, 'NEXT → ' + segments[s.angleIdx + 1].label, HH * 0.175, 'rgba(250,250,247,.75)');
      }
    }
  } else if (s.showGuide) {
    // Pre-record framing guide: thirds grid + body guide + framed status
    hctx.strokeStyle = 'rgba(250,250,247,.14)';
    hctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) {
      hctx.beginPath(); hctx.moveTo(HW * f, 0); hctx.lineTo(HW * f, HH); hctx.stroke();
      hctx.beginPath(); hctx.moveTo(0, HH * f); hctx.lineTo(HW, HH * f); hctx.stroke();
    }
    const gx = HW * 0.28, gw = HW * 0.44, gy = HH * 0.12, gh = HH * 0.78;
    const ok = s.frameStatus && s.frameStatus.ok;
    hctx.setLineDash([14, 10]);
    hctx.strokeStyle = ok ? 'rgba(123,198,126,.9)' : 'rgba(242,176,30,.85)';
    hctx.lineWidth = 3;
    pathRound(hctx, gx, gy, gw, gh, { tl: gw / 2, tr: gw / 2, bl: 10, br: 10 });
    hctx.stroke();
    hctx.setLineDash([]);
    hudPill(hctx, HW, 'FILL THE GUIDE · HEAD TO ANKLES', HH * 0.095, '#F2B01E');
    const st = s.frameStatus || { ok: false, msg: 'CHECKING FRAMING…' };
    hudPill(hctx, HW, (st.ok ? '✓ ' : '') + st.msg, HH * 0.945, st.ok ? '#7BC67E' : '#F2B01E');
  }
}
