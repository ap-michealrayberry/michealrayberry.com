import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CSS, HTML } from '../src/ui.js';
import { checkSelectorIntegrity } from './lib/selectors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(path.join(srcDir, f), 'utf8'));

/* Known-incomplete feature, kept deliberately: the violation-portrait box is
   in the template and its stamp lives in overlay.js, but the capture flow was
   never wired to the button (true in every committed version of the tool).
   Listing it here keeps the check strict for everything else; wiring the
   feature will make these entries fail the "still unreferenced?" guard below
   and force this list back to empty. */
const KNOWN_UNREFERENCED = ['ra-vp', 'ra-vpbox', 'ra-vpdate', 'ra-vpdl', 'ra-vpnote', 'ra-vpnum',
  // structural marker only — no styling, no queries
  'ra-mealbox'];

/* .ra-rec existed for a recording-state button style that no longer has
   markup; kept in the allowlist rather than deleted so removing it is a
   reviewed decision, not a side effect. */
const KNOWN_CSS_ORPHANS = ['ra-rec'];

test('every class queried in JS exists in the template', () => {
  const { missing } = checkSelectorIntegrity({ html: HTML, css: CSS, sources });
  assert.deepEqual(missing, [],
    'queried in JS but absent from the template (querySelector returns null and the next property access throws): ' + missing.join(', '));
});

test('every template class is referenced by CSS or JS (or is on the documented allowlist)', () => {
  const { unreferenced } = checkSelectorIntegrity({ html: HTML, css: CSS, sources });
  assert.deepEqual(unreferenced, [...KNOWN_UNREFERENCED].sort(),
    'template classes with no CSS and no JS references — orphaned markup or missing wiring');
});

test('every CSS class exists in the template (or is on the documented allowlist)', () => {
  const { cssOrphans } = checkSelectorIntegrity({ html: HTML, css: CSS, sources });
  assert.deepEqual(cssOrphans, [...KNOWN_CSS_ORPHANS].sort(),
    'styled in CSS but present in no markup');
});
