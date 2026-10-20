import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { suggestAllocations } from "../lib/workspace/donations.ts";
import { tableNames } from "../lib/workspace/domain.ts";

test("allocation suggestions prefer an exact match, otherwise oldest, with plan reservations and excess credit", () => {
  const data = { tables: Object.fromEntries(tableNames.map((n) => [n, []])) };
  data.tables.pledges = [
    { id: "old", donor_id: "d", pledged_on: "2025-01-01", amount_minor: 10000 },
    {
      id: "match",
      donor_id: "d",
      pledged_on: "2026-01-01",
      amount_minor: 5000,
    },
    {
      id: "void",
      donor_id: "d",
      pledged_on: "2024-01-01",
      amount_minor: 3000,
      voided_at: "now",
    },
    { id: "other", donor_id: "x", amount_minor: 5000 },
  ];
  assert.deepEqual(suggestAllocations(data, "d", 5000), [
    { pledge_id: "match", amount_minor: 5000 },
  ]);
  assert.deepEqual(suggestAllocations(data, "d", 12000), [
    { pledge_id: "old", amount_minor: 10000 },
    { pledge_id: "match", amount_minor: 2000 },
  ]);
  data.tables.schedules = [{ id: "s", pledge_id: "old", status: "active" }];
  data.tables.installments = [{ schedule_id: "s", amount_minor: 8000 }];
  assert.deepEqual(suggestAllocations(data, "d", 20000), [
    { pledge_id: "old", amount_minor: 2000 },
    { pledge_id: "match", amount_minor: 5000 },
  ]);
});

test("database donation workflow protects balances, scoped metadata, idempotency, edits and void history", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001','owner@example.test',now()),('00000000-0000-0000-0000-000000000002','other@example.test',now());`,
    );
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const f of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(f, dir), "utf8"));
    const actor = async (n) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      ]);
      await db.exec("set role authenticated");
    };
    await actor(1);
    const org = (
      await db.query("select create_organization('Donation test') id")
    ).rows[0].id;
    const donor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Test donor') returning id",
        [org],
      )
    ).rows[0].id;
    const campaign = (
      await db.query(
        "insert into campaigns(organization_id,name) values($1,'Campaign') returning id",
        [org],
      )
    ).rows[0].id;
    const pledge = (
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,pledged_on,due_date,description) values($1,$2,$3,10000,'2026-10-20','2026-12-31','Donor sees this') returning id",
        [org, donor, campaign],
      )
    ).rows[0].id;
    const details = {
      donor_id: donor,
      campaign_id: campaign,
      amount_minor: 12000,
      paid_on: "2026-10-20",
      method: "zelle",
      status: "processed",
      idempotency_key: randomUUID(),
      allocations: [],
      credit_confirmed: false,
      description: "Public donation description",
    };
    const pay = () =>
      db.query("select record_donation_payment($1,$2) id", [
        org,
        JSON.stringify(details),
      ]);
    await assert.rejects(pay(), /Confirm leaving/);
    details.allocations = [{ pledge_id: pledge, amount_minor: 10000 }];
    const payment = (await pay()).rows[0].id;
    assert.equal((await pay()).rows[0].id, payment);
    assert.equal(
      (
        await db.query(
          "select amount_minor-(select coalesce(sum(amount_minor),0) from payment_allocations where payment_id=$1) as credit from payments where id=$1",
          [payment],
        )
      ).rows[0].credit,
      "2000",
    );
    details.description = "Changed";
    await assert.rejects(pay(), /different donation/);
    details.description = "Public donation description";
    const receipt = (await db.query("select issue_receipt($1) id", [payment]))
      .rows[0].id;
    assert.equal(
      (await db.query("select snapshot from receipts where id=$1", [receipt]))
        .rows[0].snapshot.description,
      details.description,
    );
    const attrs = {
      amount_minor: 9000,
      campaign_id: campaign,
      pledged_on: "2026-10-20",
      due_date: "2027-01-01",
      description: "Edited",
      receipt_requested: true,
    };
    await assert.rejects(
      db.query("select edit_donation_record($1,'pledges',$2,$3)", [
        org,
        pledge,
        JSON.stringify(attrs),
      ]),
      /locked/,
    );
    attrs.amount_minor = 10000;
    await db.query("select edit_donation_record($1,'pledges',$2,$3)", [
      org,
      pledge,
      JSON.stringify(attrs),
    ]);
    await assert.rejects(
      db.query("select void_pledge($1,$2)", [org, pledge]),
      /Cannot void/,
    );
    await db.query("select edit_donation_record($1,'payments',$2,$3)", [
      org,
      payment,
      JSON.stringify({ description: "Updated public note", amount_minor: 1 }),
    ]);
    assert.equal(
      (
        await db.query("select amount_minor from payments where id=$1", [
          payment,
        ])
      ).rows[0].amount_minor,
      12000,
    );
    assert.equal(
      (await db.query("select snapshot from receipts where id=$1", [receipt]))
        .rows[0].snapshot.description,
      details.description,
    );
    const unused = (
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,1000,'2026-12-31') returning id",
        [org, donor, campaign],
      )
    ).rows[0].id;
    await db.query("select void_pledge($1,$2)", [org, unused]);
    await assert.rejects(
      db.query("select allocate_payment($1,$2)", [
        payment,
        JSON.stringify([{ pledge_id: unused, amount_minor: 100 }]),
      ]),
      /void/,
    );
    await actor(2);
    await assert.rejects(
      db.query("select edit_donation_record($1,'payments',$2,$3)", [
        org,
        payment,
        "{}",
      ]),
      /Permission/,
    );
    await assert.rejects(
      db.query("select void_pledge($1,$2)", [org, unused]),
      /Permission/,
    );
    await actor(1);
    assert.equal(
      (
        await db.query(
          "select coalesce(sum(debit_minor-credit_minor),0) difference from journal_lines where organization_id=$1",
          [org],
        )
      ).rows[0].difference,
      "0",
    );
  } finally {
    await db.close();
  }
});
