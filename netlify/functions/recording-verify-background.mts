import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import {
  LEVEL_MINUTES,
  finalPrefix,
  json,
  packetAuthorized,
  partKey,
  storeFor,
} from "../lib/recording.mts";

// Automated verification pipeline (spec §4). Hard gates first; AI review
// second. An AI/API failure falls back to AP review — never a silent pass.
// Every result is logged permanently with model and prompt version. A failed
// technical check never raises a consequence level or creates a violation.

const PROMPT_VERSION = "ra-verify-1";
const VERIFY_MODEL = () => Netlify.env.get("RA_VERIFY_MODEL") || "claude-opus-5";
const MAX_REVIEW_FRAMES = 16;

const AI_REVIEWED = new Set([
  "inspection-video",
  "acknowledgment-video",
  "corner-time-video",
  "milestone-video",
  "photo-front",
  "photo-left",
  "photo-rear",
  "photo-right",
  "scale-photo",
  "meal-photo",
  "violation-portrait",
]);
const VIDEO_KINDS = new Set(["inspection-video", "acknowledgment-video", "corner-time-video", "milestone-video"]);
const AUXILIARY_KINDS = new Set(["frame-strip"]);

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "code_legible", "code_matches", "defects", "summary"],
  properties: {
    pass: { type: "boolean" },
    code_legible: { type: "boolean" },
    code_matches: { type: "boolean" },
    uniform_compliant: { type: ["boolean", "null"] },
    pose_and_angles_present: { type: ["boolean", "null"] },
    framing_compliant: { type: ["boolean", "null"] },
    face_visible: { type: ["boolean", "null"] },
    scale_reading: { type: ["string", "null"] },
    food_present: { type: ["boolean", "null"] },
    defects: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
} as const;

async function logEvent(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  componentId: string | null,
  phase: string,
  outcome: string,
  defects: string[],
  extra: { model?: string; evidence?: unknown; public_summary?: string } = {},
) {
  await db.sql`
    insert into private_record.capture_verification_events
      (session_id, component_id, phase, outcome, defects, model, prompt_version, evidence, public_summary)
    values
      (${sessionId}::uuid, ${componentId}::uuid, ${phase}, ${outcome},
       ${JSON.stringify(defects)}::jsonb, ${extra.model ?? null},
       ${phase === "ai-review" ? PROMPT_VERSION : null},
       ${JSON.stringify(extra.evidence ?? null)}::jsonb, ${extra.public_summary ?? null})
  `;
}

async function streamHash(scope: string, sessionId: string, kind: string, totalParts: number) {
  const store = storeFor(scope);
  const hash = createHash("sha256");
  let bytes = 0;
  const chunks: ArrayBuffer[] = [];
  const keepBytes = kind === "frame-strip" || !VIDEO_KINDS.has(kind); // photos + strips are small enough to keep
  for (let part = 1; part <= totalParts; part++) {
    const buf = await store.get(partKey(sessionId, kind, part), { type: "arrayBuffer" });
    if (!buf) return null;
    hash.update(Buffer.from(buf));
    bytes += buf.byteLength;
    if (keepBytes) chunks.push(buf);
  }
  return { sha256: hash.digest("hex"), bytes, chunks: keepBytes ? chunks : null };
}

function concat(chunks: ArrayBuffer[]) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = Buffer.alloc(total);
  let offset = 0;
  for (const c of chunks) {
    Buffer.from(c).copy(out, offset);
    offset += c.byteLength;
  }
  return out;
}

// The frame strip is a JSON file the client writes at capture time:
// { frames: [{ t_seconds, jpeg_b64 }] } — one stamped frame every ~15s,
// composited from the same canvas the video is recorded from.
async function loadReviewImages(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  kind: string,
  selfBytes: Buffer | null,
) {
  if (!VIDEO_KINDS.has(kind)) {
    return selfBytes ? [selfBytes.toString("base64")] : [];
  }
  const rows = await db.sql`
    select storage_scope, storage_key from private_record.capture_components
    where session_id = ${sessionId}::uuid and component_kind = 'frame-strip'
      and storage_key is not null
  `;
  if (!rows.length) return [];
  const store = storeFor(String(rows[0].storage_scope));
  const { blobs } = await store.list({ prefix: finalPrefix(sessionId, "frame-strip") });
  const parts: ArrayBuffer[] = [];
  for (const b of blobs.sort((x, y) => x.key.localeCompare(y.key))) {
    const buf = await store.get(b.key, { type: "arrayBuffer" });
    if (buf) parts.push(buf);
  }
  if (!parts.length) return [];
  try {
    const manifest = JSON.parse(concat(parts).toString("utf8"));
    const frames: { t_seconds: number; jpeg_b64: string }[] = manifest.frames || [];
    if (frames.length <= MAX_REVIEW_FRAMES) return frames.map((f) => f.jpeg_b64);
    const step = frames.length / MAX_REVIEW_FRAMES;
    const sampled: string[] = [];
    for (let i = 0; i < MAX_REVIEW_FRAMES; i++) sampled.push(frames[Math.floor(i * step)].jpeg_b64);
    return sampled;
  } catch {
    return [];
  }
}

function reviewInstructions(kind: string, requirements: any, code: string, expectedWeight: number | null) {
  const uniform = requirements?.uniform;
  const uniformLine =
    uniform === "penalty-pink"
      ? "Required uniform: plain pink unitard with plain black shoes, fully opaque, no name tag."
      : uniform === "standard-black"
        ? "Required uniform: the standard plain black unitard."
        : "No uniform requirement applies to this capture.";
  const lines = [
    `You are the automated verification layer for a contractual capture instrument.`,
    `Component under review: ${kind}.`,
    `The one-time challenge code for this session is "${code}". It must be burned into the frame overlay and legible.`,
    uniformLine,
  ];
  switch (kind) {
    case "inspection-video":
      lines.push(
        "Check: subject standing with hands behind head; the sampled frames should show front, left, rear and right views across the take; full body in frame; face visible in at least one frame.",
      );
      break;
    case "acknowledgment-video":
      lines.push("Check: subject facing camera delivering a spoken statement; face visible; framing head-and-torso or closer.");
      break;
    case "corner-time-video":
      lines.push(
        "Check: subject standing facing a plain corner; full body AND the corner continuously visible; the burned-in elapsed clock should advance monotonically across the sampled frames (frames are in time order).",
      );
      break;
    case "scale-photo":
      lines.push(
        `Check: a scale readout is clearly legible. Report the reading in scale_reading.` +
          (expectedWeight != null ? ` The logged weight for this date is ${expectedWeight} lb; flag a defect if the readout clearly disagrees.` : ""),
      );
      break;
    case "meal-photo":
      lines.push("Check: the photo shows a plated meal as served. Set food_present accordingly.");
      break;
    case "violation-portrait":
      lines.push("Check: standardized portrait, subject facing camera in inspection stance, head near top of frame, fully clothed, factual presentation.");
      break;
    default:
      lines.push("Check: overlay legible, subject present, framing reasonable for the component type.");
  }
  lines.push(
    "Judge only what is visible. If the code is illegible or absent, that is a failing defect.",
    "List every defect concretely (these are returned to the participant for a corrected retake).",
    "pass = true only when every applicable check passes.",
  );
  return lines.join("\n");
}

async function aiReview(
  kind: string,
  requirements: any,
  code: string,
  images: string[],
  expectedWeight: number | null,
) {
  const client = new Anthropic({ apiKey: Netlify.env.get("ANTHROPIC_API_KEY") || "" });
  const content: any[] = images.map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  }));
  content.push({ type: "text", text: reviewInstructions(kind, requirements, code, expectedWeight) });

  const response = await client.messages.create({
    model: VERIFY_MODEL(),
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
    messages: [{ role: "user", content }],
  } as any);

  if ((response as any).stop_reason === "refusal") throw new Error("model_refusal");
  const text = (response as any).content?.find((b: any) => b.type === "text")?.text;
  if (!text) throw new Error("empty_model_response");
  return { verdict: JSON.parse(text), model: (response as any).model as string };
}

// Publication routing is server-side by mode; the client never chooses the
// destination. Media slots are first-write-wins, matching the historical
// record's invariant.
async function fileComponent(
  db: ReturnType<typeof getDatabase>,
  session: Record<string, unknown>,
  kind: string,
  publicUrl: string | null,
  requirements: any,
  summary: string,
) {
  const projectDate = String(session.project_date);
  const mode = String(session.mode);

  if (mode === "daily-inspection" && publicUrl) {
    const column =
      kind === "inspection-video"
        ? "inspection_video_url"
        : kind === "photo-front"
          ? "photo_front_url"
          : kind === "photo-left"
            ? "photo_left_url"
            : kind === "photo-rear"
              ? "photo_rear_url"
              : kind === "photo-right"
                ? "photo_right_url"
                : null;
    if (column) {
      const col = db.sql.identifier({ column });
      await db.sql`
        insert into public_record.daily_media (project_date, source_system, source_record_id)
        values (${projectDate}::date, 'recording-assistant', ${String(session.session_id)})
        on conflict (project_date) do nothing
      `;
      await db.sql`
        update public_record.daily_media
        set ${col} = ${publicUrl}
        where project_date = ${projectDate}::date and ${col} is null
      `;
    }
  }

  const assignmentId = session.assignment_id ? String(session.assignment_id) : null;
  if (assignmentId && publicUrl) {
    const componentType =
      kind === "acknowledgment-video"
        ? "public-acknowledgment"
        : kind === "corner-time-video"
          ? "public-corner-time"
          : kind === "violation-portrait"
            ? "violation-portrait"
            : null;
    if (componentType) {
      const duration = kind === "corner-time-video" ? Number(requirements?.corner_time_minutes) || null : null;
      await db.sql`
        insert into public_record.consequence_components
          (assignment_id, component_type, required, public_component, status,
           required_duration_minutes, performed_at, verified_at, public_url, verification_summary)
        values
          (${assignmentId}::uuid, ${componentType}, true, true, 'verified',
           ${duration}, now(), now(), ${publicUrl}, ${summary})
        on conflict (assignment_id, component_type) do update set
          status = 'verified',
          performed_at = coalesce(public_record.consequence_components.performed_at, now()),
          verified_at = now(),
          public_url = coalesce(public_record.consequence_components.public_url, excluded.public_url),
          verification_summary = excluded.verification_summary
        where public_record.consequence_components.status <> 'verified'
      `;
    }
  }
}

export default async (req: Request, _context: Context) => {
  if (!packetAuthorized(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const { session_id, component_kind, total_parts } = await req.json();
  const db = getDatabase();

  const sessions = await db.sql`
    select session_id::text, mode, project_date::text, assignment_id::text, violation_id::text,
           challenge_code, code_issued_at, code_expires_at, code_first_used_at, requirements, status, safety_stop
    from private_record.capture_sessions where session_id = ${String(session_id)}::uuid
  `;
  if (!sessions.length) return;
  const session = sessions[0] as Record<string, unknown>;
  const requirements = typeof session.requirements === "string" ? JSON.parse(String(session.requirements)) : session.requirements;

  const comps = await db.sql`
    select component_id::text, component_kind, storage_scope, status,
           attested_sha256, attested_bytes, attested_duration_seconds
    from private_record.capture_components
    where session_id = ${String(session_id)}::uuid and component_kind = ${String(component_kind)}
  `;
  if (!comps.length) return;
  const component = comps[0] as Record<string, unknown>;
  const componentId = String(component.component_id);
  const kind = String(component.component_kind);
  const sessionId = String(session.session_id);

  const fail = async (defects: string[], phase = "hard-gate") => {
    await logEvent(db, sessionId, componentId, phase, "fail", defects, {
      public_summary: `Returned for correction: ${defects.join("; ")}`,
    });
    await db.sql`
      update private_record.capture_components
      set status = 'returned', updated_at = now() where component_id = ${componentId}::uuid
    `;
    await db.sql`
      update private_record.capture_sessions
      set status = 'returned', updated_at = now()
      where session_id = ${sessionId}::uuid and status = 'verifying'
    `;
  };

  try {
    // ---- Hard gate 1: bytes present and hash matches the attestation ----
    const hashed = await streamHash(String(component.storage_scope), sessionId, kind, Number(total_parts));
    if (!hashed) return void (await fail(["uploaded parts are missing or unreadable"]));
    if (hashed.sha256 !== String(component.attested_sha256)) {
      await logEvent(db, sessionId, componentId, "hard-gate", "fail", ["received hash does not match attested hash"], {
        evidence: { attested: component.attested_sha256, received: hashed.sha256 },
        public_summary: "Rejected: file fingerprint mismatch.",
      });
      await db.sql`
        update private_record.capture_components
        set status = 'hash-mismatch', received_sha256 = ${hashed.sha256}, received_bytes = ${hashed.bytes}, updated_at = now()
        where component_id = ${componentId}::uuid
      `;
      return;
    }
    await db.sql`
      update private_record.capture_components
      set received_sha256 = ${hashed.sha256}, received_bytes = ${hashed.bytes}, updated_at = now()
      where component_id = ${componentId}::uuid
    `;

    // ---- Hard gate 2: challenge code was used, in time, exactly once ----
    if (!session.code_first_used_at) {
      return void (await fail(["challenge code was never activated on camera"]));
    }
    if (Date.parse(String(session.code_first_used_at)) > Date.parse(String(session.code_expires_at))) {
      return void (await fail(["challenge code expired before the first frame"]));
    }

    // ---- Hard gate 3: duration meets the requirement ----
    const duration = component.attested_duration_seconds == null ? null : Number(component.attested_duration_seconds);
    if (kind === "corner-time-video") {
      const requiredMin = Number(requirements?.corner_time_minutes) || LEVEL_MINUTES[1];
      if (duration == null || duration < requiredMin * 60 - 2) {
        return void (await fail([`corner time ran ${duration ?? 0}s; ${requiredMin} continuous minutes are required`]));
      }
    }
    if (kind === "acknowledgment-video" && (duration == null || duration < 15)) {
      return void (await fail(["acknowledgment shorter than the required 20–30 second statement window"]));
    }
    if (kind === "inspection-video" && (duration == null || duration < Number(requirements?.min_video_seconds ?? 20))) {
      return void (await fail(["inspection video shorter than the guided sequence"]));
    }
    if (kind === "corrective-session-video") {
      const requiredMin = Number(requirements?.corner_time_minutes) || 15;
      if (duration == null || duration < requiredMin * 60 - 2) {
        return void (await fail([`corrective session ran ${duration ?? 0}s; ${requiredMin} continuous minutes are required`]));
      }
    }
    await logEvent(db, sessionId, componentId, "hard-gate", "pass", [], {
      public_summary: "Hash, challenge code, and duration checks passed.",
    });

    // Safety-stopped sessions never auto-verify — they wait for the AP.
    if (session.safety_stop === true) {
      await logEvent(db, sessionId, componentId, "ai-review", "flagged-for-ap-review", [], {
        public_summary: "Safety stop — pending Accountability Partner review.",
      });
      return;
    }

    // ---- AI review (Claude), or AP routing for private/aux components ----
    let publicSummary = "Verified by hard gates.";
    if (AI_REVIEWED.has(kind)) {
      const selfBytes = hashed.chunks && !VIDEO_KINDS.has(kind) ? concat(hashed.chunks) : null;
      const images = await loadReviewImages(db, sessionId, kind, selfBytes);
      if (!images.length) {
        await logEvent(db, sessionId, componentId, "ai-review", "flagged-for-ap-review", ["no review frames available"], {
          public_summary: "Automated review unavailable — flagged for AP review.",
        });
        return;
      }
      let expectedWeight: number | null = null;
      if (kind === "scale-photo") {
        const w = await db.sql`
          select weight_lb from public_record.weight_records
          where project_date = ${String(session.project_date)}::date limit 1
        `;
        expectedWeight = w.length ? Number(w[0].weight_lb) : null;
      }
      try {
        const { verdict, model } = await aiReview(kind, requirements, String(session.challenge_code), images, expectedWeight);
        if (!verdict.pass) {
          await logEvent(db, sessionId, componentId, "ai-review", "fail", verdict.defects || ["unspecified defect"], {
            model,
            evidence: verdict,
            public_summary: `Returned for correction: ${(verdict.defects || []).join("; ")}`,
          });
          await db.sql`
            update private_record.capture_components
            set status = 'returned', updated_at = now() where component_id = ${componentId}::uuid
          `;
          return;
        }
        publicSummary = String(verdict.summary || "Automated review passed.");
        await logEvent(db, sessionId, componentId, "ai-review", "pass", [], { model, evidence: verdict, public_summary: publicSummary });
      } catch (error) {
        // AI failure falls back to AP review — never a silent pass.
        await logEvent(db, sessionId, componentId, "ai-review", "error-fallback", [String(error)], {
          model: VERIFY_MODEL(),
          public_summary: "Automated review errored — flagged for AP review.",
        });
        return;
      }
    } else if (kind === "corrective-session-video") {
      publicSummary = "Private corrective session: technical checks passed; content review is the AP's.";
      await logEvent(db, sessionId, componentId, "ap-review", "flagged-for-ap-review", [], { public_summary: publicSummary });
    }

    // ---- Verified: file and publish ----
    const scope = String(component.storage_scope);
    const publicUrl = scope === "public" ? `/media/captures/${sessionId}/${kind}` : null;
    await db.sql`
      update private_record.capture_components
      set status = 'verified', filed_at = now(), public_url = ${publicUrl}, updated_at = now()
      where component_id = ${componentId}::uuid
    `;
    await fileComponent(db, session, kind, publicUrl, requirements, publicSummary);

    const remaining = await db.sql`
      select count(*)::int as n from private_record.capture_components
      where session_id = ${sessionId}::uuid and status <> 'verified'
        and component_kind not in ('frame-strip')
    `;
    if (Number(remaining[0].n) === 0) {
      await db.sql`
        update private_record.capture_sessions
        set status = 'verified', updated_at = now() where session_id = ${sessionId}::uuid
      `;
    }
  } catch (error) {
    console.error("recording-verify error", error);
    await logEvent(db, sessionId, componentId, "hard-gate", "error-fallback", [String(error)], {
      public_summary: "Verification errored — flagged for AP review.",
    });
  }
};

// No custom path: background functions are invoked at their canonical
// /.netlify/functions/recording-verify-background endpoint by the upload
// completion handler (and by the AP console for re-runs).
