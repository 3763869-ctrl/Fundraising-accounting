"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  CalendarDays,
  Users,
  ContactRound,
  List,
  HeartHandshake,
  Wallet,
  Repeat2,
  ReceiptText,
  Megaphone,
  UserRound,
  Gift,
  CalendarHeart,
  Building2,
  Files,
  Printer,
  ArrowLeftRight,
  Landmark,
  ListTree,
  Scale,
  ChartNoAxesCombined,
  CheckSquare,
  History,
  Settings,
  ShieldCheck,
  Tablet,
  Link2,
  CreditCard,
  SlidersHorizontal,
  Workflow,
  Bell,
  Cable,
  Activity,
  FileUp,
  Webhook,
  ChevronDown,
  Plus,
  TreePine,
  RotateCcw,
  LogIn,
  X,
  CheckCircle2,
  CircleHelp,
} from "lucide-react";
import { loadWorkspace, runCommand, resetDemo } from "@/lib/workspace/store";
import {
  balance,
  paid,
  scheduled,
  credit,
  donorTotals,
  currency,
  today,
  type WorkspaceData,
  type Command,
} from "@/lib/workspace/domain";
import { pageTitles, tableView } from "@/lib/workspace/views";
import { DataTable } from "./data-table";
import { Modal, RecordForm } from "./record-form";
import { Overview } from "./overview";
import { Reports } from "./reports";
import { Calendar } from "./calendar";
import { Receipt } from "./receipt";
import { AccountingForm } from "./accounting-form";
import { FinancialReports } from "./financial-reports";
import { OperationsForm } from "./operations-form";
import { Attachments } from "./attachments";
import { signOut } from "@/app/actions";

const groups = [
  {
    label: "Home",
    items: [
      ["dashboard", LayoutDashboard],
      ["calendar", CalendarDays],
    ],
  },
  {
    label: "Contacts",
    items: [
      ["donors", Users],
      ["donor_accounts", ContactRound],
      ["donor_lists", List],
    ],
  },
  {
    label: "Donations",
    items: [
      ["pledges", HeartHandshake],
      ["payments", Wallet],
      ["schedules", Repeat2],
      ["receipts", ReceiptText],
    ],
  },
  {
    label: "Fundraising",
    items: [
      ["campaigns", Megaphone],
      ["fundraisers", UserRound],
      ["sponsorships", Gift],
      ["events", CalendarHeart],
    ],
  },
  {
    label: "Expenses",
    items: [
      ["vendors", Building2],
      ["bills", Files],
      ["checks", Printer],
    ],
  },
  {
    label: "Accounting",
    items: [
      ["transactions", ArrowLeftRight],
      ["accounts", ListTree],
      ["bank", Landmark],
      ["reconciliation", Scale],
    ],
  },
  {
    label: "Reports & activity",
    items: [
      ["reports", ChartNoAxesCombined],
      ["financial_reports", Files],
      ["tasks", CheckSquare],
      ["activities", History],
    ],
  },
  {
    label: "Settings",
    items: [
      ["settings", Settings],
      ["funds", Landmark],
      ["users", ShieldCheck],
      ["devices", Tablet],
      ["links", Link2],
      ["gateways", CreditCard],
      ["modules", SlidersHorizontal],
      ["automations", Workflow],
      ["templates", ReceiptText],
      ["notifications", Bell],
    ],
  },
  {
    label: "System · Phase 3",
    items: [
      ["integrations", Cable],
      ["jobs", Activity],
      ["imports", FileUp],
      ["webhooks", Webhook],
    ],
  },
] as const;
const operationsForms = [
  "custom_field_definitions",
  "invite",
  "member_role",
  "automation_rules",
  "devices",
  "gateway_accounts",
  "document_templates",
  "notification_preferences",
];
const operationsActions: Record<string, string> = {
  modules: "custom_field_definitions",
  users: "invite",
  automations: "automation_rules",
  devices: "devices",
  gateways: "gateway_accounts",
  templates: "document_templates",
  notifications: "notification_preferences",
};
const adminPages = [
  "modules",
  "users",
  "automations",
  "devices",
  "gateways",
  "templates",
  "notifications",
  "jobs",
  "webhooks",
];
const accountingForms = [
  "account",
  "journal",
  "deposit",
  "vendor",
  "bill",
  "pay_bill",
  "bank_import",
  "bank_match",
  "bank_create",
  "reconcile",
];
const accountingActions: Record<string, string> = {
  accounts: "account",
  transactions: "journal",
  vendors: "vendor",
  bills: "bill",
  bank: "bank_import",
  reconciliation: "reconcile",
};
const addable = [
  "donors",
  "donor_accounts",
  "donor_lists",
  "pledges",
  "campaigns",
  "fundraisers",
  "sponsorships",
  "events",
  "tasks",
  "funds",
];
const descriptions: Record<string, string> = {
  donors: "The people and relationships at the heart of your community.",
  pledges: "Every commitment, its progress, and what comes next.",
  payments: "Received payments, allocations, and available donor credit.",
  schedules:
    "A clear plan for every commitment. No automatic charges are enabled.",
  campaigns: "Connect each appeal to a purpose and a fund.",
  receipts: "Snapshots of recorded payments, ready to print.",
  reports: "Turn your connected fundraising records into useful answers.",
  tasks: "Small next steps that keep relationships moving.",
  activities: "A timeline of recorded financial operations and donor activity.",
};
const phase2 = [
  "vendors",
  "bills",
  "checks",
  "transactions",
  "accounts",
  "bank",
  "reconciliation",
  "financial_reports",
];

export function Workspace({ demo = false }: { demo?: boolean }) {
  const [data, setData] = useState<WorkspaceData | null>(null),
    [page, setPage] = useState("dashboard"),
    [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [form, setForm] = useState<{
      kind: string;
      preset?: Record<string, unknown>;
    } | null>(null),
    [detail, setDetail] = useState<{ kind: string; id: string } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [paymentTab, setPaymentTab] = useState("all");
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get("page");
      setPage(value && pageTitles[value] ? value : "dashboard");
    };
    sync();
    window.addEventListener("popstate", sync);
    let active = true;
    loadWorkspace(demo)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener("popstate", sync);
    };
  }, [demo]);
  const navigate = (next: string) => {
    setPage(next);
    setDetail(null);
    setMobile(false);
    setError("");
    setNotice("");
    window.history.pushState(
      {},
      "",
      `${demo ? "/demo" : `/dashboard?org=${data?.organization.id}&`}${demo ? "?" : ""}page=${next}`,
    );
    window.scrollTo({ top: 0 });
  };
  const save = async (command: Command) => {
    if (!data) return;
    setBusy(true);
    try {
      const next = await runCommand(demo, data, command);
      setData(next);
      setNotice(
        demo
          ? "Saved to your sample database."
          : "Saved to your organization database.",
      );
    } finally {
      setBusy(false);
    }
  };
  const act = async (command: Command) => {
    try {
      await save(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    }
  };
  if (loading)
    return (
      <main className="workspace-loading">
        <TreePine size={36} />
        <h1>Opening your workspace…</h1>
        <p>Connecting your community’s records.</p>
      </main>
    );
  if (!data)
    return (
      <main className="workspace-loading">
        <TreePine size={36} />
        <h1>Let’s connect your workspace.</h1>
        <p className="notice" role="alert">
          {error}
        </p>
        <div className="actions">
          <Link className="button" href="/login">
            Sign in
          </Link>
          {!demo && (
            <Link className="button light" href="/demo">
              Explore sample workspace
            </Link>
          )}
          <Link href="/">Back to home</Link>
        </div>
      </main>
    );
  const t = data.tables,
    writable = ["owner", "admin", "fundraiser"].includes(data.role),
    financeWritable = ["owner", "admin", "fundraiser", "accountant"].includes(
      data.role,
    );
  const table = tableView(page, data);
  if (page === "payments" && paymentTab !== "all")
    table.rows = table.rows.filter((r) =>
      paymentTab === "undeposited"
        ? r.values.deposit === "undeposited" && r.status === "processed"
        : r.status === paymentTab,
    );
  const add = () =>
    setForm({
      kind:
        page === "schedules"
          ? "schedule"
          : page === "payments"
            ? "payment"
            : page,
    });
  const stats = (items: [string, number][]) => (
    <div className="detail-stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong>{currency(value)}</strong>
        </div>
      ))}
    </div>
  );
  const detailContent = () => {
    if (!detail) return null;
    const detailTable: Record<string, string> = {
      bank: "bank_transactions",
      transactions: "journal_entries",
      checks: "bill_payments",
      reconciliation: "reconciliations",
      imports: "import_runs",
      automations: "automation_rules",
      templates: "document_templates",
      notifications: "notification_preferences",
      gateways: "gateway_accounts",
      jobs: "job_logs",
      webhooks: "webhook_logs",
      modules: "custom_field_definitions",
    };
    const row = t[detailTable[detail.kind] ?? detail.kind]?.find(
      (r) => r.id === detail.id,
    );
    if (!row) return null;
    if (detail.kind === "users")
      return (
        <div className="detail-body">
          <h3>{String(row.email)}</h3>
          <p>Role: {String(row.role)}</p>
          {data.role === "owner" && (
            <button
              onClick={() => {
                setDetail(null);
                setForm({ kind: "member_role", preset: { member: row.id } });
              }}
            >
              Change role
            </button>
          )}
        </div>
      );
    if (detail.kind === "automations")
      return (
        <div className="detail-body">
          <h3>{String(row.name)}</h3>
          <p>
            Failed payment of at least {currency(row.min_amount_minor)} → task:{" "}
            {String(row.subject)}
          </p>
          <p>{row.active ? "Enabled" : "Disabled"}</p>
          <button
            disabled={busy}
            onClick={() =>
              act({
                type: "automation_status",
                values: { rule: row.id, enabled: !row.active },
              })
            }
          >
            {row.active ? "Disable rule" : "Enable rule"}
          </button>
        </div>
      );
    if (detail.kind === "transactions")
      return (
        <div className="detail-body">
          <h3>{String(row.description)}</h3>
          <p>
            {String(row.entry_date)} · {String(row.source)} · Posted
          </p>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Fund</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {t.journal_lines
                .filter((l) => l.entry_id === row.id)
                .map((l) => (
                  <tr key={l.id}>
                    <td>
                      {String(
                        t.accounts.find((a) => a.id === l.account_id)?.name,
                      )}
                    </td>
                    <td>
                      {String(
                        t.funds.find((f) => f.id === l.fund_id)?.name ??
                          "Unassigned",
                      )}
                    </td>
                    <td>{currency(l.debit_minor)}</td>
                    <td>{currency(l.credit_minor)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="notice">
            Posted entries are immutable. Correct errors through a new reversing
            journal.
          </p>
        </div>
      );
    if (detail.kind === "bills") {
      const settled = t.bill_payments
          .filter((p) => p.bill_id === row.id)
          .reduce((n, p) => n + Number(p.amount_minor), 0),
        open = Number(row.amount_minor) - settled;
      return (
        <div className="detail-body">
          <h3>{String(t.vendors.find((v) => v.id === row.vendor_id)?.name)}</h3>
          <p>
            Invoice {String(row.invoice_reference)} · Due {String(row.due_date)}
          </p>
          {stats([
            ["Billed", Number(row.amount_minor)],
            ["Paid", settled],
            ["Outstanding", open],
          ])}
          <p>{String(row.description)}</p>
          {open > 0 && ["owner", "admin", "accountant"].includes(data.role) && (
            <button
              onClick={() => {
                setDetail(null);
                setForm({
                  kind: "pay_bill",
                  preset: { bill: row.id, amount_minor: open },
                });
              }}
            >
              Record bill payment
            </button>
          )}
        </div>
      );
    }
    if (detail.kind === "bank")
      return (
        <div className="detail-body">
          <h3>{String(row.description)}</h3>
          <p>
            {String(row.transaction_date)} · {currency(row.amount_minor)} ·{" "}
            {String(row.status)}
          </p>
          <p className="notice">
            Match recorded donations and deposits to existing ledger entries.
            Creating new income for a donation already recorded would
            double-count it.
          </p>
          {row.status === "unmatched" &&
            ["owner", "admin", "accountant"].includes(data.role) && (
              <div className="form-footer">
                <button
                  onClick={() => {
                    setDetail(null);
                    setForm({
                      kind: "bank_match",
                      preset: { bank_transaction: row.id },
                    });
                  }}
                >
                  Match existing entry
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setDetail(null);
                    setForm({
                      kind: "bank_create",
                      preset: { bank_transaction: row.id },
                    });
                  }}
                >
                  Create new transaction
                </button>
              </div>
            )}
        </div>
      );
    if (detail.kind === "checks") {
      const bill = t.bills.find((b) => b.id === row.bill_id),
        vendor = t.vendors.find((v) => v.id === bill?.vendor_id);
      return (
        <>
          <div className="receipt-actions">
            <button onClick={() => window.print()}>
              <Printer size={15} />
              Print voucher / Save PDF
            </button>
          </div>
          <article className="receipt-document">
            <h1>{String(data.organization.name)}</h1>
            <p className="sample-watermark">
              {demo ? "SAMPLE · " : ""}CHECK PAYMENT VOUCHER — NOT NEGOTIABLE
            </p>
            <div className="row">
              <strong>Check {String(row.check_number)}</strong>
              <span>{String(row.paid_on)}</span>
            </div>
            <h2>Payee: {String(vendor?.name)}</h2>
            <p>{String(vendor?.address ?? "")}</p>
            <div className="receipt-amount">{currency(row.amount_minor)}</div>
            <p>
              Bank account:{" "}
              {String(
                t.accounts.find((a) => a.id === row.bank_account_id)?.name,
              )}
            </p>
            <p>Memo: {String(row.memo ?? "")}</p>
            <small>
              For recordkeeping. Bank-approved check stock, MICR details, and
              print alignment require a separately configured check-printing
              template.
            </small>
          </article>
        </>
      );
    }
    if (detail.kind === "receipts")
      return <Receipt receipt={row} demo={demo} />;
    if (detail.kind === "donors") {
      const totals = donorTotals(data, row.id),
        ps = t.pledges.filter((p) => p.donor_id === row.id),
        payments = t.payments.filter((p) => p.donor_id === row.id),
        accounts = t.donor_accounts.filter((a) => a.donor_id === row.id);
      return (
        <div className="donor-detail">
          <div className="donor-identity">
            <span className="large-avatar">
              {String(row.name)
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <h2>
                <bdi>{String(row.name)}</bdi>
              </h2>
              <p dir="rtl">{String(row.hebrew_name ?? "")}</p>
              <div className="actions">
                {((row.tags as string[]) ?? []).map((tag) => (
                  <span key={tag} className="pill">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {stats([
            ["Pledged", totals.pledged],
            ["Paid", totals.paid],
            ["On plans", totals.scheduled],
            ["Open", totals.open],
            ["Credit", totals.credit],
          ])}
          <div className="detail-grid">
            <section>
              <h3>Contact information</h3>
              <p>
                {String(row.title ?? "")} <bdi>{String(row.name)}</bdi>
              </p>
              {[...new Set([row.email, ...((row.emails as string[]) ?? [])])]
                .filter(Boolean)
                .map((email) => (
                  <p key={String(email)}>{String(email)}</p>
                ))}
              {((row.phones as string[]) ?? []).map((phone) => (
                <p key={phone}>{phone}</p>
              ))}
              {(
                (row.addresses as { type: string; address: string }[]) ?? []
              ).map((a, i) => (
                <p key={i}>
                  <small>{a.type}</small>
                  <br />
                  {a.address}
                </p>
              ))}
              <p>
                Receipt language:{" "}
                {row.receipt_language === "he" ? "Hebrew" : "English"}
              </p>
              <p>
                Fundraiser:{" "}
                {String(
                  t.fundraisers.find((f) => f.id === row.fundraiser_id)?.name ??
                    "Unassigned",
                )}
              </p>
            </section>
            <section>
              <h3>Relationship notes</h3>
              <p className="preserve-lines">
                {String(row.notes || "No notes yet.")}
              </p>
              <h3>Occasions</h3>
              <p>
                {((row.occasions as string[]) ?? []).join(" · ") ||
                  "None recorded"}
              </p>
              <h3>Custom fields</h3>
              {Object.entries(
                (row.custom_fields as Record<string, unknown>) ?? {},
              ).map(([k, v]) => (
                <p key={k}>
                  {k}: {String(v)}
                </p>
              ))}
            </section>
          </div>
          <Attachments
            data={data}
            donor={row.id}
            demo={demo}
            writable={writable}
            onChange={setData}
          />
          <h3>Linked donor accounts</h3>
          {accounts.map((a) => (
            <p key={a.id}>
              {String(a.name)} · {String(a.type)} · {String(a.email ?? "")}
            </p>
          ))}
          {!accounts.length && <p className="muted">No linked accounts.</p>}
          <h3>Pledges</h3>
          {ps.map((p) => (
            <div className="detail-list-row" key={p.id}>
              <span>
                {String(t.campaigns.find((c) => c.id === p.campaign_id)?.name)}
              </span>
              <strong>{currency(p.amount_minor)}</strong>
              <small>{currency(balance(data, p))} open</small>
            </div>
          ))}
          <h3>Payments</h3>
          {payments.map((p) => (
            <div className="detail-list-row" key={p.id}>
              <span>
                {String(p.paid_on)} · {String(p.method)}
              </span>
              <strong>{currency(p.amount_minor)}</strong>
              <span className={`status status-${p.status}`}>
                {String(p.status)}
              </span>
            </div>
          ))}
          <h3>Activity history</h3>
          {[...t.activities]
            .filter((a) => a.donor_id === row.id)
            .reverse()
            .map((a) => (
              <div className="activity-item" key={a.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{String(a.details)}</strong>
                  <small>
                    {new Date(String(a.created_at)).toLocaleString()} ·{" "}
                    {String(a.responsible_user ?? "Workspace user")}
                  </small>
                </div>
              </div>
            ))}
          {writable && (
            <button
              className="secondary"
              onClick={() => {
                const addresses =
                  (row.addresses as { type: string; address: string }[]) ?? [];
                setDetail(null);
                setForm({
                  kind: "donor_edit",
                  preset: {
                    ...row,
                    emails: ((row.emails as string[]) ?? []).filter(
                      (e) => e !== row.email,
                    ),
                    personal_address:
                      addresses.find((a) => a.type === "personal")?.address ??
                      "",
                    business_address:
                      addresses.find((a) => a.type === "business")?.address ??
                      "",
                  },
                });
              }}
            >
              Edit donor
            </button>
          )}
          {financeWritable && (
            <div className="form-footer">
              <button
                onClick={() => {
                  setDetail(null);
                  setForm({ kind: "payment", preset: { donor_id: row.id } });
                }}
              >
                Record payment
              </button>
            </div>
          )}
        </div>
      );
    }
    if (detail.kind === "payments") {
      const donor = t.donors.find((d) => d.id === row.donor_id),
        allocations = t.payment_allocations.filter(
          (a) => a.payment_id === row.id,
        ),
        receipt = t.receipts.find((r) => r.payment_id === row.id);
      return (
        <div className="detail-body">
          <h3>{String(donor?.name)}</h3>
          {stats([
            ["Payment", Number(row.amount_minor)],
            [
              "Allocated",
              allocations.reduce((n, a) => n + Number(a.amount_minor), 0),
            ],
            ["Available credit", credit(data, row)],
          ])}
          <p>
            {String(row.method).replaceAll("_", " ")} · {String(row.paid_on)} ·{" "}
            {String(row.status)}
          </p>
          <p>
            Reference: {String(row.reference || "None")} ·{" "}
            {String(row.deposit_status)}
          </p>
          {row.status === "pending" && financeWritable && (
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  act({
                    type: "payment_status",
                    values: {
                      payment: row.id,
                      new_status: "processed",
                      dated: today(),
                    },
                  })
                }
              >
                Confirm externally received payment
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  act({
                    type: "payment_status",
                    values: {
                      payment: row.id,
                      new_status: "failed",
                      dated: today(),
                    },
                  })
                }
              >
                Mark failed
              </button>
            </div>
          )}
          <h3>Pledge allocations</h3>
          {allocations.map((a) => {
            const pledge = t.pledges.find((p) => p.id === a.pledge_id);
            return (
              <div className="detail-list-row" key={a.id}>
                <span>
                  {String(
                    t.campaigns.find((c) => c.id === pledge?.campaign_id)?.name,
                  )}
                </span>
                <strong>{currency(a.amount_minor)}</strong>
              </div>
            );
          })}
          {!allocations.length && (
            <p>No allocations. Processed funds remain donor credit.</p>
          )}
          <div className="form-footer">
            {financeWritable && credit(data, row) > 0 && (
              <button
                className="secondary"
                onClick={() => {
                  setDetail(null);
                  setForm({ kind: "allocate", preset: { payment: row.id } });
                }}
              >
                Allocate credit
              </button>
            )}
            {row.status === "processed" && financeWritable && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (receipt) {
                    setDetail({ kind: "receipts", id: receipt.id });
                    return;
                  }
                  setBusy(true);
                  try {
                    const next = await runCommand(demo, data, {
                      type: "receipt",
                      values: { payment: row.id },
                    });
                    setData(next);
                    const r = next.tables.receipts.find(
                      (r) => r.payment_id === row.id,
                    );
                    if (r) setDetail({ kind: "receipts", id: r.id });
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Unable to issue receipt.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {receipt ? "View acknowledgment" : "Create acknowledgment"}
              </button>
            )}
          </div>
        </div>
      );
    }
    if (detail.kind === "schedules") {
      const installments = t.installments
        .filter((i) => i.schedule_id === row.id)
        .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
      return (
        <div className="detail-body">
          <p>
            {String(t.donors.find((d) => d.id === row.donor_id)?.name)} ·{" "}
            {String(row.frequency)} · {String(row.status)}
          </p>
          <p className="notice">
            No automatic charges. Record externally received payments against
            the installments below.
          </p>
          <table>
            <thead>
              <tr>
                <th>Due date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => (
                <tr key={i.id}>
                  <td>{String(i.due_date)}</td>
                  <td>{currency(i.amount_minor)}</td>
                  <td>
                    {i.payment_id
                      ? "Paid"
                      : row.status === "cancelled"
                        ? "Cancelled"
                        : String(i.due_date) < today()
                          ? "Overdue"
                          : "Scheduled"}
                  </td>
                  <td>
                    {!i.payment_id &&
                      row.status === "active" &&
                      financeWritable && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setDetail(null);
                            setForm({
                              kind: "payment",
                              preset: {
                                installment: i.id,
                                donor_id: row.donor_id,
                                amount_minor: i.amount_minor,
                              },
                            });
                          }}
                        >
                          Record payment
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {financeWritable &&
            ["active", "paused"].includes(String(row.status)) && (
              <div className="form-footer">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    act({
                      type: "schedule_status",
                      values: {
                        plan: row.id,
                        new_status:
                          row.status === "active" ? "paused" : "active",
                      },
                    })
                  }
                >
                  {row.status === "active" ? "Pause plan" : "Resume plan"}
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Cancel unpaid installments? Received payments and allocations will be retained.",
                      )
                    )
                      act({
                        type: "schedule_status",
                        values: { plan: row.id, new_status: "cancelled" },
                      });
                  }}
                >
                  Cancel unpaid installments
                </button>
              </div>
            )}
        </div>
      );
    }
    if (detail.kind === "pledges")
      return (
        <div className="detail-body">
          <h3>{String(t.donors.find((d) => d.id === row.donor_id)?.name)}</h3>
          <p>
            {String(t.campaigns.find((c) => c.id === row.campaign_id)?.name)} ·
            Due {String(row.due_date)}
          </p>
          {stats([
            ["Pledged", Number(row.amount_minor)],
            ["Paid", paid(data, row.id)],
            ["Scheduled", scheduled(data, row.id)],
            ["Open", balance(data, row)],
          ])}
          <p>{String(row.description || "No description")}</p>
          <p>Receipt requested: {row.receipt_requested ? "Yes" : "No"}</p>
          {["owner", "admin", "accountant"].includes(data.role) &&
            !t.pledge_recognitions.some((r) => r.pledge_id === row.id) &&
            balance(data, row) > 0 && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Recognize the unpaid balance as an unconditional contribution receivable? Conditional pledges should remain unrecognized.",
                    )
                  )
                    act({
                      type: "recognize",
                      values: { pledge: row.id, dated: today() },
                    });
                }}
              >
                Recognize unconditional pledge
              </button>
            )}
          {financeWritable &&
            balance(data, row) - scheduled(data, row.id) > 0 && (
              <div className="form-footer">
                <button
                  className="secondary"
                  onClick={() => {
                    setDetail(null);
                    setForm({ kind: "schedule", preset: { pledge: row.id } });
                  }}
                >
                  Create payment plan
                </button>
                <button
                  onClick={() => {
                    setDetail(null);
                    setForm({
                      kind: "payment",
                      preset: { donor_id: row.donor_id },
                    });
                  }}
                >
                  Record payment
                </button>
              </div>
            )}
        </div>
      );
    if (detail.kind === "tasks")
      return (
        <div className="detail-body">
          <h3>{String(row.subject)}</h3>
          <p>{String(row.description)}</p>
          <p>
            {String(row.assignee || "Unassigned")} · Due {String(row.due_date)}{" "}
            · {String(row.priority)} priority
          </p>
          <p>Status: {String(row.status)}</p>
          {writable && (
            <button
              disabled={busy}
              onClick={() =>
                act({
                  type: "task_status",
                  values: {
                    task: row.id,
                    new_status: row.status === "open" ? "done" : "open",
                  },
                })
              }
            >
              {row.status === "open" ? "Mark complete" : "Reopen task"}
            </button>
          )}
        </div>
      );
    if (detail.kind === "donor_lists")
      return (
        <div className="detail-body">
          <h3>{String(row.name)}</h3>
          {t.list_members
            .filter((m) => m.list_id === row.id)
            .map((m) => (
              <p key={m.id}>
                {String(t.donors.find((d) => d.id === m.donor_id)?.name)}
              </p>
            ))}
          {writable && (
            <button
              onClick={() => {
                setDetail(null);
                setForm({ kind: "list_members" });
              }}
            >
              Add donor to a list
            </button>
          )}
        </div>
      );
    return (
      <div className="detail-body">
        {Object.entries(row)
          .filter(([key]) => !["id", "organization_id"].includes(key))
          .map(([key, value]) => (
            <div key={key} className="detail-list-row">
              <strong>{key.replaceAll("_", " ")}</strong>
              <span dir="auto">
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value ?? "—")}
              </span>
            </div>
          ))}
      </div>
    );
  };
  return (
    <div
      className={`app-frame ${collapsed ? "nav-collapsed" : ""} ${mobile ? "mobile-nav-open" : ""}`}
    >
      <aside className="app-sidebar">
        <Link className="app-brand" href="/">
          <span className="app-brand-mark">
            <TreePine size={23} />
          </span>
          <span>
            Cedar & Olive<small>COMMUNITY MANAGEMENT</small>
          </span>
        </Link>
        <button
          className="organization-switch"
          onClick={() => navigate("settings")}
        >
          <span className="org-avatar">CO</span>
          <span>
            <strong>{String(data.organization.name)}</strong>
            <small>{demo ? "Sample organization" : "Live workspace"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        {!demo && data.workspaces && data.workspaces.length > 1 && (
          <label className="org-picker">
            Switch organization
            <select
              aria-label="Switch organization"
              value={data.organization.id}
              onChange={(e) =>
                window.location.assign(`/dashboard?org=${e.target.value}`)
              }
            >
              {data.workspaces.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="Main navigation">
          {groups.map((g) => (
            <details className="nav-group" key={g.label} open>
              <summary>
                {g.label}
                <ChevronDown size={12} />
              </summary>
              {g.items.map(([key, Icon]) => (
                <a
                  href={`${demo ? "/demo?" : `/dashboard?org=${data.organization.id}&`}page=${key}`}
                  key={key}
                  className={page === key ? "active" : ""}
                  title={pageTitles[key]}
                  aria-current={page === key ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(key);
                  }}
                >
                  <Icon size={17} />
                  <span>{pageTitles[key]}</span>
                  {key === "tasks" &&
                    t.tasks.some(
                      (t) =>
                        t.status === "open" && String(t.due_date) < today(),
                    ) && <i className="nav-dot" />}
                </a>
              ))}
            </details>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {demo ? "SO" : data.role.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{demo ? "Sample owner" : "Your workspace"}</strong>
            <small>{data.role} · US / USD</small>
          </div>
          <button
            aria-label="Workspace help"
            className="icon-button"
            onClick={() => navigate("integrations")}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="app-main">
        <header className="app-topbar">
          <div className="row">
            <button
              className="icon-button desktop-toggle"
              aria-label={
                collapsed ? "Expand navigation" : "Collapse navigation"
              }
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? (
                <PanelLeftOpen size={20} />
              ) : (
                <PanelLeftClose size={20} />
              )}
            </button>
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(!mobile)}
            >
              <PanelLeftOpen size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{pageTitles[page]}</strong>
            </span>
          </div>
          <div className="row">
            <span className={`environment-badge ${demo ? "" : "live"}`}>
              <span />
              {demo ? "SAMPLE DATA" : "LIVE DATABASE"}
            </span>
            {demo ? (
              <Link className="top-signin" href="/login">
                <LogIn size={15} />
                Sign in
              </Link>
            ) : (
              <form action={signOut}>
                <button className="text-button">Sign out</button>
              </form>
            )}
            <span className="avatar small-avatar">
              {demo ? "SO" : data.role.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <strong>A safe place to explore.</strong> Synthetic records are
              stored only in this browser. No live payments or production data.
            </span>
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm("Reset all sample records in this browser?")
                )
                  return;
                setBusy(true);
                try {
                  setData(await resetDemo());
                  setDetail(null);
                  setNotice("Sample data reset.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Reset failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RotateCcw size={13} />
              Reset sample
            </button>
          </div>
        )}
        <main className="app-content">
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={17} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {page === "dashboard" ? (
            <Overview data={data} navigate={navigate} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    {phase2.includes(page)
                      ? "Accounting · General ledger"
                      : page === "reports"
                        ? "Insights & reporting"
                        : "Your community workspace"}
                  </p>
                  <h1>{pageTitles[page]}</h1>
                  <p>
                    {descriptions[page] ??
                      "Connected records. Clear responsibilities. One community."}
                  </p>
                </div>
                <div className="actions">
                  {operationsActions[page] &&
                    ["owner", "admin"].includes(data.role) && (
                      <button
                        onClick={() =>
                          setForm({ kind: operationsActions[page] })
                        }
                      >
                        <Plus size={16} />
                        {page === "users" ? "Invite user" : "Add new"}
                      </button>
                    )}
                  {accountingActions[page] &&
                    ["owner", "admin", "accountant"].includes(data.role) && (
                      <button
                        onClick={() =>
                          setForm({ kind: accountingActions[page] })
                        }
                      >
                        <Plus size={16} />
                        {page === "reconciliation"
                          ? "Reconcile statement"
                          : page === "bank"
                            ? "Import bank CSV"
                            : page === "transactions"
                              ? "Post journal"
                              : `Add ${accountingActions[page]}`}
                      </button>
                    )}
                  {page === "transactions" &&
                    ["owner", "admin", "accountant"].includes(data.role) && (
                      <button
                        className="secondary"
                        onClick={() => setForm({ kind: "deposit" })}
                      >
                        Record deposit
                      </button>
                    )}
                  {page === "payments" && financeWritable && (
                    <>
                      <button
                        className="secondary"
                        onClick={() => setForm({ kind: "batch" })}
                      >
                        Batch entry
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setForm({ kind: "allocate" })}
                      >
                        Allocate credit
                      </button>
                    </>
                  )}
                  {((addable.includes(page) && writable) ||
                    (["schedules", "payments"].includes(page) &&
                      financeWritable)) && (
                    <button onClick={add}>
                      <Plus size={16} />
                      Add new{" "}
                      {page === "donor_lists"
                        ? "list"
                        : page === "schedules"
                          ? "plan"
                          : page === "donor_accounts"
                            ? "account"
                            : page.replace(/s$/, "")}
                    </button>
                  )}
                </div>
              </div>
              {adminPages.includes(page) &&
              !["owner", "admin"].includes(data.role) ? (
                <p className="notice">
                  Administrator access is required for this area.
                </p>
              ) : phase2.includes(page) &&
                !["owner", "admin", "accountant", "viewer"].includes(
                  data.role,
                ) ? (
                <p className="notice">
                  Your role does not have accounting access.
                </p>
              ) : page === "integrations" ? (
                <section className="panel">
                  <h2>Authenticated API</h2>
                  <p>
                    Read donors, campaigns, pledges, payments, allocations,
                    schedules and job logs with a Supabase user access token.
                    Payment entry uses the same atomic allocation and accounting
                    rules.
                  </p>
                  <Link className="button" href="/api">
                    API documentation
                  </Link>
                  <p className="notice">
                    Solo, charity-card, bank-feed providers, and webhook
                    adapters require provider documentation, sandbox
                    authorization, and secure credential setup. No external
                    provider is connected.
                  </p>
                </section>
              ) : page === "financial_reports" ? (
                <FinancialReports data={data} />
              ) : page === "calendar" ? (
                <Calendar data={data} />
              ) : page === "reports" ? (
                <Reports data={data} />
              ) : page === "settings" ? (
                <section className="panel">
                  <h2>{String(data.organization.name)}</h2>
                  <p dir="rtl">{String(data.organization.hebrew_name ?? "")}</p>
                  <div className="settings-grid">
                    {[
                      ["Country", "United States"],
                      ["Currency", "USD"],
                      [
                        "Timezone",
                        String(
                          data.organization.timezone ?? "America/New_York",
                        ),
                      ],
                      [
                        "Tax ID",
                        String(data.organization.tax_id || "Not configured"),
                      ],
                      [
                        "Database",
                        demo
                          ? "Browser sample database"
                          : "Supabase PostgreSQL",
                      ],
                      ["Access", data.role],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <small>{label}</small>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  {["owner", "admin"].includes(data.role) && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setForm({
                          kind: "organization_update",
                          preset: data.organization,
                        })
                      }
                    >
                      Edit organization
                    </button>
                  )}
                  <p className="notice">
                    Sample records are never copied into the live workspace.
                    Production organizations start empty.
                  </p>
                </section>
              ) : table.columns.length > 0 ? (
                <>
                  {page === "users" && (
                    <>
                      <p className="notice">
                        Invite links are single-use, email-bound, and expire
                        after seven days. No email is sent automatically.
                      </p>
                      {data.inviteToken && (
                        <section className="panel">
                          <h3>
                            {demo
                              ? "Sample invitation — cannot join a live organization"
                              : "Invitation link"}
                          </h3>
                          <input
                            aria-label="Invitation link"
                            readOnly
                            value={
                              demo
                                ? "SAMPLE ONLY — " + data.inviteToken
                                : `${window.location.origin}/join?token=${data.inviteToken}`
                            }
                            onFocus={(e) => e.target.select()}
                          />
                        </section>
                      )}
                    </>
                  )}
                  {[
                    "devices",
                    "gateways",
                    "notifications",
                    "webhooks",
                  ].includes(page) && (
                    <p className="notice">
                      {page === "webhooks"
                        ? "No external webhook endpoint is connected. Real events appear here only after provider integration."
                        : "Configuration only. External processing, device connectivity, email delivery, and retries are not active."}
                    </p>
                  )}
                  {page === "jobs" && (
                    <p className="notice">
                      Failed-payment rule executions are logged here. These
                      rules run synchronously in the database; an external
                      background worker is not connected.
                    </p>
                  )}

                  {page === "payments" && (
                    <div
                      className="view-tabs"
                      role="group"
                      aria-label="Payment views"
                    >
                      {[
                        "all",
                        "processed",
                        "pending",
                        "failed",
                        "undeposited",
                        "upcoming",
                      ].map((tab) => (
                        <button
                          key={tab}
                          className={paymentTab === tab ? "active" : ""}
                          onClick={() => {
                            if (tab === "upcoming") navigate("schedules");
                            else setPaymentTab(tab);
                          }}
                        >
                          {tab[0].toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}
                  {page === "receipts" && (
                    <p className="notice">
                      Create acknowledgments from a processed payment’s details.
                      Email delivery and organization-approved tax receipt
                      templates require later setup.
                    </p>
                  )}
                  <DataTable
                    key={`${page}-${paymentTab}`}
                    columns={table.columns}
                    rows={table.rows}
                    name={pageTitles[page]}
                    onOpen={(id) => setDetail({ kind: page, id })}
                    storageKey={`${data.organization.id}-${page}`}
                  />
                  {page === "users" && (
                    <details className="panel" style={{ marginTop: 24 }}>
                      <summary>
                        Invitation history ({t.invitations.length})
                      </summary>
                      <DataTable
                        columns={tableView("invitations", data).columns}
                        rows={tableView("invitations", data).rows}
                        name="Invitations"
                        storageKey={`${data.organization.id}-invitations`}
                      />
                    </details>
                  )}
                </>
              ) : (
                <PlannedPage page={page} data={data} />
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              <TreePine size={13} />
              Cedar & Olive
            </span>
            <span>Built for the work that brings people together.</span>
            <span>
              US · USD · {demo ? "Sample workspace" : "Live workspace"}
            </span>
          </footer>
        </main>
      </div>
      {form && (
        <Modal
          title={
            form.kind === "donor_edit"
              ? "Edit donor"
              : form.kind === "organization_update"
                ? "Edit organization"
                : form.kind === "batch"
                  ? "Batch payment entry"
                  : form.kind === "allocate"
                    ? "Allocate donor credit"
                    : `Add ${form.kind === "payment" ? "payment" : form.kind === "schedule" ? "payment plan" : form.kind.replaceAll("_", " ").replace(/s$/, "")}`
          }
          onClose={() => setForm(null)}
        >
          {operationsForms.includes(form.kind) ? (
            <OperationsForm
              kind={form.kind}
              data={data}
              preset={form.preset}
              onSave={save}
              onClose={() => setForm(null)}
            />
          ) : accountingForms.includes(form.kind) ? (
            <AccountingForm
              kind={form.kind}
              data={data}
              preset={form.preset}
              onSave={save}
              onClose={() => setForm(null)}
            />
          ) : (
            <RecordForm
              kind={form.kind}
              data={data}
              preset={form.preset}
              onSave={save}
              onClose={() => setForm(null)}
            />
          )}
        </Modal>
      )}
      {detail && (
        <Modal
          title={
            detail.kind === "receipts"
              ? "Payment acknowledgment"
              : `${pageTitles[detail.kind]} · Details`
          }
          onClose={() => setDetail(null)}
        >
          {detailContent()}
        </Modal>
      )}
    </div>
  );
}

function PlannedPage({ page, data }: { page: string; data: WorkspaceData }) {
  const accounting = phase2.includes(page),
    gateway = page === "gateways";
  const cards = gateway
    ? [
        [
          "Solo",
          "Requested card processor. Exact provider API documentation and merchant authorization are needed.",
        ],
        [
          "Matbeya / OJZ",
          "Charity-card providers. Integration capabilities are pending your provider research.",
        ],
        [
          "Chase",
          "Bank account connection. Import and matching are planned for the accounting phase.",
        ],
      ]
    : accounting
      ? [
          [
            "One source of financial truth",
            "Payments will post balanced entries; deposits will move undeposited funds into bank accounts without recognizing donations again.",
          ],
          [
            "Accounting controls",
            "Reconciliation, locked periods, fund restrictions, vendor bills, and check printing belong to Phase 2.",
          ],
          [
            "No financial statements yet",
            "Current fundraising reports show commitments and receipts, not a completed general ledger or GAAP statements.",
          ],
        ]
      : page === "users"
        ? [
            [
              "Your role",
              `${data.role}. Database policies enforce organization membership and financial permissions.`,
            ],
            [
              "Roles",
              "Owner, admin, fundraiser, accountant, and viewer roles are defined. Accountants can record payments; viewers cannot write records.",
            ],
            [
              "Team management",
              "Invitations, role changes, and organization switching require the next access-management milestone. No invite action is active yet.",
            ],
          ]
        : [
            [
              "Planned implementation",
              "This module is part of the later integration and operations phase. It does not run background jobs or send notifications today.",
            ],
            [
              "External setup",
              "Gateways, email/SMS, bank connections, devices, and public donation pages need separately authorized provider setup.",
            ],
            [
              "What works now",
              "Donors, campaigns, pledges, manual payments, allocations, credit, finite schedules, printable acknowledgments, reports, calendar, and task records.",
            ],
          ];
  return (
    <>
      <div className="phase-callout">
        <span className="phase-icon">
          {accounting ? (
            <Landmark size={26} />
          ) : gateway ? (
            <CreditCard size={26} />
          ) : (
            <Workflow size={26} />
          )}
        </span>
        <div>
          <p className="eyebrow">
            {accounting ? "Phase 2" : "Phase 3"} ·{" "}
            {gateway ? "External setup required" : "Not implemented yet"}
          </p>
          <h2>{pageTitles[page]}</h2>
          <p>
            {accounting
              ? "The fundraising foundation is ready for accounting to be connected in the same Supabase database."
              : "This area is labeled as planned. No external integration is active."}
          </p>
        </div>
      </div>
      <div className="planned-grid">
        {cards.map(([title, description]) => (
          <section className="panel" key={title}>
            <h3>{title}</h3>
            <p className="muted">{description}</p>
          </section>
        ))}
      </div>
    </>
  );
}
