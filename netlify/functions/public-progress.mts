import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

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

    const body = JSON.stringify({
      status: "ok",
      timezone: "America/New_York",
      records: weights.map((row) => ({
        project_day: Number(row.project_day),
        date: String(row.date),
        weight_lb: Number(row.weight_lb),
        note: row.note == null ? null : String(row.note)
      }))
    });

    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch {
    const body = JSON.stringify({ status: "unavailable" });
    return new Response(request.method === "HEAD" ? null : body, {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
};

export const config: Config = { path: "/api/public/progress" };
