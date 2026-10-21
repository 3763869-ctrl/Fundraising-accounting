import "server-only";
import { createClient } from "@supabase/supabase-js";
import { configured, supabase } from "@/lib/supabase/server";
export function plaidMissing() {
  const m: string[] = [];
  if (!process.env.PLAID_CLIENT_ID) m.push("Plaid client ID");
  if (!process.env.PLAID_SANDBOX_SECRET) m.push("Plaid Sandbox secret");
  if (!/^[a-f0-9]{64}$/i.test(process.env.PLAID_TOKEN_ENCRYPTION_KEY ?? ""))
    m.push("Server encryption key");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    m.push("Private database connection");
  return m;
}
export function plaidAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function plaidOwner(org: string) {
  if (!configured() || !/^[a-f0-9-]{36}$/i.test(org)) return null;
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  const owner = process.env.PLAID_OWNER_EMAIL ?? process.env.SOLA_OWNER_EMAIL;
  if (
    !user?.email_confirmed_at ||
    !owner ||
    user.email?.toLowerCase() !== owner.toLowerCase()
  )
    return null;
  const { data: member } = await db
    .from("memberships")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", user.id)
    .maybeSingle();
  return member && ["owner", "admin"].includes(member.role)
    ? { db, user }
    : null;
}
