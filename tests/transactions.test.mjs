import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  applyCommand,
  tableNames,
  credit,
  balance,
} from "../lib/workspace/domain.ts";
test("transaction sample separates pledged campaigns, immediate donations, explicit credit and anonymous payments", () => {
  let data = {
    organization: { id: randomUUID(), name: "Sample" },
    role: "owner",
    tables: Object.fromEntries(tableNames.map((n) => [n, []])),
  };
  const run = (type, values = {}, table) =>
    (data = applyCommand(data, { type, values, table }));
  run("transaction_setup");
  const general = data.organization.default_donation_campaign_id,
    anon = data.tables.donors.find((d) => d.system_role === "anonymous").id;
  run("transaction_setup");
  assert.equal(data.tables.campaigns.length, 1);
  run("insert", { name: "Named donor" }, "donors");
  const donor = data.tables.donors.at(-1).id;
  run("insert", { name: "Building appeal" }, "campaigns");
  const campaign = data.tables.campaigns.at(-1).id;
  const pledgeDetails = {
    donor_id: donor,
    campaign_id: campaign,
    amount_minor: 6000,
    pledged_on: "2026-10-21",
    due_date: "2026-10-21",
    description: "Pledge",
    transaction_key: randomUUID(),
  };
  run("transaction_pledge", pledgeDetails);
  run("transaction_pledge", pledgeDetails);
  assert.equal(data.tables.pledges.length, 1);
  const pledge = data.tables.pledges[0].id;
  const details = {
    donor_id: donor,
    campaign_id: general,
    amount_minor: 10000,
    paid_on: "2026-10-21",
    method: "cash",
    status: "processed",
    idempotency_key: randomUUID(),
    description: "Donation",
    allocations: [{ pledge_id: pledge, amount_minor: 6000 }],
    remainder_mode: "donation",
    credit_confirmed: false,
  };
  run("transaction_payment", details);
  const p = data.tables.payments[0];
  assert.equal(credit(data, p), 0);
  assert.equal(balance(data, data.tables.pledges[0]), 0);
  assert.equal(
    data.tables.pledges.find((pl) => pl.id === p.direct_pledge_id).campaign_id,
    general,
  );
  assert.equal(
    data.tables.pledges.find((pl) => pl.id === p.direct_pledge_id).amount_minor,
    4000,
  );
  run("transaction_payment", details);
  assert.equal(data.tables.pledges.length, 2);
  assert.equal(data.tables.payments.length, 1);
  run("transaction_payment", {
    ...details,
    amount_minor: 2500,
    idempotency_key: randomUUID(),
    allocations: [],
    remainder_mode: "credit",
    credit_confirmed: true,
  });
  assert.equal(credit(data, data.tables.payments.at(-1)), 2500);
  run("transaction_payment", {
    ...details,
    donor_id: anon,
    amount_minor: 500,
    idempotency_key: randomUUID(),
    allocations: [],
  });
  assert.equal(credit(data, data.tables.payments.at(-1)), 0);
  assert.throws(
    () =>
      run("transaction_payment", {
        ...details,
        donor_id: anon,
        idempotency_key: randomUUID(),
        allocations: [],
        remainder_mode: "credit",
      }),
    /named donor/,
  );
  run("cash_void", {
    payment: p.id,
    dated: "2026-10-21",
    reason: "Duplicate entry",
  });
  assert.equal(
    balance(
      data,
      data.tables.pledges.find((pl) => pl.id === pledge),
    ),
    6000,
  );
  assert.ok(
    data.tables.pledges.find((pl) => pl.id === p.direct_pledge_id).voided_at,
  );
});
test("SQL transaction workflows preserve allocation campaigns, donate only the remainder, finalize providers once and scope anonymous identities", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001','owner@example.test',now()),('00000000-0000-0000-0000-000000000002','other@example.test',now());select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    );
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    await db.exec("set role authenticated");
    const org = (
      await db.query("select create_organization('Transaction test') id")
    ).rows[0].id;
    await db.query("select ensure_transaction_setup($1)", [org]);
    await db.query("select ensure_transaction_setup($1)", [org]);
    const general = (
      await db.query(
        "select default_donation_campaign_id id from organizations where id=$1",
        [org],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query(
          "select count(*) n from donors where organization_id=$1 and system_role='anonymous'",
          [org],
        )
      ).rows[0].n,
      1,
    );
    const anon = (
      await db.query(
        "select id from donors where organization_id=$1 and system_role='anonymous'",
        [org],
      )
    ).rows[0].id;
    const donor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Named donor') returning id",
        [org],
      )
    ).rows[0].id;
    const campaign = (
      await db.query(
        "insert into campaigns(organization_id,name) values($1,'Building appeal') returning id",
        [org],
      )
    ).rows[0].id;
    const pledgeDetails = {
      donor_id: donor,
      campaign_id: campaign,
      amount_minor: 6000,
      pledged_on: "2026-10-21",
      due_date: "2026-10-21",
      description: "Building pledge",
      transaction_key: randomUUID(),
    };
    const pledge = (
      await db.query("select record_transaction_pledge($1,$2) id", [
        org,
        JSON.stringify(pledgeDetails),
      ])
    ).rows[0].id;
    assert.equal(
      (
        await db.query("select record_transaction_pledge($1,$2) id", [
          org,
          JSON.stringify(pledgeDetails),
        ])
      ).rows[0].id,
      pledge,
    );
    const details = {
      donor_id: donor,
      campaign_id: general,
      amount_minor: 10000,
      paid_on: "2026-10-21",
      method: "cash",
      status: "processed",
      idempotency_key: randomUUID(),
      allocations: [{ pledge_id: pledge, amount_minor: 6000 }],
      credit_confirmed: false,
      remainder_mode: "donation",
      description: "Public note",
    };
    const pay = async (d) =>
      (
        await db.query("select record_transaction_payment($1,$2) id", [
          org,
          JSON.stringify(d),
        ])
      ).rows[0].id;
    const payment = await pay(details);
    assert.equal(await pay(details), payment);
    let row = (
      await db.query("select direct_pledge_id from payments where id=$1", [
        payment,
      ])
    ).rows[0];
    assert.ok(row.direct_pledge_id);
    const splits = (
      await db.query(
        "select p.campaign_id,a.amount_minor from payment_allocations a join pledges p on p.id=a.pledge_id where a.payment_id=$1 order by a.amount_minor",
        [payment],
      )
    ).rows;
    assert.deepEqual(
      splits.map((r) => [r.campaign_id, Number(r.amount_minor)]),
      [
        [general, 4000],
        [campaign, 6000],
      ],
    );
    await assert.rejects(
      pay({ ...details, amount_minor: 10001 }),
      /different donation/,
    );
    const creditPay = await pay({
      ...details,
      idempotency_key: randomUUID(),
      amount_minor: 2500,
      allocations: [],
      credit_confirmed: true,
      remainder_mode: "credit",
    });
    assert.equal(
      (
        await db.query("select direct_pledge_id from payments where id=$1", [
          creditPay,
        ])
      ).rows[0].direct_pledge_id,
      null,
    );
    const anonymousPay = await pay({
      ...details,
      idempotency_key: randomUUID(),
      donor_id: anon,
      amount_minor: 500,
      allocations: [],
    });
    assert.ok(
      (
        await db.query("select direct_pledge_id from payments where id=$1", [
          anonymousPay,
        ])
      ).rows[0].direct_pledge_id,
    );
    await assert.rejects(
      pay({
        ...details,
        idempotency_key: randomUUID(),
        donor_id: anon,
        allocations: [],
        remainder_mode: "credit",
      }),
      /named donor/,
    );
    await db.query(
      "select void_cash_payment($1,'2026-10-21','Duplicate entry')",
      [payment],
    );
    assert.ok(
      (
        await db.query("select voided_at from pledges where id=$1", [
          row.direct_pledge_id,
        ])
      ).rows[0].voided_at,
    );
    await assert.rejects(
      db.query("select complete_transaction_donation($1)", [creditPay]),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    await db.query(
      "select bind_sola_merchant($1,'00000000-0000-0000-0000-000000000001')",
      [org],
    );
    await db.query(
      "select bind_matbia_merchant($1,'00000000-0000-0000-0000-000000000001')",
      [org],
    );
    const donation = {
      campaign_id: general,
      description: "Gateway donation",
      collector: "",
      credit_confirmed: true,
      remainder_mode: "donation",
    };
    for (const provider of ["sola", "matbia"]) {
      await db.exec("reset role;set role authenticated");
      const key = randomUUID();
      const prep =
        provider === "sola"
          ? (
              await db.query(
                "select prepare_sola_donation($1,$2,1000,$3,'[]',$4,null,false) result",
                [org, donor, key, JSON.stringify(donation)],
              )
            ).rows[0].result
          : (
              await db.query(
                "select prepare_matbia_payment($1,$2,1000,$3,'[]',$4) result",
                [org, donor, key, JSON.stringify(donation)],
              )
            ).rows[0].result;
      await db.exec("reset role;set role service_role");
      const finish = () =>
        provider === "sola"
          ? db.query(
              "select finish_sola_payment_vault($1,'approved','SOLA_TEST',null)",
              [prep.attempt],
            )
          : db.query(
              "select finish_matbia_payment($1,'approved','MATBIA_TEST')",
              [prep.attempt],
            );
      await finish();
      await finish();
      await db.exec("reset role;set role authenticated");
      assert.ok(
        (
          await db.query("select direct_pledge_id from payments where id=$1", [
            prep.payment,
          ])
        ).rows[0].direct_pledge_id,
      );
    }
    // An allocation changed during a gateway request must keep funds for review,
    // rather than silently donating them to the default campaign.
    for (const provider of ["sola", "matbia"]) {
      await db.exec("reset role;set role authenticated");
      const d = (
        await db.query(
          "insert into donors(organization_id,name) values($1,'Concurrent donor') returning id",
          [org],
        )
      ).rows[0].id;
      const pl = (
        await db.query(
          "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,pledged_on,due_date) values($1,$2,$3,1000,'2026-10-21','2026-10-21') returning id",
          [org, d, campaign],
        )
      ).rows[0].id;
      const alloc = JSON.stringify([{ pledge_id: pl, amount_minor: 1000 }]);
      const prep = (
        await db.query(
          provider === "sola"
            ? "select prepare_sola_donation($1,$2,1200,$3,$4,$5,null,false) result"
            : "select prepare_matbia_payment($1,$2,1200,$3,$4,$5) result",
          [org, d, randomUUID(), alloc, JSON.stringify(donation)],
        )
      ).rows[0].result;
      await pay({
        ...details,
        donor_id: d,
        idempotency_key: randomUUID(),
        amount_minor: 1000,
        allocations: JSON.parse(alloc),
        remainder_mode: "credit",
      });
      await db.exec("reset role;set role service_role");
      const result = (
        await db.query(
          provider === "sola"
            ? "select finish_sola_payment_vault($1,'approved','CONCURRENT_SOLA',null) result"
            : "select finish_matbia_payment($1,'approved','CONCURRENT_MATBIA') result",
          [prep.attempt],
        )
      ).rows[0].result;
      assert.equal(result.allocation_review, true);
      await db.exec("reset role;set role authenticated");
      assert.equal(
        (
          await db.query("select direct_pledge_id from payments where id=$1", [
            prep.payment,
          ])
        ).rows[0].direct_pledge_id,
        null,
      );
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) n from payment_allocations where payment_id=$1",
              [prep.payment],
            )
          ).rows[0].n,
        ),
        0,
      );
    }
    for (const provider of ["sola", "matbia"]) {
      for (const outcome of ["declined", "unknown"]) {
        await db.exec("reset role;set role authenticated");
        const key = randomUUID();
        const prep = (
          await db.query(
            provider === "sola"
              ? "select prepare_sola_donation($1,$2,1000,$3,'[]',$4,null,false) result"
              : "select prepare_matbia_payment($1,$2,1000,$3,'[]',$4) result",
            [org, donor, key, JSON.stringify(donation)],
          )
        ).rows[0].result;
        await db.exec("reset role;set role service_role");
        await db.query(
          provider === "sola"
            ? "select finish_sola_payment_vault($1,$2,null,null)"
            : "select finish_matbia_payment($1,$2,null)",
          [prep.attempt, outcome],
        );
        await db.exec("reset role;set role authenticated");
        const row = (
          await db.query(
            "select direct_pledge_id,status from payments where id=$1",
            [prep.payment],
          )
        ).rows[0];
        assert.equal(row.direct_pledge_id, null);
        assert.equal(row.status, outcome === "declined" ? "failed" : "pending");
      }
    }
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(debit_minor-credit_minor) difference from journal_lines",
          )
        ).rows[0].difference,
      ),
      0,
    );
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);set role authenticated",
    );
    await assert.rejects(
      db.query("select ensure_transaction_setup($1)", [org]),
      /Permission denied/,
    );
    assert.equal((await db.query("select * from payments")).rows.length, 0);
  } finally {
    await db.close();
  }
});
