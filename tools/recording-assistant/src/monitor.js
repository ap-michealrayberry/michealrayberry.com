/* Position monitor: derives issue strings from MediaPipe pose landmarks and
   a microphone level. Pure math — the landmarker itself is loaded and run by
   the caller, so this can be tested with synthetic landmarks.

   Landmarks: 0 nose · 7/8 ears · 11/12 shoulders · 15/16 wrists · 23/24 hips. */

export const ISSUE = {
  OUT_OF_FRAME: 'OUT OF FRAME',
  TURNED_AWAY: 'TURNED AWAY',
  HANDS_OFF_HEAD: 'HANDS OFF HEAD',
  MOVEMENT: 'EXCESSIVE MOVEMENT',
  NOISE: 'NOISE / MUSIC',
};

/* track holds smoothing state across frames: { lastC, ema }. */
export function poseIssues(lm, track) {
  const issues = [];
  if (!lm) { issues.push(ISSUE.OUT_OF_FRAME); return issues; }
  const vis = (i) => (lm[i].visibility == null ? 1 : lm[i].visibility);
  if (vis(11) < 0.5 && vis(12) < 0.5) issues.push(ISSUE.OUT_OF_FRAME);
  else {
    if (vis(0) < 0.4) issues.push(ISSUE.TURNED_AWAY);
    const sw = Math.max(0.02, Math.abs(lm[11].x - lm[12].x));
    const near = (w, e) => Math.hypot(lm[w].x - lm[e].x, lm[w].y - lm[e].y) < sw * 0.8 && lm[w].y < Math.max(lm[11].y, lm[12].y);
    if (!((near(15, 7) || near(15, 8)) && (near(16, 7) || near(16, 8)))) issues.push(ISSUE.HANDS_OFF_HEAD);
    const cx = (lm[23].x + lm[24].x) / 2, cy = (lm[23].y + lm[24].y) / 2;
    if (track.lastC) {
      const d = Math.hypot(cx - track.lastC.x, cy - track.lastC.y);
      track.ema = (track.ema || 0) * 0.8 + d * 0.2;
      if (track.ema > 0.012) issues.push(ISSUE.MOVEMENT);
    }
    track.lastC = { x: cx, y: cy };
  }
  return issues;
}

/* rms: root-mean-square of the analyser's time-domain buffer.
   track holds { aEma }. Returns the issue string or null. */
export function audioIssue(rms, track) {
  track.aEma = (track.aEma || 0) * 0.9 + rms * 0.1;
  return track.aEma > 0.06 ? ISSUE.NOISE : null;
}
