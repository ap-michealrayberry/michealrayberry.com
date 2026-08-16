import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteChrome, StatGrid } from "@/components/site-chrome";
import {
  AP_EMAIL,
  SUBJECT_EMAIL,
  SUBJECT_NAME,
  getSnapshot,
  lb,
} from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      title: "Micheal Ray Berry — official public weigh-in record, 340 to 175",
      description:
        "Official public weigh-in record. Declared start 340 lb. First filed weigh-in 337.0 lb on Day 1 (13 August 2026). Toward 175. Archive: /daily/. Violations: /penalties.",
      path: "/",
    }),
  component: Home,
});

function Home() {
  const snap = getSnapshot();
  const hero = snap.latestHero;
  const heroPhoto = hero.photos.front;

  return (
    <SiteChrome current="Home">
      <section className="border-b border-ink px-4 py-14 sm:px-8">
        <div className="mx-auto grid max-w-[1160px] gap-10 lg:grid-cols-[1fr_minmax(220px,300px)] lg:gap-14">
          <div>
            <p className="mb-5 font-mono text-[13px] uppercase tracking-[0.24em] text-accent">
              Official record · held by the Accountability Partner
            </p>
            <h1 className="max-w-[900px] text-[clamp(48px,8vw,104px)] leading-[0.92] tracking-[-0.01em]">
              {SUBJECT_NAME}
            </h1>
            <p className="mt-3 mb-9 font-mono text-[13px] uppercase tracking-[0.16em] text-muted">
              Subject · official record
            </p>
            <div className="mb-9 grid max-w-[720px] grid-cols-2 border border-ink sm:grid-cols-4">
              {[
                { k: "Day", v: String(snap.currentDayNumber) },
                { k: "Last filed", v: lb(snap.lastWeight) },
                { k: "Declared start", v: "340" },
                { k: "Open", v: String(snap.openCount), accent: true },
              ].map((cell, i) => (
                <div
                  key={cell.k}
                  className={`px-4 py-4 ${i < 3 ? "border-r border-rule" : ""}`}
                >
                  <span
                    className={`block font-mono text-[11px] uppercase tracking-[0.16em] ${cell.accent ? "text-accent" : "text-muted"}`}
                  >
                    {cell.k}
                  </span>
                  <span
                    className={`font-mono text-[32px] font-semibold tabular-nums ${cell.accent ? "text-accent" : ""}`}
                  >
                    {cell.v}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex max-w-[640px] flex-col gap-4 text-lg leading-relaxed">
              <p>
                He is required to file a packet every day by 10:00 PM Eastern:
                inspection video, four-angle photographs, weight, tracker update,
                in the project uniform.
              </p>
              <p className="border border-ink border-l-[6px] border-l-accent p-4 text-[15px] leading-relaxed">
                <strong>On the numbers.</strong> Declared start 340 lb. First
                filed weigh-in 337.0 lb, Day 1. Day 2 incomplete (
                <Link to="/violations/$id" params={{ id: "v-002" }} className="font-semibold">
                  V-002
                </Link>
                ). Day 3 incomplete (
                <Link to="/violations/$id" params={{ id: "v-003" }} className="font-semibold">
                  V-003
                </Link>
                ). Day 4 is a complete record. Archive:{" "}
                <Link to="/daily" className="font-semibold">
                  /daily/
                </Link>{" "}
                and{" "}
                <Link to="/penalties" className="font-semibold">
                  /penalties
                </Link>
                .
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="aspect-[3/4] w-full border border-ink">
              {heroPhoto ? (
                <img
                  src={heroPhoto}
                  alt={`${SUBJECT_NAME}, Day ${hero.day} front, ${hero.date}${hero.weight ? `, ${lb(hero.weight)} lb` : ""}. Declared start 340.`}
                  className="block size-full object-cover"
                />
              ) : null}
            </div>
            <span className="font-mono text-[13px] text-muted">
              Day {String(hero.day).padStart(3, "0")}
              {hero.weight ? ` — ${lb(hero.weight)} lb filed` : ""}. Declared start 340.
            </span>
          </div>
        </div>
      </section>

      <section className="border-b border-ink bg-ink text-paper">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-8">
          <StatGrid
            invert
            items={[
              { label: "Day", value: String(snap.currentDayNumber) },
              { label: "Declared start", value: lb(snap.startWeight) },
              { label: "Last recorded", value: lb(snap.lastWeight) },
              { label: "Goal", value: lb(snap.goalWeight), accent: true },
              { label: "Days without violation", value: String(snap.cleanDays) },
              {
                label: "Next milestone",
                value: String(snap.nextMilestone),
              },
            ]}
          />
          <p className="pb-6 font-mono text-xs text-muted-on-ink">
            {snap.toMilestone.toFixed(1)} lbs to {snap.nextMilestone}
          </p>
        </div>
      </section>

      <section className="border-b border-ink px-4 py-20 sm:px-8">
        <div className="mx-auto max-w-[1160px]">
          <h2 className="text-[40px]">Three Possible Outcomes</h2>
          <p className="mt-3 mb-12 text-[17px] text-muted">
            From the start, there are only three. There is no Path 4.
          </p>
          <div className="grid border border-ink md:grid-cols-3">
            <Path
              n="Path 1"
              title="Full Compliance"
              items={[
                "Each day is documented.",
                "Each weigh-in is posted.",
                "Each entry is logged.",
              ]}
              note="Completion requires sustained documentation. Every missed requirement remains part of the record."
            />
            <Path
              n="Path 2"
              title="A Requirement Is Missed"
              accent
              items={[
                "The 10 PM check runs by itself and enters the date and what was missing.",
                "A corrective session follows — recorded, published beside the entry, and verified.",
                "The entry stays. Completing the correction closes it; nothing removes it.",
              ]}
              note="Nobody has to decide this. It happens whether or not anyone is watching."
            />
            <Path
              n="Path 3"
              title="Project Abandonment"
              items={[
                "If the project is abandoned, the record remains public.",
                "The starting weight, the last recorded date, and the unfinished goal remain visible.",
              ]}
              note="There is no unrecorded ending to this project."
              last
            />
          </div>
        </div>
      </section>

      <section className="border-b border-ink px-4 py-20 sm:px-8">
        <div className="mx-auto grid max-w-[1160px] gap-12 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <h2 className="text-[40px]">Project Introduction</h2>
            <div className="relative aspect-video w-full bg-ink">
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-xs uppercase tracking-[0.16em] text-muted-on-ink">
                Project statement — published on the official channel
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-5">
            <h2 className="text-[40px]">Daily Inspection</h2>
            <div className="relative aspect-video w-full bg-ink">
              {heroPhoto ? (
                <img
                  src={heroPhoto}
                  alt=""
                  className="absolute inset-0 size-full object-cover opacity-40"
                />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-xs uppercase tracking-[0.16em] text-paper">
                {hero.hasVideo
                  ? `Day ${hero.day} inspection on file`
                  : "Awaiting today's inspection"}
              </div>
            </div>
            <Link
              to="/daily"
              className="self-start border-b border-ink font-mono text-xs uppercase tracking-[0.12em] no-underline hover:border-accent hover:text-accent"
            >
              Day {hero.day} · {hero.date} · every day in the archive →
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-ink px-4 py-16 sm:px-8">
        <div className="mx-auto max-w-[1160px]">
          <p className="mb-6 font-mono text-[13px] uppercase tracking-[0.24em] text-accent">
            How you can help
          </p>
          <div className="grid border-t border-rule md:grid-cols-3">
            {[
              ["01", "Watch the daily inspection videos in the archive."],
              ["02", "Share the website or original project posts — without alteration."],
              [
                "03",
                `Report broken links or discrepancies to ${AP_EMAIL}.`,
              ],
            ].map(([n, t], i) => (
              <div
                key={n}
                className={`flex flex-col gap-2 border-b border-rule py-7 ${i > 0 ? "md:border-l md:pl-6" : "md:pr-6"}`}
              >
                <span className="font-mono text-xs text-muted-on-ink">{n}</span>
                <span className="text-lg font-semibold">
                  {n === "03" ? (
                    <>
                      Report broken links or discrepancies to{" "}
                      <a href={`mailto:${AP_EMAIL}`} className="underline">
                        {AP_EMAIL}
                      </a>
                      .
                    </>
                  ) : (
                    t
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-ink bg-paper-dim px-4 py-14 sm:px-8">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[13px] uppercase tracking-[0.2em] text-accent">
              Contact
            </span>
            <span className="text-xl font-semibold">
              The Accountability Partner administers this record.
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={`mailto:${AP_EMAIL}`}
              className="bg-ink px-7 py-4 font-mono text-[15px] tracking-[0.06em] text-paper no-underline hover:bg-accent"
            >
              {AP_EMAIL}
            </a>
            <a
              href={`mailto:${SUBJECT_EMAIL}`}
              className="border border-ink bg-paper px-7 py-4 font-mono text-[15px] tracking-[0.06em] no-underline hover:bg-ink hover:text-paper"
            >
              {SUBJECT_EMAIL}
            </a>
          </div>
        </div>
      </section>
    </SiteChrome>
  );
}

function Path({
  n,
  title,
  items,
  note,
  accent,
  last,
}: {
  n: string;
  title: string;
  items: string[];
  note: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-4 p-8 ${last ? "" : "border-b border-ink md:border-b-0 md:border-r"}`}>
      <span
        className={`self-start border px-3 py-1.5 font-mono text-[13px] uppercase tracking-[0.2em] ${
          accent ? "border-accent text-accent" : "border-ink"
        }`}
      >
        {n}
      </span>
      <h3 className="text-[26px]">{title}</h3>
      <ul className="flex list-disc flex-col gap-2.5 pl-5 text-base">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-auto text-[15px] text-muted">{note}</p>
    </div>
  );
}
