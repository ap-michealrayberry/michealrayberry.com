/* The rules the code enforces, taken from contract-2026-10-03.txt (Edition 2).
   Every scheduled time is America/New_York, including daylight saving time. */

export const TZ = 'America/New_York';
export const EDITION = '2';
/* §1, §12: Day 1 is fixed by the signed edition. No setting moves it. */
export const DAY_ONE = '2026-10-03';
export const PACKET_DEADLINE = { hour: 22, minute: 0 }; // §4: 10:00 PM Eastern
export const CORRECTIVE_WINDOW_MS = 72 * 3600 * 1000; // §8
/* §6: nights preceding a scheduled workday, ordinarily Sunday–Thursday. The AP
   records the applicable schedule (site_state.supervision_days, 0 = Sunday). */
export const DEFAULT_SUPERVISION_DAYS = [0, 1, 2, 3, 4];
export const MILESTONES = [320, 300, 275, 250, 225, 200]; // §7
export const GOAL_LB = 200.0;
export const GOAL_STREAK_DAYS = 28;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function etParts(instant: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of etFormatter.formatToParts(instant)) p[type] = value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

/** The Eastern calendar date of an instant, as YYYY-MM-DD. */
export function etDate(instant: Date): string {
  const p = etParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The UTC instant of an Eastern wall-clock time on an Eastern date. */
export function etWallTime(date: string, hour: number, minute = 0): Date {
  if (!isIsoDate(date)) throw new Error(`invalid date: ${date}`);
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  // Offset of ET from UTC at a given instant, in ms (negative: ET is behind).
  const offsetAt = (ms: number) => {
    const p = etParts(new Date(ms));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return new Date(guess);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

/** Project Day number for a date (Day 1 = 2026-10-03). Dates before Day 1 return 0 or less. */
export function dayNumber(date: string): number {
  return daysBetween(DAY_ONE, date) + 1;
}

/** §4: the Daily Compliance Packet for `date` is due at 10:00 PM Eastern that date. */
export function packetDeadline(date: string): Date {
  return etWallTime(date, PACKET_DEADLINE.hour, PACKET_DEADLINE.minute);
}

/** §8: the corrective session is due 72 hours after the assignment notice. */
export function correctiveDueAt(assignedAt: Date): Date {
  return new Date(assignedAt.getTime() + CORRECTIVE_WINDOW_MS);
}

/** §8: level follows the accumulated count of confirmed violations; third and later are Level Three. */
export function correctiveFor(confirmedCount: number): { level: 1 | 2 | 3; minutes: 10 | 20 | 30 } {
  if (!Number.isInteger(confirmedCount) || confirmedCount < 1) {
    throw new Error('a corrective requires at least one confirmed violation');
  }
  if (confirmedCount === 1) return { level: 1, minutes: 10 };
  if (confirmedCount === 2) return { level: 2, minutes: 20 };
  return { level: 3, minutes: 30 };
}

export function parseSupervisionDays(value: string | undefined): number[] {
  if (value === undefined || value.trim() === '') return DEFAULT_SUPERVISION_DAYS;
  const days = value.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error(`invalid supervision_days: ${value}`);
  }
  return [...new Set(days)].sort();
}

/** Weekday of an ISO date, 0 = Sunday. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export type SiteState = Record<string, string>;

export interface AgreementGate {
  active: boolean;
  today: string;
  effectiveDate: string;
  /** Set when participation ended (withdrawal, completion, archival ending). */
  ended: { kind: 'withdrawn' | 'completed' | 'abandoned'; date: string } | null;
  missing: string[];
}

/**
 * §1: the agreement is operative only after both signatures are personally
 * verified and the Edition 2 consent confirmation has been filed and reviewed
 * by the AP. The effective date is the latest of the project start date and
 * those four dates. Nothing is enforced before it, nothing retroactively.
 *
 * `consentFilings` are the dates of filed Edition 2 confirmations; the
 * recorded consent date must match one of them.
 */
export function agreementGate(state: SiteState, consentFilings: string[], today: string): AgreementGate {
  const missing: string[] = [];
  const date = (key: string, label: string) => {
    const value = (state[key] ?? '').trim();
    if (!value) { missing.push(label); return ''; }
    if (!isIsoDate(value)) { missing.push(`valid ${label} (${key} is not YYYY-MM-DD)`); return ''; }
    if (value > today) { missing.push(`${label} is in the future`); return ''; }
    return value;
  };

  if ((state.agreement_edition ?? '') !== EDITION) missing.push('Edition 2 selected (agreement_edition = 2)');
  const participant = date('participant_signature_verified_on', 'verified participant signature');
  const ap = date('ap_signature_verified_on', 'verified AP signature');
  const consent = date('consent_recording_date', 'accepted consent recording');
  const reviewed = date('consent_reviewed_on', 'AP consent review');

  // The signed edition is dated Day 1; a verification before it cannot be of this edition.
  if (participant && participant < DAY_ONE) missing.push('participant signature verified on or after 2026-10-03');
  if (ap && ap < DAY_ONE) missing.push('AP signature verified on or after 2026-10-03');
  if (consent && !consentFilings.includes(consent)) missing.push('a filed Edition 2 consent confirmation dated consent_recording_date');
  if (consent && reviewed && reviewed < consent) missing.push('consent review on or after the consent recording');

  let effectiveDate = '';
  if (participant && ap && consent && reviewed) {
    effectiveDate = [DAY_ONE, participant, ap, consent, reviewed].sort().pop() as string;
    const recorded = (state.effective_date ?? '').trim();
    if (recorded && recorded !== effectiveDate) {
      missing.push(`recorded effective_date ${recorded} disagrees with the computed ${effectiveDate}`);
    }
  }
  if (effectiveDate && effectiveDate > today) missing.push('effective date has not arrived');

  let ended: AgreementGate['ended'] = null;
  for (const kind of ['withdrawn', 'completed', 'abandoned'] as const) {
    const value = (state[kind] ?? '').trim();
    if (isIsoDate(value) && value <= today && (!ended || value < ended.date)) ended = { kind, date: value };
  }

  return { active: missing.length === 0 && !!effectiveDate, today, effectiveDate, ended, missing };
}

/**
 * Whether the agreement's requirements apply to a record date: on or after the
 * effective date, and before any withdrawal, completion or archival ending (§11).
 */
export function appliesOn(date: string, gate: AgreementGate): boolean {
  if (!gate.active || !isIsoDate(date) || date < gate.effectiveDate || date > gate.today) return false;
  return !gate.ended || date < gate.ended.date;
}

/** §6: whether Evening Supervision is required on the night of `date`. */
export function supervisionRequiredOn(date: string, gate: AgreementGate, state: SiteState): boolean {
  return appliesOn(date, gate) && parseSupervisionDays(state.supervision_days).includes(weekday(date));
}

export interface PacketRow {
  weight_lb: number | null;
  video: string | null;
  photo_front: string | null;
  photo_left: string | null;
  photo_rear: string | null;
  photo_right: string | null;
}

/** §4: all four components — weight, inspection video, four photographs, tracker row. */
export function packetComponents(row: PacketRow | null) {
  const photos = row ? [row.photo_front, row.photo_left, row.photo_rear, row.photo_right].filter(Boolean).length : 0;
  const parts = {
    tracker: !!row,
    weight: row?.weight_lb != null,
    video: !!row?.video,
    photos,
  };
  return { ...parts, complete: parts.tracker && parts.weight && parts.video && photos === 4 };
}
