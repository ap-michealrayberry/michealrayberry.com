/* Scale weight from the Fitbit Web API (README decision; contract §4: the
   weight is the dated scale-synced entry, never a typed number).
   Micheal authorises once at /mrb/fitbit/connect (OAuth 2.0 + PKCE); the
   tokens live in KV and the refresh token is rotated on every refresh.
   Only readings from the sources in FITBIT_SCALE_SOURCES count; everything
   else (e.g. a manual entry) is logged for the AP and ignored. */
import { appendEvent } from '../events';
import { buildSoon } from '../build';
import { DAY_ONE, etDate } from '../rules';

const AUTHORIZE = 'https://www.fitbit.com/oauth2/authorize';
const TOKEN = 'https://api.fitbit.com/oauth2/token';
interface Tokens { access_token: string; refresh_token: string; expires_at: number; user_id: string }

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const basic = (env: Env) => `Basic ${btoa(`${env.FITBIT_CLIENT_ID}:${env.FITBIT_CLIENT_SECRET}`)}`;
const callbackUrl = (env: Env) => `${env.SITE_ORIGIN}/mrb/fitbit/callback`;

/** GET /mrb/fitbit/connect: starts authorisation (state and PKCE verifier kept 10 minutes). */
export async function connect(env: Env): Promise<Response> {
  if (!env.FITBIT_CLIENT_ID) return new Response('Fitbit is not configured.', { status: 503 });
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await env.CACHE.put(`fitbit:state:${state}`, verifier, { expirationTtl: 600 });
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: env.FITBIT_CLIENT_ID, redirect_uri: callbackUrl(env), scope: 'weight',
    code_challenge: challenge, code_challenge_method: 'S256', state,
  }).toString();
  return Response.redirect(url.toString(), 302);
}

/** GET /mrb/fitbit/callback: exchanges the code and stores the tokens. */
export async function callback(env: Env, request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const state = q.get('state') ?? '';
  const verifier = state ? await env.CACHE.get(`fitbit:state:${state}`) : null;
  if (!verifier || !q.get('code')) return new Response('This Fitbit authorisation link has expired. Start again from /mrb/.', { status: 400 });
  await env.CACHE.delete(`fitbit:state:${state}`);
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { Authorization: basic(env), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: callbackUrl(env), code_verifier: verifier, client_id: env.FITBIT_CLIENT_ID }),
  });
  if (!res.ok) return new Response(`Fitbit refused the authorisation (${res.status}).`, { status: 502 });
  const t = await res.json<{ access_token: string; refresh_token: string; expires_in: number; user_id: string }>();
  await env.CACHE.put('fitbit:tokens', JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, user_id: t.user_id } satisfies Tokens));
  await appendEvent(env.DB, { actor: 'system', action: 'fitbit.connected', subject: t.user_id, payload: {} });
  return Response.redirect(`${env.SITE_ORIGIN}/mrb/?fitbit=connected`, 302);
}

async function accessToken(env: Env): Promise<string | null> {
  const raw = await env.CACHE.get('fitbit:tokens');
  if (!raw) return null;
  const t = JSON.parse(raw) as Tokens;
  if (Date.now() < t.expires_at - 60_000) return t.access_token;
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { Authorization: basic(env), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  if (!res.ok) throw new Error(`Fitbit refresh: HTTP ${res.status} — Micheal must reconnect at /mrb/`);
  const n = await res.json<{ access_token: string; refresh_token: string; expires_in: number; user_id: string }>();
  await env.CACHE.put('fitbit:tokens', JSON.stringify({ access_token: n.access_token, refresh_token: n.refresh_token, expires_at: Date.now() + n.expires_in * 1000, user_id: n.user_id } satisfies Tokens));
  return n.access_token;
}

export interface WeightLog { logId: number; date: string; time?: string; weight: number; source?: string }

/** Pure: the official daily weight for each date (the latest accepted scale reading). */
export function dailyWeights(logs: WeightLog[], sources: string[]): { accepted: Map<string, WeightLog>; rejected: WeightLog[] } {
  const accepted = new Map<string, WeightLog>();
  const rejected: WeightLog[] = [];
  for (const log of [...logs].sort((a, b) => `${a.date}T${a.time ?? ''}`.localeCompare(`${b.date}T${b.time ?? ''}`))) {
    if (!sources.includes(String(log.source ?? ''))) { rejected.push(log); continue; }
    accepted.set(log.date, log);
  }
  return { accepted, rejected };
}

/** Hourly: the last seven days of weight logs into weight_readings, health and days. */
export async function syncWeights(env: Env, now = new Date()): Promise<string> {
  const token = await accessToken(env);
  if (!token) return 'not connected';
  const today = etDate(now);
  const res = await fetch(`https://api.fitbit.com/1/user/-/body/log/weight/date/${today}/1w.json`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'en_US' }, // en_US: pounds
  });
  if (!res.ok) throw new Error(`Fitbit weight: HTTP ${res.status}`);
  const { weight } = await res.json<{ weight: WeightLog[] }>();
  const sources = env.FITBIT_SCALE_SOURCES.split(',').map((s) => s.trim()).filter(Boolean);
  const { accepted, rejected } = dailyWeights(weight.filter((w) => w.date >= DAY_ONE), sources);

  const statements = [];
  for (const w of weight) {
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO weight_readings (log_id, date, time, weight_lb, source) VALUES (?, ?, ?, ?, ?)')
      .bind(String(w.logId), w.date, w.time ?? null, Math.round(w.weight * 10) / 10, String(w.source ?? '')));
  }
  let changed = 0;
  for (const [date, w] of accepted) {
    const lb = Math.round(w.weight * 10) / 10;
    const current = await env.DB.prepare('SELECT weight_lb FROM days WHERE date = ?').bind(date).first<number | null>('weight_lb');
    if (current === lb) continue;
    changed++;
    statements.push(env.DB.prepare(
      "INSERT INTO days (date, weight_lb, note) VALUES (?, ?, 'scale-synced (Fitbit)') ON CONFLICT(date) DO UPDATE SET weight_lb = excluded.weight_lb, note = 'scale-synced (Fitbit)'",
    ).bind(date, lb));
    statements.push(env.DB.prepare(
      'INSERT INTO health (date, weight_lb, synced_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET weight_lb = excluded.weight_lb, synced_at = excluded.synced_at',
    ).bind(date, lb, now.toISOString()));
  }
  if (statements.length) await env.DB.batch(statements);
  if (rejected.length) {
    await appendEvent(env.DB, { actor: 'system', action: 'fitbit.ignored', subject: null, payload: { readings: rejected.map((r) => ({ date: r.date, time: r.time, source: r.source })) } });
  }
  if (changed) {
    await appendEvent(env.DB, { actor: 'system', action: 'fitbit.synced', subject: null, payload: { dates: [...accepted.keys()] } });
    await buildSoon(env, 'fitbit');
  }
  return `${weight.length} readings, ${changed} dates updated, ${rejected.length} ignored`;
}
