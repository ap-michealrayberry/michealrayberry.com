/* Builds the <recording-assistant> element from tools/recording-assistant/src/
   into ONE self-contained classic script at mrb/inspection/recording-assistant.js.

   The host page cannot adopt a bundler: it loads the output with a plain
   <script src> and mounts the tag. So the output must stay a single IIFE with
   no import/export except the runtime dynamic import() of MediaPipe, which is
   valid in classic scripts and is deliberately left as-is (marked external). */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const outfile = path.join(repoRoot, 'mrb', 'inspection', 'recording-assistant.js');

const BANNER = `/* Recording Assistant — vanilla web component <recording-assistant>
   Records a 9:16 canvas-composited video with a branded overlay.
   BUILT FILE — do not edit. Source: tools/recording-assistant/src/
   Rebuild with: npm run build:ra   (then run: npm test) */`;

await build({
  entryPoints: [path.join(here, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020', // keeps dynamic import() and optional syntax intact
  external: ['https://*'], // MediaPipe is imported at runtime from its CDN
  outfile,
  banner: { js: BANNER },
  charset: 'utf8',
  minify: false, // the deployed file stays reviewable, like the file it replaces
  logLevel: 'info',
});
