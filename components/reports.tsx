"use client";
import { useState } from "react";
import { Printer } from "lucide-react";
import { DataTable, type Column, type TableRow } from "./data-table";
import {
  balance,
  paid,
  scheduled,
  currency,
  today,
  type WorkspaceData,
} from "@/lib/workspace/domain";

export function Reports({ data }: { data: WorkspaceData }) {
  const [basis, setBasis] = useState("pledges"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [group, setGroup] = useState("campaign");
  const t = data.tables,
    name = (table: string, id: unknown) =>
      String(t[table].find((r) => r.id === id)?.name ?? "Unassigned");
  const between = (date: unknown) =>
    (!from || String(date) >= from) && (!to || String(date) <= to);
  let columns: Column[] = [],
    rows: TableRow[] = [];
  if (basis === "pledges" || basis === "open") {
    columns = [
      { key: "donor", label: "Donor" },
      {
        key: "group",
        label:
          group === "expected"
            ? "Expected payment type"
            : group === "campaign"
              ? "Campaign"
              : "Fundraiser",
      },
      { key: "date", label: "Pledge date" },
      { key: "pledged", label: "Pledged" },
      { key: "paid", label: "Paid" },
      { key: "scheduled", label: "Scheduled" },
      { key: "open", label: "Open balance" },
    ];
    const ps = t.pledges.filter(
      (p) =>
        !p.voided_at &&
        between(p.pledged_on) &&
        (basis !== "open" || balance(data, p) > 0),
    );
    rows = ps.map((p) => ({
      id: p.id,
      values: {
        donor: name("donors", p.donor_id),
        group:
          group === "expected"
            ? String(p.expected_payment_type ?? "unspecified")
            : name(
                group === "campaign" ? "campaigns" : "fundraisers",
                p[group === "campaign" ? "campaign_id" : "fundraiser_id"],
              ),
        date: String(p.pledged_on),
        pledged: currency(p.amount_minor),
        paid: currency(paid(data, p.id)),
        scheduled: currency(scheduled(data, p.id)),
        open: currency(balance(data, p)),
      },
    }));
  } else if (basis === "payments") {
    columns = [
      { key: "donor", label: "Donor" },
      { key: "date", label: "Received date" },
      { key: "method", label: "Method" },
      { key: "reference", label: "Reference" },
      { key: "received", label: "Received" },
    ];
    rows = t.payments
      .filter((p) => p.status === "processed" && between(p.paid_on))
      .map((p) => ({
        id: p.id,
        values: {
          donor: name("donors", p.donor_id),
          date: String(p.paid_on),
          method: String(p.method),
          reference: String(p.reference ?? ""),
          received: currency(p.amount_minor),
        },
      }));
  } else if (basis === "forecast") {
    columns = [
      { key: "donor", label: "Donor" },
      { key: "date", label: "Expected date" },
      { key: "amount", label: "Expected amount" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status" },
    ];
    rows = t.installments
      .filter(
        (i) =>
          !i.payment_id &&
          between(i.due_date) &&
          t.schedules.some(
            (s) => s.id === i.schedule_id && s.status === "active",
          ),
      )
      .map((i) => {
        const s = t.schedules.find((s) => s.id === i.schedule_id)!;
        return {
          id: i.id,
          values: {
            donor: name("donors", s.donor_id),
            date: String(i.due_date),
            amount: currency(i.amount_minor),
            source: "Scheduled installment",
            status: String(i.due_date) < today() ? "Overdue" : "Expected",
          },
        };
      });
    t.pledges
      .filter((p) => !p.voided_at)
      .forEach((p) => {
        const available = balance(data, p) - scheduled(data, p.id);
        if (available > 0 && between(p.due_date))
          rows.push({
            id: p.id,
            values: {
              donor: name("donors", p.donor_id),
              date: String(p.due_date),
              amount: currency(available),
              source: "Unscheduled pledge balance",
              status: String(p.due_date) < today() ? "Overdue" : "Expected",
            },
          });
      });
  } else {
    columns = [
      {
        key: "group",
        label:
          group === "expected"
            ? "Expected payment type"
            : group === "campaign"
              ? "Campaign"
              : "Fundraiser",
      },
      { key: "pledged", label: "Pledged" },
      { key: "paid", label: "Allocated payments" },
      { key: "scheduled", label: "Scheduled" },
      { key: "open", label: "Open balance" },
    ];
    const groups =
      group === "expected"
        ? [
            ...new Set(
              t.pledges.map((p) =>
                String(p.expected_payment_type ?? "unspecified"),
              ),
            ),
          ].map((id) => ({ id, name: id }))
        : t[group === "campaign" ? "campaigns" : "fundraisers"];
    rows = groups.map((r) => {
      const ps = t.pledges.filter(
        (p) =>
          !p.voided_at &&
          (group === "expected"
            ? String(p.expected_payment_type ?? "unspecified") === r.id
            : p[group === "campaign" ? "campaign_id" : "fundraiser_id"] ===
              r.id) &&
          between(p.pledged_on),
      );
      return {
        id: r.id,
        values: {
          group: String(r.name),
          pledged: currency(ps.reduce((n, p) => n + Number(p.amount_minor), 0)),
          paid: currency(ps.reduce((n, p) => n + paid(data, p.id), 0)),
          scheduled: currency(
            ps.reduce((n, p) => n + scheduled(data, p.id), 0),
          ),
          open: currency(ps.reduce((n, p) => n + balance(data, p), 0)),
        },
      };
    });
  }
  return (
    <>
      <div className="report-filters panel">
        <label>
          Report
          <select
            aria-label="Report"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          >
            <option value="pledges">Pledge detail · commitment basis</option>
            <option value="payments">Received payments · cash basis</option>
            <option value="open">Open pledges</option>
            <option value="summary">Fundraising summary</option>
            <option value="forecast">Expected payment forecast</option>
          </select>
        </label>
        <label>
          Group / reference
          <select
            aria-label="Report grouping"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="campaign">Campaign</option>
            <option value="fundraiser">Fundraiser</option>
            <option value="expected">Expected payment type</option>
          </select>
        </label>
        <label>
          From date
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through date
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="secondary" onClick={() => window.print()}>
          <Printer size={16} />
          Print / Save PDF
        </button>
      </div>
      <p className="report-note">
        {basis === "payments"
          ? "Counts each processed payment once, including unallocated donor credit. Pending and failed attempts are excluded."
          : basis === "forecast"
            ? "Forecasts active unpaid installments and unscheduled pledge balances once each; paused plans are excluded. No payment is guaranteed."
            : "Date filters select pledges by commitment date. Paid and open balances reflect all payments to those pledges as of now."}{" "}
        These fundraising reports are not GAAP financial statements.
      </p>
      {from && to && from > to ? (
        <div className="notice error">
          The from date must precede the through date.
        </div>
      ) : (
        <div className="report-screen">
          <DataTable
            key={`${basis}-${group}`}
            columns={columns}
            rows={rows}
            name="Fundraising report"
            storageKey={`${data.organization.id}-report-${basis}-${group}`}
          />
        </div>
      )}
      <section className="print-report">
        <h1>{String(data.organization.name)}</h1>
        <h2>{basis.replaceAll("_", " ")} report</h2>
        <p>
          {from || "All dates"} — {to || "Present"} · USD
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
