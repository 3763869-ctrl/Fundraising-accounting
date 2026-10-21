"use client";
import { useRef, useState } from "react";
import { InlineCardPayment } from "./inline-card-payment";
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

export function DonationForm({
  data,
  preset = {},
  demo,
  onSave,
  onClose,
  onRecorded,
}: {
  data: WorkspaceData;
  demo: boolean;
  preset?: Record<string, unknown>;
  onSave: (c: Command) => Promise<void>;
  onClose: () => void;
  onRecorded: () => Promise<void>;
}) {
  const key = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const [donor, setDonor] = useState(String(preset.donor_id ?? ""));
  const [amount, setAmount] = useState(
    preset.amount_minor ? String(Number(preset.amount_minor) / 100) : "",
  );
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("cash");
  const [status, setStatus] = useState("processed");
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  const [confirmCredit, setConfirmCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = data.tables;
  const open = t.pledges
    .filter((p) => p.donor_id === donor && !p.voided_at && balance(data, p) > 0)
    .sort((a, b) => String(a.pledged_on).localeCompare(String(b.pledged_on)));
  const select = (
    name: string,
    label: string,
    table: string,
    required = false,
  ) => (
    <label>
      {label}
      {required && " *"}
      <select name={name} required={required}>
        <option value="">Select…</option>
        {t[table].map((r) => (
          <option key={r.id} value={r.id}>
            {String(r.name)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      ref={formRef}
      method="post"
      className="record-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (method === "external_card") return;
        setError("");
        try {
          const n = cents(amount);
          const chosen = Object.entries(allocations)
            .filter(([, v]) => Number(v) > 0)
            .map(([pledge_id, v]) => ({ pledge_id, amount_minor: cents(v) }));
          if (chosen.reduce((sum, a) => sum + a.amount_minor, 0) > n)
            throw new Error("Allocations exceed the payment amount.");
          if (
            open.length &&
            !chosen.length &&
            !preset.installment &&
            !creditConfirmed
          ) {
            setConfirmCredit(true);
            return;
          }
          const form = new FormData(e.currentTarget);
          setBusy(true);
          await onSave({
            type: "donation_payment",
            values: {
              donor_id: donor,
              amount_minor: n,
              paid_on: form.get("paid_on"),
              method,
              status,
              reference: form.get("reference") || "",
              collector: form.get("collector") || "",
              idempotency_key: key.current,
              allocations: chosen,
              installment: preset.installment ?? null,
              campaign_id: form.get("campaign_id"),
              fundraiser_id: form.get("fundraiser_id") || null,
              sponsorship_id: form.get("sponsorship_id") || null,
              event_id: form.get("event_id") || null,
              description: form.get("description") || "",
              credit_confirmed: creditConfirmed,
            },
          });
          onClose();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Unable to save payment.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="donation-fields">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <section className="donation-section">
          <h3>Donation information</h3>
          <div className="form-grid">
            <label>
              Donor *
              <select
                aria-label="Donor"
                required
                value={donor}
                onChange={(e) => {
                  setDonor(e.target.value);
                  setAllocations({});
                  setCreditConfirmed(false);
                  setConfirmCredit(false);
                }}
              >
                <option value="">Select donor…</option>
                {t.donors
                  .filter((d) => d.active !== false)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {String(d.name)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Payment amount (USD) *
              <input
                aria-label="Payment amount (USD)"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setCreditConfirmed(false);
                  setConfirmCredit(false);
                }}
              />
            </label>
            {select("campaign_id", "Goes to / Campaign", "campaigns", true)}
            <label>
              Payment date
              <input
                type="date"
                name="paid_on"
                required
                disabled={method === "external_card"}
                defaultValue={today()}
              />
            </label>
          </div>
          <details>
            <summary>
              Fundraiser, sponsorship, event & description (optional)
            </summary>
            <div className="form-grid">
              {select("fundraiser_id", "Fundraiser", "fundraisers")}
              {select("sponsorship_id", "Sponsorship", "sponsorships")}
              {select("event_id", "Event", "events")}
              <label className="wide-field">
                Donor-visible description
                <textarea name="description" maxLength={10000} rows={3} />
              </label>
            </div>
          </details>
        </section>
        {!preset.installment && donor && (
          <section className="donation-section">
            <h3>Apply to open pledges</h3>
            <p className="muted">
              Select pledges and the amount to apply. Unallocated money remains
              donor credit. Plan balances are reserved for their installments.
            </p>
            {open.length > 0 && (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    try {
                      setAllocations(
                        Object.fromEntries(
                          suggestAllocations(data, donor, cents(amount)).map(
                            (a) => [
                              a.pledge_id,
                              (a.amount_minor / 100).toFixed(2),
                            ],
                          ),
                        ),
                      );
                      setCreditConfirmed(false);
                      setConfirmCredit(false);
                    } catch {
                      setError("Enter a payment amount first.");
                    }
                  }}
                >
                  Auto select: exact match, then oldest
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setAllocations({});
                    setCreditConfirmed(false);
                  }}
                >
                  Clear all
                </button>
              </>
            )}
            {open.map((p) => {
              const available = balance(data, p) - scheduled(data, p.id);
              return (
                <div className="pledge-allocation-row" key={p.id}>
                  <input
                    aria-label={`Select pledge ${p.id}`}
                    type="checkbox"
                    disabled={available <= 0 || status !== "processed"}
                    checked={Number(allocations[p.id]) > 0}
                    onChange={(e) => {
                      setAllocations({
                        ...allocations,
                        [p.id]: e.target.checked
                          ? (
                              Math.min(
                                available,
                                Math.max(
                                  0,
                                  Number(amount) * 100 -
                                    Object.entries(allocations)
                                      .filter(([id]) => id !== p.id)
                                      .reduce(
                                        (sum, [, v]) =>
                                          sum + Math.round(Number(v) * 100),
                                        0,
                                      ),
                                ),
                              ) / 100
                            ).toFixed(2)
                          : "",
                      });
                      setCreditConfirmed(false);
                      setConfirmCredit(false);
                    }}
                  />
                  <div>
                    <strong>
                      {String(
                        t.campaigns.find((c) => c.id === p.campaign_id)?.name,
                      )}{" "}
                      · {String(p.pledged_on)}
                    </strong>
                    <small style={{ display: "block" }}>
                      ID {p.id} · Open {currency(balance(data, p))} · On plan{" "}
                      {currency(scheduled(data, p.id))}
                    </small>
                    <span>{String(p.description ?? "")}</span>
                  </div>
                  <input
                    aria-label={`Allocation ${p.id}`}
                    type="number"
                    min="0"
                    max={available / 100}
                    step="0.01"
                    disabled={available <= 0 || status !== "processed"}
                    value={allocations[p.id] ?? ""}
                    placeholder="0.00"
                    onChange={(e) => {
                      setAllocations({
                        ...allocations,
                        [p.id]: e.target.value,
                      });
                      setCreditConfirmed(false);
                      setConfirmCredit(false);
                    }}
                  />
                </div>
              );
            })}
            {!open.length && (
              <p>No open pledges. This payment will remain donor credit.</p>
            )}
            {confirmCredit && (
              <div className="notice" role="alert">
                <strong>This donor has open pledges.</strong>
                <p>
                  Keep this payment as donor credit without applying it to any
                  pledge?
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={creditConfirmed}
                    onChange={(e) => setCreditConfirmed(e.target.checked)}
                  />
                  I confirm: do not apply this payment to any pledge.
                </label>
                <p>
                  Press {method === "external_card" ? "Charge" : "Save payment"}{" "}
                  again to continue.
                </p>
              </div>
            )}
          </section>
        )}
        <section className="donation-section">
          <h3>Payment details</h3>
          <div className="form-grid">
            <label>
              Payment method *
              <select
                aria-label="Payment method"
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  if (e.target.value === "external_card")
                    setStatus("processed");
                }}
              >
                <option value="external_card">Credit card</option>
                <option value="charity_card">
                  Charity card (manual; integration pending)
                </option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="zelle">Zelle</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
            {method !== "external_card" && (
              <label>
                Status
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setAllocations({});
                    setCreditConfirmed(false);
                  }}
                >
                  <option value="processed">Received / processed</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
            )}
            {method !== "external_card" && (
              <label>
                Reference / check number
                <input
                  name="reference"
                  maxLength={200}
                  required={method === "charity_card"}
                />
              </label>
            )}
            <label>
              Collector
              <input name="collector" maxLength={200} />
            </label>
          </div>
          {method === "external_card" ? (
            <InlineCardPayment
              organization={data.organization.id}
              donor={donor}
              amount={amount}
              demo={demo}
              onRecorded={onRecorded}
              onBusy={setBusy}
              beforeSubmit={() => {
                setError("");
                try {
                  if (!formRef.current?.reportValidity()) return null;
                  const chosen = Object.entries(allocations)
                    .filter(([, v]) => Number(v) > 0)
                    .map(([pledge_id, v]) => ({
                      pledge_id,
                      amount_minor: cents(v),
                    }));
                  if (
                    chosen.reduce((sum, a) => sum + a.amount_minor, 0) >
                    cents(amount)
                  )
                    throw new Error("Allocations exceed the payment amount.");
                  if (open.length && !chosen.length && !creditConfirmed) {
                    setConfirmCredit(true);
                    return null;
                  }
                  const f = new FormData(formRef.current);
                  return {
                    organization: data.organization.id,
                    allocations: chosen,
                    donation: {
                      campaign_id: f.get("campaign_id"),
                      fundraiser_id: f.get("fundraiser_id") || null,
                      sponsorship_id: f.get("sponsorship_id") || null,
                      event_id: f.get("event_id") || null,
                      description: String(f.get("description") || ""),
                      collector: String(f.get("collector") || ""),
                      credit_confirmed: creditConfirmed,
                    },
                  };
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Check donation details.",
                  );
                  return null;
                }
              }}
            />
          ) : (
            <p className="muted">
              This method records a payment already received. No transfer or
              card charge is initiated.
            </p>
          )}
        </section>
        <div className="form-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {method !== "external_card" && (
            <button disabled={busy}>{busy ? "Saving…" : "Save payment"}</button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
