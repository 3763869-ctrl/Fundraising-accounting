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

    // The following provider responses are synthetic; no network calls occur.
    await db.exec("reset role; set role service_role");
    await db.query(
      "select bind_sola_merchant($1,'00000000-0000-0000-0000-000000000001')",
      [org],
    );
    await actor(1);
    const donation = {
      campaign_id: campaign,
      description: "Inline card donation",
      collector: "Owner",
      credit_confirmed: true,
    };
    const request = randomUUID();
    const prep = async (key = request, save = true, card = null, d = donor) =>
      db.query(
        "select prepare_sola_donation($1,$2,500,$3,'[]',$4,$5,$6) result",
        [org, d, key, JSON.stringify(donation), card, save],
      );
    const prepared = (await prep()).rows[0].result;
    assert.equal(prepared.send, true);
    assert.equal((await prep()).rows[0].result.send, false);
    await assert.rejects(
      db.query("select * from sola_card_tokens"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "select finish_sola_payment_vault($1,'approved','testcard','{}')",
        [prepared.attempt],
      ),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    const fakeCard = {
      last4: "1111",
      brand: "Visa",
      expiry: "1250",
      encrypted_token:
        "synthetic_encrypted_token_payload_for_database_permission_tests",
    };
    let result = (
      await db.query(
        "select finish_sola_payment_vault($1,'approved','synthetic_card_ref',$2) result",
        [prepared.attempt, JSON.stringify(fakeCard)],
      )
    ).rows[0].result;
    assert.equal(result.card_saved, true);
    assert.equal(
      (
        await db.query(
          "select finish_sola_payment_vault($1,'approved','synthetic_card_ref',$2) result",
          [prepared.attempt, JSON.stringify(fakeCard)],
        )
      ).rows[0].result.card_saved,
      true,
    );
    await actor(1);
    const method = prepared.card_method_id;
    assert.equal(
      (
        await db.query("select last4 from donor_payment_methods where id=$1", [
          method,
        ])
      ).rows[0].last4,
      "1111",
    );
    await assert.rejects(
      db.query("select encrypted_token from sola_card_tokens"),
      /permission denied/,
    );
    const otherDonor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Another donor') returning id",
        [org],
      )
    ).rows[0].id;
    await assert.rejects(
      prep(randomUUID(), false, method, otherDonor),
      /Saved card unavailable/,
    );
    const failed = (await prep(randomUUID())).rows[0].result;
    await db.exec("reset role;set role service_role");
    result = (
      await db.query(
        "select finish_sola_payment_vault($1,'approved','synthetic_no_save',null) result",
        [failed.attempt],
      )
    ).rows[0].result;
    assert.equal(result.state, "approved");
    assert.equal(result.save_error, true);
    await db.exec("reset role");
    const paymentCount = (await db.query("select count(*) count from payments"))
      .rows[0].count;
    await db.exec("set role service_role");
    const saveKey = randomUUID();
    const save = (
      await db.query(
        "select prepare_sola_card_save($1,$2,'00000000-0000-0000-0000-000000000001',$3) result",
        [org, donor, saveKey],
      )
    ).rows[0].result;
    assert.equal(save.send, true);
    assert.equal(
      (
        await db.query(
          "select prepare_sola_card_save($1,$2,'00000000-0000-0000-0000-000000000001',$3) result",
          [org, donor, saveKey],
        )
      ).rows[0].result.send,
      false,
    );
    await db.query("select finish_sola_card_save($1,'approved',$2)", [
      save.attempt,
      JSON.stringify(fakeCard),
    ]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) count from payments")).rows[0].count,
      paymentCount,
    );
    await actor(2);
    assert.equal(
      (await db.query("select * from donor_payment_methods")).rows.length,
      0,
    );
    await assert.rejects(
      prep(randomUUID(), false, method),
      /Permission denied/,
    );
    await db.exec("reset role;set role service_role");
    await db.query("select retire_sola_card($1,$2)", [org, method]);
    assert.equal(
      (
        await db.query("select * from sola_card_tokens where method_id=$1", [
          method,
        ])
      ).rows.length,
      0,
    );
    await actor(1);
    await assert.rejects(
      prep(randomUUID(), false, method),
      /Saved card unavailable/,
    );

    // Cash voids reverse the books and preserve receipts and allocation history.
    await assert.rejects(
      db.query("select void_cash_payment($1,'2026-10-22','Correction')", [
        payment,
      ]),
      /Only cash/,
    );
    const cashPledge = (
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,1000,'2026-12-31') returning id",
        [org, otherDonor, campaign],
      )
    ).rows[0].id;
    const cash = (
      await db.query(
        "select record_payment($1,$2,2000,'2026-10-21','cash','processed','',$3,$4) id",
        [
          org,
          otherDonor,
          randomUUID(),
          JSON.stringify([{ pledge_id: cashPledge, amount_minor: 1000 }]),
        ],
      )
    ).rows[0].id;
    const cashReceipt = (await db.query("select issue_receipt($1) id", [cash]))
      .rows[0].id;
    const receiptSnapshot = (
      await db.query("select snapshot from receipts where id=$1", [cashReceipt])
    ).rows[0].snapshot;
    await assert.rejects(
      db.query("select void_cash_payment($1,'2026-10-20','Wrong date')", [
        cash,
      ]),
      /void date/,
    );
    await db.query(
      "select void_cash_payment($1,'2026-10-22','Duplicate cash entry')",
      [cash],
    );
    const voided = (
      await db.query("select * from payments where id=$1", [cash])
    ).rows[0];
    assert.equal(voided.status, "voided");
    assert.equal(voided.cash_void_snapshot.allocations.length, 1);
    assert.equal(
      (
        await db.query(
          "select * from payment_allocations where payment_id=$1",
          [cash],
        )
      ).rows.length,
      0,
    );
    const voidReceipt = (
      await db.query("select * from receipts where id=$1", [cashReceipt])
    ).rows[0];
    assert.ok(voidReceipt.voided_at);
    assert.deepEqual(voidReceipt.snapshot, receiptSnapshot);
    const count = (await db.query("select count(*) count from journal_entries"))
      .rows[0].count;
    await db.query(
      "select void_cash_payment($1,'2026-10-22','Repeated click')",
      [cash],
    );
    assert.equal(
      (await db.query("select count(*) count from journal_entries")).rows[0]
        .count,
      count,
    );
    const deposited = (
      await db.query(
        "select record_payment($1,$2,5000,'2026-10-21','cash','processed','',$3) id",
        [org, otherDonor, randomUUID()],
      )
    ).rows[0].id;
    const bank = (
      await db.query(
        "select id from accounts where organization_id=$1 and code='1000'",
        [org],
      )
    ).rows[0].id;
    await db.query("select deposit_payments($1,$2,'2026-10-21',$3,$4)", [
      org,
      bank,
      [deposited],
      randomUUID(),
    ]);
    const bankBalance = async () =>
      (
        await db.query(
          "select sum(debit_minor-credit_minor) balance from journal_lines where account_id=$1",
          [bank],
        )
      ).rows[0].balance;
    const before = await bankBalance();
    await db.query(
      "select void_cash_payment($1,'2026-10-22','Deposited correction')",
      [deposited],
    );
    assert.equal(await bankBalance(), before);
    assert.equal(
      (
        await db.query(
          "select sum(l.credit_minor-l.debit_minor) balance from journal_lines l join accounts a on a.id=l.account_id where a.organization_id=$1 and a.code='2995'",
          [org],
        )
      ).rows[0].balance,
      "5000",
    );
    assert.equal(
      (
        await db.query(
          "select * from tasks where organization_id=$1 and subject='Review voided deposited cash'",
          [org],
        )
      ).rows.length,
      1,
    );
    await actor(2);
    await assert.rejects(
      db.query(
        "select void_cash_payment($1,'2026-10-22','Other organization')",
        [cash],
      ),
      /Permission denied/,
    );
    await actor(1);
    const installmentPledge = (
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,10000,'2027-12-31') returning id",
        [org, otherDonor, campaign],
      )
    ).rows[0].id;
    await db.query(
      "select create_schedule($1,$2,'installment','monthly','2026-10-21',10000,2)",
      [org, installmentPledge],
    );
    const installments = (
      await db.query(
        "select i.* from installments i join schedules s on s.id=i.schedule_id where s.pledge_id=$1 order by i.due_date",
        [installmentPledge],
      )
    ).rows;
    let lastPayment;
    for (const i of installments)
      lastPayment = (
        await db.query(
          "select record_payment($1,$2,5000,'2026-11-21','cash','processed','',$3,'[]',$4) id",
          [org, otherDonor, randomUUID(), i.id],
        )
      ).rows[0].id;
    assert.equal(
      (
        await db.query("select status from schedules where pledge_id=$1", [
          installmentPledge,
        ])
      ).rows[0].status,
      "completed",
    );
    await db.query(
      "select void_cash_payment($1,'2026-11-22','Reopen installment')",
      [lastPayment],
    );
    assert.equal(
      (
        await db.query("select status from schedules where pledge_id=$1", [
          installmentPledge,
        ])
      ).rows[0].status,
      "active",
    );
    assert.equal(
      (
        await db.query("select * from installments where id=$1", [
          installments[1].id,
        ])
      ).rows[0].payment_id,
      null,
    );
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
