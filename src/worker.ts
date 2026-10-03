import { Hono } from 'hono';
import { accessIdentity, type Identity } from './auth/access';
import { getMe } from './api/me';
import * as filing from './api/filing';
import * as ap from './api/ap';
import { runBuild } from './build';
import { runDue } from './cron/schedule';
import { JOBS } from './cron/jobs';
import * as fitbit from './cron/fitbit';
import { formConfig, observerReport, subscribe } from './api/public';
import { serveSite } from './site';

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

app.get('/api/me', async (c) => c.json({
  ok: true, ...(await getMe(c.env.DB, c.get('who'))), ...(await filing.assistantState(c.env)),
  fitbit: { configured: !!c.env.FITBIT_CLIENT_ID, connected: !!(await c.env.CACHE.get('fitbit:tokens')) },
}));

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
app.get('/api/ap/state', apOnly, ap.getState);
app.post('/api/ap/state', apOnly, ap.setState);
app.post('/api/ap/violation', apOnly, ap.violationOp);
app.post('/api/ap/supervision', apOnly, ap.supervisionOp);
app.post('/api/ap/update', apOnly, ap.updateOp);
app.post('/api/ap/correction-request', apOnly, ap.correctionRequestOp);
app.post('/api/ap/observer', apOnly, ap.observerOp);
app.post('/api/ap/milestone', apOnly, ap.milestoneOp);
app.post('/api/ap/recording', apOnly, ap.recordingOp);
app.post('/api/ap/takedown', apOnly, ap.takedown);
app.get('/api/ap/export.csv', apOnly, ap.exportCsv);

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
// Fitbit authorisation (Micheal, once): under /mrb/ so Access protects the callback too.
app.get('/mrb/fitbit/connect', async (c) => {
  const who = await accessIdentity(c.req.raw, c.env);
  if (!who.ok || who.role !== 'mrb') return c.text('Authorized access is required.', 403);
  return fitbit.connect(c.env);
});
app.get('/mrb/fitbit/callback', async (c) => {
  const who = await accessIdentity(c.req.raw, c.env);
  if (!who.ok || who.role !== 'mrb') return c.text('Authorized access is required.', 403);
  return fitbit.callback(c.env, c.req.raw);
});
app.on(['GET', 'HEAD'], '/mrb/*', (c) => protectedApp(c, 'mrb', 'MRB portal'));
app.get('/mrb', (c) => c.redirect('/mrb/', 301));
app.on(['GET', 'HEAD'], '/ap/*', (c) => protectedApp(c, 'ap', 'AP console'));
app.get('/ap', (c) => c.redirect('/ap/', 301));

// Everything else is the public site.
app.all('*', (c) => serveSite(c.req.raw, c.env, c.executionCtx as ExecutionContext));

/** The 5-minute tick: every due job (src/cron/jobs.ts) and any build a filing queued. */
export async function runScheduled(env: Env, now: Date): Promise<Record<string, string>> {
  const outcomes = await runDue(env, JOBS, now);
  if (await env.CACHE.get('build:again')) {
    await env.CACHE.delete('build:again');
    const result = await runBuild(env, 'queued', now);
    outcomes['queued-build'] = result.built ? 'done' : `skipped (${result.reason})`;
  }
  return outcomes;
}

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, new Date(controller.scheduledTime)).then(
      (outcome) => { if (Object.keys(outcome).length) console.log(JSON.stringify({ message: 'cron', outcome })); },
      (error) => console.error(JSON.stringify({ message: 'cron failed', cron: controller.cron, error: String(error?.stack || error) })),
    ));
  },
} satisfies ExportedHandler<Env>;
