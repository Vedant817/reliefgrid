import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

function messageOf(cause: unknown) {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (/InvalidAccountId|InvalidSecret/i.test(raw)) return "Email or password is incorrect";
  if (/already exists|already used/i.test(raw)) return "An account with this email already exists";
  const cleaned = raw.replace(/^\[CONVEX[^\]]*\]\s*/i, "").replace(/Server Error Uncaught Error:\s*/i, "").trim();
  return cleaned || "Could not sign in";
}

export function AuthScreen() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signUp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card w-full max-w-md p-6" aria-label="Sign in">
      <div className="eyebrow text-ledger">{mode === "signUp" ? "Create your workspace" : "Sign in"}</div>
      <h2 className="mt-2 font-serif text-[26px] font-bold tracking-tight">
        {mode === "signUp" ? "Keep this purchase in your account" : "Return to your requirements"}
      </h2>
      <p className="mt-1 text-sm text-soft">
        Convex Auth with email and password. The same login sees the same live quotes.
      </p>
      <form
        aria-label="Account"
        className="mt-5 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError(null);
          try {
            await signIn("password", {
              email: String(form.get("email") ?? "").trim(),
              password: String(form.get("password") ?? ""),
              flow: mode,
            });
          } catch (cause) {
            setError(messageOf(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-xs font-medium text-soft">
          Email
          <input required type="email" name="email" autoComplete="email" className="input-field mt-1" />
        </label>
        <label className="text-xs font-medium text-soft">
          Password
          <input required type="password" name="password" autoComplete={mode === "signUp" ? "new-password" : "current-password"} minLength={8} className="input-field mt-1" />
        </label>
        {error && <div role="alert" className="rounded-lg border border-[#edc4b6] bg-[#f9ece7] p-3 text-sm text-seal">{error}</div>}
        <button disabled={busy} className="w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-semibold text-white hover:bg-ledger-deep disabled:opacity-50">
          {busy ? "Working…" : mode === "signUp" ? "Create account" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        className="mt-4 text-xs font-medium text-ledger hover:underline"
        onClick={() => {
          setMode((current) => (current === "signUp" ? "signIn" : "signUp"));
          setError(null);
        }}
      >
        {mode === "signUp" ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
    </section>
  );
}
