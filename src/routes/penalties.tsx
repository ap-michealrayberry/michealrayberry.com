import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { VIOLATIONS, openViolations, realViolations } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/penalties")({
  head: () =>
    pageHead({
      title: "Violation Log — Micheal Ray Berry Public Accountability Project",
      description:
        "Permanent public violation log. Documentation failures only — weight fluctuation is never a violation. Open entries: V-002, V-003.",
      path: "/penalties",
    }),
  component: Penalties,
});

function Penalties() {
  const open = openViolations();
  const real = realViolations();
  const rows = [...VIOLATIONS].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <SiteChrome>
      <PageHead
        eyebrow="Permanent archival record"
        title="Violation Log"
        lede="A violation is a documentation failure — missed, late, incomplete, or refused. Weight fluctuation is never a violation. Entries stay published; completing the corrective session closes the obligation, it does not erase the row."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/penalties", label: "Violations" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <p className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-sm font-semibold">
          <span>
            {real.length} on record · {open.length} open
          </span>
          <Link to="/corner-time" className="hover:text-accent">
            Corrective standard
          </Link>
          <Link to="/violations/$id" params={{ id: "v-000" }} className="hover:text-accent">
            Specimen entry
          </Link>
        </p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse font-mono text-sm">
            <thead>
              <tr className="bg-ink text-left text-[11px] uppercase tracking-[0.12em] text-paper">
                <th className="px-2.5 py-2">No.</th>
                <th className="px-2.5 py-2">Date</th>
                <th className="px-2.5 py-2">Requirement missed</th>
                <th className="px-2.5 py-2">Status</th>
                <th className="px-2.5 py-2">Submitted</th>
                <th className="px-2.5 py-2">Resolved</th>
                <th className="px-2.5 py-2">AP verification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-rule align-top">
                  <td className="px-2.5 py-2.5">
                    <Link
                      to="/violations/$id"
                      params={{ id: v.slug }}
                      className="font-semibold hover:text-accent"
                    >
                      {v.id}
                    </Link>
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap">{v.date}</td>
                  <td className="px-2.5 py-2.5">{v.requirement}</td>
                  <td className={`px-2.5 py-2.5 ${v.status === "open" ? "font-bold text-accent" : ""}`}>
                    {v.status}
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap">{v.submitted ?? "—"}</td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap">{v.resolved ?? "—"}</td>
                  <td className="px-2.5 py-2.5">{v.verification ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-8">
          <Link to="/agreement" className="hover:text-accent">
            The signed agreement
          </Link>
          {" · "}
          <Link to="/daily" className="hover:text-accent">
            Daily record
          </Link>
        </p>
      </div>
    </SiteChrome>
  );
}
