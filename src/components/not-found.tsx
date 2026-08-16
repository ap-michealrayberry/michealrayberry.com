import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6 text-ink">
      <div className="max-w-md">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">404</p>
        <h1 className="mt-2 font-display text-4xl">No such page</h1>
        <p className="mt-3 text-muted">
          That address is not part of the official record.
        </p>
        <Link to="/" className="mt-6 inline-block font-mono text-xs uppercase tracking-[0.12em] underline">
          Return to the record
        </Link>
      </div>
    </main>
  );
}
