import { Link, useRouterState } from "@tanstack/react-router";
import {
  AP_EMAIL,
  GITHUB,
  SUBJECT_EMAIL,
  SUBJECT_NAME,
  YOUTUBE,
  getSnapshot,
  type Violation,
} from "@/data/record";

const PRIMARY = [
  { to: "/", label: "Home", exact: true },
  { to: "/daily", label: "The Record" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/penalties", label: "Violations" },
  { to: "/milestones", label: "Milestones" },
] as const;

const SECONDARY = [
  { to: "/positions", label: "Inspection Standard" },
  { to: "/uniform", label: "Uniform" },
  { to: "/agreement", label: "Agreement" },
  { to: "/about", label: "About" },
  { to: "/updates", label: "Updates" },
] as const;

function isActive(pathname: string, to: string, exact?: boolean) {
  if (exact) return pathname === "/";
  if (to === "/daily") return pathname.startsWith("/daily") || pathname.startsWith("/weeks");
  if (to === "/penalties") return pathname.startsWith("/penalties") || pathname.startsWith("/violations") || pathname.startsWith("/corner-time");
  if (to === "/positions") return pathname.startsWith("/positions");
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function SiteChrome({
  children,
  current,
}: {
  children: React.ReactNode;
  current?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const snap = getSnapshot();

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-paper text-ink">
      <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-2 bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper sm:px-8">
        <div className="flex flex-wrap items-center gap-x-7 gap-y-1">
          <span className="inline-block size-2 shrink-0 rounded-full bg-accent" />
          <span>Record held by the Accountability Partner</span>
          <span>Subject {SUBJECT_NAME}</span>
          <span>
            under agreement · {snap.openCount} open
          </span>
        </div>
      </div>

      {snap.openCount > 0 ? <OpenBanner open={snap.open} /> : null}

      <header className="border-b-2 border-ink bg-paper px-4 sm:px-8">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-3 py-5">
          <Link to="/" className="flex flex-col gap-0.5 no-underline">
            <span className="font-display text-2xl font-bold uppercase leading-none tracking-[0.04em]">
              {SUBJECT_NAME}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              Subject · official record
            </span>
          </Link>
          <nav aria-label="Primary" className="flex max-w-full flex-col items-stretch gap-0.5 sm:items-end">
            <div className="flex gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {PRIMARY.map((item) => {
                const active = isActive(pathname, item.to, "exact" in item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 px-2.5 py-2 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] no-underline ${
                      active ? "text-accent underline underline-offset-4" : "text-ink hover:text-accent hover:underline hover:underline-offset-4"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="flex gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SECONDARY.map((item) => {
                const active = isActive(pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] no-underline ${
                      active ? "text-accent" : "text-muted hover:text-accent hover:underline hover:underline-offset-4"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-14 bg-ink px-4 py-14 text-paper sm:px-8">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-10">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <b className="block font-display text-xl font-bold uppercase tracking-[0.04em]">
                {SUBJECT_NAME}
              </b>
              <span className="mt-1.5 block font-mono text-[11px] uppercase tracking-[0.22em] text-muted-on-ink">
                Public Accountability Project
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                Official record
              </span>
              <div className="flex flex-wrap gap-5 font-mono text-xs text-muted-on-ink">
                <Link to="/" className="no-underline hover:text-accent-soft">
                  Website
                </Link>
                <a href={YOUTUBE} target="_blank" rel="me noopener" className="no-underline hover:text-accent-soft">
                  YouTube
                </a>
                <Link to="/daily" className="no-underline hover:text-accent-soft">
                  Daily archive
                </Link>
                <Link to="/penalties" className="no-underline hover:text-accent-soft">
                  Violation log
                </Link>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule-strong pt-6 font-mono text-[13px] text-muted-on-ink">
            <span className="flex flex-wrap gap-x-5 gap-y-1">
              <span>
                Accountability Partner:{" "}
                <a href={`mailto:${AP_EMAIL}`} className="text-paper no-underline hover:text-accent-soft">
                  {AP_EMAIL}
                </a>
              </span>
              <span>
                {SUBJECT_NAME}:{" "}
                <a href={`mailto:${SUBJECT_EMAIL}`} className="text-paper no-underline hover:text-accent-soft">
                  {SUBJECT_EMAIL}
                </a>
              </span>
            </span>
            <Link to="/assistant" className="inline-flex items-center gap-2 text-paper no-underline hover:text-accent-soft">
              <span className="rec-lamp" aria-hidden="true" />
              Recording Assistant
            </Link>
            <a href={GITHUB} target="_blank" rel="noopener" className="text-paper no-underline hover:text-accent-soft">
              Site History
            </a>
          </div>
          {current ? <span className="sr-only">{current}</span> : null}
        </div>
      </footer>
    </div>
  );
}

function OpenBanner({ open }: { open: Violation[] }) {
  return (
    <div className="border-b border-ink bg-accent px-4 py-3 text-paper sm:px-8">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
            Public violation — {open.length === 1 ? "active" : `${open.length} open`}
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-snug">
            {open.map((v, i) => (
              <span key={v.id}>
                {i > 0 ? " · " : ""}
                <Link
                  to="/violations/$id"
                  params={{ id: v.slug }}
                  className="font-semibold underline decoration-paper/50 underline-offset-2"
                >
                  {v.id}
                </Link>
                <span>
                  {" "}
                  — {v.date}
                  {v.itemsMissing ? `, ${v.itemsMissing} required item${v.itemsMissing === 1 ? "" : "s"} still missing` : ""}
                </span>
              </span>
            ))}
            . Assigned consequences remain pending until completed and verified.
          </p>
        </div>
        <Link
          to="/penalties"
          className="shrink-0 self-start bg-ink px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-paper no-underline hover:bg-ink-soft"
        >
          View violation log →
        </Link>
      </div>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  lede,
  crumbs,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  crumbs?: { to: string; label: string }[];
}) {
  return (
    <header className="mx-auto max-w-[1160px] border-b-2 border-ink px-4 py-8 sm:px-8">
      {crumbs ? (
        <nav className="mb-2.5 font-mono text-xs uppercase tracking-[0.1em] text-muted">
          {crumbs.map((c, i) => (
            <span key={c.to}>
              {i > 0 ? " / " : null}
              <Link to={c.to} className="text-muted no-underline hover:text-accent">
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
      ) : null}
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <h1 className="mt-2 text-[clamp(2rem,5vw,3.5rem)]">{title}</h1>
      {lede ? <p className="mt-3 max-w-2xl text-lg text-ink-soft">{lede}</p> : null}
    </header>
  );
}

export function ViewSwitch({
  items,
}: {
  items: { to: string; label: string; current?: boolean }[];
}) {
  return (
    <div className="mb-6 inline-flex border border-ink font-mono text-xs font-semibold uppercase tracking-[0.1em]">
      {items.map((item, i) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.current ? "page" : undefined}
          className={`px-4 py-2.5 no-underline ${i > 0 ? "border-l border-ink" : ""} ${
            item.current ? "bg-ink text-paper" : "text-ink hover:text-accent"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function StatGrid({
  items,
  invert = false,
}: {
  items: { label: string; value: string; accent?: boolean }[];
  invert?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-2 border sm:grid-cols-3 lg:grid-cols-6 ${
        invert ? "border-rule-strong bg-ink text-paper" : "border-ink"
      }`}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex flex-col gap-2 px-5 py-8 ${
            i > 0 ? (invert ? "border-l border-rule-strong" : "border-l border-rule") : ""
          }`}
        >
          <span
            className={`font-mono text-[11px] uppercase tracking-[0.16em] ${
              item.accent ? "text-accent" : invert ? "text-muted-on-ink" : "text-muted"
            }`}
          >
            {item.label}
          </span>
          <span className={`font-mono text-[28px] font-semibold tabular-nums leading-none ${item.accent ? "text-accent" : ""}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
