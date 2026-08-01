const baseUrl = (process.env.PUBLIC_BASE_URL || "https://michealrayberry.com").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
}

const pages = ["/", "/progress/", "/dataset.json", "/datapackage.json", "/sitemap.xml", "/sitemap-static.xml"];
for (const path of pages) {
  const response = await request(path);
  assert(response.status === 200, `${path} returned ${response.status}`);
}

for (const alias of ["/dashboard", "/data", "/weigh-ins"]) {
  const response = await request(alias);
  assert([301, 302, 307, 308].includes(response.status), `${alias} did not redirect`);
  const location = response.headers.get("location");
  assert(location?.endsWith("/progress/"), `${alias} redirected to ${location}`);
}

const progressPage = await (await request("/progress/")).text();
assert(progressPage.includes("/api/public/progress"), "progress page does not link JSON API");
assert(progressPage.includes("/api/public/progress.csv"), "progress page does not link CSV API");
assert(progressPage.includes("/dataset.json"), "progress page does not link dataset metadata");
assert(!progressPage.includes("docs.google.com/spreadsheets"), "progress page contains a Google Sheets dependency");

const dataset = await (await request("/dataset.json")).json();
const distributions = dataset.distribution || [];
assert(distributions.some((entry) => entry.contentUrl?.endsWith("/api/public/progress")), "dataset lacks JSON distribution");
assert(distributions.some((entry) => entry.contentUrl?.endsWith("/api/public/progress.csv")), "dataset lacks CSV distribution");

const sitemap = await (await request("/sitemap-static.xml")).text();
assert(sitemap.includes("https://michealrayberry.com/progress/"), "sitemap lacks progress page");

console.log(JSON.stringify({
  status: "ok",
  base_url: baseUrl,
  checks: {
    canonical_pages: true,
    legacy_aliases: true,
    public_data_links: true,
    no_progress_sheet_dependency: true,
    dataset_distributions: true,
    sitemap_discovery: true
  }
}, null, 2));
