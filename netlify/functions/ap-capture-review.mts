import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";
import { apAuthorized, json } from "../lib/recording.mts";

// AP review surface for the Recording Assistant (§3.5–3.6): list sessions
// needing attention (safety stops, AI fallbacks, returned components) and
// record overrides. Overrides are append-only verification events; the AP can
// pass or fail any result, and each override records decision, date, general
// reason, and resulting status.

export default async (request: Request, _context: Context) => {
  if (!apAuthorized(request)) return json({ status: "unauthorized" }, 401);
  const db = getDatabase();

  if (request.method === "GET") {
    const sessions = await db.sql`
      select s.session_id::text, s.mode, s.project_date::text, s.status as session_status,
             s.safety_stop, s.safety_stop_reason, s.challenge_code, s.created_at,
             coalesce(jsonb_agg(jsonb_build_object(
               'component_kind', c.component_kind,
               'status', c.status,
               'storage_scope', c.storage_scope,
               'attested_at', c.attested_at,
               'attested_sha256', c.attested_sha256,
               'attested_duration_seconds', c.attested_duration_seconds,
               'public_url', c.public_url
             ) order by c.component_kind) filter (where c.component_id is not null), '[]'::jsonb) as components
      from private_record.capture_sessions s
      left join private_record.capture_components c on c.session_id = s.session_id
      group by s.session_id
      order by s.created_at desc
      limit 100
    `;
    const events = await db.sql`
      select e.session_id::text, c.component_kind, e.phase, e.outcome, e.defects,
             e.model, e.prompt_version, e.public_summary, e.created_at
      from private_record.capture_verification_events e
      left join private_record.capture_components c on c.component_id = e.component_id
      order by e.created_at desc
      limit 200
    `;
    return json({ status: "ok", sessions, events });
  }

  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });

  let input: any;
  try {
    input = await request.json();
  } catch {
    return json({ status: "invalid_json" }, 400);
  }
  const sessionId = String(input.session_id || "");
  const kind = String(input.component_kind || "");
  const outcome = String(input.outcome || "");
  const reason = String(input.reason || "").trim();
  if (!sessionId || !kind || !["pass", "fail"].includes(outcome) || reason.length < 5) {
    return json({ status: "validation_failed", required: ["session_id", "component_kind", "outcome pass|fail", "reason"] }, 422);
  }

  const comps = await db.sql`
    select component_id::text, storage_scope, status from private_record.capture_components
    where session_id = ${sessionId}::uuid and component_kind = ${kind}
  `;
  if (!comps.length) return json({ status: "component_not_found" }, 404);
  const component = comps[0] as Record<string, unknown>;
  const resulting = outcome === "pass" ? "verified" : "returned";

  await db.sql`
    insert into private_record.capture_verification_events
      (session_id, component_id, phase, outcome, defects, public_summary)
    values
      (${sessionId}::uuid, ${String(component.component_id)}::uuid, 'ap-override', ${outcome},
       '[]'::jsonb, ${`AP override: ${reason} — resulting status ${resulting}.`})
  `;
  const publicUrl =
    outcome === "pass" && component.storage_scope === "public" ? `/media/captures/${sessionId}/${kind}` : null;
  await db.sql`
    update private_record.capture_components
    set status = ${resulting}, public_url = coalesce(public_url, ${publicUrl}),
        filed_at = case when ${outcome} = 'pass' then coalesce(filed_at, now()) else filed_at end,
        updated_at = now()
    where component_id = ${String(component.component_id)}::uuid
  `;
  if (outcome === "pass") {
    await db.sql`
      update private_record.capture_sessions
      set status = 'verified', updated_at = now()
      where session_id = ${sessionId}::uuid
        and not exists (
          select 1 from private_record.capture_components c
          where c.session_id = ${sessionId}::uuid
            and c.status <> 'verified' and c.component_kind <> 'frame-strip'
        )
    `;
  }
  return json({ status: "ok", resulting_status: resulting });
};

export const config: Config = {
  path: "/api/ap/capture-review",
};
