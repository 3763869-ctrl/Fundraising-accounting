import "server-only";
import { createClient } from "@supabase/supabase-js";
import { configured, supabase } from "@/lib/supabase/server";
import { MATBIA_SANDBOX_ORG, MATBIA_SANDBOX_TOKEN } from "./transaction";
export const matbiaLimit = () => {
  const n = Number(process.env.MATBIA_MAX_CHARGE_MINOR ?? 10000);
  return Number.isSafeInteger(n) && n > 0 && n <= 99999999999 ? n : 0;
};
export function matbiaMissing() {
  const missing: string[] = [];
  if (
    !process.env.MATBIA_API_TOKEN?.trim() ||
    process.env.MATBIA_API_TOKEN.trim() === MATBIA_SANDBOX_TOKEN
  )
    missing.push("Production validation token");
  if (
    !process.env.MATBIA_ORG_USER_HANDLE?.trim() ||
    process.env.MATBIA_ORG_USER_HANDLE.trim() === MATBIA_SANDBOX_ORG
  )
    missing.push("Organization profile API key");
  if (process.env.MATBIA_DIRECT_ENTRY_ENABLED !== "true")
    missing.push("Direct card entry enabled");
  if (process.env.MATBIA_LIVE_PAYMENTS_ENABLED !== "true")
    missing.push("Live processing enabled");
  if (
    process.env.VERCEL_ENV !== "production" ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !matbiaLimit()
  )
    missing.push("Production backend settings");
  return missing;
}
export async function matbiaOwner() {
  if (!configured()) return null;
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  const email = process.env.MATBIA_OWNER_EMAIL ?? process.env.SOLA_OWNER_EMAIL;
  return user?.email_confirmed_at &&
    email &&
    user.email?.toLowerCase() === email.toLowerCase()
    ? { db, user }
    : null;
}
export function matbiaAdmin() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("Payment backend unavailable.");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function matbiaIdentity() {
  const owner = await matbiaOwner();
  if (!owner || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data: binding } = await matbiaAdmin()
    .from("matbia_merchant_binding")
    .select("organization_id")
    .eq("singleton", true)
    .maybeSingle();
  if (!binding) return null;
  const { data: member } = await owner.db
    .from("memberships")
    .select("role")
    .eq("organization_id", binding.organization_id)
    .eq("user_id", owner.user.id)
    .maybeSingle();
  return member && ["owner", "admin"].includes(member.role)
    ? { ...owner, org: binding.organization_id }
    : null;
}
