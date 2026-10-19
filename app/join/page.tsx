import Link from "next/link";
import { configured, supabase } from "@/lib/supabase/server";
import { acceptInvitation } from "@/app/actions";
export const dynamic = "force-dynamic";
export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; message?: string }>;
}) {
  const params = await searchParams,
    token = params.token ?? "";
  if (!configured())
    return (
      <main className="shell">
        <p className="notice">Connect Supabase to accept a live invitation.</p>
        <Link href="/demo">Explore the separate sample workspace</Link>
      </main>
    );
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  return (
    <main className="shell">
      <section className="auth card">
        <p className="eyebrow">Cedar & Olive</p>
        <h1>Join your community.</h1>
        <p>
          Invitations expire after seven days and require a verified account
          with the invited email address.
        </p>
        {params.message && (
          <p className="notice" role="alert">
            The invitation could not be accepted. Check the email address,
            expiry, and whether it was already used.
          </p>
        )}
        {!user ? (
          <>
            <p>
              Sign in or create your account, confirm your email, then reopen
              this invitation link.
            </p>
            <Link className="button" href="/login">
              Sign in / Create account
            </Link>
          </>
        ) : (
          <form action={acceptInvitation}>
            <input type="hidden" name="token" value={token} />
            <p>Signed in as {user.email}</p>
            <button disabled={!/^[a-f0-9-]{72}$/.test(token)}>
              Accept invitation
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
