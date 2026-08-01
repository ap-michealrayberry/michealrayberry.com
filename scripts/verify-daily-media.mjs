const baseUrl = (process.env.PUBLIC_BASE_URL || "https://michealrayberry.com").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const response = await fetch(`${baseUrl}/api/public/daily-records`, { headers: { Accept: "application/json" } });
assert(response.status === 200, `daily records returned ${response.status}`);
const payload = await response.json();
assert(payload.status === "ok" && Array.isArray(payload.records), "daily record payload is invalid");

const media = payload.records.flatMap((record) =>
  Object.entries(record.media)
    .filter(([, url]) => Boolean(url))
    .map(([component, url]) => ({ day: record.project_day, component, url })),
);
assert(media.length === payload.summary.total_public_media_items, "media count differs from API summary");

const durable = media.filter(({ url }) => url.startsWith(`${baseUrl}/`));
const external = media.filter(({ url }) => !url.startsWith(`${baseUrl}/`));
const driveHosted = external.filter(({ url }) => new URL(url).hostname.endsWith("google.com"));

const failures = [];
const concurrency = 8;
let cursor = 0;
async function worker() {
  while (cursor < media.length) {
    const item = media[cursor++];
    try {
      const result = await fetch(item.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (result.status >= 400) failures.push({ ...item, status: result.status });
    } catch (error) {
      failures.push({ ...item, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
assert(failures.length === 0, `unavailable media references: ${JSON.stringify(failures)}`);

console.log(JSON.stringify({
  status: "ok",
  checked: media.length,
  durable_site_assets: durable.length,
  external_assets: external.length,
  drive_hosted_assets_requiring_durable_replacement: driveHosted.length,
  drive_hosted: driveHosted.map(({ day, component, url }) => ({ day, component, url })),
}, null, 2));
