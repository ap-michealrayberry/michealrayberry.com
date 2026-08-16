import { createFileRoute, Link } from "@tanstack/react-router";
import { dayStatus, getSnapshot, statusLabel } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/assistant/")({
  head: () =>
    pageHead({
      title: "Recording Assistant — demonstration only",
      description:
        "Demonstration of the official capture instrument. Filing requires a device key issued to Micheal. Nothing on this page reaches the official record.",
      path: "/assistant/",
      noindex: true,
    }),
  component: Assistant,
});

const SESSIONS = [
  {
    name: "Daily Inspection",
    when: "Due 10 PM ET",
    desc: "Four-angle video, four photographs, the weight. Evidence for the public record.",
  },
  {
    name: "Corrective Session",
    when: "After confirmed violation",
    desc: "10 / 20 / 30 min by level, recorded in one unbroken take and published beside the entry.",
  },
  {
    name: "Consent Confirmation",
    when: "Once · on each amendment",
    desc: "Recorded statement of understanding. Re-recorded when the agreement is amended.",
  },
  {
    name: "Project Announcement",
    when: "Launch · once",
    desc: "The opening statement of the project.",
  },
  {
    name: "Demonstration",
    when: "As needed",
    desc: "Explainer of the standard. Marked DEMONSTRATION · NOT A SESSION. Answers no violation.",
  },
];

function Assistant() {
  const snap = getSnapshot();
  const today = snap.latestHero;
  const todayStatus =
    today.date === snap.todayIso ? dayStatus(today) : snap.todayIso > today.date ? "due" : dayStatus(today);

  return (
    <div className="min-h-dvh bg-ink text-paper">
      <div className="border-b border-accent bg-accent px-4 py-2.5 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-paper">
        Demonstration · test data only · nothing here is filed to the official record
      </div>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule-strong px-5 py-5">
        <div>
          <div className="font-display text-lg font-bold uppercase tracking-[0.06em]">
            Micheal Ray Berry
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-on-ink">
            Public Accountability Project
          </div>
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Record · demo</div>
      </header>

      <main className="mx-auto max-w-[720px] px-5 py-8">
        <p className="mb-6 text-sm leading-relaxed text-muted-on-ink">
          Visitors: this is the official capture instrument behind the record.
          Filing requires the device key issued to Micheal, checked server-side
          on every action. Without it the tool runs as a demonstration and
          nothing reaches the record. The standard it enforces is documented at{" "}
          <Link to="/positions" className="text-paper underline">
            /positions
          </Link>
          .
        </p>

        <section className="border border-rule-strong p-4" aria-label="Today status">
          <Row label="Mode" value="DEMO — not connected" test />
          <Row label="Deadline" value="10:00 PM Eastern" />
          <Row
            label="Packet today"
            value={
              today.date === snap.todayIso && todayStatus === "complete"
                ? `TEST DISPLAY · ${statusLabel(todayStatus)} (Day ${today.day})`
                : `TEST DISPLAY · ${statusLabel(today.date === snap.todayIso ? todayStatus : "due")}`
            }
            test
          />
          <Row label="Voice" value="TEST DISPLAY · device fallback" test />
          <Row label="Device key" value="TEST DISPLAY · not present · demo mode" test />
        </section>

        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-on-ink">
          Open entries on this screen are hidden in demonstration mode. The live
          log is{" "}
          <Link to="/penalties" className="text-paper underline">
            /penalties
          </Link>
          . Future-dated rows are not shown.
        </p>

        <h2 className="mt-10 font-display text-2xl">Sessions</h2>
        <p className="mt-2 mb-5 text-sm text-muted-on-ink">
          One instrument. Five sessions. Shared camera, overlay, monitor, voice,
          hashing, and upload — only the script and filing destination differ.
        </p>
        <div className="flex flex-col gap-3">
          {SESSIONS.map((s) => (
            <div key={s.name} className="border border-rule-strong p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-lg uppercase">{s.name}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-on-ink">
                  {s.when}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-on-ink">{s.desc}</p>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-accent">
                Cannot start — demonstration only · no device key
              </p>
            </div>
          ))}
        </div>

        <section className="mt-10 border border-rule-strong p-4">
          <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-on-ink">
            Device configuration · demonstration fields
          </h3>
          <p className="mt-3 text-sm text-muted-on-ink">
            Keys are never collected on this public demonstration. The issued
            device key is checked only on the private capture host. Every field
            below is unlabeled test chrome and does nothing.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {["Device key", "Apps Script exec URL", "Sheet ID", "Voice key"].map((label) => (
              <label key={label} className="flex flex-col gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-on-ink">
                {label} · test
                <input
                  disabled
                  placeholder="TEST DATA — not accepted"
                  className="border border-rule-strong bg-ink px-3 py-2 text-muted-on-ink"
                />
              </label>
            ))}
          </div>
        </section>

        <p className="mt-10">
          <Link to="/" className="font-mono text-xs uppercase tracking-[0.12em] text-paper underline">
            ← Return to the official record
          </Link>
        </p>
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  test,
}: {
  label: string;
  value: string;
  test?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong py-2 last:border-b-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-on-ink">{label}</span>
      <span className={`font-mono text-sm ${test ? "text-accent" : "text-paper"}`}>{value}</span>
    </div>
  );
}
