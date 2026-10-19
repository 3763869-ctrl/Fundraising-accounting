import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  tableNames,
  accountId,
  accountBalance,
} from "../lib/workspace/domain.ts";
import { financialRows } from "../lib/workspace/financial.ts";

test("cash/accrual statements follow the connected subledgers and deposits do not create income", () => {
  let data = {
    organization: { id: "org", name: "Sample" },
    role: "owner",
    tables: Object.fromEntries(tableNames.map((t) => [t, []])),
  };
  const run = (type, values, table) => {
    data = applyCommand(data, { type, values, table });
  };
  run("insert", { name: "Donor" }, "donors");
  const donor = data.tables.donors[0].id;
  run("insert", { name: "Campaign" }, "campaigns");
  const campaign = data.tables.campaigns[0].id;
  run(
    "insert",
    {
      donor_id: donor,
      campaign_id: campaign,
      amount_minor: 15000,
      pledged_on: "2026-10-01",
      due_date: "2026-12-01",
    },
    "pledges",
  );
  const pledge = data.tables.pledges[0].id;
  const receive = (n, date) =>
    run("payment", {
      donor_id: donor,
      amount_minor: n,
      paid_on: date,
      method: "check",
      status: "processed",
      idempotency_key: crypto.randomUUID(),
      allocations: [{ pledge_id: pledge, amount_minor: n }],
    });
  receive(6000, "2026-10-02");
  run("recognize", { pledge, dated: "2026-10-03" });
  receive(3000, "2026-10-04");
  run("insert", { name: "Vendor" }, "vendors");
  const vendor = data.tables.vendors[0].id,
    bank = accountId(data, "1000");
  run("bill", {
    vendor,
    invoice: "INV-1",
    dated: "2026-10-03",
    due: "2026-11-03",
    amount: 10000,
    expense_account: accountId(data, "5000"),
    memo: "Supplies",
  });
  const bill = data.tables.bills[0].id;
  run("pay_bill", {
    bill,
    bank,
    amount: 1000,
    dated: "2026-10-04",
    payment_method: "bank_transfer",
    check_reference: "",
    memo: "",
    request_key: crypto.randomUUID(),
  });
  const report = (kind, basis) =>
    financialRows(data, kind, basis, "", "2026-10-31", "", "");
  const value = (r, id) => r.rows.find((r) => r.id === id).values.amount;
  assert.equal(value(report("pnl", "accrual"), "income"), "$150.00");
  assert.equal(value(report("pnl", "cash"), "income"), "$90.00");
  assert.equal(value(report("pnl", "accrual"), "expense"), "$100.00");
  assert.equal(value(report("pnl", "cash"), "expense"), "$10.00");
  assert.equal(value(report("pnl", "accrual"), "net"), "$50.00");
  assert.equal(value(report("pnl", "cash"), "net"), "$80.00");
  const before = report("pnl", "accrual");
  run("deposit", {
    bank,
    dated: "2026-10-05",
    payments: data.tables.payments.map((p) => p.id),
    request_key: crypto.randomUUID(),
  });
  assert.deepEqual(report("pnl", "accrual"), before);
  assert.equal(accountBalance(data, bank), 8000);
  assert.equal(accountBalance(data, accountId(data, "1050")), 0);
  assert.equal(
    value(report("balance", "accrual"), "assets"),
    value(report("balance", "accrual"), "liabilities"),
  );
  assert.equal(value(report("balance", "cash"), "results"), "$80.00");
  const old = structuredClone(data);
  assert.throws(() =>
    run("journal", {
      dated: "2026-10-06",
      memo: "Unbalanced",
      request_key: crypto.randomUUID(),
      lines: [
        { account_id: bank, debit_minor: 100 },
        { account_id: accountId(data, "3000"), credit_minor: 99 },
      ],
    }),
  );
  assert.deepEqual(data, old);
});
