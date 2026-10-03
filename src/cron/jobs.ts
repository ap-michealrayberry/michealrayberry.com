/* Scheduled jobs (README §2.6), ported from Code.gs with its wording. A flag
   written here is a private request for AP review (status 'flagged'); it is
   never a Violation Event, never public, and never MISSED (contract §6, §8).
   Contract fixes over Code.gs are marked "§". */
import { appliesOn, correctiveFor, dayNumber, etDate, etWallTime, MILESTONES, packetComponents, supervisionRequiredOn, type AgreementGate, type PacketRow, type SiteState } from '../rules';
import { loadGate, loadSiteState } from '../state';
import { AP_CONSOLE, ASSISTANT, mailAP, mailMRB, notifySubscribers } from '../mail';
import { appendEvent } from '../events';
import { buildSoon, runBuild } from '../build';
import { backup } from './backup';
import { syncWeights } from './fitbit';
import { pollSupervision } from './twitch';
import { dailyAt, everyTickBetween, hourly, type Job } from './schedule';

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const checkedAtEt = (now: Date) => now.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const etLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

async function context(env: Env, now: Date) {
  const state = await loadSiteState(env.DB);
  const gate = await loadGate(env.DB, now, state);
  return { state, gate, today: gate.today };
}

/** Code.gs dailyPacketStateFromRow: the four components and what is missing (§4). */
export async function packetState(env: Env, date: string) {
  const row = await env.DB.prepare('SELECT weight_lb, video, photo_front, photo_left, photo_rear, photo_right FROM days WHERE date = ?').bind(date).first<PacketRow>();
  const p = packetComponents(row);
  const missing: string[] = [];
  if (!p.tracker) missing.push('public tracker update (no dated Weigh-ins row)');
  if (p.tracker && !p.weight) missing.push('scale-synced weight (step on the scale; it syncs through Fitbit)');
  if (p.tracker && p.photos < 4) missing.push(`accountability photographs (${p.photos}/4 filed)`);
  if (p.tracker && !p.video) missing.push('four-angle inspection video');
  return { ...p, row, missing, day: dayNumber(date) };
}

/* Code.gs consequenceForLevel / nextConsequence. */
const consequenceText = (n: number) => {
  const c = correctiveFor(Math.max(1, n));
  return `Level ${c.level} — ${c.minutes} continuous minutes of corner time, recorded in one unbroken take and published beside the entry`;
};
async function nextConsequence(env: Env, gate: AgreementGate) {
  if (!gate.active) return { text: 'No consequence — agreement execution is inactive', open: 0, total: 0 };
  const { results } = await env.DB.prepare("SELECT date, status FROM violations WHERE status IN ('open', 'submitted', 'resolved') AND public_id IS NOT NULL").all<{ date: string; status: string }>();
  const record = results.filter((v) => appliesOn(v.date, gate));
  return { text: consequenceText(record.length + 1), open: record.filter((v) => v.status !== 'resolved').length, total: record.length };
}

/* Code.gs openCorrectiveDeadline, with the exact 72-hour due time (§8). */
async function openCorrectiveDeadline(env: Env, gate: AgreementGate, now: Date) {
  const c = await env.DB.prepare(
    `SELECT v.date, c.level, c.minutes, c.due_at, c.revised_due_at FROM correctives c JOIN violations v ON v.id = c.violation_id
     WHERE c.completed_at IS NULL AND v.status = 'open' ORDER BY COALESCE(c.revised_due_at, c.due_at) LIMIT 1`,
  ).first<{ date: string; level: number; minutes: number; due_at: string; revised_due_at: string | null }>();
  if (!c || !appliesOn(c.date, gate)) return null;
  const dueAt = c.revised_due_at ?? c.due_at;
  const due = etLabel(dueAt);
  const days = Math.round((Date.parse(`${etDate(new Date(dueAt))}T12:00:00Z`) - Date.parse(`${etDate(now)}T12:00:00Z`)) / 864e5);
  const text = Date.parse(dueAt) < now.getTime()
    ? `The assigned corrective due time was ${due}. Any apparent lapse requires AP review before it can become a Violation Event.`
    : days === 0
      ? `The assigned corrective session is due TODAY (${due}). An apparent lapse will be sent to the AP for review.`
      : `${days} day(s) remain to submit the assigned corrective session (due ${due}). Only an explicit AP ruling can turn an apparent lapse into a Violation Event.`;
  return { text, assignment: `Level ${c.level} · ${c.minutes} minutes of corner time` };
}

/** A private review flag (§8). Unique per date, requirement and subject, so a re-run adds nothing. */
async function flag(env: Env, date: string, requirement: string, text: string, source: string, subjectRef: string | null = null): Promise<boolean> {
  // subject_ref is '' rather than NULL: SQLite treats NULLs as distinct, which would defeat the unique index.
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO violations (date, violation, status, source, requirement, subject_ref) VALUES (?, ?, 'flagged', ?, ?, ?)",
  ).bind(date, text, source, requirement, subjectRef ?? '').run();
  if (res.meta.changes === 1) await appendEvent(env.DB, { actor: 'system', action: 'flag.created', subject: `${requirement}:${date}`, payload: { text, subjectRef } });
  return res.meta.changes === 1;
}

const ended = (gate: AgreementGate) => !!gate.ended; // §11: nothing new is required after an ending

// ───────────────────────────── daily ─────────────────────────────

export async function morningBrief(env: Env, now: Date): Promise<string> {
  const { gate, state, today } = await context(env, now);
  if (!appliesOn(today, gate) || ended(gate)) return 'inactive';
  const st = await packetState(env, today);
  const c = await nextConsequence(env, gate);
  const dl = await openCorrectiveDeadline(env, gate, now);
  let body = `Day ${st.day}. Everything below is due by 10:00 PM Eastern tonight.\n\n` +
    '  1. Four-angle inspection video, one continuous take\n' +
    '  2. Four accountability photographs\n' +
    "  3. Today's scale-synced weight\n" +
    '  4. Dated public tracker update\n\n' +
    `The filing flow captures the evidence and updates the tracker at ${ASSISTANT(env)}.\n\n` +
    'Current file presence alone does not prove filing time. The scheduled check records\n' +
    'what is present when it runs; the AP reviews server-side receipts before any ruling.\n\n' +
    `If the AP verifies a deadline miss, the governed consequence would be: ${c.text}.\n`;
  if (supervisionRequiredOn(today, gate, state)) {
    const sv = await env.DB.prepare('SELECT status FROM supervision WHERE date = ?').bind(today).first<string>('status');
    if (!/^EXCEPTION/.test(sv ?? '')) {
      // § Edition 2 §6; the session is recorded from the Twitch broadcast (no File tool).
      body += '\nEVENING SUPERVISION tonight, 6:00–10:00 PM Eastern (§6): full uniform, fixed camera,\n' +
        'water only, home-cooked dinner. Stream on twitch.tv/michealrayberry; the session is recorded from the broadcast.\n' +
        'An apparent gap is sent privately to the AP; only an explicit AP ruling may mark MISSED or declare a Violation Event.\n';
    }
  }
  if (c.open) body += `\nYou currently have ${c.open} unresolved ${c.open === 1 ? 'entry' : 'entries'} on the public record.\n`;
  if (dl) body += `\n${dl.text}\nAssigned: ${dl.assignment}\nRecord it at ${ASSISTANT(env)}\n`;
  await mailMRB(env, `Day ${st.day} — due by 10 PM ET tonight`, body, 'morning-brief');
  return 'sent';
}

export async function eveningWarning(env: Env, now: Date): Promise<string> {
  const { gate, today } = await context(env, now);
  if (!appliesOn(today, gate) || ended(gate)) return 'inactive';
  const st = await packetState(env, today);
  if (st.complete) return 'complete';
  const c = await nextConsequence(env, gate);
  const dl = await openCorrectiveDeadline(env, gate, now);
  const body = `Two hours to the 10:00 PM Eastern deadline. The record shows ${st.missing.length} outstanding ${st.missing.length === 1 ? 'item' : 'items'}:\n\n  - ${st.missing.join('\n  - ')}\n\n` +
    `Record it now: ${ASSISTANT(env)}\n\n` +
    (dl ? `${dl.text}\n\n` : '') +
    'The scheduled check records file presence and privately requests AP review; it does not declare a violation.\n' +
    'If the AP later verifies a deadline miss after reviewing receipts and exceptions, the governed consequence would be:\n\n' +
    `  ${c.text}.\n\n` +
    'The entry is retained as durable history after the obligation closes, subject to safety,\n' +
    'privacy, consent, and legal redaction or takedown requirements. Completion changes its\n' +
    'status rather than deleting it by default.';
  await mailMRB(env, `TWO HOURS LEFT — Day ${st.day} packet incomplete`, body, 'evening-warning');
  return 'sent';
}

/** 22:00 ET: the nightly compliance check (§4, §8). A miss becomes a Violation Event only when the AP verifies it. */
export async function nightlyCheck(env: Env, now: Date): Promise<string> {
  const { gate, today } = await context(env, now);
  if (!appliesOn(today, gate) || ended(gate)) return 'inactive';
  const st = await packetState(env, today);
  const dayN = st.day;
  if (st.complete) {
    await notifySubscribers(env, `Daily Result: PACKET FILED — Day ${dayN}`,
      `Micheal Ray Berry — Daily Result for ${today} (Day ${dayN})\n\nDaily Compliance Packet: all required files present at the 10:00 PM ET check.\n\nRecord: ${env.SITE_ORIGIN}/daily/\n`, 'daily');
    return 'complete';
  }
  const checkedAt = checkedAtEt(now);
  const queued = await flag(env, today, 'daily-packet', `Record-presence review — packet files were incomplete when checked at ${checkedAt}: ${st.missing.join(', ')}.`, 'nightly');
  await mailAP(env, `MRB Day ${dayN} — AP REVIEW REQUIRED: packet files incomplete when checked`,
    `Scheduled record-presence review for ${today} (Day ${dayN}).\n\n` +
    `Checked at: ${checkedAt}\nFiles absent then:\n- ${st.missing.join('\n- ')}\n\n` +
    (queued ? 'A private pending-review signal was added.\n\n' : 'The existing private review signal was retained.\n\n') +
    'This observation is not a deadline verdict or a Violation Event. Current file presence cannot prove filing time. Review the server-side receipts and any documented exception, then explicitly VERIFY or REJECT the signal in the AP console.\n\n' +
    'Each filed component carries its receipt time on the day\'s record, and every filing is in the audit log.', 'nightly-ap');
  // README §2.6 / owner's choice: subscribers hear the automated result, labelled as a flag the AP reviews.
  await notifySubscribers(env, `Daily Result: INCOMPLETE AT 10 PM — Day ${dayN}`,
    `Micheal Ray Berry — Daily Result for ${today} (Day ${dayN})\n\n` +
    `Automated check at 10:00 PM ET: the Daily Compliance Packet was not complete on the record.\nNot on record: ${st.missing.join(', ')}.\n\n` +
    'The Accountability Partner reviews receipts, evidence and any documented exception before confirming or rejecting a Violation Event (§8). An automated flag does not by itself establish a missed deadline.\n\n' +
    `Record: ${env.SITE_ORIGIN}/daily/\n`, 'daily');
  return 'flagged';
}

/** 22:20 ET on a required night: never writes MISSED (§6). */
export async function supervisionCheck(env: Env, now: Date): Promise<string> {
  const { gate, state, today } = await context(env, now);
  if (!supervisionRequiredOn(today, gate, state) || ended(gate)) return 'not required';
  const row = await env.DB.prepare('SELECT status FROM supervision WHERE date = ?').bind(today).first<{ status: string }>();
  if (row && /^(SUBMITTED|COMPLETED|EXCEPTION|MISSED|REVIEW REQUIRED)/i.test(row.status)) return `already ${row.status}`;
  const checkedAt = checkedAtEt(now);
  await env.DB.prepare(
    `INSERT INTO supervision (date, required, status, note) VALUES (?, 1, 'REVIEW REQUIRED', ?)
     ON CONFLICT(date) DO UPDATE SET status = 'REVIEW REQUIRED'`,
  ).bind(today, `Automated flag: no completed session record was present when checked at ${checkedAt}`).run();
  await flag(env, today, 'evening-supervision', `Supervision record-presence review — no submitted archive record was present when checked at ${checkedAt}.`, 'supervision');
  await mailAP(env, `REVIEW REQUIRED — Evening Supervision ${today}`,
    `No completed session record was present when the scheduled check ran at ${checkedAt}. This is an automated flag, not a ruling (§8). Review the Twitch broadcast, receipts and any documented §9 exception, then rule COMPLETED, MISSED or EXCEPTION in the AP console.`, 'supervision-ap');
  await buildSoon(env, 'supervision.review-required');
  return 'review required';
}

/** Every 5 minutes, 17:45–22:15 ET, on a required night. */
export async function twitchPoll(env: Env, now: Date): Promise<string> {
  const { gate, state, today } = await context(env, now);
  if (!supervisionRequiredOn(today, gate, state) || ended(gate)) return 'not required';
  if (!env.TWITCH_CLIENT_ID) return 'not configured';
  return pollSupervision(env, today, now);
}

// ───────────────────────────── hourly ─────────────────────────────

/** §8: past the exact due time with no session filed → a private flag for AP review. Never an escalation by itself. */
export async function correctiveDeadlineWatch(env: Env, now: Date): Promise<string> {
  const { gate } = await context(env, now);
  if (!gate.active) return 'inactive';
  const { results } = await env.DB.prepare(
    `SELECT v.date, c.assignment_id, c.due_at, c.revised_due_at FROM correctives c JOIN violations v ON v.id = c.violation_id
     WHERE c.completed_at IS NULL AND v.status = 'open'`,
  ).all<{ date: string; assignment_id: string; due_at: string; revised_due_at: string | null }>();
  const lapsed: string[] = [];
  for (const c of results) {
    const dueAt = c.revised_due_at ?? c.due_at;
    if (!appliesOn(c.date, gate) || Date.parse(dueAt) >= now.getTime()) continue;
    const added = await flag(env, etDate(new Date(dueAt)), 'corrective-deadline',
      `Corrective-window review — no recording was present when checked after the linked assignment due ${etLabel(dueAt)}.`, 'corrective-deadline', c.assignment_id);
    if (added) lapsed.push(`${c.assignment_id} (due ${etLabel(dueAt)})`);
  }
  if (lapsed.length) {
    await mailAP(env, 'AP REVIEW REQUIRED — possible corrective-window lapse',
      `The scheduled review found no corrective recording after the linked assignment due time(s): ${lapsed.join(', ')}.\n\n` +
      'Private pending-review signals were added. This is not a deadline verdict, escalation, or new Violation Event. Review the assignment and receipt evidence, then explicitly VERIFY or REJECT each signal.', 'corrective-deadline');
  }
  return `${lapsed.length} flagged`;
}

/** §7: a scale reading at or below a threshold is an observation; the milestone needs video + AP review. */
export async function milestoneWatch(env: Env, now: Date): Promise<string> {
  const { gate, state } = await context(env, now);
  if (!gate.active) return 'inactive';
  const latest = (await env.DB.prepare('SELECT date, weight_lb FROM days WHERE weight_lb IS NOT NULL ORDER BY date DESC LIMIT 14').all<{ date: string; weight_lb: number }>())
    .results.find((d) => appliesOn(d.date, gate));
  if (!latest) return 'no weight';
  const hit = JSON.parse(state.milestones_hit || '{}') as Record<string, string>;
  const priming = !state.milestones_hit;
  const sent: number[] = [];
  for (let m = 0; m < MILESTONES.length; m++) {
    const target = MILESTONES[m];
    if (latest.weight_lb > target || hit[target]) continue;
    hit[target] = latest.date;
    if (priming) continue;
    const day = dayNumber(latest.date);
    await mailMRB(env, `THRESHOLD RECORDED — ${target} lb scale row on Day ${day}`,
      `The scale row for ${latest.date} recorded ${latest.weight_lb} lb, at or below the ${target}-pound threshold.\n\n` +
      'This is a threshold observation, not an official milestone. The milestone requires\n' +
      'the required milestone video and Accountability Partner verification before it may be\n' +
      'described as reached or entered as official.\n\n' +
      (target === 200
        ? "If the 200-pound milestone is verified, completion still separately requires the\nagreement's sustained-weight period and official completion verification.\n"
        : `Next: ${MILESTONES[m + 1]} lb.\n`), 'milestone-mrb');
    await mailAP(env, `Threshold recorded — ${target} lb — verification required (${latest.date})`,
      `The scale row for ${latest.date} recorded ${latest.weight_lb} lb at or below the ${target}-pound threshold (Day ${day}).\n\n` +
      'Do not call this an official milestone yet. Verify the required milestone video and the\n' +
      'weigh-in evidence first; only an accepted AP review may mark the milestone official.', 'milestone-ap');
    sent.push(target);
  }
  await env.DB.prepare("INSERT INTO site_state (key, value) VALUES ('milestones_hit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(hit)).run();
  return priming ? 'primed' : `${sent.length} thresholds`;
}

// ───────────────────────────── weekly (Monday) ─────────────────────────────

async function reviewWindow(env: Env, gate: AgreementGate, today: string) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i - 7)).filter((d) => appliesOn(d, gate));
  const states = [];
  for (const d of dates) states.push({ date: d, ...(await packetState(env, d)) });
  return states;
}

export async function mrbWeeklyBrief(env: Env, now: Date): Promise<string> {
  const { gate, today } = await context(env, now);
  if (!gate.active || ended(gate)) return 'inactive';
  const days = await reviewWindow(env, gate, today);
  if (!days.length) return 'no active dates';
  const documented = days.filter((d) => d.complete).length;
  const missed = days.filter((d) => !d.complete).map((d) => `Day ${d.day} (${d.date}) — ${d.missing.join(', ')}`);
  const weights = days.filter((d) => d.row?.weight_lb != null).map((d) => d.row!.weight_lb as number);
  const trend = weights.length >= 2
    ? `Weight: ${weights[0]} → ${weights.at(-1)} lb (${weights.at(-1)! - weights[0] > 0 ? '+' : ''}${(weights.at(-1)! - weights[0]).toFixed(1)} this week).\nThe number is not a violation. Any documentation ruling requires explicit AP verification.\n`
    : weights.length === 1 ? `Weight: ${weights[0]} lb — one entry all week.\n` : 'No weight was recorded at all this week.\n';
  const c = await nextConsequence(env, gate);
  await mailMRB(env, `Week in review — ${documented} of ${days.length} eligible days documented`,
    `${documented} of ${days.length} eligible completed days since the ${gate.effectiveDate} effective date carry a complete record.\n\n${trend}\n` +
    (missed.length ? `Current incomplete file sets (timeliness not inferred):\n  - ${missed.join('\n  - ')}\n\n` : 'No incomplete file sets are currently shown for the reviewed dates.\n\n') +
    (c.open ? `${c.open} unresolved ${c.open === 1 ? 'entry remains' : 'entries remain'} on the public record.\nEach one stays open until the Accountability Partner verifies a completed session.\n`
      : 'No entries are open. The record is current.\n') +
    `\n${c.total} violation ${c.total === 1 ? 'entry has' : 'entries have'} been recorded since Day 1.\n` +
    'By default, resolution changes status while retaining durable record history. Publication\n' +
    'remains subject to safety, privacy, consent, and legal redaction or takedown requirements.', 'weekly-mrb');
  return 'sent';
}

export async function apWeeklyReview(env: Env, now: Date): Promise<string> {
  const { gate, today } = await context(env, now);
  if (!gate.active) return 'inactive';
  const days = await reviewWindow(env, gate, today);
  const lines = days.map((d) => `Day ${d.day} (${d.date}): ${d.row?.weight_lb != null ? `${Number(d.row.weight_lb).toFixed(1)} lb` : 'no weight'} · photos ${d.photos}/4 · video ${d.video ? '✓' : '✗'} · tracker ${d.tracker ? '✓' : '✗'}${d.complete ? '' : '  ← REVIEW'}`);
  const { results } = await env.DB.prepare("SELECT date, violation FROM violations WHERE status IN ('open', 'submitted') AND public_id IS NOT NULL ORDER BY date").all<{ date: string; violation: string }>();
  const pens = results.filter((v) => appliesOn(v.date, gate)).map((v) => `${v.date} — ${v.violation}`);
  const flags = (await env.DB.prepare("SELECT COUNT(*) AS n FROM violations WHERE status = 'flagged'").first<number>('n')) ?? 0;
  const needed = lines.some((l) => l.endsWith('← REVIEW')) || pens.length || flags;
  await mailAP(env, `MRB weekly review — ${today}${needed ? ' — ACTION NEEDED' : ' — clean week'}`,
    `Eligible completed days since agreement effective date (${gate.effectiveDate}): ${days.length}\n${lines.join('\n')}` +
    `\n\nUnresolved violations: ${pens.length ? `\n${pens.join('\n')}` : 'none'}` +
    `\nFlags awaiting your review: ${flags}` +
    '\n\n5-MINUTE CHECKLIST\n' +
    '1. Any ← REVIEW lines above: check the receipts and recordings, then verify or reject the flag (§8).\n' +
    '2. Unresolved violations: corrective corner time per §8; verify and mark resolved when done.\n' +
    "3. Spot-check one day's video + photos for documentation standard (§4, §5).\n" +
    `4. Confirm the site is up and showing current data: ${env.SITE_ORIGIN}\n` +
    '5. Note anything worth recording in the Updates log.', 'weekly-ap');
  return 'sent';
}

export async function subscriberWeeklyAudit(env: Env, now: Date): Promise<string> {
  const { gate, state, today } = await context(env, now);
  if (!gate.active) return 'inactive';
  const days = await reviewWindow(env, gate, today);
  if (!days.length) return 'no active dates';
  const filed = days.filter((d) => d.complete).length;
  const sup = days.filter((d) => supervisionRequiredOn(d.date, gate, state));
  let supMissed = 0;
  for (const d of sup) if (/^MISSED/i.test((await env.DB.prepare('SELECT status FROM supervision WHERE date = ?').bind(d.date).first<string>('status')) ?? '')) supMissed++;
  const c = await nextConsequence(env, gate);
  const week = Math.ceil((dayNumber(today) - 1) / 7);
  await notifySubscribers(env, `Weekly Audit — Week ${week}`,
    `Micheal Ray Berry — Weekly Audit, the 7 days ending ${addDays(today, -1)}\n\n` +
    `Packet filed: ${filed} of ${days.length} days\n` +
    // § §7: file presence is distinguished from a verified deadline outcome.
    `Packet files incomplete when checked: ${days.length - filed} (automated; only AP-verified misses are violations)\n` +
    `Evening Supervision: ${sup.length - supMissed} of ${sup.length} required sessions not ruled MISSED${supMissed ? ` · ${supMissed} MISSED` : ''}\n` +
    `Open violations: ${c.open} · total on record: ${c.total}\n\n` +
    `Weekly page: ${env.SITE_ORIGIN}/weeks/\n`, 'weekly');
  return 'sent';
}

// ───────────────────────────── 23:00: §11 and completion ─────────────────────────────

async function setState(env: Env, key: string, value: string | null) {
  if (value === null) await env.DB.prepare('DELETE FROM site_state WHERE key = ?').bind(key).run();
  else await env.DB.prepare('INSERT INTO site_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

/** §2, §7: 28 consecutive qualifying days ≤ 200.0 lb, then AP confirmation. Alerts the AP only. */
async function completionStreakAlert(env: Env, gate: AgreementGate, state: SiteState, today: string) {
  if (gate.ended?.kind === 'completed') return;
  let streak = 0;
  let d = today;
  let skippedToday = false;
  for (let i = 0; i < 60; i++) {
    const w = await env.DB.prepare('SELECT weight_lb FROM days WHERE date = ?').bind(d).first<number | null>('weight_lb');
    if (w != null && w <= 200 && appliesOn(d, gate)) { streak++; }
    else if (d === today && !skippedToday) { skippedToday = true; }
    else break;
    d = addDays(d, -1);
  }
  const at = streak >= 28 ? 28 : streak >= 21 ? 21 : streak >= 14 ? 14 : 0;
  if (!at || state[`completion_alert_${at}`]) return;
  await setState(env, `completion_alert_${at}`, today);
  if (at === 28) {
    await mailAP(env, 'COMPLETION CONDITION MET — 28 days at/under 200 (§2, §7)',
      'The tracker shows 28 consecutive days at or under 200.0 lbs.\n\nSchedule the official on-camera completion weigh-in (§7). Once verified, record completion in the AP console.', 'completion');
  } else {
    await mailAP(env, `Completion watch — ${streak} days at/under 200`, `${streak} consecutive days at or under 200.0 lbs. At 28, the completion condition is met pending the official weigh-in.`, 'completion');
  }
}

/** §11: 30 consecutive active days without documentation → AP review. Nothing public changes automatically. */
export async function abandonmentWatch(env: Env, now: Date): Promise<string> {
  const { gate, state, today } = await context(env, now);
  if (!gate.active || ended(gate)) return 'inactive';
  await completionStreakAlert(env, gate, state, today);
  let streak = 0;
  for (let d = addDays(today, -1); streak < 60 && appliesOn(d, gate); d = addDays(d, -1)) {
    if ((await packetState(env, d)).complete) break;
    streak++;
  }
  if (streak < 30 && state.abandonment_review_signal) await setState(env, 'abandonment_review_signal', null);
  if (streak >= 30) {
    if (state.abandonment_review_signal) return `streak ${streak}, signalled`;
    await setState(env, 'abandonment_review_signal', `pending:${today}`);
    await mailAP(env, 'AP REVIEW REQUIRED — 30 incomplete current file sets',
      `The current record-presence count reached ${streak} consecutive days without a complete file set.\n\n` +
      'This count does not prove filing timeliness and has not changed the public record. Review receipts and exceptions; if you rule that the §11 standard is met, send the written notice and allow the seven-day opportunity to resume before recording any ending.', 'abandonment-ap');
    return `streak ${streak}, AP asked to review`;
  }
  if ([7, 14, 21].includes(streak)) {
    await mailMRB(env, `RECORD-PRESENCE WATCH — ${streak} incomplete days`,
      `${streak} consecutive days currently lack a complete public file set. This does not establish filing time or an adverse ruling.\n\n` +
      'At 30 the Accountability Partner is asked to review the record and exceptions; the site does not make that judgement automatically.\n\n' +
      `File tonight: ${ASSISTANT(env)}`, 'abandonment-mrb');
    await mailAP(env, `Record-presence warning — ${streak} incomplete days`,
      `${streak} consecutive days currently lack a complete public file set. This is not a deadline verdict. At 30, review receipts and exceptions before any §11 ruling.`, 'abandonment-ap');
  }
  return `streak ${streak}`;
}

// ───────────────────────────── 00:10 ─────────────────────────────

export async function nightlyBuildAndBackup(env: Env, now: Date): Promise<string> {
  const build = await runBuild(env, 'nightly', now);
  const dump = await backup(env, etDate(new Date(now.getTime() - 3600_000)));
  return `build ${build.built ? 'done' : build.reason}; backup ${dump}`;
}

export const JOBS: Job[] = [
  { name: 'morning-brief', slot: dailyAt(7, 0), run: (env, now) => morningBrief(env, now) },
  { name: 'evening-warning', slot: dailyAt(20, 0), run: (env, now) => eveningWarning(env, now) },
  { name: 'nightly-check', slot: dailyAt(22, 0), run: (env, now) => nightlyCheck(env, now) },
  { name: 'supervision-check', slot: dailyAt(22, 20), run: (env, now) => supervisionCheck(env, now) },
  { name: 'twitch-poll', slot: everyTickBetween([17, 45], [22, 15]), run: (env, now) => twitchPoll(env, now) },
  { name: 'fitbit-sync', slot: hourly, run: (env, now) => syncWeights(env, now) },
  { name: 'corrective-deadline', slot: hourly, run: (env, now) => correctiveDeadlineWatch(env, now) },
  { name: 'milestone-watch', slot: hourly, run: (env, now) => milestoneWatch(env, now) },
  { name: 'weekly-mrb', slot: dailyAt(9, 0, 55, [1]), run: (env, now) => mrbWeeklyBrief(env, now) },
  { name: 'weekly-ap', slot: dailyAt(9, 0, 55, [1]), run: (env, now) => apWeeklyReview(env, now) },
  { name: 'weekly-subscribers', slot: dailyAt(9, 30, 55, [1]), run: (env, now) => subscriberWeeklyAudit(env, now) },
  { name: 'abandonment-watch', slot: dailyAt(23, 0), run: (env, now) => abandonmentWatch(env, now) },
  { name: 'nightly-build-backup', slot: dailyAt(0, 10), run: (env, now) => nightlyBuildAndBackup(env, now) },
];

