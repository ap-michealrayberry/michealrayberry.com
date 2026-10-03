/* Report-card PNGs: the SVG from publish.js rasterised with resvg (WASM).
   Replaces sharp; the cards now render in IBM Plex Mono, the site's own face. */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import plexRegular from './fonts/IBMPlexMono-Regular.ttf';
import plexBold from './fonts/IBMPlexMono-Bold.ttf';

// WASM instantiation is per isolate, not per request.
let ready: Promise<void> | null = null;
const fonts = [new Uint8Array(plexRegular), new Uint8Array(plexBold)];

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** `photo` replaces the mrb-photo: placeholder href with the embedded image. */
export async function renderCard(svg: string, photo: { bytes: Uint8Array; type: string } | null): Promise<Uint8Array> {
  ready ??= initWasm(resvgWasm);
  await ready;
  const source = svg.replace(/href="mrb-photo:[^"]*"/, photo
    ? `href="data:${photo.type};base64,${bytesToBase64(photo.bytes)}"`
    : 'href=""');
  const resvg = new Resvg(source, {
    font: {
      fontBuffers: fonts,
      loadSystemFonts: false,
      defaultFontFamily: 'IBM Plex Mono',
      monospaceFamily: 'IBM Plex Mono',
    },
  });
  return resvg.render().asPng();
}
