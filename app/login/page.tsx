import Link from "next/link";
import { authenticate, resendConfirmation } from "@/app/actions";
import { configured } from "@/lib/supabase/server";

const messages: Record<string, string> = {
  resend: "Could not request another confirmation email. Wait a minute and try again. If this continues, check the project email settings.",
  configuration: "Connect the Supabase project before signing in.",
  invalid: "Enter a valid email address and password.",
  password: "Use a password between 12 and 128 characters.",
  auth: "Unable to authenticate. Check your details and email confirmation, or try again later.",
  confirmation:
    "Check your email to confirm your account, then return here to sign in.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; message?: string }>;
}) {
  const params = await searchParams;
  const signup = params.mode === "signup";
  const ready = configured();
  return (
    <main className="shell">
      <Link className="brand" href="/">
        <span className="mark">f</span>Fundraising & Accounting
      </Link>
      <section className="auth card">
        <p className="eyebrow">Your organization starts here</p>
        <h1>{signup ? "Make room for your mission." : "Welcome back."}</h1>
        <p className="muted">
          {signup
            ? "Create your account, then set up your US organization."
            : "Sign in to your organization’s workspace."}
        </p>
        {!ready && (
          <div className="notice">
            Account setup is awaiting a Supabase project connection. The web
            foundation is available; signup is not active yet.
          </div>
        )}
        {params.message && messages[params.message] && (
          <div role="status" className="notice">
            {messages[params.message]}
          </div>
        )}
        <form action={authenticate}>
          <input
            type="hidden"
            name="mode"
            value={signup ? "signup" : "login"}
          />
          <label>
            Email address
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <p className="muted">At least 12 characters.</p>
          <button className="full" disabled={!ready}>
            {signup ? "Create account" : "Sign in"}
          </button>
        </form>
        <details style={{ marginTop: 20 }}>
          <summary>Confirmation link expired? Resend confirmation</summary>
          <p className="muted">Open the newest email in the same browser where you requested it. If your account is already confirmed, sign in above.</p>
          <form action={resendConfirmation}>
            <label>Email address<input type="email" name="email" autoComplete="email" required maxLength={254} /></label>
            <button disabled={!ready}>Resend confirmation email</button>
          </form>
        </details>
        <p style={{ marginTop: 20 }}>
          {signup ? "Already have an account?" : "New here?"}{" "}
          <Link href={signup ? "/login" : "/login?mode=signup"}>
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </main>
  );
}
