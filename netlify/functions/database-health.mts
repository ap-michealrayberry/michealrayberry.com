import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

const REQUIRED_RELATIONS = [
  ["public_record", "daily_packets"],
  ["public_record", "violations"],
  ["public_record", "consequences"],
  ["audit", "events"],
] as const;

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`
      select table_schema, table_name
      from information_schema.tables
      where (table_schema, table_name) in (
        ('public_record', 'daily_packets'),
        ('public_record', 'violations'),
        ('public_record', 'consequences'),
        ('audit', 'events')
      )
    `;

    const found = new Set(
      rows.map((row) => `${String(row.table_schema)}.${String(row.table_name)}`),
    );

    const checks = Object.fromEntries(
      REQUIRED_RELATIONS.map(([schema, table]) => {
        const name = `${schema}.${table}`;
        return [name, found.has(name)];
      }),
    );

    const healthy = Object.values(checks).every(Boolean);
    const body = JSON.stringify({
      status: healthy ? "ok" : "incomplete",
      database: "reachable",
      checks,
    });

    return new Response(request.method === "HEAD" ? null : body, {
      status: healthy ? 200 : 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const body = JSON.stringify({
      status: "unavailable",
      database: "unreachable",
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

export const config: Config = {
  path: "/.well-known/database-health",
};
