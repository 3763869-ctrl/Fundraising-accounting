"use client";
import { useState } from "react";
import {
  cents,
  type Command,
  type WorkspaceData,
} from "@/lib/workspace/domain";

export function OperationsForm({
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = (
    name: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label>
      {label}
      <input
        name={name}
        aria-label={label}
        type={type}
        required={required}
        maxLength={254}
      />
    </label>
  );
  const choices = (name: string, label: string, items: string[]) => (
    <label>
      {label}
      <select name={name} aria-label={label}>
        {items.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      v: Record<string, unknown> = Object.fromEntries(f.entries());
    try {
      let command: Command;
      if (kind === "invite")
        command = {
          type: "invite",
          values: { invite_email: v.email, invite_role: v.role },
        };
      else if (kind === "member_role")
        command = {
          type: "member_role",
          values: { member: preset.member, new_role: v.role },
        };
      else {
        if (kind === "custom_field_definitions")
          v.required = f.get("required") === "on";
        if (kind === "automation_rules") {
          v.event = "payment_failed";
          v.action = "create_task";
          v.active = true;
          v.min_amount_minor = Number(v.minimum) === 0 ? 0 : cents(v.minimum);
          delete v.minimum;
        }
        if (kind === "devices" || kind === "gateway_accounts")
          v.status = "setup_required";
        if (kind === "notification_preferences") {
          for (const key of [
            "daily_summary",
            "failed_payment_notices",
            "receipt_default",
          ])
            v[key] = f.get(key) === "on";
          v.schedule_hour = Number(v.schedule_hour);
          v.retry_limit = Number(v.retry_limit);
        }
        command = { type: "insert", table: kind, values: v };
      }
      await onSave(command);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="record-form" onSubmit={submit}>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {["devices", "gateway_accounts", "notification_preferences"].includes(
        kind,
      ) && (
        <p className="notice">
          Saves setup information only. Devices, provider processing, scheduled
          collections, retries, and email/SMS delivery are not connected.
        </p>
      )}
      {kind === "invite" && (
        <p className="notice">
          Creates a single-use invitation valid for seven days. Copy the link
          and share it yourself; this action sends no email. The invitee must
          verify the invited email address.
        </p>
      )}
      {kind === "automation_rules" && (
        <p className="notice">
          Supported automation: when a failed payment record meets the minimum
          amount, create a high-priority donor task due tomorrow. It runs in the
          database transaction and logs its result. External actions and
          processing-fee rules require provider settlement integration.
        </p>
      )}
      <div className="form-grid">
        {kind === "invite" && (
          <>
            {input("email", "Invite email", "email")}
            {choices(
              "role",
              "Role",
              data.role === "owner"
                ? ["fundraiser", "accountant", "viewer", "admin"]
                : ["fundraiser", "accountant", "viewer"],
            )}
          </>
        )}
        {kind === "member_role" &&
          choices("role", "New role", [
            "viewer",
            "fundraiser",
            "accountant",
            "admin",
            "owner",
          ])}
        {!["invite", "member_role"].includes(kind) && input("name", "Name")}
        {kind === "custom_field_definitions" && (
          <>
            {input(
              "field_key",
              "Field key (lowercase letters, numbers, underscores)",
            )}
            {choices("field_type", "Field type", [
              "text",
              "number",
              "date",
              "boolean",
            ])}
            <label className="check-label">
              <input type="checkbox" name="required" />
              Required on donor forms
            </label>
          </>
        )}
        {kind === "automation_rules" && (
          <>
            {input("subject", "Follow-up task subject")}
            <label>
              Minimum payment (USD)
              <input
                name="minimum"
                aria-label="Minimum payment (USD)"
                type="number"
                step="0.01"
                min="0"
                defaultValue="0"
                required
              />
            </label>
          </>
        )}
        {kind === "devices" && (
          <>
            {input("serial", "Serial / device identifier")}
            {input("location", "Location", "text", false)}
            {input("provider", "Device provider", "text", false)}
          </>
        )}
        {kind === "gateway_accounts" && (
          <>
            {choices("provider", "Provider", [
              "Solo",
              "Matbeya",
              "OJZ",
              "Other",
            ])}
            {input(
              "merchant_reference",
              "Merchant reference (not a secret)",
              "text",
              false,
            )}
            {choices("environment", "Provider environment", [
              "sandbox",
              "production",
            ])}
          </>
        )}
        {kind === "document_templates" && (
          <>
            {choices("language", "Language", ["en", "he"])}
            <label className="wide-field">
              Acknowledgment text
              <textarea
                name="body"
                aria-label="Acknowledgment text"
                rows={7}
                maxLength={10000}
                required
              />
              <small>
                Plain text only. Placeholders:{" "}
                {"{{organization}}, {{donor}}, {{amount}}, {{date}}"}. New
                acknowledgments use the latest template for the donor’s
                language. Existing snapshots do not change.
              </small>
            </label>
          </>
        )}
        {kind === "notification_preferences" && (
          <>
            <label className="check-label">
              <input name="daily_summary" type="checkbox" />
              Daily summaries
            </label>
            <label className="check-label">
              <input
                name="failed_payment_notices"
                type="checkbox"
                defaultChecked
              />
              Failed-payment notices
            </label>
            <label className="check-label">
              <input name="receipt_default" type="checkbox" defaultChecked />
              Request receipts by default
            </label>
            <label>
              Schedule hour (organization timezone)
              <input
                name="schedule_hour"
                aria-label="Schedule hour"
                type="number"
                min="0"
                max="23"
                defaultValue="9"
                required
              />
            </label>
            <label>
              Retry limit
              <input
                name="retry_limit"
                aria-label="Retry limit"
                type="number"
                min="0"
                max="10"
                defaultValue="3"
                required
              />
            </label>
          </>
        )}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : kind === "invite"
              ? "Create invitation"
              : "Save settings"}
        </button>
      </footer>
    </form>
  );
}
