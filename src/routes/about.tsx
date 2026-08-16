import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome } from "@/components/site-chrome";
import { AP_EMAIL, SUBJECT_NAME } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () =>
    pageHead({
      title: "About the Project — Micheal Ray Berry",
      description:
        "Micheal Ray Berry's public weight-loss accountability project: declared start 340 lb, first filed 337.0 on Day 1 (13 August 2026), toward 175. The official record is held by the Accountability Partner.",
      path: "/about",
    }),
  component: About,
});

const SECTIONS = [
  {
    n: "01",
    title: "Why this exists",
    body: [
      "Private plans left room to delay, restart, and disappear when the record became uncomfortable. This project removes that escape. The Accountability Partner holds the rules, the record, and the consequences.",
      "Every day by 10:00 PM Eastern: an inspection video, four photographs, a weight entry, and a tracker update, in the project uniform. The focus is documentation, not presentation.",
    ],
  },
  {
    n: "02",
    title: "Why my real name is used",
    body: [
      "This project is attached to my real legal name because anonymity would weaken the accountability. In the past, it has been too easy to restart privately, hide failure, change direction, or abandon the process without a lasting public record.",
      "The point is not branding. The point is consequence.",
    ],
  },
  {
    n: "03",
    title: "Why the attire is standardized",
    body: [
      "Required photos and videos are recorded in the project uniform so that changes are visible, comparisons are consistent, and the record cannot be softened by flattering clothing, angles, or presentation.",
      "The purpose is not fashion. The purpose is honesty.",
    ],
  },
  {
    n: "04",
    title: "Daily documentation",
    body: [
      "Every day by 10:00 PM Eastern: a four-angle inspection video published to the official record and posted publicly to YouTube, four daily photos, a weight entry, and a tracker update. Daily documentation exists because long gaps create room for avoidance.",
    ],
  },
  {
    n: "05",
    title: "Progress and milestones",
    body: [
      "Daily weigh-ins and documented milestone weigh-ins at 300, 275, 250, 225, 200, and 175 pounds track whether the project is actually working. Weight fluctuation is recorded as progress information — only missing or false documentation is a violation.",
      "The weight loss itself is conducted under a physician's care, at a sustainable rate. The project enforces documentation — the medicine is supervised separately.",
    ],
  },
  {
    n: "06",
    title: "Missed requirements",
    body: [
      "If a requirement is missed, the miss is recorded permanently in the public Violation Log — the date, the requirement missed, the status, when the correction was submitted, when it was resolved, and the Accountability Partner's verification result. The correction is public too: a recorded session, published beside the entry that caused it.",
      "The purpose is not drama. The purpose is enforcement.",
    ],
  },
  {
    n: "07",
    title: "The public record",
    body: [
      "This website is the official public record. It exists to prevent quiet abandonment, hidden failure, or selective documentation. The record begins here and continues until the goal is reached.",
    ],
  },
  {
    n: "08",
    title: "Why the record is permanent",
    body: [
      "A record I could delete later is not a record — it is a draft. Permanence closes that door. The archive is administered by the Accountability Partner, mirrored, and indexed under my real name on purpose.",
      "The archive cannot be edited. The next photo can.",
    ],
  },
];

const FAQ = [
  {
    q: "Is this real?",
    a: "Yes. Real name, real face, real signed agreement, daily since August 13, 2026. Every claim on this site is verifiable against the public tracker, the photo archive, and the video archive.",
  },
  {
    q: "Is this voluntary?",
    a: "Entirely. I designed this system, asked for it in writing, and signed it — precisely because voluntary private promises kept failing. The Accountability Partner administers the structure; he did not impose it.",
  },
  {
    q: "What happens if a requirement is missed?",
    a: "A Violation Event is entered permanently in the public log. A corrective session follows, recorded and published beside the entry. Submitting it resolves the entry; the AP reviews the posting. The entry stays forever.",
  },
  {
    q: "Can he delete this site or quietly quit?",
    a: "No. The website, domain, trackers, and violation log are owned and administered by the Accountability Partner for the project's duration. Thirty days of silence or any attempt to take the record down converts the site to a permanent public abandonment record.",
  },
  {
    q: "Is the weight loss medically supervised?",
    a: "Yes — under a physician's care at a sustainable rate. The project enforces documentation, not medicine. Ordinary weight fluctuation is never a violation.",
  },
  {
    q: "When does it end?",
    a: "One way: 175 pounds, held for 28 consecutive days under the verification standard. Then the site converts to a permanent completion record. There is no other ending that isn't public.",
  },
];

function About() {
  return (
    <SiteChrome>
      <PageHead
        eyebrow="In his words · the record is held above"
        title="About This Project"
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/about", label: "About" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <p className="max-w-[68ch] text-lg">
          My name is {SUBJECT_NAME}. This is a public weight-loss project.
          Declared start 340 pounds. First weigh-in 337.0 on Day 1. Goal 175
          pounds, held 28 days. I participate in the project. I do not
          unilaterally control its official record.
        </p>
        <p className="mt-4 max-w-[68ch] border border-ink border-l-[6px] border-l-accent p-4 text-[15px]">
          <strong>On the numbers.</strong> Agreement start 340 lb. First filed
          weigh-in 337.0 lb, Day 1 (13 August 2026). Day 2 incomplete (
          <Link to="/violations/$id" params={{ id: "v-002" }} className="font-semibold">
            V-002
          </Link>
          ). Day 3 incomplete (
          <Link to="/violations/$id" params={{ id: "v-003" }} className="font-semibold">
            V-003
          </Link>
          ). Archive:{" "}
          <Link to="/daily" className="font-semibold">
            /daily/
          </Link>{" "}
          and{" "}
          <Link to="/penalties" className="font-semibold">
            /penalties
          </Link>
          .
        </p>

        <div className="mt-4 grid gap-x-16 md:grid-cols-2">
          {SECTIONS.map((s) => (
            <div key={s.n} className="flex flex-col gap-3.5 border-b border-rule py-12">
              <span className="font-mono text-[13px] uppercase tracking-[0.2em] text-muted">{s.n}</span>
              <h2 className="text-[28px]">{s.title}</h2>
              {s.body.map((p) => (
                <p key={p} className="m-0 text-base leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
          ))}
        </div>

        <h2 className="mt-16 text-4xl">Questions, answered plainly</h2>
        <div className="mt-7 max-w-[860px] border border-ink">
          {FAQ.map((item, i) => (
            <div
              key={item.q}
              className={`flex flex-col gap-2 px-7 py-6 ${i < FAQ.length - 1 ? "border-b border-rule" : ""}`}
            >
              <span className="text-[17px] font-semibold">{item.q}</span>
              <p className="m-0 text-[15px] leading-relaxed text-ink-soft">{item.a}</p>
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t border-rule px-7 py-6">
            <span className="text-[17px] font-semibold">I know him personally. What now?</span>
            <p className="m-0 text-[15px] leading-relaxed text-ink-soft">
              Recognition is not a risk of this project — it's the mechanism.
              Questions and reports go to{" "}
              <a href={`mailto:${AP_EMAIL}`} className="font-semibold underline">
                {AP_EMAIL}
              </a>
              , answered by the Accountability Partner, not by Micheal.
            </p>
          </div>
        </div>

        <p className="mt-10 font-mono tracking-[0.06em]">
          — Signed, <strong>{SUBJECT_NAME}</strong>
        </p>
      </div>
    </SiteChrome>
  );
}
