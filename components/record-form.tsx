"use client";
import { useEffect, useRef, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import {
  balance,
  scheduled,
  credit,
  cents,
  currency,
  today,
  type Command,
  type Row,
  type WorkspaceData,
} from "@/lib/workspace/domain";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog className="modal" ref={ref} onCancel={onClose}>
      <header>
        <div>
          <p className="eyebrow">Fundora · Workspace</p>
          <h2>{title}</h2>
        </div>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { id: string; name: string }[];
  required?: boolean;
  value?: string;
};
const select = (
  key: string,
  label: string,
  rows: Row[],
  required = true,
): Field => ({
  key,
  label,
  options: rows.map((r) => ({
    id: r.id,
    name: String(r.name ?? r.subject ?? r.id),
  })),
  required,
});
const choice = (
  key: string,
  label: string,
  items: string[],
  value?: string,
): Field => ({
  key,
  label,
  options: items.map((id) => ({ id, name: id.replaceAll("_", " ") })),
  required: true,
  value,
});
const named = (extra: Field[] = []) => [
  { key: "name", label: "Name", required: true },
  ...extra,
];
export function RecordForm({
  kind,
  data,
  onSave,
  onClose,
  preset = {},
}: {
  kind: string;
  data: WorkspaceData;
  onSave: (c: Command) => Promise<void>;
  onClose: () => void;
  preset?: Record<string, unknown>;
}) {
  const requestKey = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [donor, setDonor] = useState(String(preset.donor_id ?? "")),
    [pledge, setPledge] = useState(String(preset.pledge ?? "")),
    [payment, setPayment] = useState(String(preset.payment ?? "")),
    [rows, setRows] = useState([crypto.randomUUID()]);
  const t = data.tables;
  const fields: Record<string, Field[]> = {
    organization_update: named([
      { key: "hebrew_name", label: "Hebrew organization name", type: "hebrew" },
      { key: "tax_id", label: "Federal tax ID / EIN" },
      choice("timezone", "Organization timezone", [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Phoenix",
        "America/Anchorage",
        "Pacific/Honolulu",
      ]),
    ]),
    donors: named([
      { key: "title", label: "Title" },
      { key: "hebrew_name", label: "Hebrew name", type: "hebrew" },
      { key: "email", label: "Primary email", type: "email" },
      {
        key: "emails",
        label: "Additional emails (one per line)",
        type: "textarea",
      },
      {
        key: "phones",
        label: "Phone numbers (one per line)",
        type: "textarea",
      },
      { key: "personal_address", label: "Personal address", type: "textarea" },
      { key: "business_address", label: "Business address", type: "textarea" },
      { key: "tags", label: "Tags (comma separated)" },
      select("fundraiser_id", "Assigned fundraiser", t.fundraisers, false),
      choice("receipt_language", "Receipt language", ["en", "he"]),
      { key: "notes", label: "Notes", type: "textarea" },
      { key: "occasions", label: "Occasions (one per line)", type: "textarea" },
      {
        key: "custom_fields",
        label: "Custom fields (JSON object)",
        type: "textarea",
      },
    ]),
    campaigns: named([
      select("fund_id", "Fund", t.funds, false),
      { key: "goal", label: "Fundraising goal (USD)", type: "money" },
      choice("status", "Status", ["active", "planned", "completed"]),
    ]),
    pledges: [
      {
        key: "sponsorship_date",
        label: "Sponsorship date (if applicable)",
        type: "date",
      },
      choice(
        "expected_payment_type",
        "Expected payment type",
        [
          "unspecified",
          "check",
          "cash",
          "bank_transfer",
          "external_card",
          "charity_card",
        ],
        "unspecified",
      ),
      select("donor_id", "Donor", t.donors),
      select("campaign_id", "Campaign", t.campaigns),
      {
        key: "amount",
        label: "Pledge amount (USD)",
        type: "money",
        required: true,
      },
      {
        key: "pledged_on",
        label: "Pledge date",
        type: "date",
        required: true,
        value: today(),
      },
      { key: "due_date", label: "Due date (optional)", type: "date" },
      select("fundraiser_id", "Fundraiser", t.fundraisers, false),
      select("sponsorship_id", "Sponsorship", t.sponsorships, false),
      select("event_id", "Event", t.events, false),
      {
        key: "description",
        label: "Donor-visible description",
        type: "textarea",
      },
      choice("receipt_requested", "Receipt requested", ["yes", "no"], "yes"),
    ],
    funds: named([
      choice("restricted", "Fund restriction", ["unrestricted", "restricted"]),
    ]),
    fundraisers: named([{ key: "email", label: "Email", type: "email" }]),
    donor_accounts: [
      select("donor_id", "Linked donor", t.donors),
      ...named([
        { key: "display_name", label: "Display name", required: true },
        choice("type", "Account type", ["personal", "business", "foundation"]),
        { key: "email", label: "Email", type: "email" },
        { key: "address", label: "Address", type: "textarea" },
      ]),
    ],
    donor_lists: named(),
    list_members: [
      select("list_id", "List", t.donor_lists),
      select("donor_id", "Donor", t.donors),
    ],
    events: named([
      { key: "description", label: "Description", type: "textarea" },
      { key: "event_date", label: "Event date", type: "date", required: true },
      choice("status", "Status", [
        "planned",
        "active",
        "completed",
        "cancelled",
      ]),
    ]),
    sponsorships: named([
      { key: "type", label: "Sponsorship type", required: true },
      {
        key: "availability_limit",
        label: "Availability limit",
        type: "number",
        required: true,
      },
      {
        key: "default_price",
        label: "Default price (USD)",
        type: "money",
        required: true,
      },
    ]),
    tasks: [
      { key: "subject", label: "Subject", required: true },
      { key: "description", label: "Description", type: "textarea" },
      select("donor_id", "Linked donor", t.donors, false),
      { key: "assignee", label: "Assignee" },
      choice("priority", "Priority", ["normal", "high", "low"]),
      { key: "due_date", label: "Due date", type: "date", required: true },
      choice("status", "Status", ["open", "done"]),
    ],
    payment: [
      { key: "collector", label: "Collector (person recording receipt)" },
      select("donor_id", "Donor", t.donors),
      {
        key: "amount",
        label: "Payment amount (USD)",
        type: "money",
        required: true,
        value: preset.amount_minor
          ? String(Number(preset.amount_minor) / 100)
          : undefined,
      },
      {
        key: "paid_on",
        label: "Payment date",
        type: "date",
        required: true,
        value: today(),
      },
      choice("method", "Method", [
        "check",
        "cash",
        "bank_transfer",
        "external_card",
        "charity_card",
      ]),
      choice("status", "Status", ["processed", "pending", "failed"]),
      { key: "reference", label: "External reference / check number" },
    ],
    schedule: [
      {
        key: "pledge",
        label: "Pledge",
        required: true,
        options: t.pledges
          .filter((p) => balance(data, p) - scheduled(data, p.id) > 0)
          .map((p) => ({
            id: p.id,
            name: `${t.donors.find((d) => d.id === p.donor_id)?.name} · ${currency(balance(data, p) - scheduled(data, p.id))} available`,
          })),
      },
      choice("schedule_kind", "Plan type", ["installment", "recurring"]),
      choice("schedule_frequency", "Frequency", [
        "monthly",
        "weekly",
        "quarterly",
        "yearly",
      ]),
      {
        key: "first_date",
        label: "First payment date",
        type: "date",
        required: true,
        value: today(),
      },
      {
        key: "total",
        label: "Total plan amount (USD)",
        type: "money",
        required: true,
      },
      {
        key: "count",
        label: "Number of payments (1–120)",
        type: "number",
        required: true,
      },
    ],
    allocate: [
      {
        key: "payment",
        label: "Available donor credit",
        required: true,
        options: t.payments
          .filter((p) => credit(data, p) > 0)
          .map((p) => ({
            id: p.id,
            name: `${t.donors.find((d) => d.id === p.donor_id)?.name} · ${currency(credit(data, p))} credit`,
          })),
      },
    ],
  };
  const customFields = data.tables.custom_field_definitions ?? [];
  for (const definition of customFields)
    fields.donors.push({
      key: `custom_${definition.field_key}`,
      label: String(definition.name),
      options:
        definition.field_type === "boolean"
          ? [
              { id: "true", name: "Yes" },
              { id: "false", name: "No" },
            ]
          : undefined,
      type:
        definition.field_type === "boolean"
          ? "text"
          : definition.field_type === "number"
            ? "number"
            : definition.field_type === "date"
              ? "date"
              : "text",
      required: Boolean(definition.required),
      value: preset.custom_fields
        ? String(
            (preset.custom_fields as Record<string, unknown>)[
              String(definition.field_key)
            ] ?? "",
          )
        : undefined,
    });
  fields.donor_edit = fields.donors;
  const selectedPayment = t.payments.find((p) => p.id === payment);
  const relevantDonor =
    kind === "allocate" ? String(selectedPayment?.donor_id ?? "") : donor;
  const openPledges = t.pledges.filter(
    (p) =>
      p.donor_id === relevantDonor &&
      balance(data, p) - scheduled(data, p.id) > 0,
  );
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const values: Record<string, unknown> = Object.fromEntries(form.entries());
    const parseAllocations = () =>
      openPledges
        .filter(
          (p) =>
            form.get(`allocation_${p.id}`) &&
            Number(form.get(`allocation_${p.id}`)) > 0,
        )
        .map((p) => ({
          pledge_id: p.id,
          amount_minor: cents(form.get(`allocation_${p.id}`)),
        }));
    try {
      let cmd: Command;
      if (kind === "payment")
        cmd = {
          type: "payment",
          values: {
            donor_id: values.donor_id,
            amount_minor: cents(values.amount),
            paid_on: values.paid_on,
            method: values.method,
            status: values.status,
            reference: values.reference ?? "",
            collector: values.collector ?? "",
            idempotency_key: requestKey.current,
            allocations: preset.installment ? [] : parseAllocations(),
            ...(preset.installment ? { installment: preset.installment } : {}),
          },
        };
      else if (kind === "allocate")
        cmd = {
          type: "allocate",
          values: { payment: values.payment, allocations: parseAllocations() },
        };
      else if (kind === "schedule")
        cmd = {
          type: "schedule",
          values: {
            pledge: values.pledge,
            schedule_kind: values.schedule_kind,
            schedule_frequency: values.schedule_frequency,
            first_date: values.first_date,
            total: cents(values.total),
            count: Number(values.count),
          },
        };
      else if (kind === "batch")
        cmd = {
          type: "batch",
          values: {
            entries: rows.map((id) => ({
              donor_id: form.get(`donor_${id}`),
              amount_minor: cents(form.get(`amount_${id}`)),
              paid_on: today(),
              method: form.get(`method_${id}`),
              status: "processed",
              reference: form.get(`reference_${id}`) ?? "",
              idempotency_key: id,
              allocations: [],
            })),
          },
        };
      else {
        Object.keys(values).forEach((k) => {
          if (values[k] === "") {
            if (["donor_edit", "organization_update"].includes(kind))
              values[k] = k.endsWith("_id") ? null : "";
            else delete values[k];
          }
        });
        if (kind === "donors" || kind === "donor_edit") {
          const lines = (key: string) =>
            String(values[key] ?? "")
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean);
          values.emails = [
            ...(values.email ? [String(values.email)] : []),
            ...lines("emails"),
          ];
          values.phones = lines("phones");
          values.occasions = lines("occasions");
          values.tags = String(values.tags ?? "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          values.addresses = ["personal", "business"]
            .filter((k) => values[`${k}_address`])
            .map((type) => ({ type, address: values[`${type}_address`] }));
          delete values.personal_address;
          delete values.business_address;
          const custom = values.custom_fields
            ? JSON.parse(String(values.custom_fields))
            : {};
          if (
            typeof custom !== "object" ||
            custom === null ||
            Array.isArray(custom)
          )
            throw new Error("Custom fields must be a JSON object.");
          for (const definition of customFields) {
            const key = `custom_${definition.field_key}`,
              raw = values[key];
            delete values[key];
            if (raw !== undefined && raw !== "")
              custom[String(definition.field_key)] =
                definition.field_type === "number"
                  ? Number(raw)
                  : definition.field_type === "boolean"
                    ? raw === "true"
                    : String(raw);
            else if (definition.field_type === "boolean")
              custom[String(definition.field_key)] = false;
          }
          values.custom_fields = custom;
        }
        if (kind === "pledges") {
          values.due_date = values.due_date || values.pledged_on;
          values.amount_minor = cents(values.amount);
          delete values.amount;
          values.receipt_requested = values.receipt_requested === "yes";
        }
        if (kind === "campaigns") {
          values.goal_minor = values.goal ? cents(values.goal) : 0;
          delete values.goal;
        }
        if (kind === "funds")
          values.restricted = values.restricted === "restricted";
        if (kind === "sponsorships") {
          values.default_price_minor = cents(values.default_price);
          delete values.default_price;
          values.availability_limit = Number(values.availability_limit);
        }
        cmd =
          kind === "donor_edit"
            ? {
                type: "donor_update",
                values: { donor: preset.id, attributes: values },
              }
            : kind === "organization_update"
              ? { type: "organization_update", values: { attributes: values } }
              : { type: "insert", table: kind, values };
      }
      await onSave(cmd);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save this record.",
      );
    } finally {
      setBusy(false);
    }
  };
  const initial = (f: Field) => {
    const v = preset[f.key];
    return v === undefined
      ? (f.value ?? "")
      : Array.isArray(v)
        ? v.join(f.key === "tags" ? ", " : "\n")
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
  };
  const field = (f: Field) => (
    <label key={f.key} className={f.type === "textarea" ? "wide-field" : ""}>
      {f.label}
      {f.required && <span className="required"> *</span>}
      {f.options ? (
        <select
          aria-label={f.label}
          name={f.key}
          required={f.required}
          value={
            f.key === "donor_id"
              ? donor
              : f.key === "pledge"
                ? pledge
                : f.key === "payment"
                  ? payment
                  : undefined
          }
          defaultValue={
            ["donor_id", "pledge", "payment"].includes(f.key)
              ? undefined
              : initial(f)
          }
          onChange={(e) => {
            if (f.key === "donor_id") setDonor(e.target.value);
            if (f.key === "pledge") setPledge(e.target.value);
            if (f.key === "payment") setPayment(e.target.value);
          }}
        >
          <option value="">Select…</option>
          {f.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea
          aria-label={f.label}
          name={f.key}
          rows={3}
          maxLength={10000}
          defaultValue={initial(f)}
        />
      ) : (
        <input
          aria-label={f.label}
          name={f.key}
          type={
            ["money", "number"].includes(f.type ?? "")
              ? "number"
              : f.type === "hebrew"
                ? "text"
                : (f.type ?? "text")
          }
          dir={f.type === "hebrew" ? "rtl" : "auto"}
          required={f.required}
          defaultValue={initial(f)}
          min={
            f.type === "money" ? "0.01" : f.type === "number" ? "1" : undefined
          }
          step={
            f.type === "money" ? "0.01" : f.type === "number" ? "1" : undefined
          }
          maxLength={f.type === "email" ? 254 : 200}
        />
      )}
    </label>
  );
  return (
    <form onSubmit={submit} className="record-form">
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {["payment", "batch"].includes(kind) && (
        <div className="notice">
          Manual record only. No card is charged and no bank transfer is
          initiated. Record payments already received or recorded by your
          provider.
        </div>
      )}
      {kind === "schedule" && (
        <div className="notice">
          This creates a finite payment plan. Automatic collection requires a
          connected gateway. Remaining cents are distributed exactly across
          installments.
        </div>
      )}
      <div className="form-grid">{(fields[kind] ?? []).map(field)}</div>
      {["payment", "allocate"].includes(kind) && !preset.installment && (
        <fieldset key={relevantDonor}>
          <legend>Allocate to pledges</legend>
          <p className="muted">
            Any unallocated processed payment remains donor credit. Scheduled
            balances are reserved for their installment payments.
          </p>
          {openPledges.map((p) => (
            <label key={p.id}>
              {String(
                t.campaigns.find((c) => c.id === p.campaign_id)?.name ??
                  "Campaign",
              )}{" "}
              · {currency(balance(data, p) - scheduled(data, p.id))} available
              <input
                name={`allocation_${p.id}`}
                aria-label={`Allocate to ${String(t.campaigns.find((c) => c.id === p.campaign_id)?.name ?? "Campaign")}`}
                type="number"
                step="0.01"
                min="0"
                max={(balance(data, p) - scheduled(data, p.id)) / 100}
                placeholder="0.00"
              />
            </label>
          ))}
          {!openPledges.length && (
            <p className="muted">
              Select a donor with an unscheduled open pledge to allocate funds.
            </p>
          )}
        </fieldset>
      )}
      {kind === "batch" && (
        <>
          <p>
            All rows are recorded atomically as processed payments dated today.
            Amounts remain credit until allocated.
          </p>
          {rows.map((id, index) => (
            <div className="batch-row" key={id}>
              <strong>{index + 1}</strong>
              <label>
                Donor
                <select name={`donor_${id}`} required>
                  <option value="">Select donor</option>
                  {t.donors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {String(d.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount (USD)
                <input
                  name={`amount_${id}`}
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                />
              </label>
              <label>
                Method
                <select name={`method_${id}`}>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
              <label>
                Reference
                <input name={`reference_${id}`} />
              </label>
              <button
                type="button"
                className="icon-button"
                disabled={rows.length === 1}
                aria-label={`Remove batch row ${index + 1}`}
                onClick={() => setRows(rows.filter((r) => r !== id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={rows.length >= 100}
            onClick={() => setRows([...rows, crypto.randomUUID()])}
          >
            <Plus size={16} />
            Add payment row
          </button>
        </>
      )}
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : kind === "batch"
              ? `Record ${rows.length} payments`
              : kind === "allocate"
                ? "Allocate credit"
                : "Save record"}
        </button>
      </footer>
    </form>
  );
}
