const $ = (id) => document.getElementById(id);
const LABELS = {
  photo_front: "Front photo",
  photo_left: "Left photo",
  photo_rear: "Rear photo",
  photo_right: "Right photo",
  inspection_video: "Inspection video",
};

function pounds(value) {
  return value == null ? "—" : `${Number(value).toFixed(1)} lb`;
}

function isDurable(url) {
  return typeof url === "string" && url.startsWith("https://michealrayberry.com/");
}

function mediaLink(key, url) {
  const item = document.createElement("li");
  if (!url) {
    item.className = "missing";
    item.textContent = `${LABELS[key]} — unavailable`;
    return item;
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = LABELS[key];
  item.append(link);
  if (!isDurable(url)) {
    const badge = document.createElement("span");
    badge.className = "host-badge";
    badge.textContent = "External host";
    item.append(badge);
  }
  return item;
}

function recordCard(record) {
  const article = document.createElement("article");
  article.className = `record-card ${record.completeness.media_complete ? "complete" : "incomplete"}`;
  article.id = `day-${record.project_day}`;

  const heading = document.createElement("div");
  heading.className = "record-heading";
  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `Project day ${record.project_day}`;
  const title = document.createElement("h3");
  title.textContent = record.date;
  titleWrap.append(eyebrow, title);
  const state = document.createElement("span");
  state.className = "state";
  state.textContent = record.completeness.media_complete ? "Media complete" : "Media incomplete";
  heading.append(titleWrap, state);

  const facts = document.createElement("dl");
  facts.innerHTML = `<div><dt>Weight</dt><dd>${pounds(record.weight_lb)}</dd></div><div><dt>Photos</dt><dd>${record.completeness.photo_count}/4</dd></div><div><dt>Video</dt><dd>${record.completeness.video_count}/1</dd></div>`;

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = record.note || "No public note.";

  const media = document.createElement("ul");
  media.className = "media-list";
  Object.entries(record.media).forEach(([key, url]) => media.append(mediaLink(key, url)));

  if (record.completeness.missing_components.length) {
    const missing = document.createElement("p");
    missing.className = "missing-summary";
    missing.textContent = `Missing: ${record.completeness.missing_components.map((key) => LABELS[key]).join(", ")}.`;
    article.append(heading, facts, note, media, missing);
  } else {
    article.append(heading, facts, note, media);
  }
  return article;
}

async function loadRecords() {
  try {
    const response = await fetch("/api/public/daily-records", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== "ok" || !Array.isArray(data.records)) throw new Error("Invalid response");

    $("record-count").textContent = String(data.summary.record_count);
    $("complete-count").textContent = String(data.summary.complete_media_days);
    $("incomplete-count").textContent = String(data.summary.incomplete_media_days);
    $("media-count").textContent = String(data.summary.total_public_media_items);
    $("status").textContent = `Verified public data generated ${new Date(data.generated_at).toLocaleString("en-US", { timeZone: data.timezone })} ET.`;

    const fragment = document.createDocumentFragment();
    data.records.slice().reverse().forEach((record) => fragment.append(recordCard(record)));
    $("records").replaceChildren(fragment);

    const requestedDay = new URLSearchParams(location.search).get("day");
    if (requestedDay && /^\d+$/.test(requestedDay)) document.getElementById(`day-${requestedDay}`)?.scrollIntoView();
  } catch (error) {
    console.error("Unable to load daily records", error);
    $("status").textContent = "Daily public records are temporarily unavailable.";
    $("status").classList.add("error");
  }
}

loadRecords();
