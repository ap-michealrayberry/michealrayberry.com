import { createFileRoute } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { MILESTONES, getSnapshot } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/milestones")({
  head: () =>
    pageHead({
      title: "Milestones — 300, 275, 250, 225, 200, 175 lb",
      description:
        "Official milestone ladder for the Micheal Ray Berry Public Accountability Project. A milestone counts only when documented by an official weigh-in and a milestone video.",
      path: "/milestones",
    }),
  component: Milestones,
});

function Milestones() {
  const snap = getSnapshot();
  return (
    <SiteChrome>
      <PageHead
        eyebrow="Documented only when officially weighed"
        title="Milestones"
        lede="300 · 275 · 250 · 225 · 200 · 175. A rung counts only with an official weigh-in and a milestone video. Weight fluctuation between rungs is progress information, never a violation."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/milestones", label: "Milestones" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <div className="grid grid-cols-2 border border-ink sm:grid-cols-3 lg:grid-cols-6">
          {MILESTONES.map((m, i) => {
            const hit = snap.lastWeight <= m;
            return (
              <div
                key={m}
                className={`flex flex-col gap-1.5 px-3.5 py-6 ${i > 0 ? "border-l border-rule" : ""} ${hit ? "bg-ink text-paper" : ""}`}
              >
                <b className="font-mono text-[28px] leading-none">{m}</b>
                <em className={`font-mono text-[11px] not-italic uppercase tracking-[0.14em] ${hit ? "text-muted-on-ink" : "text-muted"}`}>
                  {hit ? "Reached" : m === snap.nextMilestone ? `${snap.toMilestone.toFixed(1)} to go` : "Pending"}
                </em>
              </div>
            );
          })}
        </div>
        <p className="mt-8 max-w-[68ch] text-ink-soft">
          Last recorded {snap.lastWeight.toFixed(1)} lb. Next documented target is{" "}
          {snap.nextMilestone} lb — {snap.toMilestone.toFixed(1)} pounds remaining.
          Completion is 175.0 lb held for 28 consecutive days under the
          verification standard.
        </p>
      </div>
    </SiteChrome>
  );
}
