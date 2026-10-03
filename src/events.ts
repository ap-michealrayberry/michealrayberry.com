/* Append-only audit log. Each row's hash covers the previous hash and the
   canonical row, so any later edit or removal breaks the chain. Shared by the
   Worker and scripts/import-sheets.mjs (Node 24 strips the types). */

export const GENESIS = '0'.repeat(64);

export interface EventRow {
  at: string;
  actor: string; // system | mrb:<email> | ap:<email>
  action: string;
  subject: string | null;
  payload: unknown;
}

/** JSON with object keys sorted at every level, so the hash is stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function eventHash(prevHash: string, row: EventRow): Promise<string> {
  const { at, actor, action, subject, payload } = row;
  return sha256Hex(`${prevHash}\n${canonicalJson({ at, actor, action, subject, payload })}`);
}

/** Appends one event. prev_hash is UNIQUE, so a concurrent writer that read the same tip fails and retries. */
export async function appendEvent(db: D1Database, row: Omit<EventRow, 'at'> & { at?: string }): Promise<string> {
  const full: EventRow = { ...row, at: row.at ?? new Date().toISOString() };
  for (let attempt = 0; attempt < 5; attempt++) {
    const tip = await db.prepare('SELECT hash FROM events ORDER BY id DESC LIMIT 1').first<{ hash: string }>();
    const prevHash = tip?.hash ?? GENESIS;
    const hash = await eventHash(prevHash, full);
    try {
      await db.prepare(
        'INSERT INTO events (at, actor, action, subject, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(full.at, full.actor, full.action, full.subject, canonicalJson(full.payload), prevHash, hash).run();
      return hash;
    } catch (error) {
      if (!/UNIQUE constraint failed: events\.prev_hash/.test(String(error))) throw error;
    }
  }
  throw new Error('events: could not append after 5 attempts');
}

/** Recomputes the chain; returns the id of the first broken row, or null when intact. */
export async function verifyChain(db: D1Database): Promise<number | null> {
  const { results } = await db.prepare(
    'SELECT id, at, actor, action, subject, payload, prev_hash, hash FROM events ORDER BY id',
  ).all<{ id: number; at: string; actor: string; action: string; subject: string | null; payload: string; prev_hash: string; hash: string }>();
  let prev = GENESIS;
  for (const r of results) {
    const expected = await eventHash(prev, { at: r.at, actor: r.actor, action: r.action, subject: r.subject, payload: JSON.parse(r.payload) });
    if (r.prev_hash !== prev || r.hash !== expected) return r.id;
    prev = r.hash;
  }
  return null;
}
