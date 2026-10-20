import Link from "next/link";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase/server";
import { sandboxFieldsAllowed } from "@/lib/sola/ifields";
import { SolaIFields } from "@/components/sola-ifields";

export const dynamic = "force-dynamic";

export default async function SolaSetup() {
  // The live API key and live iFields key are deliberately not read here.
  let allowed = false;
  const org = process.env.SOLA_SANDBOX_ORGANIZATION_ID;
  if (configured()) {
    const client = await supabase();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) redirect("/login");
    if (org) {
      const { data: membership } = await client
        .from("memberships")
        .select("role")
        .eq("organization_id", org)
        .eq("user_id", user.id)
        .maybeSingle();
      allowed = Boolean(
        membership && ["owner", "admin"].includes(membership.role),
      );
    }
  }
  const enabled =
    allowed &&
    sandboxFieldsAllowed({
      deployment: process.env.VERCEL_ENV,
      nodeEnvironment: process.env.NODE_ENV,
      enabled: process.env.SOLA_SANDBOX_ENABLED,
      hasSandboxKey: Boolean(process.env.SOLA_SANDBOX_IFIELDS_KEY),
      organization: org,
    });
  return (
    <main className="shell">
      <section className="card">
        <Link href="/dashboard?page=gateways">← Payment gateways</Link>
        <p className="eyebrow">Sola · formerly Cardknox</p>
        <h1>Secure card-entry setup</h1>
        <p className="notice">
          Live processing is disabled. This page cannot charge a card, save a
          payment method, or create a recurring schedule.
        </p>
        {enabled ? (
          <SolaIFields sandboxKey={process.env.SOLA_SANDBOX_IFIELDS_KEY!} />
        ) : (
          <>
            <h2>Sandbox setup required</h2>
            <p>
              The secure-field check is available only to an owner or
              administrator of an explicitly selected sandbox organization, in a
              separate Preview deployment or local development environment.
            </p>
            <ol>
              <li>
                Connect a separate non-production Supabase project and create a
                sandbox organization.
              </li>
              <li>
                Create a Sola sandbox account and a separate sandbox iFields
                key. Do not copy the live key.
              </li>
              <li>
                Configure the Preview deployment with SOLA_SANDBOX_IFIELDS_KEY,
                SOLA_SANDBOX_ORGANIZATION_ID, and SOLA_SANDBOX_ENABLED=true.
                Restrict the sandbox iFields key to the chosen preview origin
                where supported.
              </li>
              <li>
                Sign in as that sandbox organization’s owner or administrator
                and return to this page.
              </li>
            </ol>
            <p>
              Production deployments always keep this sandbox check disabled.
              The existing live keys remain unused.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
