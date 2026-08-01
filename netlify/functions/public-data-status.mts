import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`
      select
        (select count(*)::int from public_record.project_days) as project_days,
        (select count(*)::int from public_record.weight_records) as weight_records,
        (select min(project_date)::text from public_record.weight_records) as first_weight_date,
        (select max(project_date)::text from public_record.weight_records) as latest_weight_date,
        (select max(imported_at)::text from public_record.weight_records) as latest_imported_at,
        not exists (
          select 1
          from public_record.weight_records w
          left join public_record.project_days p using (project_date)
          where p.project_date is null
        ) as referential_integrity
    `;

    const row = rows[0];
    const healthy = Boolean(row?.referential_integrity);
    const body = JSON.stringify({
      status: healthy ? "ok" : "incomplete",
      timezone: "America/New_York",
      counts: {
        project_days: Number(row?.project_days ?? 0),
        weight_records: Number(row?.weight_records ?? 0),
      },
      range: {
        first_weight_date: row?.first_weight_date == null ? null : String(row.first_weight_date),
        latest_weight_date: row?.latest_weight_date == null ? null : String(row.latest_weight_date),
      },
      latest_imported_at: row?.latest_imported_at == null ? null : String(row.latest_imported_at),
      checks: { referential_integrity: healthy },
    });

    return new Response(request.method === "HEAD" ? null : body, {
      status: healthy ? 200 : 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("public-data-status query failed", error);
    const body = JSON.stringify({ status: "unavailable" });
    return new Response(request.method === "HEAD" ? null : body, {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
};

export const config: Config = { path: "/api/public/status" };
