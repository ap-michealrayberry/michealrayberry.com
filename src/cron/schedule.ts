/* The Worker's one cron trigger (every 5 minutes) runs this. Workers cron is
   UTC; the contract's times are Eastern including DST (§1), so each job's slot
   is computed on the Eastern clock here. A job runs at most once per slot
   (job_runs); a failed run releases its slot so the next tick retries, and a
   tick missed by Cloudflare is caught up within the job's window. */
import { etDate, etWallTime } from '../rules';

export interface Job {
  name: string;
  /** The slot this tick falls in, or null when the job is not due now. */
  slot(now: Date): string | null;
  run(env: Env, now: Date, slot: string): Promise<string>;
}

const etHourMinute = (now: Date) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
};

/** A daily job at hh:mm ET, runnable for `windowMin` minutes after (catch-up). */
export function dailyAt(hour: number, minute: number, windowMin = 55, weekdays?: number[]) {
  return (now: Date): string | null => {
    const date = etDate(now);
    const at = etWallTime(date, hour, minute).getTime();
    if (now.getTime() < at || now.getTime() >= at + windowMin * 60_000) return null;
    if (weekdays && !weekdays.includes(etHourMinute(now).weekday)) return null;
    return date;
  };
}

/** Once per Eastern hour, in its first 55 minutes. */
export function hourly(now: Date): string {
  const { hour } = etHourMinute(now);
  return `${etDate(now)}T${String(hour).padStart(2, '0')}`;
}

/** Every tick between two Eastern times, slot = the 5-minute tick. */
export function everyTickBetween(from: [number, number], to: [number, number]) {
  return (now: Date): string | null => {
    const date = etDate(now);
    const t = now.getTime();
    if (t < etWallTime(date, ...from).getTime() || t > etWallTime(date, ...to).getTime()) return null;
    return new Date(Math.floor(t / 300_000) * 300_000).toISOString();
  };
}

export async function runDue(env: Env, jobs: Job[], now: Date): Promise<Record<string, string>> {
  const outcomes: Record<string, string> = {};
  for (const job of jobs) {
    const slot = job.slot(now);
    if (!slot) continue;
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO job_runs (job, slot) VALUES (?, ?)').bind(job.name, slot).run();
    if (claim.meta.changes !== 1) continue;
    try {
      const outcome = await job.run(env, now, slot);
      await env.DB.prepare('UPDATE job_runs SET finished_at = ?, outcome = ? WHERE job = ? AND slot = ?')
        .bind(new Date().toISOString(), outcome.slice(0, 500), job.name, slot).run();
      outcomes[job.name] = outcome;
    } catch (error) {
      // Release the slot: the next tick inside the window tries again.
      await env.DB.prepare('DELETE FROM job_runs WHERE job = ? AND slot = ?').bind(job.name, slot).run();
      console.error(JSON.stringify({ message: 'job failed', job: job.name, slot, error: String((error as Error)?.stack ?? error) }));
      outcomes[job.name] = `failed: ${String((error as Error)?.message ?? error)}`;
    }
  }
  return outcomes;
}
