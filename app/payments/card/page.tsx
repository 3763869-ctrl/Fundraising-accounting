import Link from "next/link";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase/server";
import {
  liveConfigured,
  liveLimit,
  solaIdentity,
  solaOwner,
} from "@/lib/sola/server";
import { SolaMerchantConnect } from "@/components/sola-merchant-connect";
import { SolaLivePayment } from "@/components/sola-live-payment";
export const dynamic = "force-dynamic";
export default async function CardPayment() {
  if (!configured()) redirect("/login?message=configuration");
  const client = await supabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const identity = await solaIdentity();
  if (!identity || !liveConfigured()) {
    const owner = await solaOwner();
    let organizations: { id: string; name: string }[] = [];
    if (owner && !identity && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { data: memberships } = await owner.db
        .from("memberships")
        .select("organization_id")
        .eq("user_id", owner.user.id)
        .eq("role", "owner");
      if (memberships?.length) {
        const { data } = await owner.db
          .from("organizations")
          .select("id,name")
          .in(
            "id",
            memberships.map((m) => m.organization_id),
          );
        organizations = data ?? [];
      }
    }
    return (
      <main className="shell">
        <section className="card">
          <Link href="/dashboard">← Workspace</Link>
          <h1>Card payment setup</h1>
          <p>
            Live entry is not enabled for this account yet. The verified owner
            email, organization binding and payment backend must be configured
            before a card can be entered.
          </p>
          {owner &&
            !identity &&
            (organizations.length ? (
              <SolaMerchantConnect organizations={organizations} />
            ) : (
              <p>
                <Link href="/setup">Create your synagogue organization →</Link>
              </p>
            ))}
          <p>
            Create your organization and donor records in the workspace, then
            finish the merchant connection. Do not enter card details in notes
            or manual payment references.
          </p>
        </section>
      </main>
    );
  }
  const { data: donors, error } = await identity.db
    .from("donors")
    .select("id,name")
    .eq("organization_id", identity.org)
    .eq("active", true)
    .order("name")
    .limit(1000);
  if (error)
    return (
      <main className="shell">
        <h1>Payment setup needs attention</h1>
        <p>Donor records could not be loaded. No payment was submitted.</p>
      </main>
    );
  return (
    <main className="shell">
      <section className="card" style={{ maxWidth: 650, margin: "auto" }}>
        <Link href="/dashboard?page=payments">← Payments</Link>
        <h1>Charge a card</h1>
        {donors?.length ? (
          <SolaLivePayment
            ifieldsKey={process.env.NEXT_PUBLIC_SOLA_IFIELDS_KEY!}
            donors={donors}
            limit={liveLimit()}
          />
        ) : (
          <p>
            Add a real donor in the workspace before recording a card payment.
          </p>
        )}
      </section>
    </main>
  );
}
