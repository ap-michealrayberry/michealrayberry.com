import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";
import { finalPrefix, storeFor } from "../lib/recording.mts";

// Public media gateway for verified Recording Assistant captures.
// Serves ONLY components that are (a) public-scope and (b) verified — it
// reads exclusively from the public blob store, so private-ap material
// (corrective sessions, meal photos, frame strips, location records) is
// structurally unreachable from any public URL.

const MIME_FALLBACK: Record<string, string> = {
  "inspection-video": "video/webm",
  "acknowledgment-video": "video/webm",
  "corner-time-video": "video/webm",
  "milestone-video": "video/webm",
};

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const match = /^\/media\/captures\/([0-9a-f-]{36})\/([a-z-]+)$/.exec(new URL(request.url).pathname);
  if (!match) return new Response("Not found", { status: 404 });
  const [, sessionId, kind] = match;

  const db = getDatabase();
  const rows = await db.sql`
    select storage_scope, status from private_record.capture_components c
    join private_record.capture_sessions s on s.session_id = c.session_id
    where c.session_id = ${sessionId}::uuid and c.component_kind = ${kind}
  `;
  if (!rows.length) return new Response("Not found", { status: 404 });
  const component = rows[0] as Record<string, unknown>;
  if (component.storage_scope !== "public" || component.status !== "verified") {
    return new Response("Not found", { status: 404 });
  }

  const store = storeFor("public");
  const { blobs } = await store.list({ prefix: finalPrefix(sessionId, kind) });
  const keys = blobs.map((b) => b.key).sort();
  if (!keys.length) return new Response("Not found", { status: 404 });

  const firstMeta = await store.getMetadata(keys[0]);
  const mime = String(firstMeta?.metadata?.mime || MIME_FALLBACK[kind] || "image/jpeg");

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "none" },
    });
  }

  // Sequentially stream parts. Verified captures are immutable, so long
  // cache lifetimes are safe. (Range requests are not supported yet.)
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= keys.length) {
        controller.close();
        return;
      }
      const buf = await store.get(keys[index++], { type: "arrayBuffer" });
      if (buf) controller.enqueue(new Uint8Array(buf));
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "none" },
  });
};

export const config: Config = {
  path: "/media/captures/*",
};
