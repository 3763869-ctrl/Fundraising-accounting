import { IFIELDS_BASE } from "../lib/sola/ifields.ts";

// Optional deployment check of public Sola resources and read-only Supabase
// connectivity. No Sola merchant key is read or transaction endpoint called.
if (process.env.SOLA_VERIFY_PUBLIC_ASSETS === "1") {
  if (!/^[a-f0-9]{64}$/i.test(process.env.SOLA_CARD_VAULT_KEY ?? ""))
    throw new Error("Private card vault encryption setting is incomplete.");
  for (const [name, url, mime] of [
    ["iFields SDK", `${IFIELDS_BASE}/ifields.min.js`, /javascript|ecmascript/i],
    ["iFields frame", `${IFIELDS_BASE}/ifield.htm`, /html/i],
    ["Sola gateway health", "https://x1.cardknox.com/status", null],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (
      !response.ok ||
      (mime && !mime.test(response.headers.get("content-type") ?? ""))
    )
      throw new Error(
        `${name} availability check failed (${response.status}).`,
      );
    await response.body?.cancel();
    console.log(
      `${name}: HTTP ${response.status}. No credentials or transaction submitted.`,
    );
  }
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !publicKey || !serverKey)
    throw new Error("Supabase deployment settings are incomplete.");
  for (const [name, url, headers] of [
    [
      "Supabase public Auth connection",
      `${origin}/auth/v1/settings`,
      { apikey: publicKey },
    ],
    [
      "Supabase private card vault schema",
      `${origin}/rest/v1/sola_card_tokens?select=method_id&limit=0`,
      { apikey: serverKey, Authorization: `Bearer ${serverKey}` },
    ],
    [
      "Supabase private payment database",
      `${origin}/rest/v1/sola_merchant_binding?select=singleton&limit=0`,
      { apikey: serverKey, Authorization: `Bearer ${serverKey}` },
    ],
  ]) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`${name} verification failed (${response.status}).`);
    await response.body?.cancel();
    console.log(
      `${name}: HTTP ${response.status}. Read-only verification; no credentials displayed.`,
    );
  }
}
