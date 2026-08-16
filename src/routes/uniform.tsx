import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome, ViewSwitch } from "@/components/site-chrome";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/uniform")({
  head: () =>
    pageHead({
      title: "Project Uniform — Micheal Ray Berry Public Accountability Project",
      description:
        "Required project uniform: black full-body unitard, plain black shoes, and from 15 August 2026 a titanium collar. Four-angle documentation.",
      path: "/uniform",
    }),
  component: Uniform,
});

function Uniform() {
  return (
    <SiteChrome>
      <PageHead
        eyebrow="Required standard — all official content"
        title="Project Uniform"
        lede="All official project content must show Micheal Ray Berry under the same conditions each time — clearly identified, visually inspected, and publicly documented."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/uniform", label: "Uniform" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <ViewSwitch
          items={[
            { to: "/positions", label: "Inspection" },
            { to: "/uniform", label: "Uniform", current: true },
          ]}
        />

        <h2 className="text-2xl">Requirement 1 — Black full-body unitard</h2>
        <p className="mt-3 max-w-[68ch]">
          Creates a consistent visual baseline. Prevents ordinary clothing from
          hiding or changing the appearance of the body over time. Its purpose is
          not fashion. Its purpose is documentation.
        </p>

        <h2 className="mt-10 text-2xl">Requirement 2 — Plain black shoes</h2>
        <p className="mt-3 max-w-[68ch]">
          Required for all official full-body documentation. They complete the
          project uniform and ensure each inspection presents the same full-body
          visual standard from head to toe.
        </p>

        <h2 className="mt-10 text-2xl">Requirement 3 — Collar · from 15 August 2026</h2>
        <p className="mt-3 max-w-[68ch]">
          A standardized part of the project uniform, and a visible sign of
          Micheal's commitment to finishing. Worn closed in every official
          photograph and inspection so each entry matches the same standard.
          Required as of 15 August 2026 (amendment). Days 1–2 stay as filed. A
          missing collar is a violation, same class as a missed packet.
        </p>
        <p className="mt-3 max-w-[68ch] text-ink-soft">
          Days 1–2 were filed under unitard and shoes only. Signed §4.1 is not
          silently rewritten; this is an amendment.
        </p>

        <h2 className="mt-10 text-2xl">Required pose and angles</h2>
        <p className="mt-3 max-w-[68ch]">
          Standing upright, hands behind head, body visible, face visible, no
          concealment of body shape. Every inspection documents four angles:
          front, left side, right side, and rear. A normal Daily Inspection runs
          roughly a minute. The same attire, pose, angle, and no-concealment
          standards apply to the four required daily photos.
        </p>
        <p className="mt-6 max-w-[68ch] border-l-4 border-accent bg-paper-dim px-4 py-3">
          No anonymous content. No casual documentation. No hidden identity. No
          inconsistent visual record.
        </p>
        <p className="mt-8">
          <Link to="/positions" className="hover:text-accent">
            Inspection standard
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
