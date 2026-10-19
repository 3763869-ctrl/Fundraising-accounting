import {
  accountBalance,
  currency,
  type WorkspaceData,
  type Row,
} from "./domain.ts";
import type { Column, TableRow } from "@/components/data-table";

export function financialRows(
  data: WorkspaceData,
  report: string,
  basis: string,
  from: string,
  to: string,
  fund: string,
  account: string,
): { columns: Column[]; rows: TableRow[] } {
  const t = data.tables,
    between = (date: unknown) =>
      (!from || String(date) >= from) && String(date) <= to;
  if (report === "balance") {
    const accounts = t.accounts.filter(
      (a) =>
        ["asset", "liability", "equity"].includes(String(a.kind)) &&
        (basis !== "cash" ||
          !["receivable", "payable"].includes(String(a.purpose))),
    );
    const rows = accounts.map((a) => ({
      id: a.id,
      values: {
        account: `${a.code} · ${a.name}`,
        type: String(a.kind),
        amount: currency(
          accountBalance(data, a.id, to) * (a.kind === "asset" ? 1 : -1),
        ),
      },
    }));
    const totals = (kind: string) =>
      accounts
        .filter((a) => a.kind === kind)
        .reduce(
          (n, a) =>
            n + accountBalance(data, a.id, to) * (kind === "asset" ? 1 : -1),
          0,
        );
    const assets = totals("asset"),
      liabilities = totals("liability"),
      equity = totals("equity"),
      results = assets - liabilities - equity;
    rows.push(
      {
        id: "results",
        values: {
          account: "Accumulated operating results",
          type: "equity",
          amount: currency(results),
        },
      },
      {
        id: "assets",
        values: {
          account: "TOTAL ASSETS",
          type: "total",
          amount: currency(assets),
        },
      },
      {
        id: "liabilities",
        values: {
          account: "TOTAL LIABILITIES + NET ASSETS",
          type: "total",
          amount: currency(liabilities + equity + results),
        },
      },
    );
    return {
      columns: [
        { key: "account", label: "Account" },
        { key: "type", label: "Type" },
        { key: "amount", label: "Balance" },
      ],
      rows,
    };
  }
  if (report === "ledger") {
    const lines = t.journal_lines
      .filter((l) => l.account_id === account)
      .map(
        (l) =>
          ({
            ...l,
            entry: t.journal_entries.find((e) => e.id === l.entry_id)!,
          }) as Row & { entry: Row },
      )
      .sort(
        (a, b) =>
          String(a.entry.entry_date).localeCompare(
            String(b.entry.entry_date),
          ) ||
          String(a.entry.created_at).localeCompare(String(b.entry.created_at)),
      );
    let running = lines
      .filter((l) => from && String(l.entry.entry_date) < from)
      .reduce((n, l) => n + Number(l.debit_minor) - Number(l.credit_minor), 0);
    return {
      columns: [
        { key: "date", label: "Date" },
        { key: "description", label: "Description" },
        { key: "debit", label: "Debit" },
        { key: "credit", label: "Credit" },
        { key: "running", label: "Running debit balance" },
      ],
      rows: lines
        .filter((l) => between(l.entry.entry_date))
        .map((l) => {
          running += Number(l.debit_minor) - Number(l.credit_minor);
          return {
            id: l.id,
            values: {
              date: String(l.entry.entry_date),
              description: String(l.entry.description),
              debit: currency(l.debit_minor),
              credit: currency(l.credit_minor),
              running: currency(running),
            },
          };
        }),
    };
  }
  if (report === "vendors")
    return {
      columns: [
        { key: "vendor", label: "Vendor" },
        { key: "billed", label: "Billed through date" },
        { key: "paid", label: "Paid through date" },
        { key: "open", label: "Outstanding" },
      ],
      rows: t.vendors.map((v) => {
        const bills = t.bills.filter(
            (b) => b.vendor_id === v.id && String(b.bill_date) <= to,
          ),
          ids = bills.map((b) => b.id),
          billed = bills.reduce((n, b) => n + Number(b.amount_minor), 0),
          paid = t.bill_payments
            .filter(
              (p) => ids.includes(String(p.bill_id)) && String(p.paid_on) <= to,
            )
            .reduce((n, p) => n + Number(p.amount_minor), 0);
        return {
          id: v.id,
          values: {
            vendor: String(v.name),
            billed: currency(billed),
            paid: currency(paid),
            open: currency(billed - paid),
          },
        };
      }),
    };
  const totals = new Map<string, number>();
  const accumulate = (id: string, n: number) =>
    totals.set(id, (totals.get(id) ?? 0) + n);
  for (const line of t.journal_lines) {
    const a = t.accounts.find((a) => a.id === line.account_id)!,
      e = t.journal_entries.find((e) => e.id === line.entry_id)!;
    if (
      !["income", "expense"].includes(String(a.kind)) ||
      !between(e.entry_date) ||
      (fund && line.fund_id !== fund)
    )
      continue;
    if (basis === "cash" && !["manual", "bank"].includes(String(e.source)))
      continue;
    accumulate(
      a.id,
      (Number(line.credit_minor) - Number(line.debit_minor)) *
        (a.kind === "income" ? 1 : -1),
    );
  }
  if (basis === "cash") {
    const contributions = t.accounts.find((a) => a.code === "4000")!;
    for (const allocation of t.payment_allocations) {
      const p = t.payments.find((p) => p.id === allocation.payment_id)!,
        pledge = t.pledges.find((pl) => pl.id === allocation.pledge_id)!,
        campaign = t.campaigns.find((c) => c.id === pledge.campaign_id);
      if (between(p.paid_on) && (!fund || campaign?.fund_id === fund))
        accumulate(contributions.id, Number(allocation.amount_minor));
    }
    for (const payment of t.bill_payments) {
      const bill = t.bills.find((b) => b.id === payment.bill_id)!;
      if (between(payment.paid_on) && (!fund || bill.fund_id === fund))
        accumulate(
          String(bill.expense_account_id),
          Number(payment.amount_minor),
        );
    }
  }
  let income = 0,
    expenses = 0;
  const rows: TableRow[] = t.accounts
    .filter((a) => totals.has(a.id))
    .map((a) => {
      const n = totals.get(a.id)!;
      if (a.kind === "income") income += n;
      else expenses += n;
      return {
        id: a.id,
        values: {
          account: `${a.code} · ${a.name}`,
          type: String(a.kind),
          amount: currency(n),
        },
      };
    });
  rows.push(
    {
      id: "income",
      values: {
        account: "TOTAL INCOME",
        type: "total",
        amount: currency(income),
      },
    },
    {
      id: "expense",
      values: {
        account: "TOTAL EXPENSES",
        type: "total",
        amount: currency(expenses),
      },
    },
    {
      id: "net",
      values: {
        account: "NET OPERATING RESULT",
        type: "total",
        amount: currency(income - expenses),
      },
    },
  );
  return {
    columns: [
      { key: "account", label: "Account" },
      { key: "type", label: "Type" },
      { key: "amount", label: "Amount" },
    ],
    rows,
  };
}
