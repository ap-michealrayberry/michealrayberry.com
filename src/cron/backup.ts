/* Nightly SQL dump of the record to R2 backups/YYYY-MM-DD.sql (README §2.2).
   D1 Time Travel covers 30 days; these dumps outlive it. backups/ is never
   served by the site (src/site.ts serves only site/ and photos/). */
const sqlValue = (v: unknown) => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`);

export async function dumpDatabase(db: D1Database): Promise<string> {
  const { results: objects } = await db.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY type = 'table' DESC, name",
  ).all<{ type: string; name: string; sql: string }>();
  const lines = ['PRAGMA foreign_keys = OFF;'];
  for (const o of objects) lines.push(`${o.sql};`);
  for (const t of objects.filter((o) => o.type === 'table')) {
    const { results } = await db.prepare(`SELECT * FROM "${t.name}"`).all<Record<string, unknown>>();
    for (const row of results) {
      const cols = Object.keys(row);
      lines.push(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => sqlValue(row[c])).join(', ')});`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function backup(env: Env, date: string): Promise<string> {
  const sql = await dumpDatabase(env.DB);
  await env.MEDIA.put(`backups/${date}.sql`, sql, { httpMetadata: { contentType: 'application/sql' } });
  return `${sql.length} bytes`;
}
