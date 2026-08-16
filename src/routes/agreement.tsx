import { createFileRoute } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { AGREEMENT_META, AGREEMENT_SECTIONS } from "@/data/agreement";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/agreement")({
  head: () =>
    pageHead({
      title: "The Signed Accountability Agreement — Micheal Ray Berry",
      description:
        "The executed public accountability agreement signed 13 August 2026. Declared start 340 lb. Goal 175 lb held 28 days. Documentation failures only — weight is never a violation.",
      path: "/agreement",
    }),
  component: Agreement,
});

function Agreement() {
  return (
    <SiteChrome>
      <PageHead
        eyebrow="Executed 13 August 2026 · published for verification"
        title="The Signed Accountability Agreement"
        lede="This Agreement governs documentation and verification. It makes Micheal Ray Berry’s actions visible, measurable, and difficult to quietly abandon."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/agreement", label: "Agreement" },
        ]}
      />
      <div className="mx-auto max-w-[880px] px-4 py-8 sm:px-8">
        <div className="grid gap-2 border border-ink p-4 text-sm sm:grid-cols-2">
          <div>
            <strong>Participant:</strong> {AGREEMENT_META.participant}
          </div>
          <div>
            <strong>Accountability Partner:</strong> {AGREEMENT_META.partner}
          </div>
          <div>
            <strong>Project Start (Day 1):</strong> {AGREEMENT_META.start}
          </div>
          <div>
            <strong>Starting Weight:</strong> {AGREEMENT_META.startWeight}
          </div>
          <div>
            <strong>Goal Weight:</strong> {AGREEMENT_META.goal}
          </div>
          <div>
            <strong>Completion:</strong> {AGREEMENT_META.completion}
          </div>
        </div>

        {AGREEMENT_SECTIONS.map((s) => (
          <section key={s.id} className="mt-10">
            <h2 className="border-b border-rule pb-1 text-[17px] tracking-[0.04em]">{s.title}</h2>
            {s.paras.map((p) => (
              <p key={p.slice(0, 40)} className="mt-3 text-[15px] leading-relaxed">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </SiteChrome>
  );
}
