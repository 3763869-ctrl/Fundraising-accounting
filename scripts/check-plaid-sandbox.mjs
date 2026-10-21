// One-off verification: Sandbox credentials only, simulated institution only.
// No production access tokens, bank connections, or bookkeeping data are used.
if (process.env.PLAID_VERIFY_SANDBOX === "1") {
  const { plaidSandbox, readSandboxSync, PlaidFailure } =
    await import("../lib/plaid/client.ts");
  const call = plaidSandbox(
    process.env.PLAID_CLIENT_ID,
    process.env.PLAID_SANDBOX_SECRET,
  );
  let token = "";
  try {
    const institutions = await call("/institutions/search", {
      query: "Chase",
      products: ["transactions"],
      country_codes: ["US"],
    });
    const chase = institutions.institutions?.find((i) =>
      /\bchase\b/i.test(i.name),
    );
    if (!chase) throw new Error("Simulated Chase institution not returned.");
    const pub = await call("/sandbox/public_token/create", {
      institution_id: chase.institution_id,
      initial_products: ["transactions"],
    });
    const item = await call("/item/public_token/exchange", {
      public_token: pub.public_token,
    });
    token = item.access_token;
    if (!/^access-sandbox-/.test(token))
      throw new Error("Non-Sandbox token rejected.");
    let count = 0;
    for (let i = 0; i < 10; i++) {
      try {
        const batch = await readSandboxSync(call, token, "");
        count = batch.added.length;
        if (count) break;
      } catch (e) {
        if (!(e instanceof PlaidFailure) || e.code !== "PRODUCT_NOT_READY")
          throw e;
      }
      if (i < 9) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!count)
      throw new Error("Sandbox linked, but sample transactions are not ready.");
    console.log(
      `Plaid Sandbox verification passed: simulated Chase connected; ${count} test transactions received. No live bank or accounting records written.`,
    );
  } catch (e) {
    throw new Error(
      `Plaid Sandbox verification failed (${e instanceof PlaidFailure ? e.code : "SANDBOX_DATA_NOT_READY"}). No Production Plaid API was used.`,
    );
  } finally {
    if (token) {
      await call("/item/remove", { access_token: token });
      token = "";
      console.log("Temporary Plaid Sandbox test connection removed.");
    }
  }
}
