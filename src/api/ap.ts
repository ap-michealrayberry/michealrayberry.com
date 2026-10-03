/* AP console API (role ap; README §2.5). The AP administers the record and makes
   every ruling (contract §3, §8): verify or reject flags, assign and resolve
   corrective sessions, overrule on the written standard, rule supervision
   nights, record exceptions, publish updates and amendments, and review
   requests and reports. Every action is an audit event with the AP as actor,
   and ruling-time emails (Code.gs wording, with §8 fixes) go out here. */
import {
  appliesOn, correctiveDueAt, correctiveFor, DAY_ONE, dayNumber, etDate, isIsoDate, parseSupervisionDays, type AgreementGate,
} from '../rules';
import { loadGate, loadSiteState } from '../state';
import { appendEvent, sha256Hex } from '../events';
import { buildSoon } from '../build';
import { ASSISTANT, mailMRB, notifySubscribers } from '../mail';
import { attemptId, FilingError, hmacHex, streamUrl, type Ctx } from './filing';

const fail = (message: string, status: 400 | 403 | 404 | 409 = 400): never => { throw new FilingError(message, status); };
const etLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

async function input(c: Ctx): Promise<Record<string, unknown>> {
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('Invalid request.');
  return b!;
}
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const actor = (c: Ctx) => `ap:${c.get('who').email}`;

async function audit(c: Ctx, action: string, subject: string | null, payload: unknown, rebuild = true) {
  await appendEvent(c.env.DB, { actor: actor(c), action, subject, payload });
  if (rebuild) c.executionCtx.waitUntil(buildSoon(c.env, action));
}

async function gateNow(env: Env): Promise<AgreementGate> { return loadGate(env.DB, new Date()); }

interface ViolationRow {
  id: number; date: string; violation: string; status: string; public_id: string | null; verified_at: string | null;
  submitted_at: string | null; resolved_at: string | null; recording: string | null; corrections: string; requirement: string | null; source: string | null;
}
async function violation(env: Env, id: unknown): Promise<ViolationRow> {
  const row = await env.DB.prepare('SELECT * FROM violations WHERE id = ?').bind(Number(id)).first<ViolationRow>();
  if (!row) fail('No such entry.', 404);
  return row!;
}
/** Append-only factual history on the entry (§10: a dated explanation; never rewrite an earlier note). */
const appendCorrection = (existing: string, note: string, today: string) => [existing, `${today}: ${note}`].filter(Boolean).join('; ');

// ───────────────────────────── state ─────────────────────────────

/** GET /api/ap/state: everything awaiting the AP, plus the record's current settings. */
export async function getState(c: Ctx) {
  const db = c.env.DB;
  const state = await loadSiteState(db);
  const gate = await loadGate(db, new Date(), state);
  const all = <T>(sql: string) => db.prepare(sql).all<T>().then((r) => r.results);
  const [flags, submitted, open, correctives, supervision, requests, observers, milestones, recordings, preAgreement, subscribers, updates, recent] = await Promise.all([
    // Entries dated before Day 1 are pre-agreement history: nothing there can be ruled on (§1).
    all(`SELECT id, date, violation, source, requirement, subject_ref, created_at FROM violations WHERE status = 'flagged' AND date >= '${DAY_ONE}' ORDER BY date, id`),
    all(`SELECT v.id, v.public_id, v.date, v.violation, v.submitted_at, v.recording, c.assignment_id, c.level, c.minutes, c.due_at, c.revised_due_at
         FROM violations v LEFT JOIN correctives c ON c.violation_id = v.id AND c.completed_at IS NULL WHERE v.status = 'submitted' AND v.date >= '${DAY_ONE}' ORDER BY v.submitted_at`),
    all(`SELECT v.id, v.public_id, v.date, v.violation, c.assignment_id, c.level, c.minutes, c.due_at, c.revised_due_at, c.exception_note
         FROM violations v LEFT JOIN correctives c ON c.violation_id = v.id AND c.completed_at IS NULL WHERE v.status = 'open' AND v.date >= '${DAY_ONE}' ORDER BY v.date`),
    all('SELECT assignment_id, attempts FROM correctives'),
    all("SELECT date, status, start_at, end_at, stream_url, note FROM supervision WHERE status NOT LIKE 'COMPLETED%' AND status NOT LIKE 'MISSED%' AND status NOT LIKE 'EXCEPTION%' ORDER BY date DESC LIMIT 30"),
    all(`SELECT r.id, r.received_at, r.reason, r.evidence_url, r.status, r.ap_note, v.public_id, v.date FROM correction_requests r JOIN violations v ON v.id = r.violation_id ORDER BY r.received_at DESC`),
    all('SELECT id, received_at, type, message, name, email, source_url, quotable, review, ap_note FROM observer_reports ORDER BY received_at DESC LIMIT 100'),
    all("SELECT id, date, threshold, weight_lb, url, status, ap_note FROM milestone_filings ORDER BY date DESC"),
    all("SELECT id, received_at, kind, url, status FROM portal_filings WHERE kind IN ('announcement', 'demo') ORDER BY received_at DESC"),
    all(`SELECT COUNT(*) AS n FROM violations WHERE date < '${DAY_ONE}'`),
    all('SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status'),
    all('SELECT id, date, type, title, cosigned_on FROM updates ORDER BY date DESC, id DESC LIMIT 20'),
    all("SELECT at, actor, action, subject FROM events WHERE actor LIKE 'ap:%' ORDER BY id DESC LIMIT 30"),
  ]);
  return c.json({
    ok: true, email: c.get('who').email,
    agreement: { active: gate.active, effective_date: gate.effectiveDate || null, ended: gate.ended, missing: gate.missing, today: gate.today },
    state, flags, submitted, open, correctives, supervision, requests, observers, milestones, recordings,
    subscribers: Object.fromEntries((subscribers as { status: string; n: number }[]).map((s) => [s.status, s.n])),
    updates, recent, pre_agreement_entries: (preAgreement as { n: number }[])[0]?.n ?? 0,
  });
}

// ───────────────────────────── Site State ─────────────────────────────

/* §1, §11, §13: the execution record and how participation ended are AP entries. */
const DATE_KEYS = [
  'participant_signature_verified_on', 'ap_signature_verified_on', 'consent_recording_date', 'consent_reviewed_on',
  'effective_date', 'withdrawn', 'completed', 'abandoned',
];
const TEXT_KEYS = ['intro_video_url', 'demo_video_url', 'ap_statement', 'ap_links', 'completion_statement', 'prior_attempt_note'];

/** POST /api/ap/state {key, value}: sets one Site State entry ('' removes it). */
export async function setState(c: Ctx) {
  const b = await input(c);
  const key = String(b.key ?? '');
  const value = String(b.value ?? '').trim();
  const today = etDate(new Date());
  if (key === 'agreement_edition') {
    if (value !== '2' && value !== '') fail('Only Edition 2 is in effect.');
  } else if (DATE_KEYS.includes(key)) {
    // A date may be recorded only once it has happened; nothing can be backdated before Day 1 (rules.ts).
    if (value && (!isIsoDate(value) || value > today)) fail('Enter a past or present date as YYYY-MM-DD.');
  } else if (key === 'supervision_days') {
    try { parseSupervisionDays(value || undefined); } catch { fail('Use weekday numbers 0–6 (0 = Sunday), comma-separated.'); }
  } else if (!TEXT_KEYS.includes(key)) {
    fail('Unknown setting.');
  }
  const before = await c.env.DB.prepare('SELECT value FROM site_state WHERE key = ?').bind(key).first<string>('value');
  if (value) {
    await c.env.DB.prepare('INSERT INTO site_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
  } else {
    await c.env.DB.prepare('DELETE FROM site_state WHERE key = ?').bind(key).run();
  }
  await audit(c, 'ap.state', key, { before, after: value || null });
  return c.json({ ok: true, key, value: value || null });
}

// ───────────────────────────── violations (§8) ─────────────────────────────

/** The AP's verification marker: HMAC over the exact date and wording, so the public id stays stable. */
async function eventMarker(env: Env, date: string, wording: string, verifiedOn: string) {
  const mac = await hmacHex(env.ATTEST_HMAC_KEY, `violation-event-v2\n${date}\n${wording}`);
  const marker = `APV2|${verifiedOn}|${mac}`;
  const publicId = `V-${(await sha256Hex(`public-violation-id-v2\n${mac}`)).slice(0, 12).toUpperCase()}`;
  return { marker, publicId };
}

async function confirmedBefore(env: Env, gate: AgreementGate, excludeId: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, date FROM violations WHERE status IN ('open', 'submitted', 'resolved') AND public_id IS NOT NULL AND id != ?")
    .bind(excludeId).all<{ id: number; date: string }>();
  return results.filter((v) => appliesOn(v.date, gate)).length;
}

/** Verifies an event and assigns its corrective session: level by the confirmed count, due 72 h after this notice (§8). */
async function verifyAndAssign(c: Ctx, row: ViolationRow, wording: string, note: string) {
  const gate = await gateNow(c.env);
  if (!appliesOn(row.date, gate)) fail('No Violation Event can apply to a date outside the active agreement (§1).', 409);
  const now = new Date();
  const today = etDate(now);
  const { marker, publicId } = await eventMarker(c.env, row.date, wording, today);
  const n = (await confirmedBefore(c.env, gate, row.id)) + 1;
  const { level, minutes } = correctiveFor(n);
  const assignedAt = now.toISOString();
  const dueAt = correctiveDueAt(now).toISOString();
  const assignmentId = `C-${(await sha256Hex(`corrective-assignment-v2\n${marker}\n${assignedAt}`)).slice(0, 24).toUpperCase()}`;
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE violations SET status = 'open', violation = ?, verified_at = ?, event_marker = ?, public_id = ?, ap_verification = ?, corrections = ? WHERE id = ? AND status = 'flagged'")
      .bind(wording, today, marker, publicId, `AP verified ${today}`, note ? appendCorrection(row.corrections, note, today) : row.corrections, row.id),
    c.env.DB.prepare("INSERT INTO correctives (violation_id, assignment_id, assigned_at, due_at, level, minutes, status) SELECT ?, ?, ?, ?, ?, ?, 'assigned' WHERE changes() = 1")
      .bind(row.id, assignmentId, assignedAt, dueAt, level, minutes),
  ]);
  if (res[0].meta.changes !== 1) fail('This entry is no longer awaiting review.', 409);
  await audit(c, 'ap.violation.verify', publicId, { id: row.id, date: row.date, wording, level, minutes, assigned_at: assignedAt, due_at: dueAt, assignment_id: assignmentId });

  const day = dayNumber(row.date);
  const escalation = row.requirement === 'corrective-deadline';
  c.executionCtx.waitUntil((async () => {
    await mailMRB(c.env, `AP-VERIFIED VIOLATION — Day ${day} — ${row.date}`,
      `The Accountability Partner reviewed the source evidence and explicitly verified this dated Violation Event:\n\n${wording}\n\n` +
      'The event is now eligible for the governed record and consequence count.\n\n' +
      `Assigned: Level ${level} — ${minutes} continuous minutes of corner time, recorded in one unbroken take and published beside the entry.\n` +
      `Notice: ${etLabel(assignedAt)}. Due: ${etLabel(dueAt)} (72 hours, §8).\n\n` +
      `Record it at ${ASSISTANT(c.env)}. The entry stays open until the Accountability Partner\n` +
      'verifies the session — submitting it is not the same as resolving it.\n\n' +
      'If a documented medical event or verified platform failure applies, say so to the AP. The AP decision is logged either way. Stop at once for pain, dizziness, numbness or an emergency; a good-faith safety stop is never punished (§9).', 'violation-mrb');
    await notifySubscribers(c.env, `${escalation ? 'ESCALATION: ' : 'VIOLATION: '}${wording.slice(0, 80)}`,
      `Micheal Ray Berry — ${escalation ? 'Escalation' : 'New Violation Event'}, ${row.date}\n\n${wording}\n\n` +
      `Corrective requirement: Level ${level} · ${minutes} minutes of corner time, recorded in one unbroken take and published beside the entry. ` +
      // § §8: the 72 hours run from the AP's assignment notice; a missed deadline is reviewed before any further event.
      `Due ${etLabel(dueAt)}, 72 hours after the assignment notice. A missed deadline is reviewed by the Accountability Partner before any further Violation Event is confirmed.\n\n` +
      `Violation log: ${c.env.SITE_ORIGIN}/violations/\n`, escalation ? 'escalation' : 'violation');
  })());
  return { publicId, level, minutes, dueAt, assignmentId };
}

/** POST /api/ap/violation {op, id?, …} */
export async function violationOp(c: Ctx) {
  const b = await input(c);
  const op = String(b.op ?? '');
  const today = etDate(new Date());

  if (op === 'declare') {
    // A Violation Event the AP identifies directly (e.g. from an observer report), verified on entry.
    const date = String(b.date ?? '');
    const wording = text(b.violation, 500);
    if (!isIsoDate(date) || date > today) fail('Enter the date of the failure as YYYY-MM-DD.');
    if (wording.length < 10) fail('State the written requirement that was missed.');
    const ins = await c.env.DB.prepare("INSERT INTO violations (date, violation, status, source, requirement) VALUES (?, ?, 'flagged', 'ap', ?)")
      .bind(date, wording, text(b.requirement, 60) || 'ap-declared').run();
    const row = await violation(c.env, ins.meta.last_row_id);
    return c.json({ ok: true, ...(await verifyAndAssign(c, row, wording, text(b.note, 1000))) });
  }

  const row = await violation(c.env, b.id);

  if (op === 'verify') {
    if (row.status !== 'flagged') fail('Only a flag awaiting review can be verified.', 409);
    // The public entry states the facts neutrally (§8); the AP may restate the flag's wording.
    const wording = text(b.violation, 500) || row.violation;
    return c.json({ ok: true, ...(await verifyAndAssign(c, row, wording, text(b.note, 1000))) });
  }

  if (op === 'reject') {
    if (row.status !== 'flagged') fail('Only a flag awaiting review can be rejected.', 409);
    const reason = text(b.reason, 1000);
    if (reason.length < 5) fail('Record the reason (requirement, receipts, exception).');
    await c.env.DB.prepare("UPDATE violations SET status = 'rejected', ap_verification = ?, corrections = ? WHERE id = ? AND status = 'flagged'")
      .bind(`AP reviewed ${today}`, appendCorrection(row.corrections, `rejected — ${reason}`, today), row.id).run();
    await audit(c, 'ap.violation.reject', String(row.id), { date: row.date, reason }, false);
    return c.json({ ok: true });
  }

  if (op === 'resolve') {
    // §8: an accepted correction closes the obligation without erasing the entry; only after a submitted session.
    if (row.status !== 'submitted') fail('Resolve only after a corrective session has been submitted and reviewed.', 409);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE violations SET status = 'resolved', resolved_at = ?, ap_verification = ? WHERE id = ? AND status = 'submitted'")
        .bind(today, `AP-verified resolution ${today}`, row.id),
      c.env.DB.prepare("UPDATE correctives SET completed_at = ?, status = 'completed' WHERE violation_id = ? AND completed_at IS NULL").bind(new Date().toISOString(), row.id),
    ]);
    await audit(c, 'ap.violation.resolve', row.public_id, { id: row.id, note: text(b.note, 1000) || null });
    c.executionCtx.waitUntil((async () => {
      await mailMRB(c.env, `RESOLVED — ${row.date} — verified by the Accountability Partner`,
        `The entry for ${row.date} (${row.violation}) has been verified and marked resolved.\n\n` +
        (text(b.note, 1000) ? `AP verification: ${text(b.note, 1000)}\n\n` : '') +
        'The obligation is closed. The entry remains as durable record history and now shows its\n' +
        'resolution date, subject to safety, privacy, consent, and legal redaction or takedown requirements.', 'resolved-mrb');
      await notifySubscribers(c.env, `CORRECTION COMPLETED: ${row.date}`,
        `Micheal Ray Berry — Correction completed\n\nEntry: ${row.date} · ${row.violation}\n` +
        `Corrective session: COMPLETED · RECORDED · verified by the Accountability Partner ${today}.\n\n` +
        `The entry stays on the record. Violation log: ${c.env.SITE_ORIGIN}/violations/\n`, 'corrected');
    })());
    return c.json({ ok: true });
  }

  if (op === 'overrule') {
    // §8: a submitted session that fails the written standard; the reason is recorded and a new attempt starts from zero.
    if (row.status !== 'submitted') fail('Only a submitted session can be overruled.', 409);
    const reason = text(b.reason, 1000);
    if (reason.length < 10) fail('Overrule only on the written standard (§8): state which requirement the session did not meet.');
    const cor = await c.env.DB.prepare('SELECT assignment_id, attempts FROM correctives WHERE violation_id = ? AND completed_at IS NULL').bind(row.id).first<{ assignment_id: string; attempts: string }>();
    if (!cor) fail('No open corrective assignment for this entry.', 409);
    const attempts = JSON.parse(cor!.attempts || '[]') as { rejection_id?: string }[];
    const rejectionId = `J-${(await sha256Hex(`corrective-rejection-v2\n${cor!.assignment_id}\n${attempts.length}\n${new Date().toISOString()}`)).slice(0, 24).toUpperCase()}`;
    attempts.push({ rejection_id: rejectionId, at: new Date().toISOString(), reason, recording: row.recording } as never);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE violations SET status = 'open', submitted_at = NULL, recording = NULL, corrections = ? WHERE id = ? AND status = 'submitted'")
        .bind(appendCorrection(row.corrections, `corrective session not accepted — ${reason}`, today), row.id),
      c.env.DB.prepare('UPDATE correctives SET attempts = ? WHERE violation_id = ? AND completed_at IS NULL').bind(JSON.stringify(attempts), row.id),
    ]);
    const nextAttempt = await attemptId(cor!.assignment_id, rejectionId);
    await audit(c, 'ap.violation.overrule', row.public_id, { id: row.id, reason, rejection_id: rejectionId, next_attempt: nextAttempt });
    c.executionCtx.waitUntil(mailMRB(c.env, `SESSION REJECTED — ${row.date} — must be repeated`,
      `The Accountability Partner has reviewed the session submitted against the entry for ${row.date}\n(${row.violation}) and has not accepted it.\n\n` +
      `Result: ${reason}\n\n` +
      'The entry remains open. The full assignment restarts from zero — a partial or invalid\nsession counts for nothing.\n\n' +
      `Record it again at ${ASSISTANT(c.env)}.`, 'overrule-mrb'));
    return c.json({ ok: true, next_attempt: nextAttempt });
  }

  if (op === 'exception') {
    // §9: a safety stop or documented exception — the AP records the reason and any revised deadline. No added time, never punished.
    if (row.status !== 'open') fail('An exception applies to an open corrective requirement.', 409);
    const reason = text(b.reason, 1000);
    const revised = String(b.revised_due_at ?? '').trim();
    if (reason.length < 5) fail('Record the reason without private medical details (§9).');
    if (revised && Number.isNaN(Date.parse(revised))) fail('Revised due time must be an ISO date-time.');
    await c.env.DB.prepare('UPDATE correctives SET exception_note = ?, revised_due_at = COALESCE(?, revised_due_at) WHERE violation_id = ? AND completed_at IS NULL')
      .bind(`${today}: ${reason}`, revised ? new Date(revised).toISOString() : null, row.id).run();
    await audit(c, 'ap.violation.exception', row.public_id, { id: row.id, reason, revised_due_at: revised || null });
    return c.json({ ok: true });
  }

  if (op === 'correct') {
    // §10, §12: a factual correction with a dated explanation; the original decision history stays.
    const note = text(b.note, 1000);
    if (note.length < 5) fail('Write the dated explanation.');
    await c.env.DB.prepare('UPDATE violations SET corrections = ? WHERE id = ?').bind(appendCorrection(row.corrections, note, today), row.id).run();
    await audit(c, 'ap.violation.correct', row.public_id ?? String(row.id), { note });
    return c.json({ ok: true });
  }

  return fail('Unknown operation.');
}

// ───────────────────────────── supervision (§6) ─────────────────────────────

/** POST /api/ap/supervision {date, op: complete|missed|exception, reason?, note?}. Only the AP rules. */
export async function supervisionOp(c: Ctx) {
  const b = await input(c);
  const date = String(b.date ?? '');
  const op = String(b.op ?? '');
  const today = etDate(new Date());
  if (!isIsoDate(date) || date > today) fail('Bad date.');
  const reason = text(b.reason, 300);
  const status = op === 'complete' ? 'COMPLETED' : op === 'missed' ? 'MISSED' : op === 'exception' ? `EXCEPTION · ${reason}` : fail('Unknown ruling.');
  if (op === 'exception' && reason.length < 3) fail('Record the exception reason (§9).');
  if (op === 'missed') {
    const gate = await gateNow(c.env);
    if (!appliesOn(date, gate)) fail('No supervision requirement applied on that date.', 409);
  }
  const note = text(b.note, 500);
  await c.env.DB.prepare(
    `INSERT INTO supervision (date, required, status, note) VALUES (?, 1, ?, ?)
     ON CONFLICT(date) DO UPDATE SET status = excluded.status, note = CASE WHEN ? = '' THEN supervision.note ELSE excluded.note END`,
  ).bind(date, status, note ? `${note} — entered by the AP ${today}` : `entered by the AP ${today}`, note).run();
  await audit(c, 'ap.supervision', date, { status, note: note || null });
  if (op === 'missed') {
    c.executionCtx.waitUntil(notifySubscribers(c.env, `MISSED: Evening Supervision — ${date}`,
      `Micheal Ray Berry — Evening Supervision, ${date}\n\n` +
      'The Accountability Partner reviewed the record and ruled the required 6:00–10:00 PM ET session MISSED.\n\n' +
      `Supervision record: ${c.env.SITE_ORIGIN}/live/\n`, 'supervision'));
  }
  return c.json({ ok: true, status });
}

// ───────────────────────────── updates and amendments (§12) ─────────────────────────────

export async function updateOp(c: Ctx) {
  const b = await input(c);
  const type = String(b.type ?? 'official');
  if (!['official', 'personal', 'amendment'].includes(type)) fail('Unknown update type.');
  const date = String(b.date ?? etDate(new Date()));
  if (!isIsoDate(date)) fail('Bad date.');
  const title = text(b.title, 200);
  const body = text(b.body, 10000);
  if (!title || !body) fail('Title and body are required.');
  const link = text(b.link, 500);
  if (link && !/^(https:\/\/|\/)/.test(link)) fail('Link must be https:// or a site path.');
  let cosigned: string | null = null;
  if (type === 'amendment') {
    // §12: written, dated, logged in Updates, and co-signed by both parties before it takes effect.
    cosigned = String(b.cosigned_on ?? '');
    if (!isIsoDate(cosigned) || cosigned > etDate(new Date())) fail('An amendment takes effect only once co-signed by both parties: enter the co-signature date.');
  }
  const res = await c.env.DB.prepare('INSERT INTO updates (date, type, title, body, link, cosigned_on) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(date, type, title, body, link || null, cosigned).run();
  await audit(c, 'ap.update', String(res.meta.last_row_id), { date, type, title, cosigned_on: cosigned });
  return c.json({ ok: true, id: res.meta.last_row_id });
}

// ───────────────────────────── reviews ─────────────────────────────

export async function correctionRequestOp(c: Ctx) {
  const b = await input(c);
  const status = String(b.status ?? '');
  if (!['received', 'under review', 'corrected', 'declined'].includes(status)) fail('Unknown status.');
  const note = text(b.ap_note, 2000);
  if ((status === 'corrected' || status === 'declined') && note.length < 5) fail('Record the dated explanation for the decision.');
  const res = await c.env.DB.prepare('UPDATE correction_requests SET status = ?, ap_note = ? WHERE id = ?').bind(status, note || null, Number(b.id)).run();
  if (res.meta.changes !== 1) fail('No such request.', 404);
  await audit(c, 'ap.correction-request', String(b.id), { status, ap_note: note || null }, false);
  return c.json({ ok: true });
}

export async function observerOp(c: Ctx) {
  const b = await input(c);
  const review = String(b.review ?? '');
  if (!['received', 'dismissed', 'verified', 'published', 'actioned'].includes(review)) fail('Unknown review state.');
  const res = await c.env.DB.prepare('UPDATE observer_reports SET review = ?, ap_note = ? WHERE id = ?').bind(review, text(b.ap_note, 2000) || null, Number(b.id)).run();
  if (res.meta.changes !== 1) fail('No such report.', 404);
  await audit(c, 'ap.observer', String(b.id), { review }, false);
  return c.json({ ok: true });
}

/** §7: a milestone becomes official only after the verification weigh-in, video and AP review. */
export async function milestoneOp(c: Ctx) {
  const b = await input(c);
  const op = String(b.op ?? '');
  if (op !== 'verify' && op !== 'reject') fail('Unknown operation.');
  const note = text(b.ap_note, 1000);
  if (op === 'reject' && note.length < 5) fail('Record the reason.');
  const res = await c.env.DB.prepare("UPDATE milestone_filings SET status = ?, reviewed_at = ?, ap_note = ? WHERE id = ? AND status = 'submitted'")
    .bind(op === 'verify' ? 'verified' : 'rejected', new Date().toISOString(), note || null, Number(b.id)).run();
  if (res.meta.changes !== 1) fail('No milestone filing awaiting review.', 404);
  await audit(c, `ap.milestone.${op}`, String(b.id), { note: note || null });
  return c.json({ ok: true });
}

/** Announcement / demonstration recordings filed by Micheal: the AP publishes or declines (§3, §10). */
export async function recordingOp(c: Ctx) {
  const b = await input(c);
  const op = String(b.op ?? '');
  const row = await c.env.DB.prepare("SELECT id, kind, url FROM portal_filings WHERE id = ? AND kind IN ('announcement', 'demo')").bind(Number(b.id)).first<{ id: number; kind: string; url: string }>();
  if (!row) fail('No such recording.', 404);
  if (op === 'publish') {
    const key = row!.kind === 'announcement' ? 'intro_video_url' : 'demo_video_url';
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO site_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, row!.url),
      c.env.DB.prepare("UPDATE portal_filings SET status = 'published' WHERE id = ?").bind(row!.id),
    ]);
  } else if (op === 'decline') {
    await c.env.DB.prepare("UPDATE portal_filings SET status = 'declined' WHERE id = ?").bind(row!.id).run();
  } else fail('Unknown operation.');
  await audit(c, `ap.recording.${op}`, String(row!.id), { kind: row!.kind, url: row!.url });
  return c.json({ ok: true });
}

// ───────────────────────────── takedown (§10) ─────────────────────────────

/** POST /api/ap/takedown {date, field, explanation}: removes a published file under §10, with a dated explanation. */
export async function takedown(c: Ctx) {
  const b = await input(c);
  const date = String(b.date ?? '');
  const field = String(b.field ?? '');
  const explanation = text(b.explanation, 500);
  if (!isIsoDate(date)) fail('Bad date.');
  if (!['video', 'photo_front', 'photo_left', 'photo_rear', 'photo_right'].includes(field)) fail('Unknown file.');
  if (explanation.length < 10) fail('Write the dated explanation (without repeating the protected information).');
  const row = await c.env.DB.prepare(`SELECT ${field} AS url, note FROM days WHERE date = ?`).bind(date).first<{ url: string | null; note: string | null }>();
  if (!row?.url) fail('Nothing on file there.', 404);
  const today = etDate(new Date());
  if (field === 'video') {
    const video = streamUrl(row!.url);
    if (video && c.env.STREAM_API_TOKEN) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/stream/${video.uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${c.env.STREAM_API_TOKEN}` } });
      if (!res.ok && res.status !== 404) fail(`Cloudflare Stream refused the deletion (${res.status}).`, 409);
    }
  } else {
    const key = String(row!.url).replace(`${c.env.SITE_ORIGIN}/`, '');
    if (key.startsWith('photos/')) await c.env.MEDIA.delete(key);
  }
  const label = field === 'video' ? 'inspection video' : `${field.replace('photo_', '')} photograph`;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE days SET ${field} = NULL, note = ? WHERE date = ?`)
      .bind([row!.note, `${today}: ${label} removed under §10 — ${explanation}`].filter(Boolean).join(' · '), date),
    c.env.DB.prepare('INSERT INTO redactions (target, date, explanation, actor) VALUES (?, ?, ?, ?)').bind(`days:${date}:${field}`, today, explanation, actor(c)),
  ]);
  await audit(c, 'ap.takedown', `days:${date}:${field}`, { explanation });
  return c.json({ ok: true });
}

// ───────────────────────────── export ─────────────────────────────

const EXPORTABLE = ['days', 'health', 'attestations', 'violations', 'correctives', 'supervision', 'weekly', 'confirmations', 'updates',
  'site_state', 'correction_requests', 'portal_filings', 'observer_reports', 'subscribers', 'milestone_filings', 'events', 'weight_readings', 'redactions'];

/** GET /api/ap/export.csv?table=… */
export async function exportCsv(c: Ctx) {
  const table = c.req.query('table') ?? '';
  if (!EXPORTABLE.includes(table)) fail('Unknown table.');
  const { results } = await c.env.DB.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all<Record<string, unknown>>();
  const cols = results.length ? Object.keys(results[0]) : [];
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    // Spreadsheet formula injection guard, then RFC 4180 quoting.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [cols.join(','), ...results.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\r\n') + '\r\n';
  await audit(c, 'ap.export', table, { rows: results.length }, false);
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${table}-${etDate(new Date())}.csv"`, 'cache-control': 'no-store' } });
}
