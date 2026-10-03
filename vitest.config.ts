import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      projects: [
        {
          // Worker code runs inside workerd with a fresh local D1 per test file.
          plugins: [cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: migrations,
                ACCESS_TEAM_DOMAIN: 'mrb-test.cloudflareaccess.com',
                ACCESS_AUD_ASSISTANT: 'aud-assistant',
                ACCESS_AUD_MRB: 'aud-mrb',
                ACCESS_AUD_AP: 'aud-ap',
                DEV_ACCESS_EMAIL: 'michealrayberry@gmail.com',
                // Pinned so a developer's .dev.vars never changes test results.
                SHEETS_MIRROR: 'off',
                SHEETS_FEEDS: '{}',
                IMAGE_TRANSFORMS: 'off',
              },
            },
          })],
          test: { name: 'worker', include: ['test/worker/**/*.test.ts'], setupFiles: ['./test/worker/apply-migrations.ts'] },
        },
        {
          // Node-side scripts (the one-off Sheets import).
          test: { name: 'scripts', include: ['test/scripts/**/*.test.ts'], environment: 'node' },
        },
      ],
    },
  };
});
