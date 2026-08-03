/* Each of the documented bugs, demonstrated failing against the pre-fix code.
   test/fixtures/pre-refactor-recording-assistant.js is a byte-for-byte copy
   of mrb/inspection/recording-assistant.js as deployed before this refactor
   (git ea97b03); the synthetic fixtures reproduce the two historical bugs
   whose exact code predates the repo history. The fourth regression — the
   undeclared MODE identifier — is asserted in lint.test.mjs. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkSelectorIntegrity } from './lib/selectors.mjs';
import { extractCsp, parseCsp, checkNetworkNeeds } from './lib/csp.mjs';
import { NETWORK_NEEDS } from './csp-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const preFix = readFileSync(path.join(here, 'fixtures', 'pre-refactor-recording-assistant.js'), 'utf8');
const realHeaders = readFileSync(path.join(here, '..', '..', '..', '_headers'), 'utf8');

function extractTemplate(source) {
  const html = source.match(/const HTML = `([\s\S]*?)`;/);
  const css = source.match(/const CSS = `([\s\S]*?)`;/);
  if (!html || !css) throw new Error('could not extract template from fixture');
  return { html: html[1], css: css[1] };
}

// ---- Bug 1 (dangling selector) + Bug 3 (dead handlers), as shipped ----

test('selector check fails against the pre-fix file: corrective selectors query markup that does not exist', () => {
  const { html, css } = extractTemplate(preFix);
  const { missing } = checkSelectorIntegrity({ html, css, sources: [preFix] });
  // The dead corrective block queried four classes with no markup behind them
  // — including .ra-corrnote, the exact selector from the documented bug 1.
  for (const c of ['ra-corrnote', 'ra-cstart', 'ra-cstop', 'ra-cdl']) {
    assert.ok(missing.includes(c), 'expected the checker to flag .' + c + '; it flagged: ' + missing.join(', '));
  }
});

test('bug 1 reproduction: a helper querying a class an edit removed is flagged', () => {
  const html = '<div class="ra-note"></div><button class="ra-start"></button>';
  const source = "const setCorrNote = (m) => { $('.ra-corrnote').textContent = m; };";
  const { missing } = checkSelectorIntegrity({ html, css: '', sources: [source] });
  assert.deepEqual(missing, ['ra-corrnote']);
});

test('bug 3 reproduction: listeners attached to removed markup are flagged', () => {
  const html = '<div class="ra-note"></div>';
  const source = `
    $('.ra-old-a').addEventListener('click', () => {});
    $('.ra-old-b').addEventListener('click', () => {});
    $('.ra-old-c').addEventListener('change', () => {});
  `;
  const { missing } = checkSelectorIntegrity({ html, css: '', sources: [source] });
  assert.deepEqual(missing, ['ra-old-a', 'ra-old-b', 'ra-old-c']);
});

// ---- Bug 2 (silent CSP break) ----

test('CSP check fails against the pre-fix header: storage.googleapis.com removed from script-src', () => {
  /* Reconstruct the incident: drop storage.googleapis.com from script-src
     ONLY (it stays in connect-src, which is what made the removal look safe
     — "it only serves a model file"). */
  const cspLine = extractCsp(realHeaders);
  const broken = cspLine.replace(
    /(script-src[^;]*?) https:\/\/storage\.googleapis\.com/,
    '$1'
  );
  assert.notEqual(broken, cspLine, 'fixture surgery failed — script-src no longer lists storage.googleapis.com?');
  const violations = checkNetworkNeeds(parseCsp(broken), NETWORK_NEEDS);
  assert.ok(
    violations.some((v) => v.startsWith('script-src') && v.includes('storage.googleapis.com')),
    'expected a script-src violation for storage.googleapis.com (the WASM glue is script, not just a model file); got: ' + JSON.stringify(violations)
  );
});

test('the current _headers passes the same check (the incident stays fixed)', () => {
  assert.deepEqual(checkNetworkNeeds(parseCsp(extractCsp(realHeaders)), NETWORK_NEEDS), []);
});
