import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome, ViewSwitch } from "@/components/site-chrome";
import { DAYS, dayStatus, longDate, statusLabel, weekOf } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/weeks/")({
  head: () =>
    pageHead({
      title: "Weekly record — Micheal Ray Berry official weigh-in archive",
      description:
        "Week-by-week weights and documentation status for the Micheal Ray Berry Public Accountability Project. Week 1 began 13 August 2026.",
      path: "/weeks/",
    }),
  component: Weeks,
});

function Weeks() {
  const weeks = new Map<number, typeof DAYS>();
  for (const d of DAYS) {
    const w = weekOf(d.day);
    const list = weeks.get(w) ?? [];
    list.push(d);
    weeks.set(w, list);
  }

  return (
    <SiteChrome>
      <PageHead
        eyebrow="Week-by-week"
        title="Weekly Record"
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/weeks", label: "Weeks" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <ViewSwitch
          items={[
            { to: "/daily", label: "Days" },
            { to: "/weeks", label: "Weeks", current: true },
            { to: "/dashboard", label: "Dashboard" },
          ]}
        />
        {[...weeks.entries()].map(([n, days]) => {
          const weights = days.filter((d) => d.weight != null).map((d) => d.weight as number);
          const first = weights[0];
          const last = weights.at(-1);
          const net = first != null && last != null ? Number((last - first).toFixed(1)) : null;
          return (
            <section key={n} className="mb-10">
              <h2 className="text-2xl">Week {n}</h2>
              <p className="mt-1 font-mono text-sm text-muted">
                {longDate(days[0].date)}
                {net != null ? ` · net ${net > 0 ? "+" : ""}${net.toFixed(1)} lb` : ""}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse font-mono text-sm">
                  <thead>
                    <tr className="bg-ink text-left text-[11px] uppercase tracking-[0.12em] text-paper">
                      <th className="px-2.5 py-2">Day</th>
                      <th className="px-2.5 py-2">Date</th>
                      <th className="px-2.5 py-2">Weight</th>
                      <th className="px-2.5 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.date} className="border-b border-rule">
                        <td className="px-2.5 py-2.5">
                          <Link
                            to="/daily/$slug"
                            params={{ slug: `${d.date}-day-${String(d.day).padStart(3, "0")}` }}
                            className="font-semibold hover:text-accent"
                          >
                            {d.day}
                          </Link>
                        </td>
                        <td className="px-2.5 py-2.5">{d.date}</td>
                        <td className="px-2.5 py-2.5">
                          {d.weight != null ? `${d.weight.toFixed(1)}` : "—"}
                        </td>
                        <td className="px-2.5 py-2.5">{statusLabel(dayStatus(d))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </SiteChrome>
  );
}
