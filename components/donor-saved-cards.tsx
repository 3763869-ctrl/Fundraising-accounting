"use client";
import { useEffect, useState } from "react";
import { InlineCardPayment } from "./inline-card-payment";
type Card = {
  id: string;
  brand: string;
  last4: string;
  expiry: string;
  consent_at: string;
};
export function DonorSavedCards({
  organization,
  donor,
  demo,
}: {
  organization: string;
  donor: string;
  demo: boolean;
}) {
  const [cards, setCards] = useState<Card[]>([]),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = async () => {
    if (demo) {
      setLoading(false);
      return;
    }
    const r = await fetch(
      `/api/sola/cards?donor=${encodeURIComponent(donor)}`,
      { cache: "no-store" },
    );
    if (!r.ok)
      throw new Error(
        "Saved-card access requires the verified Sola merchant owner and a connected organization.",
      );
    const body = await r.json();
    setCards(body.cards ?? []);
  };
  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [donor, demo]);
  return (
    <section className="donation-section">
      <h3>Saved credit cards</h3>
      <p className="muted">
        Cards are held by Sola. This file shows masked details; CVV is never
        saved.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && <p>Loading saved cards…</p>}
      {!loading && !cards.length && <p>No saved cards.</p>}
      {cards.map((c) => (
        <div className="detail-list-row" key={c.id}>
          <span>
            {c.brand} •••• {c.last4} · Expires {c.expiry.slice(0, 2)}/
            {c.expiry.slice(2)}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Remove the saved card ending ${c.last4}? Pending payments are retained.`,
                )
              )
                return;
              setBusy(true);
              setError("");
              try {
                const r = await fetch("/api/sola/cards", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ method: c.id }),
                });
                if (!r.ok) throw new Error("Card could not be removed.");
                await load();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to remove card.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {!adding && (
        <button
          type="button"
          className="secondary"
          onClick={() => setAdding(true)}
        >
          Add card to donor file
        </button>
      )}
      {adding && (
        <div>
          <button
            type="button"
            className="text-button"
            onClick={() => setAdding(false)}
          >
            Close card entry
          </button>
          <InlineCardPayment
            organization={organization}
            donor={donor}
            amount=""
            demo={demo}
            mode="save"
            beforeSubmit={() => ({ organization })}
            onRecorded={load}
          />
        </div>
      )}
    </section>
  );
}
