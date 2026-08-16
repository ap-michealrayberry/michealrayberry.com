import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { UPDATES, longDate } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/updates")({
  head: () =>
    pageHead({
      title: "Updates — Micheal Ray Berry Public Accountability Project",
      description:
        "Official entries posted by the Accountability Partner and personal notes posted by Micheal Ray Berry. Nothing is silently altered or deleted.",
      path: "/updates",
    }),
  component: Updates,
});

function Updates() {
  return (
    <SiteChrome>
      <PageHead
        eyebrow="Chronological — newest first"
        title="Updates"
        lede="Official entries are posted by the Accountability Partner. Personal notes are posted by Micheal Ray Berry. Nothing is silently altered or deleted — a correction is appended with a date."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/updates", label: "Updates" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <ol className="flex list-none flex-col gap-0 p-0">
          {UPDATES.map((u) => (
            <li key={u.date + u.title} className="border-b border-rule py-8">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
                {longDate(u.date)} · {u.by}
              </p>
              <h2 className="mt-2 text-2xl">{u.title}</h2>
              <p className="mt-3 max-w-[68ch] text-ink-soft">{u.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8">
          <Link to="/daily" className="hover:text-accent">
            Daily record
          </Link>
          {" · "}
          <Link to="/agreement" className="hover:text-accent">
            Agreement
          </Link>
        </p>
      </div>
    </SiteChrome>
  );
}
