import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import globals from 'globals';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.join(here, '..');

test('src/ has no undeclared identifiers and no unused bindings', async () => {
  const eslint = new ESLint({ cwd: toolRoot });
  const results = await eslint.lintFiles(['src/**/*.js']);
  const problems = results.flatMap((r) =>
    r.messages.map((m) => path.basename(r.filePath) + ':' + m.line + ' ' + m.ruleId + ' ' + m.message));
  assert.deepEqual(problems, []);
});

/* Regression: the pre-refactor file (committed as a fixture) shipped with two
   references to MODE after the edit that removed its declaration — a live
   ReferenceError inside the draw loop. This test is the check that would have
   caught it, run against the exact code that had it. */
test('no-undef catches the MODE regression in the pre-refactor file', async () => {
  const eslint = new ESLint({
    cwd: toolRoot,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.js'],
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'script',
        globals: { ...globals.browser, ysFixWebmDuration: 'readonly' },
      },
      rules: { 'no-undef': 'error' },
    }],
  });
  const results = await eslint.lintFiles(['test/fixtures/pre-refactor-recording-assistant.js']);
  const undefs = results.flatMap((r) => r.messages.filter((m) => m.ruleId === 'no-undef'));
  const modeErrors = undefs.filter((m) => /'MODE'/.test(m.message));
  assert.equal(modeErrors.length, 2,
    'expected exactly the two dangling MODE references (drawHud + checkFraming) in the pre-fix code');
});
