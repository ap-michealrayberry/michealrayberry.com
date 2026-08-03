/* Lint gate for the recording assistant. The rule that matters most here is
   no-undef: it is the mechanical check for the "identifier survived the edit
   that removed its declaration" class of bug (the MODE regression — see the
   tools README). Run via `npm test` (lint.test.mjs) or `npx eslint`. */

import globals from 'globals';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Optional webm duration patcher: only present if the host page loaded
        // it; every use is typeof-guarded.
        ysFixWebmDuration: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', {
        args: 'none',
        // The one idiom the original file leans on everywhere: `catch (e) {}`.
        caughtErrors: 'none',
      }],
    },
  },
];
