/* Capture helpers: codec choice, still-photo sharpness scoring, the framing
   heuristic, and artifact file names. The getUserMedia / MediaRecorder /
   canvas plumbing itself stays in main.js — these are the decision functions,
   kept pure so they can be tested. */

// First supported type wins; MP4 preferred (plays everywhere the record is reviewed).
export function pickMimeType(isTypeSupported) {
  return isTypeSupported('video/mp4') ? 'video/mp4'
    : isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
    : isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
    : isTypeSupported('video/webm') ? 'video/webm'
    : '';
}

// RGBA pixels → luma plane (Rec. 601 weights).
export function lumaPlane(data, n) {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = i * 4; g[i] = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114; }
  return g;
}

// Variance-of-Laplacian on a small grayscale copy — higher = sharper.
export function sharpnessScore(data, sw, sh) {
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

/* Coarse framing heuristic on a 90×160 downsample: edge energy inside the
   body guide vs. the side margins. A person filling the guide adds edges
   inside relative to outside. Informational only — never blocks recording. */
export const FRAME_W = 90;
export const FRAME_H = 160;
export function framingStatus(data) {
  const lum = lumaPlane(data, FRAME_W * FRAME_H);
  const y0 = 19, y1 = 144; // guide rows (12%..90%)
  let occ = 0;
  for (let y = y0; y < y1; y++) {
    let inE = 0, outE = 0;
    for (let x = 26; x < 64; x++) { const i = y * FRAME_W + x; inE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - FRAME_W]); }
    for (let x = 3; x < 22; x++) { const i = y * FRAME_W + x; outE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - FRAME_W]); }
    for (let x = 68; x < 87; x++) { const i = y * FRAME_W + x; outE += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - FRAME_W]); }
    if (inE / 38 > (outE / 38) * 1.3 + 5) occ++;
  }
  const cov = occ / (y1 - y0);
  return cov > 0.55
    ? { ok: true, msg: 'FRAMED — WHOLE BODY IN VIEW' }
    : { ok: false, msg: 'ADJUST — FILL THE GUIDE TOP TO BOTTOM' };
}

// ---- Artifact names: every file is self-identifying about its Project Day ----
function daySuffix(d) {
  return d.preStart ? '-pre-start' : '-day-' + String(d.dayNum).padStart(3, '0');
}
export function videoFileName(d, ext) {
  return 'micheal-ray-berry-daily-inspection-' + d.isoStr + daySuffix(d) + '.' + ext;
}
export function photoFileName(d, slug) {
  return 'micheal-ray-berry-daily-photo-' + d.isoStr + '-' + slug + '.jpg';
}
export function mealFileName(d) {
  return 'micheal-ray-berry-evening-meal-' + d.isoStr + daySuffix(d) + '.jpg';
}
export function xCardFileName(d) {
  return 'micheal-ray-berry-x-card-' + d.isoStr + daySuffix(d) + '.jpg';
}
export function photoSlug(label) {
  return label.toLowerCase().replace(/ side$/, '');
}
