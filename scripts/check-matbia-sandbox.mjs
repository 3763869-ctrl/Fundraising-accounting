// Optional provider check using ONLY Matbia's published sandbox fixtures.
// All accounting verification happens in an ephemeral in-memory PostgreSQL DB.
// No production credentials, cards, customer records or live API hosts are used.
if (process.env.MATBIA_VERIFY_SANDBOX === "1") {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile, readdir } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const {
    submitMatbiaCharge,
    MATBIA_SANDBOX_TOKEN,
    MATBIA_SANDBOX_ORG,
    MATBIA_SANDBOX_CARDS,
  } = await import("../lib/matbia/transaction.ts");
  const db = new PGlite();
  try {
    await db.exec(
      `create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001','sandbox@example.test',now());select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    );
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    const org = (
      await db.query("select create_organization('Isolated sandbox') id")
    ).rows[0].id;
    await db.query("select bind_matbia_merchant($1,auth.uid())", [org]);
    const donor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Synthetic donor') returning id",
        [org],
      )
    ).rows[0].id;
    const campaign = (
      await db.query(
        "insert into campaigns(organization_id,name) values($1,'Synthetic campaign') returning id",
        [org],
      )
    ).rows[0].id;
    const pledge = (
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,10000,current_date) returning id",
        [org, donor, campaign],
      )
    ).rows[0].id;
    const context = {
      campaign_id: campaign,
      description: "Sandbox fixture only",
      collector: "Automated sandbox check",
      credit_confirmed: false,
    };
    for (const fixture of process.env.MATBIA_SANDBOX_DECLINE_ONLY === "1"
      ? ["declined"]
      : ["funded", "declined"]) {
      const requestKey = randomUUID(),
        allocations = [{ pledge_id: pledge, amount_minor: 2500 }];
      const prepared = (
        await db.query(
          "select prepare_matbia_payment($1,$2,2500,$3,$4,$5) result",
          [
            org,
            donor,
            requestKey,
            JSON.stringify(allocations),
            JSON.stringify(context),
          ],
        )
      ).rows[0].result;
      const result = await submitMatbiaCharge({
        environment: "sandbox",
        token: MATBIA_SANDBOX_TOKEN,
        organizationHandle: MATBIA_SANDBOX_ORG,
        cardNumber: MATBIA_SANDBOX_CARDS[fixture],
        expiry: "1228",
        amountMinor: 2500,
        requestKey,
        transactionDate: new Date().toISOString(),
      });
      if (fixture === "funded" && result.state !== "approved")
        throw new Error(
          `Matbia sandbox approval was not confirmed (provider status: ${result.providerStatus ?? "unavailable"}). No production request submitted.`,
        );
      if (fixture === "declined" && result.state !== "declined")
        throw new Error(
          "Matbia declined sandbox fixture did not produce a definitive decline. Review the documented error mapping.",
        );
      await db.query("select finish_matbia_payment($1,$2,$3)", [
        prepared.attempt,
        result.state,
        result.reference,
      ]);
      const remaining = Number(
        (
          await db.query(
            "select amount_minor-(select coalesce(sum(amount_minor),0) from payment_allocations where pledge_id=$1) balance from pledges where id=$1",
            [pledge],
          )
        ).rows[0].balance,
      );
      if (
        remaining !==
        (process.env.MATBIA_SANDBOX_DECLINE_ONLY === "1" ? 10000 : 7500)
      )
        throw new Error("Matbia sandbox pledge balance verification failed.");
      const replay = (
        await db.query(
          "select prepare_matbia_payment($1,$2,2500,$3,$4,$5) result",
          [
            org,
            donor,
            requestKey,
            JSON.stringify(allocations),
            JSON.stringify(context),
          ],
        )
      ).rows[0].result;
      if (replay.send) throw new Error("Duplicate test failed.");
      console.log(
        `Matbia sandbox ${fixture}: ${result.state}; pledge remaining $${(remaining / 100).toFixed(2)}; duplicate request blocked. No live books written.`,
      );
    }
    const imbalance = (
      await db.query(
        "select coalesce(sum(debit_minor-credit_minor),0) difference from journal_lines",
      )
    ).rows[0].difference;
    if (Number(imbalance) !== 0)
      throw new Error("Sandbox ledger is unbalanced.");
  } finally {
    await db.close();
  }
}
