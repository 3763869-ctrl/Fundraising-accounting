// Read-only activation preflight. Never calls a Matbia API or payment function.
if (process.env.MATBIA_VERIFY_CONFIGURATION === "1") {
  const { MATBIA_SANDBOX_TOKEN, MATBIA_SANDBOX_ORG } =
    await import("../lib/matbia/transaction.ts");
  const token = (process.env.MATBIA_API_TOKEN ?? "").trim(),
    handle = (process.env.MATBIA_ORG_USER_HANDLE ?? "").trim(),
    owner = (
      process.env.MATBIA_OWNER_EMAIL ??
      process.env.SOLA_OWNER_EMAIL ??
      ""
    )
      .trim()
      .toLowerCase();
  const limit = Number(process.env.MATBIA_MAX_CHARGE_MINOR ?? 10000);
  if (
    !token ||
    token === MATBIA_SANDBOX_TOKEN ||
    !handle ||
    handle === MATBIA_SANDBOX_ORG ||
    !owner.includes("@") ||
    process.env.MATBIA_DIRECT_ENTRY_ENABLED !== "true" ||
    process.env.MATBIA_LIVE_PAYMENTS_ENABLED !== "true" ||
    process.env.VERCEL_ENV !== "production" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10000
  )
    throw Error(
      "Matbia activation configuration is incomplete. No provider request submitted.",
    );
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Error("Matbia private backend is incomplete.");
  const get = async (path) => {
    const r = await fetch(`${base}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("Matbia read-only backend verification failed.");
    return r.json();
  };
  const bindings = await get(
    "/rest/v1/matbia_merchant_binding?select=organization_id,owner_id&singleton=eq.true",
  );
  if (bindings.length !== 1)
    throw Error("Matbia organization is not connected.");
  const binding = bindings[0],
    userBody = await get(
      `/auth/v1/admin/users/${encodeURIComponent(binding.owner_id)}`,
    ),
    user = userBody.user ?? userBody;
  if (
    !user.email_confirmed_at ||
    String(user.email ?? "").toLowerCase() !== owner
  )
    throw Error("Matbia verified owner configuration does not match.");
  const members = await get(
    `/rest/v1/memberships?select=role&organization_id=eq.${encodeURIComponent(binding.organization_id)}&user_id=eq.${encodeURIComponent(binding.owner_id)}`,
  );
  if (!members.some((m) => m.role === "owner"))
    throw Error("Matbia organization ownership needs review.");
  console.log(
    "Matbia activation preflight passed: private settings, verified owner, organization binding and $100 maximum confirmed. No Matbia API called; no payment created.",
  );
}
