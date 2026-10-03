import { Hono } from 'hono';
import { accessIdentity, type Identity } from './auth/access';
import { getMe } from './api/me';

type Who = Extract<Identity, { ok: true }>;
const app = new Hono<{ Bindings: Env; Variables: { who: Who } }>();

app.onError((error, c) => {
  console.error(JSON.stringify({ message: 'unhandled error', path: c.req.path, error: String(error?.stack || error) }));
  return c.json({ ok: false, error: 'Internal error.' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// Every /api route below this line requires a verified Access identity.
app.use('/api/*', async (c, next) => {
  const who = await accessIdentity(c.req.raw, c.env);
  if (!who.ok) return c.json({ ok: false, error: who.error }, who.status);
  c.set('who', who);
  await next();
});

app.get('/api/me', async (c) => c.json({ ok: true, ...(await getMe(c.env.DB, c.get('who'))) }));

app.all('/api/*', (c) => c.json({ ok: false, error: 'Not found.' }, 404));
app.all('*', (c) => c.text('Not found.', 404));

export default app satisfies ExportedHandler<Env>;
