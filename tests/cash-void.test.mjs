import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  tableNames,
  balance,
  credit,
} from "../lib/workspace/domain.ts";
import { financialRows } from "../lib/workspace/financial.ts";
test("cash void restores pledges, retains audit history and reports income in the correct period", () => {
  let data = {
    organization: { id: "org", name: "Test" },
    role: "owner",
    tables: Object.fromEntries(tableNames.map((n) => [n, []])),
  };
  const run = (c) => {
    data = applyCommand(data, c);
  };
  run({ type: "insert", table: "donors", values: { name: "Test donor" } });
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
      pledged_on: "2026-10-01",
      due_date: "2026-12-31",
    },
  });
  const pledge = data.tables.pledges[0].id;
  run({
    type: "payment",
    values: {
      donor_id: donor,
      amount_minor: 10000,
      paid_on: "2026-10-02",
      method: "cash",
      status: "processed",
      idempotency_key: crypto.randomUUID(),
      allocations: [{ pledge_id: pledge, amount_minor: 10000 }],
    },
  });
  const payment = data.tables.payments[0].id;
  run({ type: "receipt", values: { payment } });
  run({
    type: "cash_void",
    values: { payment, dated: "2026-10-21", reason: "Duplicate cash record" },
  });
  assert.equal(balance(data, data.tables.pledges[0]), 10000);
  assert.equal(credit(data, data.tables.payments[0]), 0);
  assert.ok(data.tables.receipts[0].voided_at);
  assert.equal(
    data.tables.payments[0].cash_void_snapshot.allocations.length,
    1,
  );
  const report = (basis, from, to) =>
    financialRows(data, "pnl", basis, from, to, "", "").rows.find(
      (r) => r.id === "income",
    ).values.amount;
  assert.equal(report("cash", "", "2026-10-20"), "$100.00");
  assert.equal(report("cash", "", "2026-10-31"), "$0.00");
  assert.equal(report("cash", "2026-10-21", "2026-10-31"), "-$100.00");
  assert.equal(report("accrual", "", "2026-10-31"), "$0.00");
  const count = data.tables.journal_entries.length;
  run({
    type: "cash_void",
    values: { payment, dated: "2026-10-21", reason: "Repeat" },
  });
  assert.equal(data.tables.journal_entries.length, count);
});
