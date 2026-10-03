import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      ACCESS_AUD_ASSISTANT?: string;
      ACCESS_AUD_MRB?: string;
      ACCESS_AUD_AP?: string;
      DEV_ACCESS_EMAIL?: string;
    }
  }
}
