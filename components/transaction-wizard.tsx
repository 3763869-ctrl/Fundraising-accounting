"use client";
import { useEffect, useRef, useState } from "react";
import {
  UserRound,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Banknote,
  ReceiptText,
  HeartHandshake,
  Wallet,
  Plus,
  ChevronRight,
} from "lucide-react";
import { InlineCardPayment } from "./inline-card-payment";
import { MatbiaPayment } from "./matbia-payment";
import {
  balance,
  scheduled,
  cents,
  currency,
  today,
  type Command,
  type WorkspaceData,
} from "@/lib/workspace/domain";
import { suggestAllocations } from "@/lib/workspace/donations";
const methods = [
  ["external_card", "Credit card", CreditCard],
  ["bank_transfer", "ACH / transfer", Landmark],
  ["charity_card", "Charity card", HeartHandshake],
  ["cash", "Cash", Banknote],
  ["check", "Check", ReceiptText],
  ["pledge", "Pledge", HeartHandshake],
  ["zelle", "Zelle", Wallet],
  ["other", "Other", Plus],
] as const;
export function TransactionWizard({
  data,
  demo,
  onSave,
  onRecorded,
  onClose,
}: {
  data: WorkspaceData;
  demo: boolean;
  onSave: (c: Command) => Promise<void>;
  onRecorded: () => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0),
    [search, setSearch] = useState(""),
    [donor, setDonor] = useState(""),
    [newName, setNewName] = useState(""),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState(""),
    [campaign, setCampaign] = useState(
      String(data.organization.default_donation_campaign_id ?? ""),
    ),
    [description, setDescription] = useState(""),
    [charity, setCharity] = useState("matbia"),
    [reference, setReference] = useState(""),
    [creditMode, setCreditMode] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [allocations, setAllocations] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID()),
    submitting = useRef(false);
  const anonymous = data.tables.donors.find(
    (d) => d.system_role === "anonymous",
  );
  const selected = data.tables.donors.find((d) => d.id === donor);
  const named = selected && selected.system_role !== "anonymous";
  useEffect(() => {
    if (!newName) return;
    const found = data.tables.donors.find(
      (d) => String(d.name).toLowerCase() === newName.toLowerCase(),
    );
    if (found) {
      setDonor(found.id);
      setNewName("");
      setStep(1);
    }
  }, [data, newName]);
  const open = data.tables.pledges
    .filter((p) => p.donor_id === donor && !p.voided_at && balance(data, p) > 0)
    .sort((a, b) => String(a.pledged_on).localeCompare(String(b.pledged_on)));
  const chosen = () =>
    Object.entries(allocations)
      .filter(([, n]) => Number(n) > 0)
      .map(([pledge_id, n]) => ({ pledge_id, amount_minor: cents(n) }));
  let minor = 0,
    applied = 0;
  try {
    minor = cents(amount);
    applied = chosen().reduce((sum, a) => sum + a.amount_minor, 0);
  } catch {}
  const remaining = Math.max(0, minor - applied);
  const advanceDonor = async () => {
    setError("");
    setAllocations({});
    setConfirmed(false);
    const name = search.trim();
    const found =
      data.tables.donors.find(
        (d) => d.id === donor && String(d.name) === name,
      ) ??
      data.tables.donors.find(
        (d) =>
          d.system_role !== "anonymous" &&
          String(d.name).toLowerCase() === name.toLowerCase(),
      );
    if (found) {
      setDonor(found.id);
      setStep(1);
      return;
    }
    if (!name || name.length > 200) {
      setError("Enter or choose a donor name, or use Skip.");
      return;
    }
    if (data.role === "accountant") {
      setError(
        "Choose an existing donor or use Skip. A fundraising user can add a donor.",
      );
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNewName(name);
    try {
      await onSave({
        type: "insert",
        table: "donors",
        values: { name, receipt_language: "en" },
      });
    } catch (e) {
      setNewName("");
      setError(e instanceof Error ? e.message : "Unable to add donor.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const context = () => {
    setError("");
    try {
      if (!donor || !selected) throw Error("Choose a donor or use Skip.");
      const n = cents(amount);
      if (n < 1) throw Error("Enter an amount above zero.");
      if (!data.tables.campaigns.some((c) => c.id === campaign))
        throw Error("Select a campaign.");
      const items = chosen();
      let total = 0;
      for (const a of items) {
        const p = open.find((p) => p.id === a.pledge_id);
        if (!p || a.amount_minor > balance(data, p) - scheduled(data, p.id))
          throw Error("An allocation exceeds its available pledge balance.");
        total += a.amount_minor;
      }
      if (total > n) throw Error("Pledge allocations exceed this payment.");
      if (open.length && !items.length && !confirmed)
        throw Error(
          "Confirm that this payment should not pay any open pledges.",
        );
      if (creditMode && !named)
        throw Error("Choose a named donor for account credit.");
      return {
        organization: data.organization.id,
        allocations: items,
        donation: {
          campaign_id: campaign,
          description,
          collector: "",
          credit_confirmed: confirmed,
          remainder_mode: creditMode ? "credit" : "donation",
        },
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check transaction details.");
      return null;
    }
  };
  const save = async () => {
    if (submitting.current) return;
    setError("");
    try {
      if (method === "pledge") {
        if (!named) throw Error("Choose a named donor to create a pledge.");
        if (!campaign || minor < 1)
          throw Error("Enter the amount and select a campaign.");
      } else {
        if (!context()) return;
        if (!method) throw Error("Choose a payment type.");
        if (
          (method === "check" || method === "charity_card") &&
          !reference.trim()
        )
          throw Error(
            "Enter the check number or charity-card payment reference.",
          );
      }
      submitting.current = true;
      setBusy(true);
      await onSave(
        method === "pledge"
          ? {
              type: "transaction_pledge",
              values: {
                donor_id: donor,
                campaign_id: campaign,
                amount_minor: minor,
                pledged_on: today(),
                due_date: today(),
                description,
                transaction_key: key.current,
              },
            }
          : {
              type: "transaction_payment",
              values: {
                ...context()!.donation,
                donor_id: donor,
                amount_minor: minor,
                paid_on: today(),
                method,
                status: "processed",
                reference: reference.trim(),
                idempotency_key: key.current,
                allocations: chosen(),
              },
            },
      );
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to record transaction.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const processing =
    method === "external_card" ||
    (method === "charity_card" && charity === "matbia");
  const campaignName = (id: unknown) =>
    String(
      data.tables.campaigns.find((c) => c.id === id)?.name ?? "Select campaign",
    );
  return (
    <div className="transaction-wizard">
      <nav className="transaction-steps" aria-label="Transaction steps">
        {[
          ["Donor info", UserRound],
          ["Amount", CircleDollarSign],
          ["Payment type", CreditCard],
        ].map(([label, Icon], i) => (
          <button
            type="button"
            key={String(label)}
            aria-current={step === i ? "step" : undefined}
            disabled={busy || i > step}
            onClick={() => {
              setError("");
              setStep(i);
            }}
          >
            <Icon size={22} />
            <span>{String(label)}</span>
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="notice transaction-error">
          {error}
        </p>
      )}
      {step === 0 ? (
        <section className="transaction-first-step">
          <h3>Enter donor info</h3>
          <label>
            Donor name
            <input
              autoFocus
              dir="auto"
              aria-label="Donor name"
              placeholder="Search or enter a donor name…"
              maxLength={200}
              value={search}
              disabled={busy}
              onChange={(e) => {
                setSearch(e.target.value);
                setDonor("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void advanceDonor();
                }
              }}
            />
          </label>
          {search.trim() && (
            <div className="transaction-donor-results">
              {data.tables.donors
                .filter(
                  (d) =>
                    d.system_role !== "anonymous" &&
                    String(d.name).toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, 8)
                .map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    disabled={busy}
                    onClick={() => {
                      setDonor(d.id);
                      setSearch(String(d.name));
                      setAllocations({});
                      setConfirmed(false);
                      setStep(1);
                    }}
                  >
                    <UserRound size={16} />
                    <span dir="auto">{String(d.name)}</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              <small>
                Choose an existing donor, or press Next to create the name you
                entered.
              </small>
            </div>
          )}
          <button
            type="button"
            className="secondary transaction-skip"
            disabled={busy || !anonymous}
            onClick={() => {
              setDonor(anonymous!.id);
              setSearch("");
              setCreditMode(false);
              setMethod("");
              setAllocations({});
              setConfirmed(false);
              setStep(1);
            }}
          >
            Skip — anonymous donation
          </button>
        </section>
      ) : step === 1 ? (
        <section className="transaction-first-step">
          <h3>Enter amount</h3>
          <p>{String(selected?.name ?? "")}</p>
          <label>
            Amount (USD)
            <input
              autoFocus
              className="transaction-amount"
              aria-label="Transaction amount (USD)"
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              disabled={busy}
              onChange={(e) => {
                setAmount(e.target.value);
                setAllocations({});
                setConfirmed(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (minor > 0) {
                    setStep(2);
                    setError("");
                  } else setError("Enter an amount above zero.");
                }
              }}
            />
          </label>
        </section>
      ) : (
        <div className="transaction-final">
          <section className="transaction-payment-section">
            <h3>Choose payment type</h3>
            <div className="transaction-methods">
              {methods.map(([value, label, Icon]) => (
                <button
                  type="button"
                  key={value}
                  disabled={
                    busy ||
                    (value === "pledge" &&
                      (!named || data.role === "accountant"))
                  }
                  aria-pressed={method === value}
                  onClick={() => {
                    setMethod(value);
                    setError("");
                  }}
                >
                  <Icon size={23} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {!named && (
              <p className="muted">
                Anonymous donations cannot create pledges or account credit.
              </p>
            )}
            {method !== "pledge" && open.length > 0 && (
              <section className="transaction-open-pledges">
                <div className="row">
                  <h3>Apply to open pledges</h3>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setAllocations(
                        Object.fromEntries(
                          suggestAllocations(data, donor, minor).map((a) => [
                            a.pledge_id,
                            String(a.amount_minor / 100),
                          ]),
                        ),
                      );
                      setConfirmed(false);
                    }}
                  >
                    Auto select
                  </button>
                </div>
                {open.map((p) => {
                  const available = balance(data, p) - scheduled(data, p.id);
                  return (
                    <div className="transaction-pledge-row" key={p.id}>
                      <input
                        type="checkbox"
                        aria-label={`Apply to pledge ${p.id}`}
                        checked={Boolean(allocations[p.id])}
                        disabled={busy || available <= 0}
                        onChange={(e) => {
                          setConfirmed(false);
                          setAllocations({
                            ...allocations,
                            [p.id]: e.target.checked
                              ? String(
                                  Math.max(0, Math.min(available, remaining)) /
                                    100,
                                )
                              : "",
                          });
                        }}
                      />
                      <span>
                        <strong>{campaignName(p.campaign_id)}</strong>
                        <small>
                          {String(p.pledged_on)} · Open{" "}
                          {currency(balance(data, p))} · On plan{" "}
                          {currency(scheduled(data, p.id))}
                        </small>
                      </span>
                      <input
                        aria-label={`Pledge allocation ${p.id}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        disabled={busy || available <= 0}
                        value={allocations[p.id] ?? ""}
                        onChange={(e) => {
                          setAllocations({
                            ...allocations,
                            [p.id]: e.target.value,
                          });
                          setConfirmed(false);
                        }}
                      />
                    </div>
                  );
                })}
                {!applied && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Record this payment without applying it to these open
                    pledges.
                  </label>
                )}
              </section>
            )}
            <label className="transaction-note">
              Note / donor-visible description
              <textarea
                maxLength={10000}
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional note…"
                dir="auto"
              />
            </label>
            {method === "charity_card" && (
              <label>
                Charity-card provider
                <select
                  value={charity}
                  disabled={busy}
                  onChange={(e) => setCharity(e.target.value)}
                >
                  <option value="matbia">Matbia</option>
                  <option value="other">
                    Other charity card — record received payment
                  </option>
                </select>
              </label>
            )}
            {!processing && method && method !== "pledge" && (
              <>
                <p className="muted">
                  Record a payment already received. This does not initiate a
                  bank transfer or charge.
                </p>
                <label>
                  {method === "check" ? "Check number" : "Payment reference"}
                  {["check", "charity_card"].includes(method) ? " *" : ""}
                  <input
                    value={reference}
                    disabled={busy}
                    maxLength={200}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              </>
            )}
            {method === "external_card" && (
              <InlineCardPayment
                organization={data.organization.id}
                donor={donor}
                amount={amount}
                demo={demo}
                beforeSubmit={context}
                onRecorded={onRecorded}
                onBusy={setBusy}
              />
            )}
            {method === "charity_card" && charity === "matbia" && (
              <MatbiaPayment
                data={data}
                demo={demo}
                donor={donor}
                amount={amount}
                beforeSubmit={context}
                onSave={onSave}
                onRecorded={onRecorded}
                onBusy={setBusy}
              />
            )}
          </section>
          <aside className="transaction-summary">
            <p className="eyebrow">Transaction summary</p>
            <strong className="transaction-summary-amount">
              {currency(minor)}
            </strong>
            <p dir="auto">{String(selected?.name ?? "")}</p>
            <label>
              {method === "pledge"
                ? "Campaign for new pledge"
                : "Campaign for new donations"}
              <select
                aria-label="Transaction campaign"
                value={campaign}
                disabled={busy}
                onChange={(e) => setCampaign(e.target.value)}
              >
                {data.tables.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.name)}
                  </option>
                ))}
              </select>
            </label>
            {method !== "pledge" && (
              <>
                <div className="transaction-split">
                  {Object.entries(allocations)
                    .filter(([, v]) => Number(v) > 0)
                    .map(([id, value]) => (
                      <p key={id}>
                        <span>
                          {campaignName(
                            open.find((p) => p.id === id)?.campaign_id,
                          )}
                          <small>Payment toward pledge</small>
                        </span>
                        <strong>
                          {currency(Math.round(Number(value) * 100))}
                        </strong>
                      </p>
                    ))}
                  <p>
                    <span>
                      {creditMode
                        ? "Donor account credit"
                        : campaignName(campaign)}
                      <small>
                        {creditMode ? "Unapplied credit" : "New donation"}
                      </small>
                    </span>
                    <strong>{currency(remaining)}</strong>
                  </p>
                </div>
                <p className="muted">
                  Pledge payments always keep the campaign assigned to that
                  pledge.
                </p>
                {named && (
                  <button
                    type="button"
                    className="text-button transaction-credit-toggle"
                    aria-pressed={creditMode}
                    disabled={busy}
                    onClick={() => setCreditMode(!creditMode)}
                  >
                    {creditMode
                      ? "Use remainder as a donation instead"
                      : "+ Add remainder as account credit"}
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}
      <footer className="transaction-footer">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => (step ? setStep(step - 1) : onClose())}
        >
          {step ? "Back" : "Cancel"}
        </button>
        {step < 2 ? (
          <button
            type="button"
            disabled={busy || (step === 0 ? !search.trim() : minor < 1)}
            onClick={() => {
              if (step === 0) void advanceDonor();
              else {
                setError("");
                setStep(2);
              }
            }}
          >
            {busy ? "Saving…" : "Next"}
            <ChevronRight size={16} />
          </button>
        ) : (
          <>
            {!processing && (
              <button
                type="button"
                disabled={busy || !method || (method === "pledge" && !named)}
                onClick={() => void save()}
              >
                {busy
                  ? "Saving…"
                  : method === "pledge"
                    ? "Create pledge"
                    : "Record payment"}
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={onClose}
            >
              Close
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
