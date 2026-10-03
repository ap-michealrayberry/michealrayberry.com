/* AP endpoints available before the console (step 5). */
import { etDate, isIsoDate, parseSupervisionDays } from '../rules';
import { appendEvent } from '../events';
import { buildSoon } from '../build';
import type { Ctx } from './filing';
import { FilingError } from './filing';

/* §1, §11, §13: the execution record and how participation ended are AP entries. */
const DATE_KEYS = [
  'participant_signature_verified_on', 'ap_signature_verified_on', 'consent_recording_date', 'consent_reviewed_on',
  'effective_date', 'withdrawn', 'completed', 'abandoned',
];
const TEXT_KEYS = ['intro_video_url', 'demo_video_url', 'ap_statement', 'ap_links', 'completion_statement', 'prior_attempt_note'];

/** POST /api/ap/state {key, value}: sets one Site State entry ('' removes it). Every change is in the audit log. */
export async function setState(c: Ctx) {
  const b = await c.req.json<{ key?: unknown; value?: unknown }>().catch(() => ({}) as { key?: unknown; value?: unknown });
  const key = String(b.key ?? '');
  const value = String(b.value ?? '').trim();
  const today = etDate(new Date());
  if (key === 'agreement_edition') {
    if (value !== '2' && value !== '') throw new FilingError('Only Edition 2 is in effect.');
  } else if (DATE_KEYS.includes(key)) {
    // A date may be recorded only once it has happened; no backdating before Day 1 is possible (rules.ts).
    if (value && (!isIsoDate(value) || value > today)) throw new FilingError('Enter a past or present date as YYYY-MM-DD.');
  } else if (key === 'supervision_days') {
    parseSupervisionDays(value || undefined);
  } else if (!TEXT_KEYS.includes(key)) {
    throw new FilingError('Unknown setting.');
  }
  const before = await c.env.DB.prepare('SELECT value FROM site_state WHERE key = ?').bind(key).first<string>('value');
  if (value) {
    await c.env.DB.prepare('INSERT INTO site_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
  } else {
    await c.env.DB.prepare('DELETE FROM site_state WHERE key = ?').bind(key).run();
  }
  const who = c.get('who');
  await appendEvent(c.env.DB, { actor: `ap:${who.email}`, action: 'ap.state', subject: key, payload: { before, after: value || null } });
  c.executionCtx.waitUntil(buildSoon(c.env, 'ap.state'));
  return c.json({ ok: true, key, value: value || null });
}
