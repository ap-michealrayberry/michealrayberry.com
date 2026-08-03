/* Publisher orchestrator: ingest → generate → (optionally validate).
   Builds everything from the committed data/ snapshots and manifests — the
   Cloudflare build never talks to the spreadsheet, so GitHub and the
   deployed site are generated from the same inputs.

   A failure here is a NONZERO EXIT and blocks the deploy. There is no
   catch-and-continue: the last valid production build stays online instead
   of a broken one going out.

   Flags:
     --online    allow remote photo ingestion + HTTP video verification
                 (used by the scheduled sync workflow, not by deploys) */
import { ingest } from './ingest.mjs';
import { generate } from './generate.mjs';

async function main() {
  await ingest();
  await generate();
  console.log('Publish complete. Run `npm run validate-records` (the build script does) before shipping.');
}

main().catch((error) => {
  console.error(error.isPipelineError ? `Publisher failed: ${error.message}` : error);
  process.exit(1);
});
