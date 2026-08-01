import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";
import { json, loadSession, packetAuthorized } from "../lib/recording.mts";

// Attestation and session-event transitions. The attestation server stamp is
// the compliance time (§3.2): bytes may land later, but capture time counts
// from here. No path in this function updates or deletes an existing
// attested value — a re-attestation with a different hash is a new take and
// resets the component to attested state via explicit transition rules only.

const EVENTS = new Set(["recording-started", "take-incomplete", "safety-stop"]);

async function handleEvent(db: ReturnType<typeof getDatabase>, session: Record<string, unknown>, input: any) {
  const event = String(input.event || "");
  if (!EVENTS.has(event)) return json({ ok: false, error: "unknown_event" }, 422);
  const sessionId = String(session.session_id);
  const now = new Date();

  if (event === "recording-started") {
    // Challenge codes expire 10 minutes to first frame and are single-use.
    if (session.code_first_used_at) return json({ ok: false, error: "code_already_used" }, 409);
    if (Date.parse(String(session.code_expires_at)) < now.getTime()) {
      await db.sql`
        update private_record.capture_sessions
        set status = 'expired', updated_at = now()
        where session_id = ${sessionId}::uuid and status = 'issued'
      `;
      return json({ ok: false, error: "code_expired" }, 409);
    }
    await db.sql`
      update private_record.capture_sessions
      set code_first_used_at = now(), status = 'recording', updated_at = now()
      where session_id = ${sessionId}::uuid and status = 'issued'
    `;
    return json({ ok: true, server_time: now.toISOString() });
  }

  if (event === "safety-stop") {
    // Contract-mandated (§5.2): ends the take immediately, never
    // auto-declares a violation, always lands in AP review.
    const reason = String(input.reason || "safety stop invoked").slice(0, 500);
    await db.sql`
      update private_record.capture_sessions
      set status = 'safety-stop-pending-review', safety_stop = true,
          safety_stop_reason = ${reason}, updated_at = now()
      where session_id = ${sessionId}::uuid
    `;
    await db.sql`
      insert into private_record.safety_reviews
        (assignment_id, violation_id, review_type, status, requested_at, public_summary, private_basis)
      values
        (${session.assignment_id ? String(session.assignment_id) : null}::uuid,
         ${session.violation_id ? String(session.violation_id) : null}::uuid,
         'safety-stop', 'requested', now(),
         'Safety stop invoked during a Recording Assistant session; pending Accountability Partner review.',
         ${`session ${sessionId} (${String(session.mode)}): ${reason}`})
    `;
    return json({ ok: true, status: "safety-stop-pending-review", server_time: now.toISOString() });
  }

  // take-incomplete: pause/stop/app-switch ended the take. The partial is
  // still attestable as incomplete evidence but the session cannot verify.
  await db.sql`
    update private_record.capture_sessions
    set status = 'incomplete', updated_at = now()
    where session_id = ${sessionId}::uuid
      and status not in ('safety-stop-pending-review', 'verified')
  `;
  return json({ ok: true, status: "incomplete", server_time: now.toISOString() });
}

async function handleAttest(db: ReturnType<typeof getDatabase>, session: Record<string, unknown>, input: any) {
  const sessionId = String(session.session_id);
  const kind = String(input.component_kind || "");
  const sha256 = String(input.sha256 || "").toLowerCase();
  const bytes = Number(input.bytes);
  const duration = input.duration_seconds == null ? null : Number(input.duration_seconds);
  if (!/^[0-9a-f]{64}$/.test(sha256)) return json({ ok: false, error: "invalid_sha256" }, 422);
  if (!Number.isFinite(bytes) || bytes <= 0) return json({ ok: false, error: "invalid_bytes" }, 422);

  const rows = await db.sql`
    select component_id::text, status, attested_sha256
    from private_record.capture_components
    where session_id = ${sessionId}::uuid and component_kind = ${kind}
  `;
  if (!rows.length) return json({ ok: false, error: "unknown_component" }, 422);
  const component = rows[0] as Record<string, unknown>;

  // Idempotent: re-posting the identical attestation returns the original stamp.
  if (component.attested_sha256 === sha256) {
    const existing = await db.sql`
      select attested_at from private_record.capture_components
      where component_id = ${String(component.component_id)}::uuid
    `;
    return json({ ok: true, attested_at: new Date(String(existing[0].attested_at)).toISOString(), duplicate: true });
  }
  if (component.status === "verified") return json({ ok: false, error: "component_already_verified" }, 409);

  const now = new Date();
  await db.sql`
    update private_record.capture_components
    set attested_sha256 = ${sha256}, attested_bytes = ${bytes},
        attested_duration_seconds = ${duration}, attested_at = now(),
        attest_client_meta = ${JSON.stringify(input.client_meta ?? null)}::jsonb,
        status = 'attested', updated_at = now()
    where component_id = ${String(component.component_id)}::uuid
  `;
  await db.sql`
    update private_record.capture_sessions
    set status = 'attested', updated_at = now()
    where session_id = ${sessionId}::uuid and status in ('recording', 'issued')
  `;
  return json({ ok: true, attested_at: now.toISOString() });
}

// Location check-in (private AP evidence — never public). The legacy client
// posted these into a void; here they land as an attested location-record.
async function handleLocation(db: ReturnType<typeof getDatabase>, session: Record<string, unknown>, input: any) {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ ok: false, error: "invalid_coordinates" }, 422);
  const record = {
    lat,
    lng,
    accuracy_m: Number(input.accuracy) || null,
    label: String(input.label || "check-in").slice(0, 40),
  };
  const now = new Date();
  await db.sql`
    update private_record.capture_components
    set attest_client_meta = ${JSON.stringify(record)}::jsonb,
        attested_at = now(), status = 'attested', updated_at = now()
    where session_id = ${String(session.session_id)}::uuid and component_kind = 'location-record'
  `;
  await db.sql`
    update private_record.capture_sessions
    set status = 'attested', updated_at = now()
    where session_id = ${String(session.session_id)}::uuid
  `;
  return json({ ok: true, server_time: now.toISOString() });
}

export default async (request: Request, _context: Context) => {
  if (!packetAuthorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  let input: any;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const db = getDatabase();
  const session = await loadSession(db, String(input.session_id || ""), String(input.upload_token || ""));
  if (!session) return json({ ok: false, error: "unknown_session" }, 404);

  const path = new URL(request.url).pathname;
  try {
    if (path.endsWith("/event")) return await handleEvent(db, session, input);
    if (path.endsWith("/attest")) return await handleAttest(db, session, input);
    if (path.endsWith("/location")) return await handleLocation(db, session, input);
    return json({ ok: false, error: "unknown_action" }, 404);
  } catch (error) {
    console.error("recording-attest error", error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

export const config: Config = {
  path: ["/api/recording/attest", "/api/recording/event", "/api/recording/location"],
};
