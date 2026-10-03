import { Hono } from 'hono';
import { accessIdentity, type Identity } from './auth/access';
import { getMe } from './api/me';
import * as filing from './api/filing';
import { setState } from './api/ap';
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
  if (error instanceof filing.FilingError) return c.json({ ok: false, error: error.message, ...error.extra }, error.status);
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
  // Signed-in writes must come from the site's own pages.
  if (c.req.method !== 'GET' && c.req.header('origin') !== new URL(c.req.url).origin) {
    return c.json({ ok: false, error: 'Cross-origin request refused.' }, 403);
  }
  c.set('who', who);
  await next();
});

app.get('/api/me', async (c) => c.json({ ok: true, ...(await getMe(c.env.DB, c.get('who'))), ...(await filing.assistantState(c.env)) }));

// Filing API: Micheal only, file-only (README §2.4).
const mrbOnly = async (c: filing.Ctx, next: () => Promise<void>) => {
  if (c.get('who').role !== 'mrb') return c.json({ ok: false, error: 'Filing is for the participant only.' }, 403);
  await next();
};
app.post('/api/challenge', mrbOnly, filing.challenge);
app.post('/api/attest', mrbOnly, filing.attest);
app.post('/api/stream-upload', mrbOnly, filing.streamUpload);
app.post('/api/media-put', mrbOnly, filing.mediaPut);
app.post('/api/packet', mrbOnly, filing.packet);
app.post('/api/weekly', mrbOnly, filing.weekly);
app.post('/api/confirmation', mrbOnly, filing.confirmation);
app.post('/api/corrective', mrbOnly, filing.corrective);
app.post('/api/milestone', mrbOnly, filing.milestone);
app.post('/api/correction-request', mrbOnly, filing.correctionRequest);
app.post('/api/recording', mrbOnly, filing.recording);

// AP endpoints.
const apOnly = async (c: filing.Ctx, next: () => Promise<void>) => {
  if (c.get('who').role !== 'ap') return c.json({ ok: false, error: 'AP only.' }, 403);
  await next();
};
app.post('/api/ap/build', apOnly, async (c) => c.json({ ok: true, ...(await runBuild(c.env, `ap:${c.get('who').email}`)) }));
app.post('/api/ap/state', apOnly, setState);

app.all('/api/*', (c) => c.json({ ok: false, error: 'Not found.' }, 404));

// Protected apps (Cloudflare Access): the Recording Assistant and the MRB portal are
// Micheal's; Access lets only his address in, and the Worker checks the token again.
async function protectedApp(c: filing.Ctx, role: 'mrb' | 'ap', name: string) {
  const who = await accessIdentity(c.req.raw, c.env);
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (!who.ok && who.status === 500) return c.text(`${name} protection must be configured before use.`, 503, headers);
  if (!who.ok || who.role !== role) return c.text('Authorized access is required.', 403, headers);
  const upstream = await c.env.ASSETS.fetch(c.req.raw);
  const res = new Response(upstream.body, upstream);
  res.headers.set('cache-control', 'no-store');
  res.headers.set('x-robots-tag', 'noindex, nofollow');
  return res;
}
app.on(['GET', 'HEAD'], '/assistant/*', async (c) => {
  const res = await protectedApp(c, 'mrb', 'Recording Assistant');
  if (res.ok) res.headers.set('permissions-policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
  return res;
});
app.get('/assistant', (c) => c.redirect('/assistant/', 301));
app.on(['GET', 'HEAD'], '/mrb/*', (c) => protectedApp(c, 'mrb', 'MRB portal'));
app.get('/mrb', (c) => c.redirect('/mrb/', 301));

// Everything else is the public site.
app.all('*', (c) => serveSite(c.req.raw, c.env, c.executionCtx as ExecutionContext));

/** Runs the job for a cron schedule. The two nightly schedules cover EDT and EST; only the one at 00:10 ET runs. */
export async function runScheduled(cron: string, env: Env, now: Date): Promise<string> {
  if (cron === '*/5 * * * *') {
    let outcome = 'mirror off';
    let build = false;
    if (env.SHEETS_MIRROR === 'on') {
      const mirror = await mirrorSheets(env, now);
      outcome = mirror.changed ? 'mirror changed' : 'mirror unchanged';
      build = mirror.changed;
    }
    // A filing that arrived while a build was running left a note.
    if (await env.CACHE.get('build:again')) {
      await env.CACHE.delete('build:again');
      build = true;
    }
    if (!build) return outcome;
    const result = await runBuild(env, 'cron', now);
    return `${outcome}; build ${result.built ? 'done' : `skipped (${result.reason})`}`;
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
