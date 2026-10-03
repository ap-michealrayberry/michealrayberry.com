import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { appendEvent, canonicalJson, GENESIS, verifyChain } from '../../src/events';

describe('events audit log', () => {
  it('canonical JSON sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it('chains each event to the previous one', async () => {
    const first = await appendEvent(env.DB, { actor: 'system', action: 'test.one', subject: null, payload: { n: 1 } });
    const second = await appendEvent(env.DB, { actor: 'ap:ap@michealrayberry.com', action: 'test.two', subject: 'V-1', payload: { n: 2 } });
    const rows = await env.DB.prepare('SELECT prev_hash, hash FROM events ORDER BY id').all<{ prev_hash: string; hash: string }>();
    expect(rows.results[0].prev_hash).toBe(GENESIS);
    expect(rows.results.at(-2)?.hash).toBe(first);
    expect(rows.results.at(-1)).toEqual({ prev_hash: first, hash: second });
    expect(await verifyChain(env.DB)).toBeNull();
  });

  it('refuses updates and deletes at the database', async () => {
    await appendEvent(env.DB, { actor: 'system', action: 'test', subject: null, payload: {} });
    await expect(env.DB.prepare("UPDATE events SET action = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare('DELETE FROM events').run()).rejects.toThrow(/append-only/);
  });

  it('cannot fork the chain: a second row on the same tip is refused', async () => {
    const tip = await appendEvent(env.DB, { actor: 'system', action: 'test', subject: null, payload: {} });
    await expect(env.DB.prepare(
      "INSERT INTO events (at, actor, action, payload, prev_hash, hash) VALUES ('t', 'system', 'fork', '{}', ?, 'f')",
    ).bind(await env.DB.prepare('SELECT prev_hash FROM events WHERE hash = ?').bind(tip).first('prev_hash')).run()).rejects.toThrow(/UNIQUE/);
  });

  it('runs concurrent appends without forking', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => appendEvent(env.DB, { actor: 'system', action: 'race', subject: null, payload: { i } })));
    expect(await verifyChain(env.DB)).toBeNull();
  });
});
