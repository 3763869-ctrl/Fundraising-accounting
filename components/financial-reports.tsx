"use client";
import { useState } from "react";
import { Printer } from "lucide-react";
import { DataTable } from "./data-table";
import { financialRows } from "@/lib/workspace/financial";
import {
  accountBalance,
  currency,
  today,
  type WorkspaceData,
  type Row,
} from "@/lib/workspace/domain";

export function FinancialReports({ data }: { data: WorkspaceData }) {
  const [report, setReport] = useState("pnl"),
    [basis, setBasis] = useState("accrual"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(today()),
    [fund, setFund] = useState(""),
    [account, setAccount] = useState(data.tables.accounts[0]?.id ?? "");
  const { columns, rows } = financialRows(
    data,
    report,
    basis,
    from,
    to,
    fund,
    account,
  );
  return (
    <>
      <section className="report-filters panel">
        <label>
          Financial report
          <select
            aria-label="Financial report"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          >
            <option value="pnl">Profit & loss</option>
            <option value="balance">Balance sheet</option>
            <option value="ledger">Account transactions</option>
            <option value="vendors">Vendor balances</option>
          </select>
        </label>
        {["pnl", "balance"].includes(report) && (
          <label>
            Accounting basis
            <select
              aria-label="Accounting basis"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
            >
              <option value="accrual">Accrual</option>
              <option value="cash">Cash</option>
            </select>
          </label>
        )}
        {["pnl", "ledger"].includes(report) && (
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
        )}
        <label>
          Through
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </label>
        {report === "pnl" && (
          <label>
            Fund
            <select
              aria-label="Report fund"
              value={fund}
              onChange={(e) => setFund(e.target.value)}
            >
              <option value="">All funds</option>
              {data.tables.funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {String(f.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        {report === "ledger" && (
          <label>
            Account
            <select
              aria-label="Report account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {data.tables.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {String(a.code)} · {String(a.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="secondary" onClick={() => window.print()}>
          <Printer size={15} />
          Print / Save PDF
        </button>
      </section>
      <p className="report-note">
        Accrual includes only explicitly recognized unconditional pledges, plus
        fulfilled donations and recorded bills. Cash reports use allocated
        received payments and paid bills; unallocated donor credit remains a
        liability. Cash balance sheets omit receivables and payables. Fund
        filters show tagged activity; bank balances are pooled.
      </p>
      {from && from > to ? (
        <p className="notice error">From date must precede the through date.</p>
      ) : (
        <div className="report-screen">
          <DataTable
            key={`${report}-${basis}`}
            columns={columns}
            rows={rows}
            name="Financial report"
            storageKey={`${data.organization.id}-financial-${report}-${basis}`}
          />
        </div>
      )}
      <section className="print-report">
        <h1>{String(data.organization.name)}</h1>
        <h2>
          {report === "pnl"
            ? "Profit & loss"
            : report === "balance"
              ? "Balance sheet"
              : report === "ledger"
                ? "Account transactions"
                : "Vendor balances"}{" "}
          · {basis}
        </h2>
        <p>
          {from || "Beginning"} through {to} · USD
        </p>
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => (
                  <td key={c.key}>{r.values[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
