const baseUrl = (process.env.PUBLIC_BASE_URL || "https://michealrayberry.com").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const response = await fetch(`${baseUrl}/api/public/daily-records`, { headers: { Accept: "application/json" } });
assert(response.status === 200, `daily records returned ${response.status}`);
assert(response.headers.get("content-type")?.includes("application/json"), "daily records content type is not JSON");
const etag = response.headers.get("etag");
assert(etag, "daily records response has no ETag");
const payload = await response.json();
assert(payload.status === "ok", "daily records status is not ok");
assert(payload.schema_version === "1.0", "unexpected daily records schema version");
assert(payload.timezone === "America/New_York", "unexpected timezone");
assert(Array.isArray(payload.records), "records is not an array");
assert(payload.records.length === 12, `expected 12 records, received ${payload.records.length}`);
assert(payload.summary?.complete_media_days === 11, "expected 11 complete media days");
assert(payload.summary?.incomplete_media_days === 1, "expected one incomplete media day");
assert(payload.summary?.total_public_media_items === 55, "expected 55 public media items");

for (let index = 0; index < payload.records.length; index += 1) {
  const record = payload.records[index];
  assert(record.project_day === index + 1, `unexpected project day at index ${index}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(record.date), `invalid date at index ${index}`);
  assert(Number.isFinite(record.weight_lb), `invalid weight at index ${index}`);
  assert(Array.isArray(record.completeness?.missing_components), `missing component list absent at index ${index}`);
}

const july31 = payload.records.find((record) => record.date === "2026-07-31");
assert(july31, "July 31 record is absent");
assert(july31.completeness.media_complete === false, "July 31 must remain incomplete");
assert(july31.completeness.missing_components.length === 5, "July 31 should report five missing media components");

const conditional = await fetch(`${baseUrl}/api/public/daily-records`, { headers: { "If-None-Match": etag } });
assert(conditional.status === 304, `conditional daily record request returned ${conditional.status}`);

console.log(JSON.stringify({
  status: "ok",
  base_url: baseUrl,
  record_count: payload.records.length,
  complete_media_days: payload.summary.complete_media_days,
  incomplete_media_days: payload.summary.incomplete_media_days,
  public_media_items: payload.summary.total_public_media_items,
  etag,
}, null, 2));
