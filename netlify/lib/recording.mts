// Shared logic for the Recording Assistant backend.
// PACKET_KEY is capture-only: session issue, attestation, upload, and event
// transitions on the caller's own session. It can never read other records,
// modify history, or delete anything.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";

export const PROJECT_START = "2026-07-20";
export const AMENDMENT5_DOCUMENT_ID = "amendment-05-escalated-public-consequences";
export const CODE_TTL_MINUTES = 10; // challenge code must reach first frame within 10 minutes
export const CORNER_TIME_HARD_CAP_MINUTES = 30; // contract-mandated ceiling; never raise
export const LEVEL_MINUTES: Record<number, number> = { 1: 15, 2: 20, 3: 30 };
export const UPLOAD_PART_BYTES = 5 * 1024 * 1024;

export const PUBLIC_STORE = "public-captures";
export const PRIVATE_STORE = "private-captures"; // corrective sessions etc. — never routed by any public function

export type CaptureMode =
  | "daily-inspection"
  | "weigh-in"
  | "milestone-weigh-in"
  | "meal-photo"
  | "violation-portrait"
  | "violation-resolution"
  | "corrective-session"
  | "location-check-in";

// storage scope per component kind. Private components are delivered to AP
// storage only and must be unreachable from any public URL.
export const COMPONENT_SCOPE: Record<string, "public" | "private-ap"> = {
  "inspection-video": "public",
  "photo-front": "public",
  "photo-left": "public",
  "photo-rear": "public",
  "photo-right": "public",
  "acknowledgment-video": "public",
  "corner-time-video": "public",
  "milestone-video": "public",
  "scale-photo": "public",
  // Meal photos remain AP evidence, not public media: the Sheet row once
  // labeled "Amendment No. 1 — Evening Meal Photograph" was unverified and
  // removed, so no signed rule authorizes publishing them.
  "meal-photo": "private-ap",
  "violation-portrait": "public",
  "corrective-session-video": "private-ap",
  "frame-strip": "private-ap",
  "location-record": "private-ap",
};

export const MODE_COMPONENTS: Record<CaptureMode, string[]> = {
  "daily-inspection": ["inspection-video", "photo-front", "photo-left", "photo-rear", "photo-right", "frame-strip"],
  "weigh-in": ["scale-photo"],
  "milestone-weigh-in": ["milestone-video", "scale-photo", "frame-strip"],
  "meal-photo": ["meal-photo"],
  "violation-portrait": ["violation-portrait"],
  "violation-resolution": ["acknowledgment-video", "corner-time-video", "frame-strip"],
  "corrective-session": ["corrective-session-video", "frame-strip"],
  "location-check-in": ["location-record"],
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeEqual(expected: string, supplied: string) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function packetAuthorized(request: Request) {
  const expected = Netlify.env.get("PACKET_KEY") || "";
  const supplied = request.headers.get("x-packet-key") || "";
  return safeEqual(expected, supplied);
}

export function apAuthorized(request: Request) {
  const expected = Netlify.env.get("AP_KEY") || "";
  const supplied =
    request.headers.get("x-ap-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return safeEqual(expected, supplied);
}

export function sha256Hex(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}

// Challenge codes: 6 chars, unambiguous alphabet, cryptographically random.
// (The legacy Apps Script issued 4-digit Math.random codes with no expiry and
// no single-use enforcement; the spec hardens both.)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function newChallengeCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function newUploadToken() {
  return randomBytes(32).toString("hex");
}

// Civil date in America/New_York — every project-day computation uses ET.
export function etDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

export function projectDay(dateStr: string) {
  const day =
    Math.floor((Date.parse(dateStr + "T12:00:00Z") - Date.parse(PROJECT_START + "T12:00:00Z")) / 86400000) + 1;
  return Math.max(1, day);
}

// Amendment No. 5 gate, read live from the governing-document registry:
// enforcement modes ship dark unless the registry shows confirmed_signed and
// no open blocking reconciliation issue. This is data-driven on purpose — if
// the AP marks the document unconfirmed or reopens a conflict, the modes go
// dark on the next session request without a deploy.
export async function amendment5Active(db = getDatabase()) {
  const rows = await db.sql`
    select
      (select execution_status from private_record.governing_documents
        where document_id = ${AMENDMENT5_DOCUMENT_ID}) as execution_status,
      (select count(*)::int from private_record.document_reconciliation_issues
        where status = 'open' and severity = 'blocking') as open_blocking
  `;
  const row = rows[0] || {};
  return {
    active: row.execution_status === "confirmed_signed" && Number(row.open_blocking) === 0,
    execution_status: row.execution_status ? String(row.execution_status) : null,
    open_blocking_issues: Number(row.open_blocking || 0),
  };
}

export interface ActiveAssignment {
  violation_id: string;
  assignment_id: string;
  activation_id: string;
  violation_number: number;
  project_date: string;
  failed_requirement: string;
  review_deadline: string | null;
  approved_level: number | null;
  corner_time_minutes: number | null;
  penalty_uniform_required: boolean;
  penalty_uniform_starts_at: string | null;
  completion_deadline: string | null;
  private_corrective_required: boolean;
  overall_status: string;
}

// The most recent AP-activated consequence assignment that is still open.
// Violation numbers are stable: position in declared_at order (V-001…).
export async function activeAssignment(db = getDatabase()): Promise<ActiveAssignment | null> {
  const rows = await db.sql`
    with numbered as (
      select id, row_number() over (order by declared_at, id) as violation_number
      from public_record.violations
    )
    select
      v.id::text as violation_id,
      a.assignment_id::text,
      x.activation_id::text,
      n.violation_number::int,
      v.project_date::text,
      v.failed_requirement,
      v.review_deadline,
      x.approved_level,
      x.corner_time_minutes,
      x.penalty_uniform_required,
      x.penalty_uniform_starts_at,
      x.completion_deadline,
      x.private_corrective_required,
      a.overall_status
    from public_record.consequence_activations x
    join public_record.consequence_assignments a on a.assignment_id = x.assignment_id
    join public_record.violations v on v.id = a.violation_id
    join numbered n on n.id = v.id
    where x.activation_status = 'active' and a.overall_status = 'open'
    order by x.activated_at desc
    limit 1
  `;
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    violation_id: String(r.violation_id),
    assignment_id: String(r.assignment_id),
    activation_id: String(r.activation_id),
    violation_number: Number(r.violation_number),
    project_date: String(r.project_date),
    failed_requirement: String(r.failed_requirement),
    review_deadline: r.review_deadline ? new Date(String(r.review_deadline)).toISOString() : null,
    approved_level: r.approved_level == null ? null : Number(r.approved_level),
    corner_time_minutes: r.corner_time_minutes == null ? null : Number(r.corner_time_minutes),
    penalty_uniform_required: Boolean(r.penalty_uniform_required),
    penalty_uniform_starts_at: r.penalty_uniform_starts_at
      ? new Date(String(r.penalty_uniform_starts_at)).toISOString()
      : null,
    completion_deadline: r.completion_deadline ? new Date(String(r.completion_deadline)).toISOString() : null,
    private_corrective_required: Boolean(r.private_corrective_required),
    overall_status: String(r.overall_status),
  };
}

export function penaltyUniformActive(assignment: ActiveAssignment | null, a5Active: boolean) {
  if (!a5Active || !assignment || !assignment.penalty_uniform_required) return false;
  if (assignment.penalty_uniform_starts_at && Date.parse(assignment.penalty_uniform_starts_at) > Date.now()) {
    return false;
  }
  return assignment.overall_status === "open";
}

// Session lookup scoped by upload token — a caller can only touch a session
// whose one-time token it holds, PACKET_KEY alone is not enough.
export async function loadSession(db: ReturnType<typeof getDatabase>, sessionId: string, uploadToken: string) {
  if (!sessionId || !uploadToken) return null;
  const rows = await db.sql`
    select session_id::text, mode, project_date::text, violation_id::text, assignment_id::text,
           challenge_code, code_issued_at, code_expires_at, code_first_used_at,
           requirements, upload_token_hash, status, safety_stop
    from private_record.capture_sessions
    where session_id = ${sessionId}::uuid
  `;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, unknown>;
  if (!safeEqual(String(row.upload_token_hash), sha256Hex(uploadToken))) return null;
  return row;
}

export function partKey(sessionId: string, componentKind: string, part: number) {
  return `sessions/${sessionId}/${componentKind}/part-${String(part).padStart(4, "0")}`;
}

export function finalPrefix(sessionId: string, componentKind: string) {
  return `sessions/${sessionId}/${componentKind}/`;
}

export function storeFor(scope: string) {
  return getStore(scope === "public" ? PUBLIC_STORE : PRIVATE_STORE);
}
