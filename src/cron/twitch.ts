/* Evening Supervision poller (contract §6; README §2.6). Every 5 minutes from
   17:45 to 22:15 ET on a required night, it samples Twitch Helix:
   - the first live sample records start_at and IN PROGRESS;
   - the first offline sample after live (or a live sample at/after 22:00)
     records end_at and SUBMITTED · awaiting AP verification.
   It never writes COMPLETED, MISSED or EXCEPTION: only the AP rules (§6).
   Broadcast availability alone does not verify attendance. */
import { appendEvent } from '../events';
import { buildSoon } from '../build';
import { etWallTime } from '../rules';

export const SUBMITTED = 'SUBMITTED · awaiting AP verification';

interface Sample { at: string; live: boolean; title?: string }

async function appToken(env: Env): Promise<string> {
  const cached = await env.CACHE.get('twitch:token');
  if (cached) return cached;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Twitch token: HTTP ${res.status}`);
  const body = await res.json<{ access_token: string; expires_in: number }>();
  await env.CACHE.put('twitch:token', body.access_token, { expirationTtl: Math.max(60, body.expires_in - 600) });
  return body.access_token;
}

/** Whether the channel is live right now, per Twitch Helix. */
export async function twitchLive(env: Env): Promise<{ live: boolean; title?: string }> {
  const call = async () => fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(env.TWITCH_CHANNEL)}`, {
    headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${await appToken(env)}` },
  });
  let res = await call();
  if (res.status === 401) { await env.CACHE.delete('twitch:token'); res = await call(); }
  if (!res.ok) throw new Error(`Twitch streams: HTTP ${res.status}`);
  const body = await res.json<{ data: { type: string; title: string }[] }>();
  const stream = body.data.find((s) => s.type === 'live');
  return stream ? { live: true, title: stream.title } : { live: false };
}

/** One poll for the supervision night `date`. Returns what changed, if anything. */
export async function pollSupervision(env: Env, date: string, now: Date): Promise<string> {
  const sample: Sample = { at: now.toISOString(), ...(await twitchLive(env)) };
  const row = await env.DB.prepare('SELECT status, start_at, end_at, twitch_samples FROM supervision WHERE date = ?').bind(date)
    .first<{ status: string; start_at: string | null; end_at: string | null; twitch_samples: string }>();
  const samples: Sample[] = row ? JSON.parse(row.twitch_samples || '[]') : [];
  samples.push(sample);
  const ruled = row && /^(COMPLETED|MISSED|EXCEPTION)\b/.test(row.status);
  let status = row?.status ?? 'SCHEDULED';
  let start = row?.start_at ?? null;
  let end = row?.end_at ?? null;
  let change = 'sampled';
  if (!ruled) {
    if (sample.live && !start) { start = sample.at; status = 'IN PROGRESS'; change = 'started'; }
    const sessionEnd = etWallTime(date, 22).getTime();
    if (start && !end && (!sample.live || now.getTime() >= sessionEnd)) { end = sample.at; status = SUBMITTED; change = 'submitted'; }
  }
  await env.DB.prepare(
    `INSERT INTO supervision (date, required, status, start_at, end_at, twitch_samples) VALUES (?, 1, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET status = excluded.status, start_at = excluded.start_at, end_at = excluded.end_at, twitch_samples = excluded.twitch_samples`,
  ).bind(date, status, start, end, JSON.stringify(samples)).run();
  if (change !== 'sampled') {
    await appendEvent(env.DB, { actor: 'system', action: `supervision.${change}`, subject: date, payload: { at: sample.at, title: sample.title ?? null } });
    await buildSoon(env, `supervision.${change}`);
  }
  return change;
}
