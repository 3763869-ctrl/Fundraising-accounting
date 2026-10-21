import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  submitMatbiaCharge,
  interpretMatbiaResponse,
  MATBIA_SANDBOX_TOKEN,
  MATBIA_SANDBOX_ORG,
  MATBIA_SANDBOX_CARDS,
} from "../lib/matbia/transaction.ts";
import { parseMatbiaInput } from "../lib/matbia/input.ts";
import {
  applyCommand,
  tableNames,
  balance,
  credit,
} from "../lib/workspace/domain.ts";
test("Matbia transport uses documented sandbox authentication, exact cents and a stable external ID without retries", async () => {
  const input = {
    environment: "sandbox",
    token: MATBIA_SANDBOX_TOKEN,
    organizationHandle: MATBIA_SANDBOX_ORG,
    cardNumber: MATBIA_SANDBOX_CARDS.funded,
    expiry: "1228",
    amountMinor: 2501,
    requestKey: randomUUID(),
    transactionDate: "2026-10-21T16:00:00Z",
  };
  let calls = 0;
  const result = await submitMatbiaCharge(input, async (url, options) => {
    calls++;
    assert.equal(url, "https://sandbox.api.matbia.org/v1/Matbia/Charge");
    assert.equal(options.headers.Authorization, MATBIA_SANDBOX_TOKEN);
    const body = JSON.parse(options.body);
    assert.equal(body.amount, 25.01);
    assert.equal(body.allowDuplicates, false);
    assert.equal(body.externalTransactionId, input.requestKey);
    assert.equal(body.transDate, new Date(input.transactionDate).toISOString());
    return new Response(
      JSON.stringify({
        status: "Success",
        error: null,
        referenceId: "SANDBOXREF",
        cardHolderName: "Not retained",
      }),
    );
  });
  assert.deepEqual(result, {
    state: "approved",
    reference: "SANDBOXREF",
    providerStatus: "Success",
  });
  assert.equal(calls, 1);
  for (const [status, body, expected] of [
    [
      406,
      {
        status: "Declined",
        error:
          "Insufficient wallet balance while charging from external source",
      },
      "declined",
    ],
    [500, { status: "Success", referenceId: "AMBIGUOUS" }, "unknown"],
    [406, { status: "Error", error: "Gateway failure" }, "unknown"],
  ])
    assert.equal(
      (
        await submitMatbiaCharge(
          input,
          async () => new Response(JSON.stringify(body), { status }),
        )
      ).state,
      expected,
    );
  assert.equal(
    (
      await submitMatbiaCharge(input, async () => {
        calls++;
        throw new Error("timeout");
      })
    ).state,
    "unknown",
  );
  assert.equal(calls, 2);
  await assert.rejects(
    submitMatbiaCharge({ ...input, environment: "production" }, async () => {
      throw new Error("Must not run");
    }),
  );
  await assert.rejects(
    submitMatbiaCharge(
      { ...input, environment: "https://attacker.invalid" },
      async () => {
        throw new Error("Must not run");
      },
    ),
  );
  for (const body of [
    { status: "Success", error: null },
    { status: "Success", error: "problem", referenceId: "REF" },
    { status: "Error", error: "Duplicate" },
    { status: "Failed" },
    null,
  ])
    assert.equal(interpretMatbiaResponse(body).state, "unknown");
  assert.equal(
    interpretMatbiaResponse({
      status: "Error",
      error: "Insufficient Wallet Balance",
    }).state,
    "declined",
  );
  assert.equal(
    interpretMatbiaResponse({ status: "Declined" }).state,
    "declined",
  );
  const base = {
    organization: randomUUID(),
    donor: randomUUID(),
    amount_minor: 100,
    request_key: randomUUID(),
    allocations: [],
    donation: {
      campaign_id: randomUUID(),
      description: "",
      collector: "",
      credit_confirmed: true,
    },
    consent: true,
    card_number: MATBIA_SANDBOX_CARDS.funded,
    expiry: "1228",
  };
  assert.throws(() => parseMatbiaInput(base, base.organization, 10000)); // Test fixtures cannot reach the live endpoint.
  assert.throws(() =>
    parseMatbiaInput(
      { ...base, token: "not accepted" },
      base.organization,
      10000,
    ),
  );
});
test("Matbia sample approval, decline, unknown recovery and excess credit stay in the sample database", () => {
  let data = {
    organization: { id: randomUUID(), name: "Sample" },
    role: "owner",
    tables: Object.fromEntries(tableNames.map((n) => [n, []])),
  };
  const run = (c) => (data = applyCommand(data, c));
  run({ type: "insert", table: "donors", values: { name: "Sample donor" } });
  const donor = data.tables.donors[0].id;
  run({ type: "insert", table: "campaigns", values: { name: "Campaign" } });
  const campaign = data.tables.campaigns[0].id;
  run({
    type: "insert",
    table: "pledges",
    values: {
      donor_id: donor,
      campaign_id: campaign,
      amount_minor: 10000,
      pledged_on: "2026-10-21",
      due_date: "2026-12-31",
    },
  });
  const pledge = data.tables.pledges[0].id;
  const values = {
    donor_id: donor,
    campaign_id: campaign,
    amount_minor: 2500,
    paid_on: "2026-10-21",
    idempotency_key: randomUUID(),
    allocations: [{ pledge_id: pledge, amount_minor: 2500 }],
    credit_confirmed: false,
  };
  run({ type: "matbia_demo_prepare", values });
  run({ type: "matbia_demo_prepare", values });
  assert.equal(data.tables.payments.length, 1);
  run({
    type: "matbia_demo_finish",
    values: { request_key: values.idempotency_key, outcome: "approved" },
  });
  run({
    type: "matbia_demo_finish",
    values: { request_key: values.idempotency_key, outcome: "approved" },
  });
  assert.equal(balance(data, data.tables.pledges[0]), 7500);
  const next = { ...values, idempotency_key: randomUUID() };
  run({ type: "matbia_demo_prepare", values: next });
  run({
    type: "matbia_demo_finish",
    values: { request_key: next.idempotency_key, outcome: "declined" },
  });
  assert.equal(balance(data, data.tables.pledges[0]), 7500);
  const unknown = {
    ...values,
    idempotency_key: randomUUID(),
    amount_minor: 10000,
    allocations: [{ pledge_id: pledge, amount_minor: 7500 }],
  };
  run({ type: "matbia_demo_prepare", values: unknown });
  run({
    type: "matbia_demo_finish",
    values: { request_key: unknown.idempotency_key, outcome: "unknown" },
  });
  assert.equal(balance(data, data.tables.pledges[0]), 7500);
  assert.throws(() =>
    run({
      type: "matbia_demo_prepare",
      values: { ...values, idempotency_key: randomUUID() },
    }),
  );
  run({
    type: "matbia_demo_finish",
    values: { request_key: unknown.idempotency_key, outcome: "approved" },
  });
  assert.equal(balance(data, data.tables.pledges[0]), 0);
  assert.equal(credit(data, data.tables.payments.at(-1)), 2500);
});
test("Matbia SQL reserves once, scopes merchant identity and protects finalization and pending balances", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001','owner@example.test',now()),('00000000-0000-0000-0000-000000000002','other@example.test',now());`,
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
    const org = (await db.query("select create_organization('Matbia test') id"))
        .rows[0].id,
      donor = (
        await db.query(
          "insert into donors(organization_id,name) values($1,'Donor') returning id",
          [org],
        )
      ).rows[0].id,
      campaign = (
        await db.query(
          "insert into campaigns(organization_id,name) values($1,'Campaign') returning id",
          [org],
        )
      ).rows[0].id;
    await assert.rejects(
      db.query("select bind_matbia_merchant($1,auth.uid())", [org]),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    await db.query(
      "select bind_matbia_merchant($1,'00000000-0000-0000-0000-000000000001')",
      [org],
    );
    await actor(1);
    const pledge = (
        await db.query(
          "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,10000,'2027-12-31') returning id",
          [org, donor, campaign],
        )
      ).rows[0].id,
      key = randomUUID(),
      allocations = [{ pledge_id: pledge, amount_minor: 2500 }],
      details = {
        campaign_id: campaign,
        description: "For the donor",
        collector: "Owner",
        credit_confirmed: false,
      };
    const prep = async (k = key, a = 2500, al = allocations) =>
      db.query("select prepare_matbia_payment($1,$2,$3,$4,$5,$6) result", [
        org,
        donor,
        a,
        k,
        JSON.stringify(al),
        JSON.stringify(details),
      ]);
    const prepared = (await prep()).rows[0].result;
    assert.equal(prepared.send, true);
    assert.equal((await prep()).rows[0].result.send, false);
    await assert.rejects(prep(key, 3000), /reused/);
    await assert.rejects(
      db.query("select finish_matbia_payment($1,'approved','REF1')", [
        prepared.attempt,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select resolve_pending_payment($1,'processed',current_date)", [
        prepared.payment,
      ]),
      /verified provider/,
    );
    await db.exec("reset role;set role service_role");
    await db.query("select finish_matbia_payment($1,'approved','REF1')", [
      prepared.attempt,
    ]);
    await db.query("select finish_matbia_payment($1,'approved','REF1')", [
      prepared.attempt,
    ]);
    await actor(1);
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(amount_minor) paid from payment_allocations where pledge_id=$1",
            [pledge],
          )
        ).rows[0].paid,
      ),
      2500,
    );
    assert.equal(
      (
        await db.query("select provider from payments where id=$1", [
          prepared.payment,
        ])
      ).rows[0].provider,
      "matbia",
    );
    const declined = (await prep(randomUUID())).rows[0].result;
    await db.exec("reset role;set role service_role");
    await db.query("select finish_matbia_payment($1,'declined',null)", [
      declined.attempt,
    ]);
    await actor(1);
    assert.equal(
      (
        await db.query("select status from payments where id=$1", [
          declined.payment,
        ])
      ).rows[0].status,
      "failed",
    );
    const unknown = (await prep(randomUUID())).rows[0].result;
    await db.exec("reset role;set role service_role");
    await db.query("select finish_matbia_payment($1,'unknown',null)", [
      unknown.attempt,
    ]);
    await actor(1);
    await assert.rejects(prep(randomUUID()), /needs review/);
    await actor(2);
    assert.equal(
      (await db.query("select * from matbia_payment_attempts")).rows.length,
      0,
    );
    await assert.rejects(prep(randomUUID()), /Permission denied/);
    await actor(1);
    assert.equal(
      Number(
        (
          await db.query(
            "select coalesce(sum(debit_minor-credit_minor),0) difference from journal_lines",
          )
        ).rows[0].difference,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
