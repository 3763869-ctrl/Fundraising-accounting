import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  tableNames,
  cents,
  credit,
  paid,
  scheduled,
} from "../lib/workspace/domain.ts";

test("sample database money rules mirror the PostgreSQL workflow", () => {
  const empty = {
    organization: { id: "org", name: "Sample" },
    role: "owner",
    tables: Object.fromEntries(tableNames.map((n) => [n, []])),
  };
  const insert = (data, table, values) =>
    applyCommand(data, { type: "insert", table, values });
  let data = insert(empty, "donors", { name: "Donor", receipt_language: "he" });
  const donor = data.tables.donors[0].id;
  data = insert(data, "campaigns", { name: "Campaign" });
  const campaign = data.tables.campaigns[0].id;
  data = insert(data, "pledges", {
    donor_id: donor,
    campaign_id: campaign,
    amount_minor: 10001,
    pledged_on: "2026-10-19",
    due_date: "2027-03-31",
  });
  const pledge = data.tables.pledges[0].id;
  const payment = {
    type: "payment",
    values: {
      donor_id: donor,
      amount_minor: 12001,
      paid_on: "2026-10-19",
      method: "check",
      status: "processed",
      reference: "Test",
      idempotency_key: "key",
      allocations: [{ pledge_id: pledge, amount_minor: 5000 }],
    },
  };
  data = applyCommand(data, payment);
  assert.equal(paid(data, pledge), 5000);
  assert.equal(credit(data, data.tables.payments[0]), 7001);
  assert.equal(applyCommand(data, payment).tables.payments.length, 1);
  assert.throws(() =>
    applyCommand(data, {
      ...payment,
      values: { ...payment.values, amount_minor: 13000 },
    }),
  );
  const unchanged = structuredClone(data);
  assert.throws(() =>
    applyCommand(data, {
      type: "allocate",
      values: {
        payment: data.tables.payments[0].id,
        allocations: [{ pledge_id: pledge, amount_minor: 6000 }],
      },
    }),
  );
  assert.deepEqual(data, unchanged);
  data = applyCommand(data, {
    type: "schedule",
    values: {
      pledge,
      total: 5001,
      count: 3,
      first_date: "2027-01-31",
      schedule_kind: "installment",
      schedule_frequency: "monthly",
    },
  });
  assert.equal(scheduled(data, pledge), 5001);
  assert.deepEqual(
    data.tables.installments.map((i) => i.due_date),
    ["2027-01-31", "2027-02-28", "2027-03-31"],
  );
  assert.equal(
    data.tables.installments.reduce((n, i) => n + i.amount_minor, 0),
    5001,
  );
  for (const i of data.tables.installments)
    data = applyCommand(data, {
      type: "payment",
      values: {
        donor_id: donor,
        amount_minor: i.amount_minor,
        paid_on: i.due_date,
        method: "cash",
        status: "processed",
        idempotency_key: crypto.randomUUID(),
        allocations: [],
        installment: i.id,
      },
    });
  assert.equal(data.tables.schedules[0].status, "completed");
  assert.equal(scheduled(data, pledge), 0);
  assert.equal(paid(data, pledge), 10001);
  data = applyCommand(data, {
    type: "receipt",
    values: { payment: data.tables.payments[0].id },
  });
  assert.equal(data.tables.receipts[0].language, "he");
  assert.equal(
    applyCommand(data, {
      type: "receipt",
      values: { payment: data.tables.payments[0].id },
    }).tables.receipts.length,
    1,
  );
  const before = structuredClone(data);
  assert.throws(() =>
    applyCommand(data, {
      type: "batch",
      values: {
        entries: [
          {
            ...payment.values,
            idempotency_key: crypto.randomUUID(),
            allocations: [],
          },
          {
            ...payment.values,
            idempotency_key: crypto.randomUUID(),
            amount_minor: -1,
          },
        ],
      },
    }),
  );
  assert.deepEqual(data, before);
  assert.throws(() => applyCommand({ ...data, role: "viewer" }, payment));
  assert.equal(cents("10.29"), 1029);
  assert.throws(() => cents("1.001"));
});
