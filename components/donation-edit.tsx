"use client";
import { useState } from "react";
import {
  cents,
  type Command,
  type Row,
  type WorkspaceData,
} from "@/lib/workspace/domain";
export function DonationEdit({
  data,
  kind,
  row,
  onSave,
  onClose,
}: {
  data: WorkspaceData;
  kind: string;
  row: Row;
  onSave: (c: Command) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = data.tables;
  const locked =
    kind === "pledges" &&
    (t.payment_allocations.some((x) => x.pledge_id === row.id) ||
      t.schedules.some(
        (x) =>
          x.pledge_id === row.id &&
          ["active", "paused"].includes(String(x.status)),
      ) ||
      t.pledge_recognitions.some((x) => x.pledge_id === row.id));
  const select = (
    key: string,
    label: string,
    table: string,
    required = false,
  ) => (
    <label>
      {label}
      <select
        name={key}
        defaultValue={String(row[key] ?? "")}
        required={required}
        disabled={key === "campaign_id" && locked}
      >
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
      className="record-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          const f = new FormData(e.currentTarget);
          const attributes: Record<string, unknown> = Object.fromEntries(
            f.entries(),
          );
          if (kind === "pledges") {
            attributes.amount_minor = locked
              ? row.amount_minor
              : cents(f.get("amount"));
            attributes.campaign_id = locked
              ? row.campaign_id
              : f.get("campaign_id");
            attributes.pledged_on = locked
              ? row.pledged_on
              : f.get("pledged_on");
            attributes.receipt_requested = f.get("receipt_requested") === "on";
          }
          await onSave({
            type: "donation_edit",
            values: { kind, record_id: row.id, attributes },
          });
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Unable to edit");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        ID {row.id} ·{" "}
        {String(t.donors.find((d) => d.id === row.donor_id)?.name)}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {kind === "payments" && (
        <p className="notice">
          Payment amount, donor, date, method and processor reference remain
          protected. Existing receipt snapshots are retained.
        </p>
      )}
      {locked && (
        <p className="notice">
          Amount, campaign and pledge date are locked because this pledge has
          payments, a plan or accounting recognition.
        </p>
      )}
      <div className="form-grid">
        {kind === "pledges" && (
          <>
            <label>
              Pledge amount (USD)
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0.01"
                required
                disabled={locked}
                defaultValue={Number(row.amount_minor) / 100}
              />
            </label>
            {select("campaign_id", "Campaign", "campaigns", true)}
            <label>
              Pledge date
              <input
                type="date"
                name="pledged_on"
                required
                disabled={locked}
                defaultValue={String(row.pledged_on)}
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                name="due_date"
                required
                defaultValue={String(row.due_date)}
              />
            </label>
            <label className="check-label">
              <input
                name="receipt_requested"
                type="checkbox"
                defaultChecked={Boolean(row.receipt_requested)}
              />
              Receipt requested
            </label>
          </>
        )}
        {select("fundraiser_id", "Fundraiser", "fundraisers")}
        {select("sponsorship_id", "Sponsorship", "sponsorships")}
        {select("event_id", "Event", "events")}
        {kind === "payments" && (
          <label>
            Collector
            <input
              name="collector"
              defaultValue={String(row.collector ?? "")}
              maxLength={200}
            />
          </label>
        )}
        <label className="wide-field">
          Donor-visible description
          <textarea
            name="description"
            defaultValue={String(row.description ?? "")}
            maxLength={10000}
            rows={4}
          />
        </label>
      </div>
      <div className="form-footer">
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
