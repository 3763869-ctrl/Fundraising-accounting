"use client";
import Script from "next/script";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IFIELDS_BASE } from "@/lib/sola/ifields";

type Result = {
  state: string;
  reference?: string;
  payment?: string;
  error?: string;
  allocation_review?: boolean;
  already_submitted?: boolean;
};
const storageKey = "cedar-olive-live-card-attempt";
export function SolaLivePayment({
  ifieldsKey,
  donors,
  limit,
}: {
  ifieldsKey: string;
  donors: { id: string; name: string }[];
  limit: number;
}) {
  const card = useRef<HTMLInputElement>(null),
    cvv = useRef<HTMLInputElement>(null);
  const fieldError = useRef<HTMLLabelElement>(null);
  const pending = useRef(false),
    alive = useRef(true);
  const [sdk, setSdk] = useState(false),
    [sdkError, setSdkError] = useState(false);
  const [donor, setDonor] = useState(""),
    [amount, setAmount] = useState(""),
    [expiry, setExpiry] = useState("");
  const [consent, setConsent] = useState(false),
    [key, setKey] = useState("");
  const [stage, setStage] = useState("checking"),
    [result, setResult] = useState<Result | null>(null);
  const clearTokens = () => {
    if (card.current) card.current.value = "";
    if (cvv.current) cvv.current.value = "";
    if (fieldError.current) fieldError.current.textContent = "";
  };
  const check = async (requestKey: string) => {
    setStage("checking");
    try {
      const response = await fetch(
        `/api/sola/payments?request_key=${encodeURIComponent(requestKey)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!alive.current) return;
      if (data.state === "not_started") {
        setStage("entry");
        setResult(null);
      } else {
        setResult(data);
        setStage("result");
      }
    } catch {
      if (alive.current) {
        setStage("result");
        setResult({
          state: "unknown",
          error:
            "Unable to check the previous attempt. Do not submit another charge; check Sola or try checking status again.",
        });
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    try {
      const stored = sessionStorage.getItem(storageKey);
      const requestKey =
        stored && /^[a-f0-9-]{36}$/i.test(stored)
          ? stored
          : crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestKey);
      setKey(requestKey);
      void check(requestKey);
    } catch {
      setResult({
        state: "unknown",
        error: "Enable browser session storage before using card processing.",
      });
      setStage("result");
    }
    return () => {
      alive.current = false;
      clearTokens();
    };
  }, []); // Only the non-sensitive request UUID is retained across reloads.
  const init = () => {
    if (!window.setAccount || !window.getTokens) {
      setSdkError(true);
      return;
    }
    try {
      window.setAccount(ifieldsKey, "Cedar & Olive", "0.1.0");
      setSdk(true);
    } catch {
      setSdkError(true);
    }
  };
  const charge = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || stage !== "entry" || !sdk || !key) return;
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount)) return;
    const [whole, part = ""] = amount.split(".");
    const minor = Number(whole) * 100 + Number(part.padEnd(2, "0"));
    if (minor < 1 || minor > limit || !consent || !donor) return;
    pending.current = true;
    setStage("submitting");
    setResult(null);
    clearTokens();
    try {
      await new Promise<void>((resolve, reject) =>
        window.getTokens!(resolve, () => reject(new Error()), 30000),
      );
    } catch {
      clearTokens();
      pending.current = false;
      if (alive.current) {
        setStage("entry");
        setResult({
          state: "not_started",
          error:
            "Secure card entry did not complete. No payment request was submitted.",
        });
      }
      return;
    }
    const cardToken = card.current?.value ?? "",
      cvvToken = cvv.current?.value ?? "";
    clearTokens();
    if (!alive.current) {
      pending.current = false;
      return;
    }
    try {
      const response = await fetch("/api/sola/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donor,
          amount_minor: minor,
          expiry,
          request_key: key,
          card_token: cardToken,
          cvv_token: cvvToken,
          consent: true,
        }),
      });
      const data = await response.json();
      if (alive.current) {
        setResult(
          data.state
            ? data
            : {
                state: "unknown",
                error: data.error ?? "Check the saved attempt before retrying.",
              },
        );
        setStage("result");
      }
    } catch {
      if (alive.current) {
        setResult({
          state: "unknown",
          error:
            "Connection lost. The card may have been charged. Check status; do not submit again.",
        });
        setStage("result");
      }
    } finally {
      pending.current = false;
    }
  };
  const reset = () => {
    if (!result || !["approved", "declined"].includes(result.state)) return;
    const requestKey = crypto.randomUUID();
    try {
      sessionStorage.setItem(storageKey, requestKey);
    } catch {
      return;
    }
    setKey(requestKey);
    setSdk(false);
    setExpiry("");
    setConsent(false);
    setResult(null);
    setStage("entry");
    clearTokens();
  };
  return (
    <section>
      <p className="notice">
        <strong>LIVE card payment.</strong> The Charge button charges a real
        card. Initial limit:{" "}
        {(limit / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })}{" "}
        per payment. No recurring payment or stored card will be created.
      </p>
      <p>
        Unallocated funds become donor credit. After approval, open the payment
        to allocate it to pledges and generate a receipt.
      </p>
      {sdkError && (
        <p role="alert">
          Sola secure fields could not load. Check the iFields key, allowed
          domain and connectivity.
        </p>
      )}
      {stage !== "result" && (
        <>
          <Script
            src={`${IFIELDS_BASE}/ifields.min.js`}
            strategy="afterInteractive"
            onReady={init}
            onError={() => setSdkError(true)}
          />
          <form onSubmit={charge} method="post" autoComplete="off">
            <fieldset
              disabled={stage !== "entry" || pending.current}
              style={{ border: 0, padding: 0 }}
            >
              <label>
                Donor
                <select
                  aria-label="Donor"
                  required
                  value={donor}
                  onChange={(e) => setDonor(e.target.value)}
                >
                  <option value="">Select donor</option>
                  {donors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount (USD)
                <input
                  type="number"
                  min="0.01"
                  max={limit / 100}
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label htmlFor="live-sola-card">
                Card number — securely hosted by Sola
              </label>
              <iframe
                id="live-sola-card"
                inert={stage !== "entry"}
                title="Secure card number"
                data-ifields-id="card-number"
                data-ifields-placeholder="Card number"
                src={`${IFIELDS_BASE}/ifield.htm`}
                style={{
                  width: "100%",
                  height: 48,
                  border: "1px solid #c9d0c4",
                  borderRadius: 7,
                }}
              />
              <label>
                Expiration (MMYY)
                <input
                  required
                  inputMode="numeric"
                  pattern="(0[1-9]|1[0-2])[0-9]{2}"
                  maxLength={4}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="MMYY"
                />
              </label>
              <label htmlFor="live-sola-cvv">
                Security code — securely hosted by Sola
              </label>
              <iframe
                id="live-sola-cvv"
                inert={stage !== "entry"}
                title="Secure security code"
                data-ifields-id="cvv"
                data-ifields-placeholder="CVV"
                src={`${IFIELDS_BASE}/ifield.htm`}
                style={{
                  width: "100%",
                  height: 48,
                  border: "1px solid #c9d0c4",
                  borderRadius: 7,
                }}
              />
              <input
                type="hidden"
                name="xCardNum"
                data-ifields-id="card-number-token"
                ref={card}
              />
              <input
                type="hidden"
                name="xCVV"
                data-ifields-id="cvv-token"
                ref={cvv}
              />
              <div hidden>
                <label ref={fieldError} data-ifields-id="card-data-error" />
              </div>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ width: "auto" }}
                />{" "}
                I have the cardholder’s permission to charge this amount once.
              </label>
              <button
                type="submit"
                disabled={!sdk || !consent || !donor || stage !== "entry"}
              >
                {stage === "submitting"
                  ? "Submitting — do not retry…"
                  : `Charge ${Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
              </button>
            </fieldset>
          </form>
        </>
      )}
      {stage === "checking" && (
        <p role="status">Checking the saved payment attempt…</p>
      )}
      {stage === "submitting" && (
        <p role="status">
          Submitting once. Do not refresh or start another payment.
        </p>
      )}
      {key && (
        <p className="muted">
          Payment attempt / Sola invoice: <code>{key}</code>
        </p>
      )}
      {result && (
        <section role="status" aria-live="polite">
          <h2>
            {result.state === "approved"
              ? "Payment approved and recorded"
              : result.state === "declined"
                ? "Card declined"
                : result.state === "not_started"
                  ? "Payment not submitted"
                  : "Payment needs review — do not retry"}
          </h2>
          {result.error && <p>{result.error}</p>}
          {result.reference && <p>Sola reference: {result.reference}</p>}
          {result.allocation_review && (
            <p>
              The payment is recorded as donor credit. Its pledge allocations
              need review.
            </p>
          )}
          {result.state === "approved" && (
            <p>
              <Link href="/dashboard?page=payments">
                Open payments to allocate funds and create the receipt →
              </Link>
            </p>
          )}
          {stage === "result" && (
            <button type="button" onClick={() => void check(key)}>
              Check saved status
            </button>
          )}
          {["approved", "declined"].includes(result.state) && (
            <button type="button" onClick={reset}>
              Start another payment
            </button>
          )}
        </section>
      )}
      <p className="muted">
        A timeout, error or 3DS challenge is kept pending for review. No
        automatic retry, refund, void or recurring operation is supported.
      </p>
    </section>
  );
}
