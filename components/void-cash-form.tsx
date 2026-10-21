"use client";
import { useState } from "react";
import {
  currency,
  today,
  type Command,
  type Row,
} from "@/lib/workspace/domain";
export function VoidCashForm({
  row,
  onSave,
  onClose,
}: {
  row: Row;
  onSave: (c: Command) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="record-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const f = new FormData(e.currentTarget);
          await onSave({
            type: "cash_void",
            values: {
              payment: row.id,
              dated: f.get("dated"),
              reason: f.get("reason"),
            },
          });
          onClose();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Unable to void cash payment.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        <strong>Void cash payment {currency(row.amount_minor)}</strong> · ID{" "}
        {row.id}
      </p>
      <p>
        The payment stays in history as Voided. Linked pledge balances and
        installments reopen, and existing receipts are marked void. No money is
        refunded or transferred.
      </p>
      {row.deposit_status === "deposited" && (
        <p className="notice">
          This cash is already marked deposited. The bank deposit and
          reconciliation stay unchanged. Its amount moves to cash suspense, and
          an accounting review task is created.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <label>
        Void date
        <input
          type="date"
          name="dated"
          required
          min={String(row.paid_on)}
          defaultValue={today()}
        />
      </label>
      <label>
        Reason for voiding
        <textarea name="reason" required maxLength={500} rows={3} />
      </label>
      <label className="check-label">
        <input type="checkbox" required />I confirm this cash payment should be
        voided.
      </label>
      <div className="form-footer">
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button className="danger-button" disabled={busy}>
          {busy ? "Voiding…" : "Void cash payment"}
        </button>
      </div>
    </form>
  );
}
