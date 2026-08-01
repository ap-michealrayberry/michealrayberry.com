import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";
import {
  CaptureMode,
  CODE_TTL_MINUTES,
  CORNER_TIME_HARD_CAP_MINUTES,
  COMPONENT_SCOPE,
  LEVEL_MINUTES,
  MODE_COMPONENTS,
  UPLOAD_PART_BYTES,
  activeAssignment,
  amendment5Active,
  etDateString,
  json,
  newChallengeCode,
  newUploadToken,
  packetAuthorized,
  penaltyUniformActive,
  projectDay,
  sha256Hex,
} from "../lib/recording.mts";

const MODES = new Set(Object.keys(MODE_COMPONENTS));

// §1.4: the acknowledgment script is generated from the violation record —
// never free-typed.
function acknowledgmentScript(a: NonNullable<Awaited<ReturnType<typeof activeAssignment>>>, dayNum: number) {
  const vn = "V-" + String(a.violation_number).padStart(3, "0");
  const minutes = a.corner_time_minutes ?? LEVEL_MINUTES[a.approved_level ?? 1];
  return [
    `I am Micheal Ray Berry. This is the public acknowledgment of violation ${vn}.`,
    `The requirement missed: ${a.failed_requirement}`,
    `The violation date was ${a.project_date}, project day ${dayNum}.` +
      (a.completion_deadline ? ` The resolution deadline is ${a.completion_deadline.slice(0, 10)}.` : ""),
    `The assigned consequence level is ${a.approved_level ?? 1}.`,
    `The public consequence required is ${minutes} continuous minutes of corner time, recorded and published in full.`,
    `Resolution requires this acknowledgment and the corner time to be completed, verified, and published to the permanent record.`,
  ];
}

async function issueSession(request: Request) {
  let input: any;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const mode = String(input.mode || "") as CaptureMode;
  if (!MODES.has(mode)) return json({ ok: false, error: "unknown_mode" }, 422);

  const db = getDatabase();
  const now = new Date();
  const today = etDateString(now);
  const dayNum = projectDay(today);
  const a5 = await amendment5Active(db);
  const assignment = await activeAssignment(db);

  // Enforcement modes are gated on the signed rule version being unambiguous
  // (CLAUDE.md) — the governing-document registry is the authority.
  if ((mode === "violation-resolution" || mode === "violation-portrait") && !a5.active) {
    return json({ ok: false, error: "amendment5_not_active", registry_status: a5.execution_status }, 409);
  }
  if ((mode === "violation-resolution" || mode === "violation-portrait") && !assignment) {
    return json({ ok: false, error: "no_active_consequence_assignment" }, 409);
  }

  const uniform = penaltyUniformActive(assignment, a5.active) ? "penalty-pink" : "standard-black";

  const requirements: Record<string, unknown> = {
    uniform,
    server_time: now.toISOString(),
    project_day: dayNum,
    capture: { video: "1080x1920@9Mbps", stills: "4K burst, sharpest wins" },
  };
  switch (mode) {
    case "daily-inspection":
      requirements.angles = ["front", "left", "rear", "right", "front-closing"];
      requirements.pose = "standing, hands behind head";
      requirements.min_video_seconds = 20;
      break;
    case "meal-photo":
      requirements.uniform = "none";
      requirements.food_check = "on-device classifier before accept";
      break;
    case "weigh-in":
      requirements.uniform = "none";
      requirements.subject = "scale readout";
      break;
    case "milestone-weigh-in":
      requirements.documentation = "on camera, same scale, milestone statement";
      break;
    case "violation-portrait":
      requirements.framing = "3:4, head at top of frame, facing camera, inspection stance";
      requirements.uniform = uniform === "penalty-pink" ? "penalty-pink" : "standard-black";
      break;
    case "violation-resolution": {
      const minutes = Math.min(
        assignment!.corner_time_minutes ?? LEVEL_MINUTES[assignment!.approved_level ?? 1],
        CORNER_TIME_HARD_CAP_MINUTES,
      );
      requirements.uniform = "penalty-pink";
      requirements.acknowledgment_seconds = { min: 20, max: 30 };
      requirements.corner_time_minutes = minutes;
      requirements.framing = "full body and corner continuously in frame";
      requirements.script = acknowledgmentScript(assignment!, projectDay(assignment!.project_date));
      requirements.violation_number = assignment!.violation_number;
      requirements.level = assignment!.approved_level;
      break;
    }
    case "corrective-session": {
      const minutes = Math.min(
        assignment?.private_corrective_required
          ? (assignment.corner_time_minutes ?? LEVEL_MINUTES[assignment.approved_level ?? 1])
          : Number(input.level_minutes) || 15,
        CORNER_TIME_HARD_CAP_MINUTES,
      );
      requirements.corner_time_minutes = minutes;
      requirements.private = true;
      break;
    }
    case "location-check-in":
      requirements.uniform = "none";
      break;
  }

  const code = newChallengeCode();
  const token = newUploadToken();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60000).toISOString();

  const sessions = await db.sql`
    insert into private_record.capture_sessions
      (mode, project_date, violation_id, assignment_id, challenge_code,
       code_issued_at, code_expires_at, requirements, upload_token_hash, client_meta)
    values
      (${mode}, ${today}::date,
       ${mode === "violation-resolution" || mode === "violation-portrait" ? assignment!.violation_id : null}::uuid,
       ${mode === "violation-resolution" || mode === "violation-portrait" || mode === "corrective-session"
         ? (assignment?.assignment_id ?? null)
         : null}::uuid,
       ${code}, ${now.toISOString()}::timestamptz, ${expiresAt}::timestamptz,
       ${JSON.stringify(requirements)}::jsonb, ${sha256Hex(token)}, ${JSON.stringify(input.client_meta ?? null)}::jsonb)
    returning session_id::text
  `;
  const sessionId = String(sessions[0].session_id);

  const components = MODE_COMPONENTS[mode];
  for (const kind of components) {
    await db.sql`
      insert into private_record.capture_components (session_id, component_kind, storage_scope)
      values (${sessionId}::uuid, ${kind}, ${COMPONENT_SCOPE[kind]})
    `;
  }

  return json({
    ok: true,
    session_id: sessionId,
    challenge_code: code,
    code_expires_at: expiresAt,
    server_time: now.toISOString(),
    upload_token: token,
    upload_part_bytes: UPLOAD_PART_BYTES,
    project_date: today,
    project_day: dayNum,
    requirements,
    components: components.map((kind) => ({ kind, scope: COMPONENT_SCOPE[kind] })),
  });
}

async function context(_request: Request) {
  const db = getDatabase();
  const now = new Date();
  const today = etDateString(now);
  const a5 = await amendment5Active(db);
  const assignment = await activeAssignment(db);
  const uniform = penaltyUniformActive(assignment, a5.active) ? "penalty-pink" : "standard-black";

  const checklistRows = await db.sql`
    select
      (select weight_lb from public_record.weight_records where project_date = ${today}::date limit 1) as weight,
      (select photo_front_url is not null and photo_left_url is not null
              and photo_rear_url is not null and photo_right_url is not null
         from public_record.daily_media where project_date = ${today}::date) as photos,
      (select inspection_video_url is not null
         from public_record.daily_media where project_date = ${today}::date) as video
  `;
  const checklist = checklistRows[0] || {};

  const enforcementEnabled = a5.active && assignment != null;
  return json({
    ok: true,
    server_time: now.toISOString(),
    project_date: today,
    project_day: projectDay(today),
    uniform,
    amendment5: a5,
    modes: {
      "daily-inspection": true,
      "weigh-in": true,
      "milestone-weigh-in": true,
      "meal-photo": true,
      "violation-portrait": enforcementEnabled,
      "violation-resolution": enforcementEnabled,
      "corrective-session": true,
      "location-check-in": true,
    },
    active_consequence: assignment
      ? {
          violation_number: assignment.violation_number,
          project_date: assignment.project_date,
          failed_requirement: assignment.failed_requirement,
          level: assignment.approved_level,
          corner_time_minutes: assignment.corner_time_minutes,
          penalty_uniform_required: assignment.penalty_uniform_required,
          completion_deadline: assignment.completion_deadline,
          private_corrective_required: assignment.private_corrective_required,
        }
      : null,
    daily_checklist: {
      weight: checklist.weight != null,
      photos: checklist.photos === true,
      video: checklist.video === true,
      deadline_local: "22:00 America/New_York",
    },
  });
}

export default async (request: Request, _context: Context) => {
  if (!packetAuthorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
  const path = new URL(request.url).pathname;
  try {
    if (path.endsWith("/context") && request.method === "GET") return await context(request);
    if (path.endsWith("/session") && request.method === "POST") return await issueSession(request);
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  } catch (error) {
    console.error("recording-session error", error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

export const config: Config = {
  path: ["/api/recording/session", "/api/recording/context"],
};
