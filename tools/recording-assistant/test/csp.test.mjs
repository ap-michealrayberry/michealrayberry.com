import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractCsp, parseCsp, checkNetworkNeeds, httpsLiterals } from './lib/csp.mjs';
import { NETWORK_NEEDS, NON_FETCH_LITERALS } from './csp-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
const srcDir = path.join(here, '..', 'src');

const headersText = readFileSync(path.join(repoRoot, '_headers'), 'utf8');
const csp = parseCsp(extractCsp(headersText));

test('every network need is permitted by the CSP in _headers', () => {
  const violations = checkNetworkNeeds(csp, NETWORK_NEEDS);
  assert.deepEqual(violations, []);
});

test('every https:// literal in src/ is accounted for in the manifest', () => {
  const known = new Set(NETWORK_NEEDS.map((n) => new URL(n.url).origin));
  for (const o of NON_FETCH_LITERALS) known.add(new URL(o).origin);
  const unaccounted = [];
  for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(path.join(srcDir, f), 'utf8');
    for (const url of httpsLiterals(src)) {
      let origin;
      try { origin = new URL(url).origin; } catch (e) { continue; }
      if (!known.has(origin)) unaccounted.push(f + ': ' + url);
    }
  }
  assert.deepEqual(unaccounted, [],
    'new external URL in src/ — add it to test/csp-manifest.mjs with the directive that governs it');
});

test('_headers comment rule is intact (comments only at the top)', () => {
  /* A '#' line inside or directly above a path block makes Cloudflare skip
     that block silently — that is what once reduced this file to 5 of its 10
     rules. Assert no comment appears after the first path rule. */
  const lines = headersText.split(/\r?\n/);
  const firstRule = lines.findIndex((l) => /^\S/.test(l) && !l.startsWith('#'));
  const straggler = lines.slice(firstRule).findIndex((l) => l.trim().startsWith('#'));
  assert.equal(straggler, -1, 'comment line inside the rules section of _headers silently disables the following block');
});
