/**
 * Single source of truth for the public record.
 * Homepage, daily archive, violation log, dashboard, and assistant
 * all read from here so counters, banners, and labels cannot drift.
 */

export const SITE_NAME = "Micheal Ray Berry — Public Accountability Project";
export const SUBJECT_NAME = "Micheal Ray Berry";
export const START_DATE = "2026-08-13";
export const START_WEIGHT = 340;
export const GOAL_WEIGHT = 175;
export const DEADLINE_HOUR_ET = 22;
export const MILESTONES = [300, 275, 250, 225, 200, 175] as const;

export const AP_EMAIL = "ap@michealrayberry.com";
export const SUBJECT_EMAIL = "contact@michealrayberry.com";
export const YOUTUBE = "https://www.youtube.com/@michealrayberry";
export const X_PROFILE = "https://x.com/michealrayberry";
export const GITHUB = "https://github.com/ap-michealrayberry/michealrayberry.com";
export const BSKY = "https://bsky.app/profile/michealrayberry.bsky.social";

export type Angle = "front" | "left" | "rear" | "right";
export const ANGLES: Angle[] = ["front", "left", "rear", "right"];

export type DayStatus = "complete" | "incomplete" | "due" | "no-record";
export type ViolationStatus = "open" | "resolved" | "specimen";

export type Photos = Partial<Record<Angle, string>>;

export type ProjectDay = {
  date: string;
  day: number;
  weight: number | null;
  photos: Photos;
  hasVideo: boolean;
  videoLabel: string | null;
  youtubeUrl: string | null;
  attestation: string | null;
  notes: string;
};

export type Violation = {
  id: string;
  slug: string;
  date: string;
  day: number;
  requirement: string;
  detail: string;
  status: ViolationStatus;
  submitted: string | null;
  resolved: string | null;
  verification: string | null;
  itemsMissing: number;
  isSpecimen: boolean;
};

export type UpdateEntry = {
  date: string;
  by: "Accountability Partner" | "Micheal Ray Berry";
  title: string;
  body: string;
};

function photo(date: string, day: number, angle: Angle): string {
  const [y, m, d] = date.split("-");
  const n = String(day).padStart(3, "0");
  return `/photos/${y}/${m}/${d}/micheal-ray-berry-day-${n}-${angle}-${date}.jpg`;
}

function four(date: string, day: number): Photos {
  return {
    front: photo(date, day, "front"),
    left: photo(date, day, "left"),
    rear: photo(date, day, "rear"),
    right: photo(date, day, "right"),
  };
}

/** Canonical day rows. Status is derived — never stored twice. */
export const DAYS: ProjectDay[] = [
  {
    date: "2026-08-13",
    day: 1,
    weight: 337.0,
    photos: four("2026-08-13", 1),
    hasVideo: true,
    videoLabel: "Day 1 inspection video — on file",
    youtubeUrl: YOUTUBE,
    attestation: null,
    notes: "First filed weigh-in. Capture attestation was late (V-001) and later verified.",
  },
  {
    date: "2026-08-14",
    day: 2,
    weight: null,
    photos: {},
    hasVideo: false,
    videoLabel: null,
    youtubeUrl: null,
    attestation: null,
    notes: "Daily Compliance Packet incomplete — two required items missing.",
  },
  {
    date: "2026-08-15",
    day: 3,
    weight: null,
    photos: four("2026-08-15", 3),
    hasVideo: false,
    videoLabel: null,
    youtubeUrl: null,
    attestation: null,
    notes: "Four-angle photographs on file. The Daily Compliance Packet was not complete.",
  },
  {
    date: "2026-08-16",
    day: 4,
    weight: 336.9,
    photos: four("2026-08-16", 4),
    hasVideo: true,
    videoLabel: "Day 4 inspection video — on file",
    youtubeUrl: YOUTUBE,
    attestation: "4340 · VALID — code issued before attest",
    notes: "Complete packet: inspection video, four-angle photographs, weight, tracker update.",
  },
];

export const VIOLATIONS: Violation[] = [
  {
    id: "V-000",
    slug: "v-000",
    date: "2026-08-13",
    day: 1,
    requirement:
      "Demonstration — what a violation entry looks like. Answers no violation.",
    detail:
      "Specimen row only. It exists so the log format is visible even when the record is clean. It is not a violation and answers none.",
    status: "specimen",
    submitted: null,
    resolved: null,
    verification: "Not a violation",
    itemsMissing: 0,
    isSpecimen: true,
  },
  {
    id: "V-001",
    slug: "v-001",
    date: "2026-08-13",
    day: 1,
    requirement:
      "Missed 10 PM ET deadline — capture attestation (no challenge code / file fingerprints logged that day)",
    detail:
      "The Day 1 packet photographs and weigh-in were filed. The capture attestation — challenge code and file fingerprints — was not logged by the deadline. A corrective session was recorded, submitted 2026-08-15 22:18, and verified by the Accountability Partner the same day. The obligation is closed. The entry stays.",
    status: "resolved",
    submitted: "2026-08-15 22:18",
    resolved: "2026-08-15",
    verification: "Verified by the Accountability Partner",
    itemsMissing: 0,
    isSpecimen: false,
  },
  {
    id: "V-002",
    slug: "v-002",
    date: "2026-08-14",
    day: 2,
    requirement: "Incomplete record — Daily Compliance Packet incomplete (2 items)",
    detail:
      "Day 2 did not deliver a complete Daily Compliance Packet. Two required items remain missing. No corrective session has been submitted. The entry is open.",
    status: "open",
    submitted: null,
    resolved: null,
    verification: null,
    itemsMissing: 2,
    isSpecimen: false,
  },
  {
    id: "V-003",
    slug: "v-003",
    date: "2026-08-15",
    day: 3,
    requirement: "Incomplete record — the Daily Compliance Packet was not complete",
    detail:
      "Day 3 has four-angle photographs on file. The Daily Compliance Packet as a whole was not complete by 10:00 PM Eastern. No corrective session has been submitted. The entry is open.",
    status: "open",
    submitted: null,
    resolved: null,
    verification: null,
    itemsMissing: 1,
    isSpecimen: false,
  },
];

export const UPDATES: UpdateEntry[] = [
  {
    date: "2026-08-16",
    by: "Accountability Partner",
    title: "Record consistency",
    body: "Day 4 is published as a complete record: inspection video and all four photographs are on file, so it is not marked incomplete before the deadline. The homepage open count now matches the Violation Log (V-002 and V-003). V-001 shows the Accountability Partner verification already recorded on its detail page.",
  },
  {
    date: "2026-08-15",
    by: "Accountability Partner",
    title: "Uniform amendment — collar",
    body: "From 15 August 2026 the project uniform includes a titanium collar, worn closed in every official photograph and inspection so each entry matches the same standard. Days 1–2 stay as filed. This is an amendment, not a rewrite of the signed §4.1 text. A missing collar is a documentation failure, same class as a missed packet.",
  },
];

export function etNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  return { iso, hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function deadlinePending(iso: string, now = new Date()) {
  const { iso: today, hour } = etNow(now);
  if (iso > today) return true;
  if (iso < today) return false;
  return hour < DEADLINE_HOUR_ET;
}

export function dayNumber(iso: string) {
  const start = Date.parse(`${START_DATE}T12:00:00Z`);
  const here = Date.parse(`${iso}T12:00:00Z`);
  return Math.floor((here - start) / 86_400_000) + 1;
}

export function longDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function daySlug(d: { date: string; day: number }) {
  return `${d.date}-day-${String(d.day).padStart(3, "0")}`;
}

export function photoCount(photos: Photos) {
  return ANGLES.filter((a) => Boolean(photos[a])).length;
}

export function hasAllPhotos(photos: Photos) {
  return photoCount(photos) === 4;
}

/**
 * A day is complete when the required media is on file.
 * It is never labeled incomplete while its 10 PM ET deadline is still ahead.
 */
export function dayStatus(day: ProjectDay, now = new Date()): DayStatus {
  if (day.hasVideo && hasAllPhotos(day.photos) && day.weight != null) {
    return "complete";
  }
  if (deadlinePending(day.date, now)) return "due";
  const v = violationForDay(day.date);
  if (v && /incomplete/i.test(v.requirement)) return "incomplete";
  if (photoCount(day.photos) > 0 || day.hasVideo || day.weight != null) {
    return "incomplete";
  }
  return "no-record";
}

export function statusLabel(status: DayStatus) {
  switch (status) {
    case "complete":
      return "Complete record";
    case "incomplete":
      return "Incomplete record";
    case "due":
      return "Due by 10 PM ET";
    case "no-record":
      return "No record";
  }
}

export function realViolations() {
  return VIOLATIONS.filter((v) => !v.isSpecimen);
}

export function openViolations() {
  return realViolations().filter((v) => v.status === "open");
}

export function violationForDay(date: string) {
  return realViolations().find((v) => v.date === date) ?? null;
}

export function dayByDate(date: string) {
  return DAYS.find((d) => d.date === date) ?? null;
}

export function dayBySlug(slug: string) {
  return DAYS.find((d) => daySlug(d) === slug) ?? null;
}

export function latestCompleteDay() {
  return [...DAYS].reverse().find((d) => dayStatus(d) === "complete") ?? null;
}

export function lastRecordedWeight() {
  return [...DAYS].reverse().find((d) => d.weight != null)?.weight ?? START_WEIGHT;
}

export function allCalendarDays(now = new Date()) {
  const { iso: today } = etNow(now);
  const lastFiled = DAYS.at(-1)?.date ?? START_DATE;
  const latest = today > lastFiled ? today : lastFiled;
  const out: { date: string; day: number; entry: ProjectDay | null }[] = [];
  for (
    let t = Date.parse(`${START_DATE}T12:00:00Z`);
    ;
    t += 86_400_000
  ) {
    const iso = new Date(t).toISOString().slice(0, 10);
    out.push({
      date: iso,
      day: dayNumber(iso),
      entry: dayByDate(iso),
    });
    if (iso >= latest) break;
  }
  return out;
}

export function daysWithoutViolation() {
  return allCalendarDays().filter((d) => {
    const v = violationForDay(d.date);
    if (v) return false;
    const status = d.entry ? dayStatus(d.entry) : deadlinePending(d.date) ? "due" : "no-record";
    return status === "complete";
  }).length;
}

export function nextMilestone(weight = lastRecordedWeight()) {
  return MILESTONES.find((m) => weight > m) ?? GOAL_WEIGHT;
}

export type RecordSnapshot = {
  todayIso: string;
  currentDayNumber: number;
  startWeight: number;
  lastWeight: number;
  goalWeight: number;
  lost: number;
  toGoal: number;
  nextMilestone: number;
  toMilestone: number;
  open: Violation[];
  openCount: number;
  cleanDays: number;
  documentedDays: number;
  incompleteDays: number;
  dueDays: number;
  latestComplete: ProjectDay | null;
  latestHero: ProjectDay;
};

export function getSnapshot(now = new Date()): RecordSnapshot {
  const { iso: todayIso } = etNow(now);
  const lastWeight = lastRecordedWeight();
  const milestone = nextMilestone(lastWeight);
  const calendar = allCalendarDays(now);
  const open = openViolations();
  const latestComplete = latestCompleteDay();
  return {
    todayIso,
    currentDayNumber: dayNumber(todayIso),
    startWeight: START_WEIGHT,
    lastWeight,
    goalWeight: GOAL_WEIGHT,
    lost: Number((START_WEIGHT - lastWeight).toFixed(1)),
    toGoal: Number((lastWeight - GOAL_WEIGHT).toFixed(1)),
    nextMilestone: milestone,
    toMilestone: Number((lastWeight - milestone).toFixed(1)),
    open,
    openCount: open.length,
    cleanDays: daysWithoutViolation(),
    documentedDays: calendar.filter((d) => d.entry && dayStatus(d.entry) === "complete").length,
    incompleteDays: calendar.filter((d) => {
      if (!d.entry) return false;
      return dayStatus(d.entry) === "incomplete";
    }).length,
    dueDays: calendar.filter((d) => {
      if (d.entry && dayStatus(d.entry) === "complete") return false;
      return deadlinePending(d.date, now) && (!d.entry || dayStatus(d.entry) === "due");
    }).length,
    latestComplete,
    latestHero: latestComplete ?? DAYS[0],
  };
}

export function lb(n: number) {
  return n.toFixed(1);
}

export function weekOf(day: number) {
  return Math.ceil(day / 7);
}
