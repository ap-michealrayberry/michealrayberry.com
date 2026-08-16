import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import {
  ANGLES,
  SUBJECT_NAME,
  allCalendarDays,
  dayBySlug,
  dayNumber,
  daySlug,
  dayStatus,
  longDate,
  statusLabel,
  violationForDay,
  type Angle,
} from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/daily/$slug")({
  loader: ({ params }) => {
    const entry = dayBySlug(params.slug);
    if (entry) return { entry, date: entry.date, day: entry.day };
    const m = params.slug.match(/^(\d{4}-\d{2}-\d{2})-day-(\d{3})$/);
    if (!m) throw notFound();
    const date = m[1];
    const day = Number(m[2]);
    if (day !== dayNumber(date) || date < "2026-08-13") throw notFound();
    return { entry: null, date, day };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { entry, date, day } = loaderData;
    const status = entry ? dayStatus(entry) : "no-record";
    const title =
      status === "complete" && entry?.weight
        ? `${SUBJECT_NAME} Day ${day} — ${entry.weight.toFixed(1)} lb | ${longDate(date)}`
        : `${SUBJECT_NAME} Day ${day} — ${statusLabel(status)} | ${longDate(date)}`;
    return pageHead({
      title,
      description:
        status === "complete"
          ? `Day ${day} of the official weigh-in record, ${longDate(date)}. Recorded weight ${entry?.weight?.toFixed(1)} lb, four-angle photographs, inspection video.`
          : `Day ${day} of the official weigh-in record, ${longDate(date)}: ${statusLabel(status).toLowerCase()}.`,
      path: `/daily/${date}-day-${String(day).padStart(3, "0")}/`,
    });
  },
  component: DayPage,
});

const ANGLE_LABEL: Record<Angle, string> = {
  front: "Front",
  left: "Left",
  rear: "Rear",
  right: "Right",
};

function DayPage() {
  const { entry, date, day } = Route.useLoaderData();
  const status = entry ? dayStatus(entry) : "no-record";
  const v = violationForDay(date);
  const calendar = allCalendarDays();
  const idx = calendar.findIndex((d) => d.date === date);
  const prev = idx > 0 ? calendar[idx - 1] : null;
  const next = idx >= 0 && idx < calendar.length - 1 ? calendar[idx + 1] : null;

  return (
    <SiteChrome>
      <PageHead
        eyebrow={`Project day ${String(day).padStart(3, "0")} · ${date}`}
        title={`Day ${day}`}
        lede={
          status === "complete" && entry?.weight
            ? `${entry.weight.toFixed(1)} lb · ${longDate(date)}`
            : `${statusLabel(status)} · ${longDate(date)}`
        }
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/daily", label: "Daily Record" },
          { to: "/daily", label: `Day ${day}` },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <div className="mb-8 flex flex-wrap gap-4 font-mono text-xs uppercase tracking-[0.1em] text-muted">
          {prev ? (
            <Link
              to="/daily/$slug"
              params={{ slug: `${prev.date}-day-${String(prev.day).padStart(3, "0")}` }}
              className="hover:text-accent"
            >
              ← Day {prev.day}
            </Link>
          ) : (
            <span />
          )}
          <Link to="/daily" className="hover:text-accent">
            All days
          </Link>
          {next ? (
            <Link
              to="/daily/$slug"
              params={{ slug: `${next.date}-day-${String(next.day).padStart(3, "0")}` }}
              className="hover:text-accent"
            >
              Day {next.day} →
            </Link>
          ) : null}
        </div>

        {status === "complete" && entry ? (
          <>
            <div className="mb-8 grid grid-cols-2 gap-px border border-ink bg-ink sm:grid-cols-4">
              {ANGLES.map((angle) => {
                const src = entry.photos[angle];
                return (
                  <figure key={angle} className="bg-paper">
                    {src ? (
                      <img
                        src={src}
                        alt={`${SUBJECT_NAME} ${angle}, Day ${day}, ${longDate(date)}${entry.weight ? `, ${entry.weight.toFixed(1)} lb` : ""}`}
                        className="block w-full"
                      />
                    ) : null}
                    <figcaption className="px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                      {ANGLE_LABEL[angle]}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <dl className="mb-8 grid grid-cols-2 border border-ink sm:grid-cols-4">
              {[
                ["Weight", entry.weight ? `${entry.weight.toFixed(1)} lb` : "—"],
                ["Video", entry.hasVideo ? "On file" : "—"],
                ["Attestation", entry.attestation ?? "—"],
                ["Status", statusLabel(status)],
              ].map(([k, val], i) => (
                <div key={k} className={`flex flex-col gap-1 px-4 py-4 ${i > 0 ? "border-l border-rule" : ""}`}>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{k}</dt>
                  <dd className="font-mono text-sm font-semibold">{val}</dd>
                </div>
              ))}
            </dl>
            {entry.hasVideo ? (
              <div className="mb-8 border border-ink bg-ink">
                <div className="flex aspect-video items-center justify-center px-6 text-center font-mono text-xs uppercase tracking-[0.16em] text-paper">
                  {entry.videoLabel ?? "Inspection video on file"}
                  {entry.youtubeUrl ? (
                    <>
                      {" — "}
                      <a
                        href={entry.youtubeUrl}
                        target="_blank"
                        rel="noopener"
                        className="ml-1 underline"
                      >
                        @michealrayberry
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
            {entry.notes ? <p className="max-w-[68ch] text-ink-soft">{entry.notes}</p> : null}
            {v ? (
              <p className="mt-4 max-w-[68ch]">
                Related entry:{" "}
                <Link to="/violations/$id" params={{ id: v.slug }} className="font-semibold">
                  {v.id}
                </Link>{" "}
                ({v.status}
                {v.verification ? ` · ${v.verification}` : ""}).
              </p>
            ) : null}
          </>
        ) : (
          <div className="max-w-[68ch]">
            <p className="border-l-4 border-accent bg-paper-dim px-4 py-3 font-mono text-sm font-semibold uppercase tracking-[0.08em] text-accent">
              {statusLabel(status)}
            </p>
            <p className="mt-6 text-[17px] leading-relaxed">
              {status === "due"
                ? `Day ${day} is still inside its filing window. A complete packet is due by 10:00 PM Eastern. Until then this day is open, not missed.`
                : status === "incomplete"
                  ? `The record filed for ${longDate(date)} is incomplete. The gap is part of the record.`
                  : `No complete packet was filed for ${longDate(date)}. The absence is part of the record.`}
            </p>
            {entry?.notes ? <p className="mt-4 text-ink-soft">{entry.notes}</p> : null}
            {entry && Object.values(entry.photos).some(Boolean) ? (
              <div className="mt-8 grid grid-cols-2 gap-px border border-ink bg-ink sm:grid-cols-4">
                {ANGLES.map((angle) => {
                  const src = entry.photos[angle];
                  return (
                    <figure key={angle} className="bg-paper">
                      {src ? (
                        <img src={src} alt={`${SUBJECT_NAME} ${angle}, Day ${day}`} className="block w-full" />
                      ) : (
                        <div className="flex aspect-[3/4] items-center justify-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                          {angle} not filed
                        </div>
                      )}
                      <figcaption className="px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                        {ANGLE_LABEL[angle]}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            ) : null}
            {v ? (
              <p className="mt-6">
                Matching violation:{" "}
                <Link to="/violations/$id" params={{ id: v.slug }} className="font-semibold">
                  {v.id}
                </Link>
                . {v.requirement}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </SiteChrome>
  );
}

