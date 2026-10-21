"use client";
import { useEffect, useState } from "react";
import { SolaLivePayment, type CardDonationContext } from "./sola-live-payment";
type Config = {
  enabled: boolean;
  ifields_key?: string;
  limit?: number;
  vault_enabled?: boolean;
  connect?: boolean;
  error?: string;
};
export function InlineCardPayment({
  organization,
  donor,
  amount,
  demo,
  beforeSubmit,
  onRecorded,
  onBusy,
  mode = "charge",
}: {
  organization: string;
  donor: string;
  amount: string;
  demo: boolean;
  beforeSubmit: () => CardDonationContext | null;
  onRecorded: () => Promise<void>;
  onBusy?: (busy: boolean) => void;
  mode?: "charge" | "save";
}) {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [connecting, setConnecting] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (demo) return;
    let alive = true;
    setConfig(null);
    setError("");
    fetch(`/api/sola/config?organization=${encodeURIComponent(organization)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json();
        if (alive) setConfig(body);
      })
      .catch(() => {
        if (alive) setError("Secure card settings could not be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [organization, demo, version]);
  if (demo)
    return (
      <div className="notice">
        <strong>Sample workspace.</strong>
        <p>
          Credit-card fields appear here in the live workspace. Real card entry
          and saving are disabled in sample mode.
        </p>
        <div className="sola-hosted-field sample-card-field">
          Sola secure card number · •••• •••• •••• ••••
        </div>
        <p>Expiration · CVV · ZIP code · Save card to donor file</p>
      </div>
    );
  if (error)
    return (
      <p role="alert">
        {error}{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => setVersion(version + 1)}
        >
          Retry setup check
        </button>
      </p>
    );
  if (!config) return <p role="status">Loading secure card entry…</p>;
  if (!config.enabled)
    return (
      <div className="notice">
        <p>{config.error ?? "Secure card processing needs setup."}</p>
        {config.connect && (
          <button
            type="button"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              try {
                const r = await fetch("/api/sola/merchant", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ organization }),
                });
                if (!r.ok) throw new Error();
                setVersion(version + 1);
              } catch {
                setError("This organization could not be connected to Sola.");
              } finally {
                setConnecting(false);
              }
            }}
          >
            {connecting ? "Connecting…" : "Connect this organization to Sola"}
          </button>
        )}
      </div>
    );
  if (mode === "save" && !config.vault_enabled)
    return (
      <p className="notice">
        Secure card saving needs the private vault setting. No card has been
        submitted.
      </p>
    );
  return (
    <SolaLivePayment
      ifieldsKey={config.ifields_key!}
      donors={[]}
      limit={config.limit!}
      vaultEnabled={config.vault_enabled}
      mode={mode}
      embedded={{ donor, amount, beforeSubmit, onRecorded, onBusy }}
    />
  );
}
