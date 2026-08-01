import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const db = getDatabase();
    const [projectSummary] = await db.sql`
      select count(*)::int as count,
             min(project_date)::text as first_date,
             max(project_date)::text as last_date,
             bool_and(timezone = 'America/New_York') as eastern_time
      from public_record.project_days
      where project_date between '2026-07-20' and '2026-08-01'
    `;

    const [weightSummary] = await db.sql`
      select count(*)::int as count,
             min(project_date)::text as first_date,
             max(project_date)::text as last_date,
             count(*) filter (where source_system = 'google-sheets')::int as traced_source_count,
             count(*) filter (where source_record_id is not null)::int as traced_row_count,
             min(weight_lb)::text as minimum_weight,
             max(weight_lb)::text as maximum_weight
      from public_record.weight_records
      where project_date between '2026-07-20' and '2026-07-31'
    `;

    const checks = {
      project_day_count: Number(projectSummary?.count) === 13,
      project_date_range: String(projectSummary?.first_date) === '2026-07-20' && String(projectSummary?.last_date) === '2026-08-01',
      eastern_time: Boolean(projectSummary?.eastern_time),
      weight_count: Number(weightSummary?.count) === 12,
      weight_date_range: String(weightSummary?.first_date) === '2026-07-20' && String(weightSummary?.last_date) === '2026-07-31',
      source_traceability: Number(weightSummary?.traced_source_count) === 12 && Number(weightSummary?.traced_row_count) === 12,
      weight_bounds: String(weightSummary?.minimum_weight) === '335.6' && String(weightSummary?.maximum_weight) === '338.4'
    };

    const reconciled = Object.values(checks).every(Boolean);
    const body = JSON.stringify({
      status: reconciled ? 'ok' : 'mismatch',
      import: '0005_import-initial-project-days-and-weights',
      checks,
      summary: {
        project_days: Number(projectSummary?.count ?? 0),
        weights: Number(weightSummary?.count ?? 0),
        first_project_date: projectSummary?.first_date ?? null,
        last_project_date: projectSummary?.last_date ?? null,
        first_weight_date: weightSummary?.first_date ?? null,
        last_weight_date: weightSummary?.last_date ?? null
      }
    });

    return new Response(request.method === 'HEAD' ? null : body, {
      status: reconciled ? 200 : 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch {
    const body = JSON.stringify({ status: 'unavailable' });
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};

export const config: Config = { path: '/.well-known/import-reconciliation' };
