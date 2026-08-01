const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

function pounds(value) {
  return value == null ? "—" : `${Number(value).toFixed(1)} lb`;
}

function createSvg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function drawChart(records) {
  const svg = $("chart");
  svg.querySelectorAll(":scope > :not(title):not(desc)").forEach((node) => node.remove());
  if (!records.length) return;

  const width = 900;
  const height = 360;
  const margin = { top: 30, right: 32, bottom: 48, left: 62 };
  const values = records.map((record) => Number(record.weight_lb));
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const x = (index) => margin.left + (index / Math.max(records.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + ((max - value) / Math.max(max - min, 1)) * (height - margin.top - margin.bottom);

  for (let value = min; value <= max; value += 1) {
    const lineY = y(value);
    svg.append(createSvg("line", { x1: margin.left, y1: lineY, x2: width - margin.right, y2: lineY, class: "grid-line" }));
    const label = createSvg("text", { x: margin.left - 10, y: lineY + 4, "text-anchor": "end", class: "axis-label" });
    label.textContent = value;
    svg.append(label);
  }

  const points = records.map((record, index) => `${x(index)},${y(Number(record.weight_lb))}`).join(" ");
  svg.append(createSvg("polyline", { points, class: "trend" }));

  records.forEach((record, index) => {
    const circle = createSvg("circle", { cx: x(index), cy: y(Number(record.weight_lb)), r: 6, class: "point", tabindex: 0 });
    const title = createSvg("title");
    title.textContent = `Day ${record.project_day}: ${pounds(record.weight_lb)} on ${record.date}`;
    circle.append(title);
    svg.append(circle);
  });

  const firstLabel = createSvg("text", { x: margin.left, y: height - 16, class: "axis-label" });
  firstLabel.textContent = `Day ${records[0].project_day}`;
  svg.append(firstLabel);
  const lastLabel = createSvg("text", { x: width - margin.right, y: height - 16, "text-anchor": "end", class: "axis-label" });
  lastLabel.textContent = `Day ${records.at(-1).project_day}`;
  svg.append(lastLabel);
}

function renderRecords(records) {
  const fragment = document.createDocumentFragment();
  records.slice().reverse().forEach((record) => {
    const row = document.createElement("tr");
    [record.project_day, record.date, pounds(record.weight_lb), record.note ?? "—"].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    });
    fragment.append(row);
  });
  $("records").replaceChildren(fragment);
}

async function loadProgress() {
  try {
    const response = await fetch("/api/public/progress", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== "ok" || !Array.isArray(data.records)) throw new Error("Invalid response");

    $("latest").textContent = pounds(data.summary.latest_record?.weight_lb);
    $("change").textContent = data.summary.change_lb == null ? "—" : `${data.summary.change_lb > 0 ? "+" : ""}${data.summary.change_lb.toFixed(1)} lb`;
    $("lowest").textContent = pounds(data.summary.lowest_weight_lb);
    $("count").textContent = String(data.summary.record_count);
    $("status").textContent = `Verified public data generated ${new Date(data.generated_at).toLocaleString("en-US", { timeZone: data.timezone })} ET.`;
    drawChart(data.records);
    renderRecords(data.records);
  } catch (error) {
    console.error("Unable to load public progress", error);
    $("status").textContent = "Public progress data is temporarily unavailable.";
    $("status").classList.add("error");
  }
}

loadProgress();
