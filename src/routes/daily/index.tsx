import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome, ViewSwitch } from "@/components/site-chrome";
import {
  allCalendarDays,
  daySlug,
  dayStatus,
  deadlinePending,
  getSnapshot,
  longDate,
  statusLabel,
  violationForDay,
} from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/daily/")({
  head: () => {
    const snap = getSnapshot();
    return pageHead({
      title: "Daily record — Micheal Ray Berry official weigh-in archive",
      description: `Every published day of Micheal Ray Berry's official weigh-in record. Declared start 340 lb, first filed 337.0 lb. ${snap.documentedDays} documented days, plus gaps. Photographs, weight, inspection video.`,
      path: "/daily/",
    });
  },
  component: DailyIndex,
});

function DailyIndex() {
  const snap = getSnapshot();
  const days = [...allCalendarDays()].reverse();

  return (
    <SiteChrome current="Daily record">
      <PageHead
        eyebrow="Official public record · MichealRayBerry.com"
        title="Daily Record"
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/daily", label: "Daily Record" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <ViewSwitch
          items={[
            { to: "/daily", label: "Days", current: true },
            { to: "/weeks", label: "Weeks" },
            { to: "/dashboard", label: "Dashboard" },
          ]}
        />
        <p className="max-w-[760px] text-base">
          Every published day, newest first. Documented days hold that day's
          four-angle photographs, the recorded weight, and the inspection video.
          Days whose packet was filed but is missing a required element are marked{" "}
          <strong>Incomplete record</strong>. The current day shows as{" "}
          <strong>due</strong> until its 10 PM Eastern deadline — unless the
          complete packet is already on file, in which case it is published as a
          complete record. Gaps are part of the record.
        </p>
        <p className="mt-4 font-mono text-sm font-semibold tracking-[0.08em]">
          <strong>{snap.documentedDays}</strong> documented days
          {snap.incompleteDays ? (
            <>
              {" "}
              · <strong>{snap.incompleteDays}</strong> incomplete{" "}
              {snap.incompleteDays === 1 ? "record" : "records"}
            </>
          ) : null}
          {snap.dueDays ? (
            <>
              {" "}
              · <strong>{snap.dueDays}</strong> still due
            </>
          ) : null}
        </p>

        <ul className="mt-8 grid list-none grid-cols-2 gap-5 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {days.map(({ date, day, entry }) => {
            const status = entry
              ? dayStatus(entry)
              : (() => {
                  const miss = violationForDay(date);
                  if (miss && /incomplete/i.test(miss.requirement)) return "incomplete" as const;
                  return deadlinePending(date) ? ("due" as const) : ("no-record" as const);
                })();
            const v = violationForDay(date);
            if (entry && status === "complete") {
              const front = entry.photos.front;
              return (
                <li key={date} className="border border-ink bg-white">
                  <Link to="/daily/$slug" params={{ slug: daySlug(entry) }} className="block no-underline">
                    {front ? (
                      <img
                        src={front}
                        alt={`Micheal Ray Berry front, Day ${day}, ${longDate(date)}${entry.weight ? `, ${entry.weight.toFixed(1)} lb` : ""}`}
                        className="block w-full"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="flex flex-col gap-0.5 px-3 py-2.5 font-mono text-xs uppercase">
                      <strong>Day {day}</strong>
                      <span>{longDate(date)}</span>
                      {entry.weight ? (
                        <span className="font-bold">{entry.weight.toFixed(1)} lb</span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            }

            const label = status ? statusLabel(status) : "Due by 10 PM ET";
            const pending = !entry || status === "due";
            return (
              <li
                key={date}
                className={`border ${pending ? "border-rule" : "border-accent"}`}
              >
                <Link to="/daily/$slug" params={{ slug: `${date}-day-${String(day).padStart(3, "0")}` }} className="block no-underline">
                  <div
                    className={`flex aspect-[9/16] items-center justify-center bg-[repeating-linear-gradient(45deg,var(--color-paper-dim),var(--color-paper-dim)_10px,var(--color-rule)_10px,var(--color-rule)_20px)]`}
                  >
                    <span
                      className={`px-3 text-center font-mono text-[13px] font-bold tracking-[0.2em] ${pending ? "text-muted" : "text-accent"}`}
                    >
                      {label.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 px-3 py-2.5 font-mono text-xs uppercase">
                    <strong>Day {day}</strong>
                    <span>{longDate(date)}</span>
                    <span className={`font-bold ${pending ? "text-muted" : "text-accent"}`}>
                      {label}
                      {v && !v.isSpecimen ? ` · ${v.id}` : ""}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </SiteChrome>
  );
}
