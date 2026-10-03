/* GET /api/me — read-only view of what is due and owed today.
   Nothing here writes; filing endpoints arrive with the filing API (step 3). */
import { appliesOn, dayNumber, etDate, packetComponents, packetDeadline, supervisionRequiredOn, type PacketRow } from '../rules';
import { loadGate, loadSiteState } from '../state';
import type { Identity } from '../auth/access';

type Me = Extract<Identity, { ok: true }>;

export async function getMe(db: D1Database, who: Me, now = new Date()) {
  const today = etDate(now);
  const state = await loadSiteState(db);
  const gate = await loadGate(db, now, state);
  const deadline = packetDeadline(today);

  const [packet, supervision, violations, owed, requests] = await Promise.all([
    db.prepare('SELECT weight_lb, video, photo_front, photo_left, photo_rear, photo_right FROM days WHERE date = ?')
      .bind(today).first<PacketRow>(),
    db.prepare('SELECT status, start_at, end_at FROM supervision WHERE date = ?')
      .bind(today).first<{ status: string; start_at: string | null; end_at: string | null }>(),
    db.prepare(`SELECT id, public_id, date, violation, status, verified_at, submitted_at, resolved_at
                FROM violations WHERE status IN ('open', 'submitted', 'resolved') ORDER BY date, id`)
      .all<{ id: number; public_id: string; date: string; violation: string; status: string; verified_at: string | null; submitted_at: string | null; resolved_at: string | null }>(),
    db.prepare(`SELECT c.assignment_id, c.level, c.minutes, c.assigned_at, c.due_at, c.revised_due_at, c.status,
                       v.public_id, v.date
                FROM correctives c JOIN violations v ON v.id = c.violation_id
                WHERE c.completed_at IS NULL AND v.status IN ('open', 'submitted') ORDER BY c.due_at`)
      .all<{ assignment_id: string; level: number; minutes: number; assigned_at: string; due_at: string; revised_due_at: string | null; status: string; public_id: string; date: string }>(),
    db.prepare(`SELECT r.received_at, r.status, r.ap_note, v.public_id
                FROM correction_requests r JOIN violations v ON v.id = r.violation_id ORDER BY r.received_at`)
      .all<{ received_at: string; status: string; ap_note: string | null; public_id: string }>(),
  ]);

  // Only events on or after the effective date are Violation Events under this agreement (§1, §8).
  const record = violations.results.filter((v) => appliesOn(v.date, gate));

  return {
    role: who.role,
    email: who.email,
    today,
    day: dayNumber(today) >= 1 ? dayNumber(today) : null,
    agreement: {
      active: gate.active,
      effective_date: gate.effectiveDate || null,
      ended: gate.ended,
      missing: gate.missing,
    },
    packet: {
      required: appliesOn(today, gate),
      deadline: deadline.toISOString(),
      seconds_left: Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 1000)),
      ...packetComponents(packet),
    },
    owed: owed.results
      .filter((c) => appliesOn(c.date, gate))
      .map(({ date: _date, ...c }) => ({ ...c, due_at: c.revised_due_at ?? c.due_at })),
    supervision: {
      required: supervisionRequiredOn(today, gate, state),
      status: supervision?.status ?? null,
      start_at: supervision?.start_at ?? null,
      end_at: supervision?.end_at ?? null,
    },
    violations: record.map(({ id: _id, ...v }) => v),
    correction_requests: requests.results,
    // Twitch live state comes from the cron poller (step 4).
    twitch: null,
  };
}
