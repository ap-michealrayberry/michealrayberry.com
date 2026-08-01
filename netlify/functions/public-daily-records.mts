import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

function matchesEtag(headerValue: string | null, etag: string) {
  if (!headerValue) return false;
  return headerValue.split(",").map((value) => value.trim()).some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`
      select project_day, project_date::text as date, weight_lb::text as weight_lb, note,
             photo_front_url, photo_left_url, photo_rear_url, photo_right_url,
             inspection_video_url, photo_count, video_count, media_complete
      from public_record.daily_public_records
      where weight_lb is not null
      order by project_date
    `;

    const records = rows.map((row) => ({
      project_day: Number(row.project_day),
      date: String(row.date),
      weight_lb: Number(row.weight_lb),
      note: row.note == null ? null : String(row.note),
      media: {
        photo_front: row.photo_front_url == null ? null : String(row.photo_front_url),
        photo_left: row.photo_left_url == null ? null : String(row.photo_left_url),
        photo_rear: row.photo_rear_url == null ? null : String(row.photo_rear_url),
        photo_right: row.photo_right_url == null ? null : String(row.photo_right_url),
        inspection_video: row.inspection_video_url == null ? null : String(row.inspection_video_url),
      },
      completeness: {
        photo_count: Number(row.photo_count ?? 0),
        video_count: Number(row.video_count ?? 0),
        media_complete: Boolean(row.media_complete),
        missing_components: [
          row.photo_front_url == null ? "photo_front" : null,
          row.photo_left_url == null ? "photo_left" : null,
          row.photo_rear_url == null ? "photo_rear" : null,
          row.photo_right_url == null ? "photo_right" : null,
          row.inspection_video_url == null ? "inspection_video" : null,
        ].filter(Boolean),
      },
    }));

    const stablePayload = {
      schema_version: "1.0",
      status: "ok",
      timezone: "America/New_York",
      summary: {
        record_count: records.length,
        complete_media_days: records.filter((record) => record.completeness.media_complete).length,
        incomplete_media_days: records.filter((record) => !record.completeness.media_complete).length,
        total_public_media_items: records.reduce((sum, record) => sum + record.completeness.photo_count + record.completeness.video_count, 0),
      },
      records,
    };
    const etag = `"${createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex")}"`;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    const body = JSON.stringify({ ...stablePayload, generated_at: new Date().toISOString() });
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  } catch (error) {
    console.error("public-daily-records query failed", error);
    const body = JSON.stringify({ schema_version: "1.0", status: "unavailable", error: "daily_records_unavailable" });
    return new Response(request.method === "HEAD" ? null : body, {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};

export const config: Config = { path: "/api/public/daily-records" };
