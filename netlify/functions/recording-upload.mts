import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";
import {
  UPLOAD_PART_BYTES,
  finalPrefix,
  json,
  loadSession,
  packetAuthorized,
  partKey,
  storeFor,
} from "../lib/recording.mts";

// Chunked, resumable upload. Parts land in Netlify Blobs under the session
// prefix. Upload-only semantics: an existing part is never overwritten and
// nothing can be deleted through this path. Corrective-session components go
// to the private store, which no public function routes.

async function componentFor(db: ReturnType<typeof getDatabase>, sessionId: string, kind: string) {
  const rows = await db.sql`
    select component_id::text, storage_scope, status, attested_sha256, attested_bytes
    from private_record.capture_components
    where session_id = ${sessionId}::uuid and component_kind = ${kind}
  `;
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

async function receivedParts(scope: string, sessionId: string, kind: string) {
  const store = storeFor(scope);
  const { blobs } = await store.list({ prefix: finalPrefix(sessionId, kind) });
  return blobs
    .map((b) => {
      const m = /part-(\d{4})$/.exec(b.key);
      return m ? Number(m[1]) : null;
    })
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
}

async function putPart(request: Request, db: ReturnType<typeof getDatabase>, session: Record<string, unknown>) {
  const url = new URL(request.url);
  const kind = String(url.searchParams.get("component") || "");
  const part = Number(url.searchParams.get("part"));
  const total = Number(url.searchParams.get("of"));
  if (!Number.isInteger(part) || part < 1 || !Number.isInteger(total) || total < part) {
    return json({ ok: false, error: "invalid_part_numbers" }, 422);
  }
  const sessionId = String(session.session_id);
  const component = await componentFor(db, sessionId, kind);
  if (!component) return json({ ok: false, error: "unknown_component" }, 422);
  if (!component.attested_sha256) return json({ ok: false, error: "attest_before_upload" }, 409);
  if (component.status === "verified") return json({ ok: false, error: "component_already_verified" }, 409);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > UPLOAD_PART_BYTES + 1024) {
    return json({ ok: false, error: "invalid_part_size" }, 422);
  }

  const store = storeFor(String(component.storage_scope));
  const key = partKey(sessionId, kind, part);
  const existing = await store.getMetadata(key);
  if (existing) {
    // Idempotent retry of the same part is fine; anything else is rejected —
    // uploads can add bytes, never replace them.
    return json({ ok: true, part, duplicate: true });
  }
  await store.set(key, body, {
    metadata: { session_id: sessionId, component_kind: kind, part, of: total, mime: request.headers.get("content-type") || "application/octet-stream" },
  });

  await db.sql`
    update private_record.capture_components
    set status = 'uploading', updated_at = now()
    where component_id = ${String(component.component_id)}::uuid and status in ('attested', 'uploading')
  `;
  return json({ ok: true, part });
}

async function status(request: Request, db: ReturnType<typeof getDatabase>, session: Record<string, unknown>) {
  const url = new URL(request.url);
  const kind = String(url.searchParams.get("component") || "");
  const component = await componentFor(db, String(session.session_id), kind);
  if (!component) return json({ ok: false, error: "unknown_component" }, 422);
  const parts = await receivedParts(String(component.storage_scope), String(session.session_id), kind);
  return json({ ok: true, received_parts: parts, component_status: String(component.status) });
}

async function complete(request: Request, db: ReturnType<typeof getDatabase>, session: Record<string, unknown>, input: any) {
  const kind = String(input.component_kind || "");
  const total = Number(input.total_parts);
  const sessionId = String(session.session_id);
  const component = await componentFor(db, sessionId, kind);
  if (!component) return json({ ok: false, error: "unknown_component" }, 422);
  if (!component.attested_sha256) return json({ ok: false, error: "attest_before_upload" }, 409);

  const parts = await receivedParts(String(component.storage_scope), sessionId, kind);
  const missing: number[] = [];
  for (let i = 1; i <= total; i++) if (!parts.includes(i)) missing.push(i);
  if (missing.length) return json({ ok: false, error: "missing_parts", missing }, 409);

  await db.sql`
    update private_record.capture_components
    set status = 'uploaded', uploaded_at = now(),
        storage_key = ${finalPrefix(sessionId, kind)}, updated_at = now()
    where component_id = ${String(component.component_id)}::uuid
  `;
  await db.sql`
    update private_record.capture_sessions
    set status = 'verifying', updated_at = now()
    where session_id = ${sessionId}::uuid
      and status in ('attested', 'uploading', 'uploaded', 'recording')
  `;

  // Hand off to the background verifier (hash check, hard gates, AI review).
  const verifyUrl = new URL("/.netlify/functions/recording-verify-background", request.url);
  await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-packet-key": request.headers.get("x-packet-key") || "",
    },
    body: JSON.stringify({ session_id: sessionId, component_kind: kind, total_parts: total }),
  });

  return json({ ok: true, status: "verifying" });
}

export default async (request: Request, _context: Context) => {
  if (!packetAuthorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = getDatabase();
  const url = new URL(request.url);

  try {
    if (request.method === "PUT") {
      const session = await loadSession(db, String(url.searchParams.get("session") || ""), request.headers.get("x-session-token") || "");
      if (!session) return json({ ok: false, error: "unknown_session" }, 404);
      return await putPart(request, db, session);
    }
    if (request.method === "GET") {
      const session = await loadSession(db, String(url.searchParams.get("session") || ""), request.headers.get("x-session-token") || "");
      if (!session) return json({ ok: false, error: "unknown_session" }, 404);
      return await status(request, db, session);
    }
    if (request.method === "POST" && url.pathname.endsWith("/complete")) {
      let input: any;
      try {
        input = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      const session = await loadSession(db, String(input.session_id || ""), String(input.upload_token || ""));
      if (!session) return json({ ok: false, error: "unknown_session" }, 404);
      return await complete(request, db, session, input);
    }
    return new Response(null, { status: 405, headers: { Allow: "GET, PUT, POST" } });
  } catch (error) {
    console.error("recording-upload error", error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

export const config: Config = {
  path: ["/api/recording/upload", "/api/recording/upload/complete"],
};
