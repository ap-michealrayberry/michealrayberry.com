/* A recording CanvasRenderingContext2D stand-in. Every call and property set
   is appended to a log, and measureText is a deterministic function of the
   string and the current font, so overlay renders can be snapshot-compared as
   JSON without any font or rasteriser in the loop. */

const METHODS = [
  'fillRect', 'clearRect', 'strokeRect', 'fillText', 'strokeText',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'rect',
  'fill', 'stroke', 'clip',
  'save', 'restore', 'translate', 'scale', 'rotate', 'transform', 'setTransform',
  'drawImage', 'setLineDash', 'getLineDash', 'createLinearGradient',
  'putImageData',
];
const PROPS = [
  'fillStyle', 'strokeStyle', 'textAlign', 'textBaseline',
  'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin',
]; // font is defined separately: measureText reads it back

function round(v) {
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // objects in args (e.g. images) are logged by shape, not identity
    return { w: v.width, h: v.height };
  }
  if (Array.isArray(v)) return v.map(round);
  return v;
}

export function createRecordingCtx(width, height) {
  const log = [];
  const ctx = { canvas: { width, height } };
  for (const m of METHODS) {
    ctx[m] = (...args) => {
      log.push([m, ...args.map(round)]);
      if (m === 'getLineDash') return [];
      return undefined;
    };
  }
  ctx.measureText = (text) => {
    const size = parseFloat((String(ctx._font || '10px').match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1]);
    return { width: Math.round(String(text).length * size * 0.6 * 100) / 100 };
  };
  ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  for (const p of PROPS) {
    Object.defineProperty(ctx, p, {
      set(v) { ctx['_' + p] = v; log.push(['set:' + p, round(v)]); },
      get() { return ctx['_' + p]; },
    });
  }
  // font needs its raw value retrievable for measureText
  Object.defineProperty(ctx, 'font', {
    set(v) { ctx._font = v; log.push(['set:font', v]); },
    get() { return ctx._font; },
  });
  ctx.__log = log;
  return ctx;
}
