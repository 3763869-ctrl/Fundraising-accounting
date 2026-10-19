import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase/server";
import { createOrganization } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Setup({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  if (!configured()) redirect("/login?message=configuration");
  const client = await supabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  return (
    <main className="shell">
      <section className="auth card">
        <p className="eyebrow">Organization setup · Step 1</p>
        <h1>A home for your organization.</h1>
        <p className="muted">You’ll become the owner of this workspace.</p>
        {params.message && (
          <p className="notice" role="alert">
            Unable to create the organization. Check the name and database
            setup.
          </p>
        )}
        <form action={createOrganization}>
          <label>
            Organization name
            <input
              name="name"
              required
              maxLength={200}
              autoComplete="organization"
            />
          </label>
          <label>
            Country
            <input value="United States" readOnly />
          </label>
          <label>
            Working currency
            <input value="USD — US dollar" readOnly />
          </label>
          <button className="full">Create organization</button>
        </form>
      </section>
    </main>
  );
}
