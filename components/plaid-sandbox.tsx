"use client";
import { useEffect, useState } from "react";
import { Landmark, RefreshCw, Unplug } from "lucide-react";
import { DataTable } from "./data-table";
import { currency } from "@/lib/workspace/domain";
type Row = {
  id: string;
  posted_on: string;
  name: string;
  amount_minor: number;
  pending: boolean;
};
type State = {
  enabled?: boolean;
  missing?: string[];
  error?: string;
  connection?: {
    id: string;
    institution_name: string;
    state: string;
    last_synced_at: string | null;
    error_code: string | null;
  };
  transactions?: Row[];
};
export function PlaidSandbox({
  organization,
  demo,
}: {
  organization: string;
  demo: boolean;
}) {
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (demo) return;
    let active = true;
    setData(null);
    fetch(
      `/api/plaid/sandbox?organization=${encodeURIComponent(organization)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        const b = await r.json();
        if (active) setData(b);
      })
      .catch(() => {
        if (active) setError("Bank test settings could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [organization, demo, version]);
  const act = async (action: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/plaid/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization, action }),
      });
      const b = await r.json();
      if (b.error) setError(b.error);
      else if (!r.ok) setError("The Sandbox operation did not complete.");
      else
        setNotice(
          action === "disconnect"
            ? "Sandbox connection removed."
            : `Saved Sandbox changes: ${b.added ?? 0} added, ${b.updated ?? 0} updated, ${b.removed ?? 0} removed.`,
        );
      setVersion((v) => v + 1);
    } catch {
      setError(
        "Connection interrupted. Refresh the saved bank status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const connected = data?.connection?.state === "connected";
  return (
    <section
      className="panel plaid-sandbox-panel"
      aria-label="Plaid Sandbox bank connection"
    >
      <div className="plaid-sandbox-heading">
        <div>
          <p className="eyebrow">Isolated bank testing</p>
          <h2>
            <Landmark size={20} /> Plaid Sandbox
          </h2>
        </div>
        <span className="environment-badge">TEST DATA</span>
      </div>
      <p>
        Connect a simulated Chase account and test transaction updates. These
        records stay separate from your live bank feed, donations,
        reconciliation, and accounting balances.
      </p>
      {demo ? (
        <p className="notice">
          Sign in to your organization to configure Plaid Sandbox. This browser
          sample workspace never calls Plaid.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {!data ? (
            <p role="status">Checking Plaid Sandbox settings…</p>
          ) : data.error ? (
            <p className="notice">{data.error}</p>
          ) : !data.enabled ? (
            <div className="notice">
              <strong>Secure setup required</strong>
              <ul>
                {data.missing?.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p>
                Add the requested server settings in Vercel. Do not enter
                credentials into this page.
              </p>
            </div>
          ) : (
            <>
              <div className="plaid-sandbox-actions">
                {!connected ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act("connect")}
                  >
                    {busy ? "Connecting…" : "Connect simulated Chase"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act("sync")}
                    >
                      <RefreshCw size={15} />
                      {busy ? "Syncing…" : "Sync Sandbox transactions"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void act("disconnect")}
                    >
                      <Unplug size={15} />
                      Disconnect Sandbox
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setVersion((v) => v + 1)}
                >
                  Refresh status
                </button>
              </div>
              {data.connection && (
                <p className="muted">
                  {data.connection.institution_name} · {data.connection.state}
                  {data.connection.last_synced_at
                    ? ` · Updated ${new Date(data.connection.last_synced_at).toLocaleString()}`
                    : ""}
                  {data.connection.error_code
                    ? ` · ${data.connection.error_code}`
                    : ""}
                </p>
              )}
              {connected && (
                <>
                  <p className="muted">
                    Latest 100 saved Sandbox transactions. A negative Plaid
                    amount is money received; a positive amount is money spent.
                    No accounting entry is created here.
                  </p>
                  <DataTable
                    name="Plaid Sandbox transactions"
                    storageKey={`plaid-sandbox-columns-${organization}`}
                    columns={[
                      { key: "date", label: "Date" },
                      { key: "name", label: "Description" },
                      { key: "amount", label: "Amount" },
                      { key: "direction", label: "Direction" },
                      { key: "status", label: "Status" },
                    ]}
                    rows={(data.transactions ?? []).map((t) => ({
                      id: t.id,
                      status: t.pending ? "Pending" : "Posted",
                      values: {
                        date: t.posted_on,
                        name: t.name,
                        amount: currency(Math.abs(Number(t.amount_minor))),
                        direction:
                          Number(t.amount_minor) < 0 ? "Received" : "Spent",
                        status: t.pending ? "Pending" : "Posted",
                      },
                    }))}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
