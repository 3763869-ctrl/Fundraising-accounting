"use client";
import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  accountBalance,
  cents,
  currency,
  dateValue,
  sum,
  today,
  type Command,
  type Row,
  type WorkspaceData,
} from "@/lib/workspace/domain";

export function AccountingForm({
  kind,
  data,
  preset = {},
  onSave,
  onClose,
}: {
  kind: string;
  data: WorkspaceData;
  preset?: Record<string, unknown>;
  onSave: (c: Command) => Promise<void>;
  onClose: () => void;
}) {
  const key = useRef(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [bank, setBank] = useState(""),
    [date, setDate] = useState(today()),
    [ending, setEnding] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [lines, setLines] = useState([crypto.randomUUID(), crypto.randomUUID()]);
  const t = data.tables,
    banks = t.accounts.filter((a) => a.purpose === "bank");
  const field = (
    name: string,
    label: string,
    options: Row[],
    required = true,
    value?: string,
  ) => (
    <label>
      {label}
      <select
        name={name}
        aria-label={label}
        required={required}
        defaultValue={value ?? ""}
        onChange={(e) => {
          if (name === "bank") {
            setBank(e.target.value);
            setSelected([]);
          }
        }}
      >
        <option value="">Select…</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {String(r.code ? `${r.code} · ${r.name}` : (r.name ?? r.id))}
          </option>
        ))}
      </select>
    </label>
  );
  const input = (
    name: string,
    label: string,
    type = "text",
    value?: string,
    required = true,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        name={name}
        type={type === "money" ? "number" : type}
        step={type === "money" ? "0.01" : undefined}
        min={type === "money" ? "0.01" : undefined}
        defaultValue={value}
        required={required}
      />
    </label>
  );
  const previous = t.reconciliations
    .filter((r) => r.bank_account_id === bank)
    .sort((a, b) =>
      String(b.statement_date).localeCompare(String(a.statement_date)),
    )[0];
  const reconciled = t.reconciliation_items
    .filter((i) => i.bank_account_id === bank)
    .map((i) => i.entry_id);
  const clearable = t.journal_entries.filter(
    (e) =>
      String(e.entry_date) <= date &&
      !reconciled.includes(e.id) &&
      t.journal_lines.some((l) => l.entry_id === e.id && l.account_id === bank),
  );
  const net = (id: string) =>
    t.journal_lines
      .filter((l) => l.entry_id === id && l.account_id === bank)
      .reduce((n, l) => n + Number(l.debit_minor) - Number(l.credit_minor), 0);
  const signed = (raw: string) => {
    if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(raw))
      throw new Error("Enter a valid amount with at most two decimals.");
    return raw.startsWith("-")
      ? -cents(raw.slice(1))
      : Number(raw) === 0
        ? 0
        : cents(raw);
  };
  const available = t.payments.filter(
    (p) => p.status === "processed" && p.deposit_status === "undeposited",
  );
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      v = Object.fromEntries(f.entries());
    try {
      let command: Command;
      if (kind === "account")
        command = {
          type: "account",
          values: {
            account_code: v.code,
            account_name: v.name,
            account_kind: v.kind,
            account_purpose: v.purpose,
          },
        };
      else if (kind === "journal")
        command = {
          type: "journal",
          values: {
            dated: v.dated,
            memo: v.memo,
            request_key: key.current,
            lines: lines.map((id) => ({
              account_id: f.get(`account_${id}`),
              fund_id: f.get(`fund_${id}`) || null,
              debit_minor:
                Number(f.get(`debit_${id}`)) > 0
                  ? cents(f.get(`debit_${id}`))
                  : 0,
              credit_minor:
                Number(f.get(`credit_${id}`)) > 0
                  ? cents(f.get(`credit_${id}`))
                  : 0,
            })),
          },
        };
      else if (kind === "deposit")
        command = {
          type: "deposit",
          values: {
            bank: v.bank,
            dated: v.dated,
            payments: selected,
            request_key: key.current,
          },
        };
      else if (kind === "bill")
        command = {
          type: "bill",
          values: {
            vendor: v.vendor,
            invoice: v.invoice,
            dated: v.dated,
            due: v.due,
            amount: cents(v.amount),
            expense_account: v.expense_account,
            fund: v.fund || null,
            memo: v.memo ?? "",
          },
        };
      else if (kind === "pay_bill")
        command = {
          type: "pay_bill",
          values: {
            bill: preset.bill,
            bank: v.bank,
            amount: cents(v.amount),
            dated: v.dated,
            payment_method: v.method,
            check_reference: v.check_reference ?? "",
            memo: v.memo ?? "",
            request_key: key.current,
          },
        };
      else if (kind === "bank_import") {
        const file = f.get("file") as File;
        if (!file || file.size > 1048576)
          throw new Error("Choose a CSV file under 1 MB.");
        const rows = parseBankCSV(await file.text());
        command = {
          type: "bank_import",
          values: { bank: v.bank, import_name: file.name, rows },
        };
      } else if (kind === "bank_match")
        command = {
          type: "bank_match",
          values: { bank_transaction: preset.bank_transaction, entry: v.entry },
        };
      else if (kind === "bank_create")
        command = {
          type: "bank_create",
          values: {
            bank_transaction: preset.bank_transaction,
            category: v.category,
            fund: v.fund || null,
          },
        };
      else if (kind === "reconcile")
        command = {
          type: "reconcile",
          values: {
            bank,
            statement_date: date,
            ending_balance: signed(ending),
            entries: selected,
          },
        };
      else if (kind === "vendor")
        command = { type: "insert", table: "vendors", values: v };
      else throw new Error("Unknown accounting action.");
      await onSave(command);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };
  const matchRow = t.bank_transactions.find(
    (b) => b.id === preset.bank_transaction,
  );
  const matchEntries = t.journal_entries
    .filter(
      (e) =>
        !t.bank_transactions.some(
          (b) =>
            b.bank_account_id === matchRow?.bank_account_id &&
            b.entry_id === e.id,
        ) &&
        t.journal_lines
          .filter(
            (l) =>
              l.entry_id === e.id && l.account_id === matchRow?.bank_account_id,
          )
          .reduce(
            (n, l) => n + Number(l.debit_minor) - Number(l.credit_minor),
            0,
          ) === matchRow?.amount_minor,
    )
    .map((e) => ({ ...e, name: `${e.entry_date} · ${e.description}` }));
  return (
    <form className="record-form" onSubmit={submit}>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {kind === "journal" && (
        <p className="notice">
          Post balanced entries in integer cents. Posted entries cannot be
          edited or deleted; use a reversing entry for corrections. Enter
          opening bank balances against opening net assets.
        </p>
      )}
      {kind === "deposit" && (
        <p className="notice">
          A deposit moves received funds from Undeposited funds to the bank. It
          creates no donation revenue. Enter a gross deposit; record processing
          fees separately.
        </p>
      )}
      {kind === "bill" && (
        <p className="notice">
          Records an accrual expense and accounts payable. Recording this bill
          does not initiate payment.
        </p>
      )}
      {kind === "pay_bill" && (
        <p className="notice">
          Record an externally completed payment or issued check. No bank
          transfer is initiated.
        </p>
      )}
      <div className="form-grid">
        {kind === "account" && (
          <>
            {input("code", "Account code")}
            {input("name", "Account name")}
            <label>
              Account type
              <select name="kind">
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="equity">Equity</option>
              </select>
            </label>
            <label>
              Purpose
              <select name="purpose">
                <option value="general">General</option>
                <option value="bank">Bank account (assets only)</option>
              </select>
            </label>
          </>
        )}
        {kind === "vendor" && (
          <>
            {input("name", "Company / vendor name")}
            {input("contact", "Contact person", "text", "", false)}
            {input("email", "Email", "email", "", false)}
            {input("phone", "Phone", "text", "", false)}
            {input("address", "Address", "text", "", false)}
          </>
        )}
        {["journal", "deposit", "bill", "pay_bill"].includes(kind) &&
          input("dated", "Posting date", "date", today())}
        {kind === "journal" && input("memo", "Journal description")}
        {["deposit", "pay_bill", "bank_import", "reconcile"].includes(kind) &&
          field("bank", "Bank account", banks)}
        {kind === "bill" && (
          <>
            {field("vendor", "Vendor", t.vendors)}
            {input("invoice", "Invoice reference")}
            {input("due", "Due date", "date")}
            {input("amount", "Bill amount (USD)", "money")}
            {field(
              "expense_account",
              "Expense category",
              t.accounts.filter((a) => a.kind === "expense"),
            )}
            {field("fund", "Fund", t.funds, false)}
            {input("memo", "Description", "text", "", false)}
          </>
        )}
        {kind === "pay_bill" && (
          <>
            {input(
              "amount",
              "Payment amount (USD)",
              "money",
              String(Number(preset.amount_minor) / 100),
            )}
            <label>
              Payment method
              <select name="method">
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
              </select>
            </label>
            {input(
              "check_reference",
              "Check number (required for checks)",
              "text",
              "",
              false,
            )}
            {input("memo", "Memo", "text", "", false)}
          </>
        )}
        {kind === "bank_import" && (
          <label>
            Bank CSV file
            <input
              name="file"
              aria-label="Bank CSV file"
              type="file"
              accept=".csv,text/csv"
              required
            />
          </label>
        )}
        {kind === "bank_match" &&
          field(
            "entry",
            `Matching entries · ${currency(matchRow?.amount_minor)}`,
            matchEntries,
          )}
        {kind === "bank_create" && (
          <>
            {field(
              "category",
              "Income / expense category",
              t.accounts.filter((a) =>
                Number(matchRow?.amount_minor) > 0
                  ? ["income", "liability", "equity"].includes(String(a.kind))
                  : ["expense", "liability", "equity"].includes(String(a.kind)),
              ),
            )}
            {field("fund", "Fund", t.funds, false)}
          </>
        )}
        {kind === "reconcile" && (
          <>
            <label>
              Statement ending date
              <input
                aria-label="Statement ending date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSelected([]);
                }}
                required
              />
            </label>
            <label>
              Statement ending balance (USD)
              <input
                aria-label="Statement ending balance (USD)"
                type="number"
                step="0.01"
                value={ending}
                onChange={(e) => setEnding(e.target.value)}
                required
              />
            </label>
          </>
        )}
      </div>
      {kind === "journal" && (
        <>
          <div className="journal-grid journal-heading">
            <span>Account</span>
            <span>Fund (optional)</span>
            <span>Debit USD</span>
            <span>Credit USD</span>
            <span />
          </div>
          {lines.map((id) => (
            <div className="journal-grid" key={id}>
              {field(
                `account_${id}`,
                "Account",
                t.accounts.filter(
                  (a) =>
                    ![
                      "receivable",
                      "payable",
                      "donor_credit",
                      "undeposited",
                      "contributions",
                    ].includes(String(a.purpose)),
                ),
              )}
              {field(`fund_${id}`, "Fund", t.funds, false)}
              {input(`debit_${id}`, "Debit", "money", "", false)}
              {input(`credit_${id}`, "Credit", "money", "", false)}
              <button
                type="button"
                aria-label="Remove journal line"
                className="icon-button"
                disabled={lines.length <= 2}
                onClick={() => setLines(lines.filter((l) => l !== id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setLines([...lines, crypto.randomUUID()])}
          >
            <Plus size={14} />
            Add line
          </button>
        </>
      )}
      {kind === "deposit" && (
        <fieldset>
          <legend>Undeposited processed payments</legend>
          {available.map((p) => (
            <label className="check-label" key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, p.id]
                      : selected.filter((id) => id !== p.id),
                  )
                }
              />
              {String(t.donors.find((d) => d.id === p.donor_id)?.name)} ·{" "}
              {String(p.paid_on)} · {currency(p.amount_minor)}
            </label>
          ))}
          <strong>
            Total:{" "}
            {currency(
              sum(
                available.filter((p) => selected.includes(p.id)),
                "amount_minor",
              ),
            )}
          </strong>
        </fieldset>
      )}
      {kind === "bank_import" && (
        <p className="notice">
          CSV columns: external_id, transaction_date (YYYY-MM-DD), description,
          amount (signed USD, positive inflow). Requires unique bank transaction
          IDs. Up to 500 rows. Duplicate IDs are skipped; invalid rows are
          logged. Chase-specific CSV mapping is not connected yet.
        </p>
      )}
      {kind === "bank_create" && (
        <label className="check-label">
          <input type="checkbox" required />
          This is a new non-duplicate transaction. Existing donations/deposits
          must be matched to their ledger entry instead.
        </label>
      )}
      {kind === "reconcile" && (
        <>
          <p>
            Previous statement balance:{" "}
            <strong>{currency(previous?.ending_balance_minor)}</strong>. Select
            transactions cleared on this statement.
          </p>
          <fieldset>
            {clearable.map((e) => (
              <label className="check-label" key={e.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(e.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, e.id]
                        : selected.filter((id) => id !== e.id),
                    )
                  }
                />
                {String(e.entry_date)} · {String(e.description)} ·{" "}
                {currency(net(e.id))}
              </label>
            ))}
          </fieldset>
          <p className="notice">
            Cleared balance:{" "}
            {currency(
              Number(previous?.ending_balance_minor ?? 0) +
                selected.reduce((n, id) => n + net(id), 0),
            )}
            . Difference:{" "}
            {currency(
              Number(ending || 0) * 100 -
                Number(previous?.ending_balance_minor ?? 0) -
                selected.reduce((n, id) => n + net(id), 0),
            )}
            . Completion requires zero difference.
          </p>
        </>
      )}
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : kind === "reconcile"
              ? "Complete reconciliation"
              : kind === "journal"
                ? "Post balanced journal"
                : "Save accounting record"}
        </button>
      </footer>
    </form>
  );
}

export function parseBankCSV(text: string) {
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if ((c === "," || c === "\n") && !quoted) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        if (row.some((v) => v.trim())) records.push(row);
        row = [];
      }
    } else field += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  row.push(field.replace(/\r$/, ""));
  if (row.some((v) => v.trim())) records.push(row);
  const header =
      records.shift()?.map((h) => h.trim().replace(/^\uFEFF/, "")) ?? [],
    keys = ["external_id", "transaction_date", "description", "amount"];
  if (!keys.every((k) => header.includes(k)))
    throw new Error(
      "CSV must include external_id, transaction_date, description, and amount columns.",
    );
  return records.map((r) => {
    const get = (k: string) => r[header.indexOf(k)]?.trim() ?? "";
    const raw = get("amount");
    let amount_minor: number;
    try {
      amount_minor = raw.startsWith("-") ? -cents(raw.slice(1)) : cents(raw);
    } catch {
      amount_minor = 0;
    }
    return {
      external_id: get("external_id"),
      transaction_date: get("transaction_date"),
      description: get("description"),
      amount_minor,
    };
  });
}
