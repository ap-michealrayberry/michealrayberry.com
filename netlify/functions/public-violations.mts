import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

function matchesEtag(headerValue: string | null, etag: string) {
  if (!headerValue) return false;
  return headerValue
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`
      select
        violation_id::text,
        project_day,
        project_date::text,
        declared_at,
        failed_requirement,
        objective_rule,
        accumulated_count,
        consequence_level,
        review_deadline,
        final_status,
        assignment_id::text,
        proposal_version,
        proposed_level,
        proposed_corner_time_minutes,
        proposed_penalty_uniform,
        proposal_status,
        proposed_at,
        decided_at,
        decision_summary,
        effective_at,
        completion_deadline,
        overall_status,
        public_components
      from public_record.public_violation_cases
      order by project_date, declared_at
    `;

    const violations = rows.map((row) => ({
      violation_id: String(row.violation_id),
      project_day: Number(row.project_day),
      project_date: String(row.project_date),
      declared_at: new Date(String(row.declared_at)).toISOString(),
      failed_requirement: String(row.failed_requirement),
      objective_rule: String(row.objective_rule),
      accumulated_count: Number(row.accumulated_count),
      consequence_level: Number(row.consequence_level),
      review_deadline: row.review_deadline == null ? null : new Date(String(row.review_deadline)).toISOString(),
      final_status: String(row.final_status),
      assignment: row.assignment_id == null ? null : {
        assignment_id: String(row.assignment_id),
        proposal_version: Number(row.proposal_version),
        proposed_level: Number(row.proposed_level),
        proposed_corner_time_minutes: row.proposed_corner_time_minutes == null ? null : Number(row.proposed_corner_time_minutes),
        proposed_penalty_uniform: Boolean(row.proposed_penalty_uniform),
        proposal_status: String(row.proposal_status),
        proposed_at: new Date(String(row.proposed_at)).toISOString(),
        decided_at: row.decided_at == null ? null : new Date(String(row.decided_at)).toISOString(),
        decision_summary: row.decision_summary == null ? null : String(row.decision_summary),
        effective_at: row.effective_at == null ? null : new Date(String(row.effective_at)).toISOString(),
        completion_deadline: row.completion_deadline == null ? null : new Date(String(row.completion_deadline)).toISOString(),
        overall_status: String(row.overall_status),
        components: Array.isArray(row.public_components) ? row.public_components : [],
      },
    }));

    const stablePayload = {
      schema_version: "1.0",
      status: "ok",
      timezone: "America/New_York",
      summary: {
        violation_count: violations.length,
        unresolved_count: violations.filter((item) => item.final_status === "unresolved").length,
        pending_ap_decision_count: violations.filter((item) => item.assignment?.proposal_status === "proposed").length,
      },
      violations,
    };

    const etag = `"${createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex")}"`;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=60",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    const body = JSON.stringify({ ...stablePayload, generated_at: new Date().toISOString() });
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  } catch (error) {
    console.error("public-violations query failed", error);
    const body = JSON.stringify({
      schema_version: "1.0",
      status: "unavailable",
      error: "violations_unavailable",
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

export const config: Config = { path: "/api/public/violations" };
