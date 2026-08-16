import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  head: () =>
    pageHead({
      title: "Sign in",
      description: "Sign in is for site administration only. The official record is public.",
      path: "/login",
      noindex: true,
    }),
  component: Login,
});

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6 text-ink">
      <div className="w-full max-w-sm space-y-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          Administration
        </p>
        <h1 className="font-display text-3xl">Sign in</h1>
        <p className="text-sm text-muted">
          The official record is public and does not require an account. This
          page is only for the Accountability Partner.
        </p>
        {authEnabled ? (
          GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              className="w-full border border-ink px-4 py-3 font-mono text-sm uppercase tracking-[0.08em] hover:bg-ink hover:text-paper"
            >
              Continue with {p.label}
            </button>
          ))
        ) : (
          <p className="text-sm text-muted">Sign-in is disabled.</p>
        )}
        <Link to="/" className="inline-block font-mono text-xs uppercase tracking-[0.12em] underline">
          ← Official record
        </Link>
      </div>
    </main>
  );
}
