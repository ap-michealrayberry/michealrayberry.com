import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHead, SiteChrome, StatGrid, ViewSwitch } from "@/components/site-chrome";
import {
  DAYS,
  START_WEIGHT,
  dayStatus,
  getSnapshot,
  lb,
  longDate,
  statusLabel,
} from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/dashboard")({
  head: () =>
    pageHead({
      title: "Dashboard — Micheal Ray Berry official weigh-in log",
      description:
        "Weigh-in log and progress for the Micheal Ray Berry Public Accountability Project. Declared start 340 lb. First filed 337.0. Last recorded 336.9. Toward 175.",
      path: "/dashboard",
    }),
  component: Dashboard,
});

function Dashboard() {
  const snap = getSnapshot();
  const series = [
    { date: "Start", label: "Declared", weight: START_WEIGHT },
    ...DAYS.filter((d) => d.weight != null).map((d) => ({
      date: d.date,
      label: `D${d.day}`,
      weight: d.weight as number,
    })),
  ];

  return (
    <SiteChrome>
      <PageHead
        eyebrow="Tracked data — updated with every weigh-in"
        title="Dashboard"
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/dashboard", label: "Dashboard" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <ViewSwitch
          items={[
            { to: "/daily", label: "Days" },
            { to: "/weeks", label: "Weeks" },
            { to: "/dashboard", label: "Dashboard", current: true },
          ]}
        />
        <StatGrid
          items={[
            { label: "Day", value: String(snap.currentDayNumber) },
            { label: "Start", value: lb(snap.startWeight) },
            { label: "Last recorded", value: lb(snap.lastWeight) },
            { label: "Lost so far", value: lb(snap.lost) },
            { label: "To goal", value: lb(snap.toGoal) },
            { label: "Open", value: String(snap.openCount), accent: true },
          ]}
        />

        <h2 className="mt-12 text-2xl">Weight</h2>
        <div className="mt-4 h-72 border border-ink bg-white p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#d8d6cf" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
              <YAxis
                domain={[170, 345]}
                tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  fontFamily: "IBM Plex Mono",
                  fontSize: 12,
                  border: "1px solid #141412",
                  borderRadius: 0,
                }}
              />
              <Line type="monotone" dataKey="weight" stroke="#b3261e" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <h2 className="mt-12 text-2xl">Weigh-in log</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse font-mono text-sm">
            <thead>
              <tr className="bg-ink text-left text-[11px] uppercase tracking-[0.12em] text-paper">
                <th className="px-2.5 py-2">Day</th>
                <th className="px-2.5 py-2">Date</th>
                <th className="px-2.5 py-2">Weight</th>
                <th className="px-2.5 py-2">Status</th>
                <th className="px-2.5 py-2">Packet</th>
              </tr>
            </thead>
            <tbody>
              {[...DAYS].reverse().map((d) => {
                const status = dayStatus(d);
                return (
                  <tr key={d.date} className="border-b border-rule">
                    <td className="px-2.5 py-2.5">
                      <Link
                        to="/daily/$slug"
                        params={{ slug: `${d.date}-day-${String(d.day).padStart(3, "0")}` }}
                        className="font-semibold hover:text-accent"
                      >
                        {String(d.day).padStart(3, "0")}
                      </Link>
                    </td>
                    <td className="px-2.5 py-2.5">{longDate(d.date)}</td>
                    <td className="px-2.5 py-2.5">{d.weight != null ? `${d.weight.toFixed(1)} lb` : "—"}</td>
                    <td className={`px-2.5 py-2.5 ${status !== "complete" ? "text-accent" : ""}`}>
                      {statusLabel(status)}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {d.hasVideo ? "video" : "—"} / {Object.values(d.photos).filter(Boolean).length}/4 photos
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SiteChrome>
  );
}
