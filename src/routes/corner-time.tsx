import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/corner-time")({
  head: () =>
    pageHead({
      title: "Corrective Sessions — Micheal Ray Berry Public Accountability Project",
      description:
        "The corrective session answers a documented failure: 10, 20, or 30 minutes by level, recorded in one unbroken take and published beside the entry that caused it.",
      path: "/corner-time/",
    }),
  component: CornerTime,
});

const LEVELS = [
  ["Level One", "First confirmed Violation Event", "10 minutes"],
  ["Level Two", "Second confirmed Violation Event", "20 minutes"],
  ["Level Three and after", "Third and every later Violation Event", "30 minutes"],
];

function CornerTime() {
  return (
    <SiteChrome>
      <PageHead
        eyebrow="Answers a documented failure · never a weight change"
        title="Corrective Sessions"
        lede="10, 20, or 30 minutes by level, recorded in one unbroken take and published beside the entry that caused it."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/penalties", label: "Violations" },
          { to: "/corner-time", label: "Corrective Sessions" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <p className="max-w-[68ch]">
          Inspection documents the day. A corrective session addresses a
          documented failure. Completing it closes the obligation. It does not
          erase the row, and it does not remove the recording.
        </p>
        <div className="mt-8 grid border border-ink md:grid-cols-3">
          {LEVELS.map(([name, when, dur], i) => (
            <div key={name} className={`flex flex-col gap-2 p-6 ${i > 0 ? "border-t border-ink md:border-t-0 md:border-l" : ""}`}>
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">{name}</span>
              <strong className="font-display text-2xl uppercase">{dur}</strong>
              <span className="text-sm text-muted">{when}</span>
            </div>
          ))}
        </div>
        <h2 className="mt-12 text-2xl">The standard</h2>
        <ul className="mt-4 max-w-[68ch] list-disc space-y-2 pl-5">
          <li>Project uniform throughout.</li>
          <li>Standing, facing the designated wall, hands behind the head, substantially still.</li>
          <li>One unbroken take. Pausing, editing, or leaving frame invalidates the attempt.</li>
          <li>Filed within 72 hours of the notice unless a documented exception applies.</li>
          <li>Published beside the violation entry and posted to the official channel.</li>
        </ul>
        <p className="mt-8">
          <Link to="/penalties" className="hover:text-accent">
            Violation log
          </Link>
          {" · "}
          <Link to="/agreement" className="hover:text-accent">
            Agreement §8
          </Link>
        </p>
      </div>
    </SiteChrome>
  );
}
