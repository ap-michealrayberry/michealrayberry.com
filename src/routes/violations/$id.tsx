import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { VIOLATIONS, daySlug, longDate } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/violations/$id")({
  loader: ({ params }) => {
    const v = VIOLATIONS.find((x) => x.slug === params.id.toLowerCase());
    if (!v) throw notFound();
    return v;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const v = loaderData;
    return pageHead({
      title: `${v.id} — ${longDate(v.date)} — Micheal Ray Berry Public Accountability Project`,
      description: `${v.id}: ${v.requirement}. Status: ${v.status}.${v.verification ? ` ${v.verification}.` : ""}`,
      path: `/violations/${v.slug}/`,
    });
  },
  component: ViolationPage,
});

function ViolationPage() {
  const v = Route.useLoaderData();
  return (
    <SiteChrome>
      <PageHead
        eyebrow={v.isSpecimen ? "Specimen · not a violation" : `Day ${v.day} · ${v.date}`}
        title={v.id}
        lede={v.requirement}
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/penalties", label: "Violations" },
          { to: "/penalties", label: v.id },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <dl className="mb-8 grid grid-cols-2 border border-ink sm:grid-cols-3">
          {[
            ["Status", v.status],
            ["Date", v.date],
            ["Project day", `Day ${v.day}`],
            ["Submitted", v.submitted ?? "—"],
            ["Resolved", v.resolved ?? "—"],
            ["AP verification", v.verification ?? "—"],
          ].map(([k, val], i) => (
            <div
              key={k}
              className={`flex flex-col gap-1 border-b border-rule px-4 py-4 sm:border-b-0 ${i % 2 === 1 ? "border-l border-rule" : ""} ${i >= 2 ? "sm:border-l sm:border-rule" : ""}`}
            >
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{k}</dt>
              <dd className={`font-mono text-sm font-semibold ${v.status === "open" && k === "Status" ? "text-accent" : ""}`}>
                {val}
              </dd>
            </div>
          ))}
        </dl>
        <p className="max-w-[68ch] text-[17px] leading-relaxed">{v.detail}</p>
        <p className="mt-6 max-w-[68ch] text-ink-soft">
          This is not a consequence for weight. A gain, a plateau, or a bad month
          breaches nothing. Only the documentation can be failed. Completing the
          corrective session closes the obligation; it does not erase the row.
        </p>
        <p className="mt-8 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-[0.1em]">
          <Link
            to="/daily/$slug"
            params={{ slug: daySlug({ date: v.date, day: v.day }) }}
            className="hover:text-accent"
          >
            Day {v.day} record
          </Link>
          <Link to="/penalties" className="hover:text-accent">
            Full log
          </Link>
          <Link to="/corner-time" className="hover:text-accent">
            Corrective standard
          </Link>
          <Link to="/agreement" className="hover:text-accent">
            Agreement §8
          </Link>
        </p>
      </div>
    </SiteChrome>
  );
}
