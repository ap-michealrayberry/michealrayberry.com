import { Hono } from 'hono';
import { accessIdentity, type Identity } from './auth/access';
import { getMe } from './api/me';
import { runBuild } from './build';
import { mirrorSheets } from './cron/sheets-mirror';
import { formConfig, observerReport, subscribe } from './legacy';
import { serveSite } from './site';
import { etDate, etWallTime } from './rules';

type Who = Extract<Identity, { ok: true }>;
const app = new Hono<{ Bindings: Env; Variables: { who: Who } }>();

// One canonical host: www.michealrayberry.com redirects to michealrayberry.com.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === 'www.michealrayberry.com') {
    url.hostname = 'michealrayberry.com';
    return c.redirect(url.toString(), 301);
  }
  await next();
});

app.onError((error, c) => {
  console.error(JSON.stringify({ message: 'unhandled error', path: c.req.path, error: String(error?.stack || error) }));
  return c.json({ ok: false, error: 'Internal error.' }, 500);
});

// Public endpoints (no sign-in).
app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/form-config', (c) => formConfig(c.env));
app.post('/api/observer', (c) => observerReport(c.req.raw, c.env));
app.post('/observer', (c) => observerReport(c.req.raw, c.env));
app.post('/report', (c) => observerReport(c.req.raw, c.env));
app.on(['GET', 'POST'], '/api/subscribe', (c) => subscribe(c.req.raw, c.env));

// Every other /api route requires a verified Access identity.
app.use('/api/*', async (c, next) => {
  const who = await accessIdentity(c.req.raw, c.env);
  if (!who.ok) return c.json({ ok: false, error: who.error }, who.status);
  c.set('who', who);
  await next();
});

app.get('/api/me', async (c) => c.json({ ok: true, ...(await getMe(c.env.DB, c.get('who'))) }));

app.post('/api/ap/build', async (c) => {
  if (c.get('who').role !== 'ap') return c.json({ ok: false, error: 'AP only.' }, 403);
  return c.json({ ok: true, ...(await runBuild(c.env, `ap:${c.get('who').email}`)) });
});

app.all('/api/*', (c) => c.json({ ok: false, error: 'Not found.' }, 404));

// The Recording Assistant: Micheal only, through Cloudflare Access.
app.on(['GET', 'HEAD'], '/assistant/*', async (c) => {
  const who = await accessIdentity(c.req.raw, c.env);
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (!who.ok && who.status === 500) return c.text('Recording Assistant protection must be configured before use.', 503, headers);
  if (!who.ok || who.role !== 'mrb') return c.text('Authorized access is required.', 403, headers);
  const upstream = await c.env.ASSETS.fetch(c.req.raw);
  const res = new Response(upstream.body, upstream);
  res.headers.set('cache-control', 'no-store');
  res.headers.set('x-robots-tag', 'noindex, nofollow');
  res.headers.set('permissions-policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
  return res;
});
app.get('/assistant', (c) => c.redirect('/assistant/', 301));

// Everything else is the public site.
app.all('*', (c) => serveSite(c.req.raw, c.env, c.executionCtx as ExecutionContext));

/** Runs the job for a cron schedule. The two nightly schedules cover EDT and EST; only the one at 00:10 ET runs. */
export async function runScheduled(cron: string, env: Env, now: Date): Promise<string> {
  if (cron === '*/5 * * * *') {
    if (env.SHEETS_MIRROR !== 'on') return 'mirror off';
    const mirror = await mirrorSheets(env, now);
    if (!mirror.changed) return 'mirror unchanged';
    const build = await runBuild(env, 'sheets-mirror', now);
    return `mirror changed; build ${build.built ? 'done' : `skipped (${build.reason})`}`;
  }
  const midnight = etWallTime(etDate(now), 0, 10).getTime();
  if (Math.abs(now.getTime() - midnight) > 30 * 60 * 1000) return 'not 00:10 ET';
  const build = await runBuild(env, 'nightly', now);
  return `nightly build ${build.built ? 'done' : `skipped (${build.reason})`}`;
}

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env, new Date(controller.scheduledTime)).then(
      (outcome) => console.log(JSON.stringify({ message: 'cron', cron: controller.cron, outcome })),
      (error) => console.error(JSON.stringify({ message: 'cron failed', cron: controller.cron, error: String(error?.stack || error) })),
    ));
  },
} satisfies ExportedHandler<Env>;
