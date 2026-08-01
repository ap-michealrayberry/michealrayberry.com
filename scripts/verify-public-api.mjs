const baseUrl = (process.env.PUBLIC_BASE_URL || "https://michealrayberry.com").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchChecked(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return response;
}

const progress = await fetchChecked("/api/public/progress", {
  headers: { Accept: "application/json" },
});
assert(progress.status === 200, `progress returned ${progress.status}`);
assert(progress.headers.get("content-type")?.includes("application/json"), "progress content type is not JSON");
const etag = progress.headers.get("etag");
assert(etag, "progress response has no ETag");
const payload = await progress.json();
assert(payload.status === "ok", "progress status is not ok");
assert(payload.schema_version === "1.1", "unexpected progress schema version");
assert(payload.timezone === "America/New_York", "unexpected progress timezone");
assert(Array.isArray(payload.records), "progress records is not an array");
assert(payload.summary?.record_count === payload.records.length, "summary count does not match records");

for (let index = 0; index < payload.records.length; index += 1) {
  const record = payload.records[index];
  assert(record.project_day === index + 1, `unexpected project_day at index ${index}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(record.date), `invalid date at index ${index}`);
  assert(Number.isFinite(record.weight_lb) && record.weight_lb > 0, `invalid weight at index ${index}`);
}

const conditional = await fetchChecked("/api/public/progress", {
  headers: { "If-None-Match": etag },
});
assert(conditional.status === 304, `conditional request returned ${conditional.status}, expected 304`);
assert(conditional.headers.get("etag") === etag, "304 ETag differs from original ETag");

const head = await fetchChecked("/api/public/progress", { method: "HEAD" });
assert(head.status === 200, `HEAD returned ${head.status}`);
assert(head.headers.get("etag") === etag, "HEAD ETag differs from GET ETag");

const status = await fetchChecked("/api/public/status");
assert(status.status === 200, `status returned ${status.status}`);
const statusPayload = await status.json();
assert(statusPayload.status === "ok", "status endpoint is not ok");
assert(statusPayload.checks?.referential_integrity === true, "referential integrity check failed");
assert(statusPayload.counts?.weight_records === payload.records.length, "status count differs from progress count");

const csv = await fetchChecked("/api/public/progress.csv");
assert(csv.status === 200, `CSV returned ${csv.status}`);
assert(csv.headers.get("content-type")?.includes("text/csv"), "CSV content type is incorrect");
const csvText = await csv.text();
const csvLines = csvText.trim().split(/\r?\n/);
assert(csvLines.length === payload.records.length + 1, "CSV row count differs from JSON record count");

console.log(JSON.stringify({
  status: "ok",
  base_url: baseUrl,
  record_count: payload.records.length,
  etag,
  checks: {
    json_shape: true,
    stable_conditional_get: true,
    head_consistency: true,
    status_consistency: true,
    csv_consistency: true,
  },
}, null, 2));
