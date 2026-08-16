import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, SiteChrome, ViewSwitch } from "@/components/site-chrome";
import { latestCompleteDay } from "@/data/record";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/positions/")({
  head: () =>
    pageHead({
      title: "Inspection Standard — Micheal Ray Berry Public Accountability Project",
      description:
        "The documentation standard: Wait, then four fixed views — front, left, rear, right — with the posture, framing, and visibility each requires.",
      path: "/positions/",
    }),
  component: Positions,
});

const VIEWS = [
  {
    angle: "wait" as const,
    label: "Wait",
    req: "Upright and squared to the camera, feet apart at the established width, hands behind the back, head level, eyes forward.",
    note: "Every session opens and closes here. It files no progress photograph — it gives every recording a defined beginning and end.",
  },
  {
    angle: "front" as const,
    label: "Front",
    req: "Squared to the camera, feet at the established inspection width, hands behind the head, head level, face fully visible.",
    note: "The primary front reference frame. Hands behind the head keep the torso unobstructed.",
  },
  {
    angle: "left" as const,
    label: "Left",
    req: "A turn to the left from Front. Same stance, posture, camera distance, and hand position.",
    note: "The camera does not move. The side profile records changes in body depth and shape.",
  },
  {
    angle: "rear" as const,
    label: "Rear",
    req: "Turned to face directly away. Established stance, hands behind the head, framing unchanged.",
    note: "The complete body remains visible from head to shoes.",
  },
  {
    angle: "right" as const,
    label: "Right",
    req: "A turn to the right, presenting the opposite profile with the posture and framing required for Left.",
    note: "Both profiles are required. One preferred side cannot substitute for the other.",
  },
];

const SPEC = [
  [
    "Inspection posture",
    "Upright, weight distributed evenly, feet at the established inspection width, hands behind the head. Held naturally: no deliberate flexing, compressing, twisting, or leaning.",
  ],
  [
    "Wait posture",
    "Separate from the four photographic positions. Feet apart, hands behind the back, body upright and squared, head level, eyes forward. No progress photograph is filed from Wait.",
  ],
  [
    "Head and identity",
    "The head remains level. During Front and both Wait positions the face must be completely visible. Hair, clothing, hands, or other objects may not materially obscure it.",
  ],
  [
    "Camera",
    "A consistent height and distance, portrait orientation, the complete body visible from head to shoes. The camera remains stationary: the participant turns, the camera does not.",
  ],
  ["Attire", "The designated project uniform. See the uniform standard."],
  [
    "Photographs",
    "Four are produced from each compliant inspection — front, left, rear, and right. Wait is recorded on video but files no progress photograph.",
  ],
  [
    "Verification",
    "The verification code is issued immediately before the recording. The Accountability Partner reviews identity, attire, framing, required views, and completeness.",
  ],
];

const INVALIDATES = [
  "Any required part of the body outside the frame",
  "Face obscured during a required identification view",
  "Incorrect position, or hands not in the required position",
  "Arms obstructing the torso during an inspection view",
  "Materially different camera height or distance",
  "Camera movement between required views",
  "Altered or noncompliant attire",
  "Leaning, twisting, flexing, compressing, or another posture that materially changes the silhouette",
  "Failure to present one of the four required views",
  "A verification failure that prevents the recording being tied to the day's record",
];

function Positions() {
  const ref = latestCompleteDay();

  return (
    <SiteChrome>
      <PageHead
        eyebrow="The documentation standard"
        title="Inspection Standard"
        lede="Wait, then four fixed views, recorded the same way every day."
        crumbs={[
          { to: "/", label: "Micheal Ray Berry" },
          { to: "/positions", label: "Inspection Standard" },
        ]}
      />
      <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8">
        <ViewSwitch
          items={[
            { to: "/positions", label: "Inspection", current: true },
            { to: "/uniform", label: "Uniform" },
          ]}
        />
        <p className="max-w-[68ch]">
          <strong>
            The positions are fixed so that changes in posture, clothing, framing,
            or concealment cannot materially alter the visual record from one day
            to the next.
          </strong>
        </p>
        <p className="mt-4 max-w-[68ch] text-ink-soft">
          Every daily record uses the same sequence, the same attire, the same
          camera position, and the same four views. The purpose is to make the
          presentation as constant as possible, so that the body is what changes.
        </p>

        <div className="my-6 flex flex-col gap-2 border border-ink bg-paper px-5 py-4">
          <b className="font-mono text-[17px] tracking-[0.06em]">
            WAIT → FRONT → LEFT → REAR → RIGHT → WAIT
          </b>
          <p className="m-0 text-sm text-ink-soft">
            The camera remains fixed. The participant changes position. Wait opens
            and closes the recording; the four inspection views produce the daily
            photographic record.
          </p>
        </div>

        <h2 className="mt-10 text-2xl">The positions</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {VIEWS.map((view) => {
            const src =
              view.angle === "wait" ? undefined : ref?.photos[view.angle];
            return (
              <figure key={view.angle} className="flex flex-col border border-ink bg-paper">
                {src ? (
                  <img
                    src={src}
                    alt={`Micheal Ray Berry ${view.label.toLowerCase()} position, inspection standard — Day ${ref?.day}`}
                    className="aspect-[9/16] w-full border-b border-ink object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-[9/16] items-center justify-center border-b border-ink bg-[repeating-linear-gradient(45deg,var(--color-paper),var(--color-paper)_10px,var(--color-paper-dim)_10px,var(--color-paper-dim)_20px)] px-4 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-on-ink">
                    {view.angle === "wait"
                      ? "Wait is recorded on video only — no photograph is filed from it"
                      : `${view.label} reference frame pending`}
                  </div>
                )}
                <figcaption className="flex flex-col gap-1.5 p-4">
                  <b className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                    {view.label}
                  </b>
                  <span className="text-sm font-semibold leading-snug">{view.req}</span>
                  <p className="m-0 text-[13.5px] leading-relaxed text-ink-soft">{view.note}</p>
                </figcaption>
              </figure>
            );
          })}
        </div>
        {ref ? (
          <p className="mt-4 text-sm text-muted">
            Reference frames from Day {ref.day}, the most recent complete record.{" "}
            <Link
              to="/daily/$slug"
              params={{ slug: `${ref.date}-day-${String(ref.day).padStart(3, "0")}` }}
              className="underline hover:text-accent"
            >
              View that day
            </Link>
            .
          </p>
        ) : null}

        <h2 className="mt-12 text-2xl">Specification</h2>
        <div className="mt-5 border border-ink">
          {SPEC.map(([k, v]) => (
            <div key={k} className="grid border-b border-rule last:border-b-0 sm:grid-cols-[170px_1fr]">
              <b className="border-b border-rule px-3.5 py-4 font-mono text-xs font-semibold text-accent sm:border-b-0 sm:border-r">
                {k}
              </b>
              <p className="m-0 px-3.5 py-4 leading-relaxed">
                {k === "Attire" ? (
                  <>
                    The designated project uniform. See{" "}
                    <Link to="/uniform" className="underline">
                      the uniform standard
                    </Link>
                    .
                  </>
                ) : (
                  v
                )}
              </p>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-2xl">What invalidates a view</h2>
        <p className="mt-3 max-w-[68ch]">
          A photograph or recorded view does not meet the standard when the
          comparison or the verification has been materially compromised. For
          example:
        </p>
        <ul className="mt-4 flex max-w-[68ch] list-disc flex-col gap-1.5 pl-5">
          {INVALIDATES.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="mt-4 max-w-[68ch]">
          <strong>A view that fails the standard is recorded again rather than filed.</strong>{" "}
          The objective is not to produce the most favourable photograph. It is to
          produce the required photograph.
        </p>

        <h2 className="mt-12 text-2xl">Inspection is not correction</h2>
        <p className="mt-3 max-w-[68ch] text-ink-soft">
          These positions produce the daily documentation record. They are separate
          from the posture required during a{" "}
          <Link to="/corner-time" className="underline">
            corrective session
          </Link>
          , which is governed by its own standard and applies only after a
          documented violation.
        </p>
      </div>
    </SiteChrome>
  );
}
