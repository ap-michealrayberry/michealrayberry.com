/* The static build, run by the Worker: read D1 → render (publish.js) → write
   R2 site/. Replaces the Pages build (publish.mjs + prepare-dist + audit).
   Triggered nightly, by the Sheets mirror when the record changes, and by the AP. */
// @ts-expect-error -- ported JS module
import { publish } from './publish.js';
import template from '../../site.template.html';
import llms from '../../llms.txt';
import { renderCard } from './card';
import { imageSize } from './image-meta';
import { DAY_ONE } from '../rules';
import { loadGate, loadSiteState } from '../state';
import { appendEvent, sha256Hex } from '../events';

export const SITE_PREFIX = 'site/';
const BUILD_LEASE_MS = 10 * 60 * 1000;

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8', xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', sha256: 'text/plain; charset=utf-8', png: 'image/png',
};
export const contentTypeFor = (key: string) => TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream';

async function digestHex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BuildResult { built: boolean; reason?: string; buildId?: string; written?: number; deleted?: number; cards?: number; files?: number }

async function acquireLease(db: D1Database, now: Date): Promise<boolean> {
  const res = await db.prepare('UPDATE locks SET until = ? WHERE name = ? AND until < ?')
    .bind(new Date(now.getTime() + BUILD_LEASE_MS).toISOString(), 'build', now.toISOString()).run();
  return res.meta.changes === 1;
}
async function releaseLease(db: D1Database): Promise<void> {
  await db.prepare('UPDATE locks SET until = ? WHERE name = ?').bind('1970-01-01T00:00:00.000Z', 'build').run();
}

/** Photo keys referenced by the record that exist in R2, with their size and digest (cached in media_meta). */
async function loadPhotos(env: Env, days: Record<string, unknown>[]): Promise<Map<string, { width: number; height: number; sha256: string; bytes: number }>> {
  const origin = env.SITE_ORIGIN.replace(/\/$/, '');
  const keys = new Set<string>();
  for (const d of days) {
    for (const col of ['photo_front', 'photo_left', 'photo_rear', 'photo_right']) {
      const url = String(d[col] ?? '');
      if (url.startsWith(`${origin}/photos/`)) keys.add(decodeURIComponent(url.slice(origin.length + 1)));
    }
  }
  const known = new Map<string, { width: number; height: number; sha256: string; bytes: number }>();
  const { results } = await env.DB.prepare('SELECT key, sha256, width, height, bytes FROM media_meta')
    .all<{ key: string; sha256: string; width: number; height: number; bytes: number }>();
  for (const r of results) if (keys.has(r.key)) known.set(r.key, r);
  for (const key of keys) {
    if (known.has(key)) continue;
    const object = await env.MEDIA.get(key);
    if (!object) continue; // not uploaded (yet): the day shows the photo as missing
    const bytes = new Uint8Array(await object.arrayBuffer());
    const size = imageSize(bytes);
    if (!size) { console.warn(JSON.stringify({ message: 'unreadable photo', key })); continue; }
    const meta = { ...size, sha256: await digestHex(bytes), bytes: bytes.length };
    await env.DB.prepare('INSERT OR IGNORE INTO media_meta (key, sha256, width, height, bytes, content_type) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(key, meta.sha256, meta.width, meta.height, meta.bytes, object.httpMetadata?.contentType ?? 'image/jpeg').run();
    known.set(key, meta);
  }
  return known;
}

async function loadInput(env: Env, now: Date) {
  const db = env.DB;
  const siteState = await loadSiteState(db);
  const gate = await loadGate(db, now, siteState);
  const [days, violations, correctives, attestations, confirmations, supervision, updates] = await Promise.all([
    db.prepare('SELECT * FROM days ORDER BY date').all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM violations WHERE status IN ('open', 'submitted', 'resolved') AND public_id IS NOT NULL ORDER BY date, id").all(),
    db.prepare('SELECT * FROM correctives ORDER BY assigned_at').all<{ violation_id: number }>(),
    db.prepare('SELECT * FROM attestations ORDER BY logged_at').all(),
    db.prepare('SELECT * FROM confirmations ORDER BY date').all(),
    db.prepare('SELECT * FROM supervision ORDER BY date').all(),
    db.prepare('SELECT * FROM updates ORDER BY date, id').all(),
  ]);
  // The latest assignment per violation (a later assignment supersedes an earlier one).
  const byViolation = new Map(correctives.results.map((c) => [c.violation_id, c]));
  return {
    gate,
    data: {
      siteState,
      days: days.results,
      violations: violations.results,
      correctives: byViolation,
      attestations: attestations.results,
      confirmations: confirmations.results,
      supervision: supervision.results,
      updates: updates.results,
    },
  };
}

/** Renders the whole site into memory. Exported for tests and the compare script. */
export async function renderSite(env: Env, now: Date) {
  const { gate, data } = await loadInput(env, now);
  const photos = await loadPhotos(env, data.days);
  const input = {
    env: {
      SITE_ORIGIN: env.SITE_ORIGIN, TWITCH_CHANNEL: env.TWITCH_CHANNEL,
      IMAGE_TRANSFORMS: env.IMAGE_TRANSFORMS, PUBLIC_SUPERVISION_URLS_ENABLED: env.PUBLIC_SUPERVISION_URLS_ENABLED,
    },
    now, dayOne: DAY_ONE, gate, data, photos, template, llms, changedUrls: [] as string[],
  };
  const { files, cards } = await publish(input) as {
    files: Map<string, string | Uint8Array>;
    cards: Map<string, { svg: string; photo: string | null }>;
  };
  return { files, cards, gate };
}

/** Builds the site and swaps it into R2. Returns built: false if another build holds the lease. */
export async function runBuild(env: Env, reason: string, now = new Date()): Promise<BuildResult> {
  if (!(await acquireLease(env.DB, now))) return { built: false, reason: 'another build is running' };
  try {
    const { files, cards } = await renderSite(env, now);

    // What is in R2 now, with the digest each object was written with.
    const existing = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = await env.MEDIA.list({ prefix: SITE_PREFIX, cursor, include: ['customMetadata'] });
      for (const o of page.objects) existing.set(o.key, o.customMetadata?.sha256 ?? '');
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const keep = new Set<string>();
    let written = 0;
    for (const [path, body] of files) {
      const key = SITE_PREFIX + path;
      keep.add(key);
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const digest = await digestHex(bytes);
      if (existing.get(key) === digest) continue;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: contentTypeFor(key) }, customMetadata: { sha256: digest } });
      written++;
    }

    // Cards re-render only when their SVG (or photo) changes; PNG rendering is the expensive part.
    let rendered = 0;
    for (const [path, card] of cards) {
      const key = SITE_PREFIX + path;
      keep.add(key);
      const digest = await sha256Hex(`${card.photo ?? ''}\n${card.svg}`);
      if (existing.get(key) === digest) continue;
      let photo: { bytes: Uint8Array; type: string } | null = null;
      if (card.photo) {
        const object = await env.MEDIA.get(card.photo);
        if (object) photo = { bytes: new Uint8Array(await object.arrayBuffer()), type: object.httpMetadata?.contentType ?? 'image/jpeg' };
      }
      await env.MEDIA.put(key, await renderCard(card.svg, photo), { httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256: digest } });
      rendered++;
    }

    // Anything a previous build published that this one did not is removed.
    const stale = [...existing.keys()].filter((k) => !keep.has(k));
    for (let i = 0; i < stale.length; i += 1000) await env.MEDIA.delete(stale.slice(i, i + 1000));

    const buildId = now.toISOString();
    await env.CACHE.put('site:build', buildId);
    await appendEvent(env.DB, {
      actor: 'system', action: 'site.build', subject: null,
      payload: { reason, buildId, files: files.size, written, cards: rendered, deleted: stale.length },
    });
    return { built: true, buildId, files: files.size, written, cards: rendered, deleted: stale.length };
  } finally {
    await releaseLease(env.DB);
  }
}
