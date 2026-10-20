"use client";
import { useState } from "react";
export function SolaMerchantConnect({
  organizations,
}: {
  organizations: { id: string; name: string }[];
}) {
  const [org, setOrg] = useState(
    organizations.length === 1 ? organizations[0].id : "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await fetch("/api/sola/merchant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organization: org }),
          });
          if (!r.ok) {
            const data = await r.json();
            throw new Error(data.error ?? "Connection failed.");
          }
          window.location.reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Connection failed.");
          setBusy(false);
        }
      }}
    >
      <h2>Connect your synagogue organization</h2>
      <p>
        This binds the Sola merchant credentials already in deployment settings
        to one organization. It does not submit a charge.
      </p>
      <label>
        Organization
        <select required value={org} onChange={(e) => setOrg(e.target.value)}>
          <option value="">Select your organization</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={!org || busy}>
        {busy ? "Connecting…" : "Connect this organization to Sola"}
      </button>
    </form>
  );
}
