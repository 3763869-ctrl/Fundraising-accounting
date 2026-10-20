import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabase, configured } from "@/lib/supabase/server";

export const liveLimit = () => {
  const value = Number(process.env.SOLA_MAX_CHARGE_MINOR ?? "10000");
  return Number.isSafeInteger(value) && value > 0 && value <= 99999999999
    ? value
    : 0;
};
export function liveConfigured() {
  return (
    process.env.VERCEL_ENV === "production" &&
    process.env.SOLA_LIVE_PAYMENTS_ENABLED === "true" &&
    Boolean(
      process.env.SOLA_API_KEY &&
        process.env.NEXT_PUBLIC_SOLA_IFIELDS_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        process.env.SOLA_OWNER_EMAIL &&
        liveLimit(),
    )
  );
}
export async function solaOwner() {
  if (!configured()) return null;
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (
    !user ||
    !user.email_confirmed_at ||
    !process.env.SOLA_OWNER_EMAIL ||
    user.email?.toLowerCase() !== process.env.SOLA_OWNER_EMAIL.toLowerCase()
  )
    return null;
  return { db, user };
}
export async function solaIdentity() {
  const owner = await solaOwner();
  if (!owner || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { db, user } = owner;
  const { data: binding, error } = await solaAdmin()
    .from("sola_merchant_binding")
    .select("organization_id")
    .eq("singleton", true)
    .maybeSingle();
  if (error || !binding) return null;
  const org = binding.organization_id;
  const { data: member } = await db
    .from("memberships")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) return null;
  return { db, user, org };
}
export function solaAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Payment backend is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
