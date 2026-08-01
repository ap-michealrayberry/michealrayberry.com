import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

type ProgressRecord = {
  project_day: number;
  date: string;
  weight_lb: number;
  note: string | null;
};

function buildSummary(records: ProgressRecord[]) {
  const first = records.at(0) ?? null;
  const latest = records.at(-1) ?? null;
  const weights = records.map((record) => record.weight_lb);

  return {
    record_count: records.length,
    first_record: first,
    latest_record: latest,
    change_lb:
      first && latest ? Number((latest.weight_lb - first.weight_lb).toFixed(1)) : null,
    lowest_weight_lb: weights.length ? Math.min(...weights) : null,
    highest_weight_lb: weights.length ? Math.max(...weights) : null,
  };
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const db = getDatabase();
    const weights = await db.sql`
      select p.project_day,
             w.project_date::text as date,
             w.weight_lb::text as weight_lb,
             w.note
      from public_record.weight_records w
      join public_record.project_days p using (project_date)
      order by w.project_date
    `;

    const records: ProgressRecord[] = weights.map((row) => ({
      project_day: Number(row.project_day),
      date: String(row.date),
      weight_lb: Number(row.weight_lb),
      note: row.note == null ? null : String(row.note),
    }));

    const payload = {
      status: "ok",
      timezone: "America/New_York",
      generated_at: new Date().toISOString(),
      summary: buildSummary(records),
      records,
    };

    const body = JSON.stringify(payload);
    const etag = `"${createHash("sha256").update(body).digest("hex")}"`;

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "public, max-age=300" },
      });
    }

    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("public-progress query failed", error);
    const body = JSON.stringify({
      status: "unavailable",
      error: "progress_data_unavailable",
    });
    return new Response(request.method === "HEAD" ? null : body, {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
};

export const config: Config = { path: "/api/public/progress" };
