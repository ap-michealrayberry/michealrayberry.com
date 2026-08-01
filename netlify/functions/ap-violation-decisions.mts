import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

const TYPES = new Set(["approve", "reduce", "substitute", "return", "waive"]);
const REVIEW_TYPES = new Set(["safety-stop", "medical-review", "accessibility-review", "technical-appeal"]);
const REVIEW_STATUSES = new Set(["requested", "suspended", "approved", "correction-required", "safe-substitute", "closed"]);
const LEVEL_MINUTES: Record<number, number> = { 1: 15, 2: 20, 3: 30 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function authorized(request: Request) {
  const expected = Netlify.env.get("AP_KEY") || "";
  const supplied = request.headers.get("x-ap-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function iso(value: unknown, required = false) {
  if (value == null || value === "") {
    if (required) throw new Error("missing_datetime");
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid_datetime");
  return parsed.toISOString();
}

function cleanText(value: unknown, max = 4000) {
  const text = value == null ? "" : String(value).trim();
  if (text.length > max) throw new Error("text_too_long");
  return text;
}

async function loadPortal(db: ReturnType<typeof getDatabase>) {
  const cases = await db.sql`
    select v.id::text as violation_id, v.project_date::text, v.declared_at, v.failed_requirement,
           v.objective_rule, v.review_deadline, v.final_status, v.accumulated_count,
           v.consequence_level, a.assignment_id::text, a.proposal_version,
           a.proposed_level, a.proposed_corner_time_minutes, a.proposed_penalty_uniform,
           a.proposal_status, a.proposed_at, a.decision_summary, a.overall_status,
           x.activation_id::text, x.activation_status, x.approved_level,
           x.corner_time_minutes, x.penalty_uniform_required,
           x.penalty_uniform_starts_at, x.completion_deadline,
           x.private_corrective_required, x.public_reason,
           x.governing_document_id, x.activated_at,
           coalesce((select jsonb_agg(jsonb_build_object(
             'type', e.evidence_type, 'description', e.description,
             'captured_at', e.captured_at, 'public_url', e.public_url
           ) order by e.captured_at) from public_record.violation_evidence e
           where e.violation_id = v.id), '[]'::jsonb) as evidence,
           coalesce((select jsonb_agg(jsonb_build_object(
             'component_type', c.component_type, 'status', c.status,
             'required', c.required, 'public_component', c.public_component,
             'duration_minutes', c.required_duration_minutes, 'due_at', c.due_at,
             'performed_at', c.performed_at, 'verified_at', c.verified_at,
             'public_url', c.public_url, 'verification_summary', c.verification_summary
           ) order by c.component_type) from public_record.consequence_components c
           where c.assignment_id = a.assignment_id), '[]'::jsonb) as components
    from public_record.violations v
    left join lateral (
      select * from public_record.consequence_assignments ca
      where ca.violation_id = v.id order by proposal_version desc limit 1
    ) a on true
    left join public_record.consequence_activations x on x.assignment_id = a.assignment_id
    order by v.declared_at desc
  `;
  const decisions = await db.sql`
    select d.decision_id::text, d.assignment_id::text, d.decision_type,
           d.decision_at, d.public_reason, d.private_rationale,
           d.resulting_status, d.created_at,
           x.activation_id::text, x.activation_status, x.approved_level,
           x.corner_time_minutes, x.penalty_uniform_required,
           x.penalty_uniform_starts_at, x.completion_deadline,
           x.private_corrective_required, x.governing_document_id
    from private_record.consequence_decisions d
    left join public_record.consequence_activations x on x.decision_id = d.decision_id
    order by d.decision_at desc
  `;
  const reviews = await db.sql`
    select review_id::text, assignment_id::text, violation_id::text,
           review_type, status, requested_at, resolved_at, public_summary,
           private_basis, created_at
    from private_record.safety_reviews order by requested_at desc
  `;
  const documents = await db.sql`
    select document_id, display_title, document_type, execution_status,
           effective_date::text, public_copy_status
    from private_record.governing_documents
    order by effective_date nulls last, display_title
  `;
  const summary = {
    violation_count: cases.length,
    unresolved_count: cases.filter((row) => row.final_status === "unresolved").length,
    pending_decision_count: cases.filter((row) => row.assignment_id && !row.activation_id).length,
    active_assignment_count: cases.filter((row) => row.activation_status === "active").length,
    open_review_count: reviews.filter((row) => !["closed", "approved"].includes(String(row.status))).length,
  };
  return { status: "ok", timezone: "America/New_York", summary, cases, decisions, reviews, documents };
}

export default async (request: Request, _context: Context) => {
  if (!authorized(request)) return json({ status: "unauthorized" }, 401);
  if (!["GET", "POST"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });

  const db = getDatabase();
  if (request.method === "GET") return json(await loadPortal(db));

  let input: any;
  try { input = await request.json(); } catch { return json({ status: "invalid_json" }, 400); }
  const action = String(input.action || "decision");

  try {
    if (action === "review") {
      const assignmentId = input.assignment_id ? String(input.assignment_id) : null;
      const violationId = input.violation_id ? String(input.violation_id) : null;
      const reviewType = String(input.review_type || "");
      const status = String(input.review_status || "requested");
      const publicSummary = cleanText(input.public_summary, 1000) || null;
      const privateBasis = cleanText(input.private_basis, 4000) || null;
      if ((!assignmentId && !violationId) || !REVIEW_TYPES.has(reviewType) || !REVIEW_STATUSES.has(status) || input.confirmed !== true) {
        return json({ status: "validation_failed", required: ["assignment_id or violation_id", "review_type", "review_status", "confirmed=true"] }, 422);
      }
      const now = new Date().toISOString();
      const resolvedAt = ["approved", "correction-required", "safe-substitute", "closed"].includes(status) ? now : null;
      const [review] = await db.sql`
        insert into private_record.safety_reviews
          (assignment_id, violation_id, review_type, status, requested_at, resolved_at, public_summary, private_basis)
        values (${assignmentId}, ${violationId}, ${reviewType}, ${status}, ${now}, ${resolvedAt}, ${publicSummary}, ${privateBasis})
        returning review_id::text, status
      `;
      return json({ status: "review_recorded", review_id: review.review_id, review_status: review.status }, 201);
    }

    const assignmentId = String(input.assignment_id || "");
    const decisionType = String(input.decision_type || "");
    const publicReason = cleanText(input.public_reason, 1000);
    const privateRationale = cleanText(input.private_rationale, 4000) || null;
    if (!assignmentId || !TYPES.has(decisionType) || publicReason.length < 10 || input.confirmed !== true) {
      return json({ status: "validation_failed", required: ["assignment_id", "decision_type", "public_reason", "confirmed=true"] }, 422);
    }

    const level = input.approved_level == null ? null : Number(input.approved_level);
    if (level != null && ![1, 2, 3].includes(level)) return json({ status: "invalid_level" }, 422);
    const cornerMinutes = input.corner_time_minutes == null ? (level ? LEVEL_MINUTES[level] : null) : Number(input.corner_time_minutes);
    if (cornerMinutes != null && ![15, 20, 30].includes(cornerMinutes)) return json({ status: "invalid_corner_time" }, 422);
    if (["approve", "reduce"].includes(decisionType) && level == null) return json({ status: "approved_level_required" }, 422);

    const uniformRequired = Boolean(input.penalty_uniform_required);
    const privateCorrective = Boolean(input.private_corrective_required);
    const uniformStartsAt = iso(input.penalty_uniform_starts_at);
    const deadline = iso(input.completion_deadline);
    if (uniformRequired && !uniformStartsAt) return json({ status: "uniform_start_required" }, 422);
    if (["approve", "reduce"].includes(decisionType) && !deadline) return json({ status: "completion_deadline_required" }, 422);
    const governingDocumentId = String(input.governing_document_id || "amendment-05-escalated-public-consequences");
    const now = new Date().toISOString();
    const activationStatus = decisionType === "waive" ? "waived" : decisionType === "return" ? "returned" : decisionType === "substitute" ? "substituted" : "active";
    const fingerprint = createHash("sha256").update(JSON.stringify({ assignmentId, decisionType, publicReason, level, cornerMinutes, uniformRequired, uniformStartsAt, deadline, privateCorrective, governingDocumentId })).digest("hex");

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const assignment = await client.query("select assignment_id from public_record.consequence_assignments where assignment_id = $1 for update", [assignmentId]);
      if (assignment.rowCount !== 1) throw new Error("assignment_not_found");
      const existing = await client.query("select activation_id from public_record.consequence_activations where assignment_id = $1", [assignmentId]);
      if (existing.rowCount) throw new Error("decision_already_recorded");
      const document = await client.query("select document_id from private_record.governing_documents where document_id = $1 and execution_status = 'confirmed_signed'", [governingDocumentId]);
      if (document.rowCount !== 1) throw new Error("governing_document_not_active");

      const decision = await client.query(
        `insert into private_record.consequence_decisions
          (assignment_id, decision_type, decision_at, public_reason, private_rationale, resulting_status)
         values ($1,$2,$3,$4,$5,$6) returning decision_id`,
        [assignmentId, decisionType, now, publicReason, privateRationale, activationStatus]
      );
      const decisionId = decision.rows[0].decision_id;
      await client.query(
        `insert into public_record.consequence_activations
          (assignment_id, decision_id, approved_level, corner_time_minutes,
           penalty_uniform_required, penalty_uniform_starts_at, completion_deadline,
           private_corrective_required, activation_status, public_reason,
           governing_document_id, activated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [assignmentId, decisionId, level, cornerMinutes, uniformRequired, uniformStartsAt, deadline, privateCorrective, activationStatus, publicReason, governingDocumentId, now]
      );

      if (activationStatus === "active") {
        const components = [
          ["public-acknowledgment", true, true, null],
          ["public-corner-time", true, true, cornerMinutes],
          ["violation-portrait", true, true, null],
          ["penalty-uniform-period", uniformRequired, true, null],
          ["private-corrective-session", privateCorrective, false, null],
        ].filter((row) => row[1]);
        for (const [type, required, isPublic, duration] of components) {
          await client.query(
            `insert into public_record.consequence_components
              (assignment_id, component_type, required, public_component, status, required_duration_minutes, due_at)
             values ($1,$2,$3,$4,'approved',$5,$6)
             on conflict (assignment_id, component_type) do nothing`,
            [assignmentId, type, required, isPublic, duration, deadline]
          );
        }
      }

      await client.query(
        `insert into private_record.ap_decision_audit (decision_id, request_fingerprint, payload)
         values ($1,$2,$3::jsonb)`,
        [decisionId, fingerprint, JSON.stringify({ decision_type: decisionType, approved_level: level, corner_time_minutes: cornerMinutes, penalty_uniform_required: uniformRequired, penalty_uniform_starts_at: uniformStartsAt, completion_deadline: deadline, private_corrective_required: privateCorrective, governing_document_id: governingDocumentId })]
      );
      await client.query("COMMIT");
      return json({ status: "recorded", decision_id: decisionId, activation_status: activationStatus }, 201);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "decision_failed";
    const status = message === "assignment_not_found" ? 404 : message === "decision_already_recorded" ? 409 : 400;
    return json({ status: message }, status);
  }
};

export const config: Config = { path: "/api/ap/violation-decisions" };
