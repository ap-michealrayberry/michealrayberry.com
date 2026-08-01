import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`
      select p.project_day,
             w.project_date::text as date,
             w.weight_lb::text as weight_lb,
             w.note
      from public_record.weight_records w
      join public_record.project_days p using (project_date)
      order by w.project_date
    `;

    const lines = [
      ["project_day", "date", "weight_lb", "note"].join(","),
      ...rows.map((row) =>
        [row.project_day, row.date, row.weight_lb, row.note]
          .map(csvCell)
          .join(","),
      ),
    ];
    const body = `${lines.join("\n")}\n`;

    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="mrb-public-progress.csv"',
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("public-progress-csv query failed", error);
    return new Response(request.method === "HEAD" ? null : "status,error\nunavailable,progress_data_unavailable\n", {
      status: 503,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
};

export const config: Config = { path: "/api/public/progress.csv" };
