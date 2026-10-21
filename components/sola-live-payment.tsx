"use client";
import Script from "next/script";
import {
  CreditCard,
  LockKeyhole,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { CardBrands, cardBrand, type CardBrand } from "./card-brands";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IFIELDS_BASE } from "@/lib/sola/ifields";
export type CardDonationContext = {
  organization: string;
  donation?: Record<string, unknown>;
  allocations?: { pledge_id: string; amount_minor: number }[];
};
type Result = {
  state: string;
  reference?: string;
  payment?: string;
  error?: string;
  allocation_review?: boolean;
  card_saved?: boolean;
  save_error?: boolean;
};
type SavedCard = { id: string; brand: string; last4: string; expiry: string };
type Embedded = {
  donor: string;
  amount: string;
  beforeSubmit: () => CardDonationContext | null;
  onRecorded: () => Promise<void>;
  onBusy?: (busy: boolean) => void;
};
export function SolaLivePayment({
  ifieldsKey,
  donors,
  limit,
  vaultEnabled = false,
  embedded,
  mode = "charge",
}: {
  ifieldsKey: string;
  donors: { id: string; name: string }[];
  limit: number;
  vaultEnabled?: boolean;
  embedded?: Embedded;
  mode?: "charge" | "save";
}) {
  const saving = mode === "save",
    endpoint = saving ? "/api/sola/cards" : "/api/sola/payments",
    storageKey = saving
      ? "cedar-olive-card-save-attempt"
      : "cedar-olive-live-card-attempt";
  const card = useRef<HTMLInputElement>(null),
    cvv = useRef<HTMLInputElement>(null),
    fieldError = useRef<HTMLLabelElement>(null),
    pending = useRef(false),
    alive = useRef(true);
  const [brand, setBrand] = useState<CardBrand>("");
  const [numberStatus, setNumberStatus] = useState<
    "empty" | "incomplete" | "valid" | "invalid"
  >("empty");
  const brandCallbackRegistered = useRef(false);
  const styleFields = () => {
    const style = {
      "font-family": "Arial, sans-serif",
      "font-size": "16px",
      color: "#292638",
      border: "none",
      outline: "none",
      padding: "0 14px",
      width: "100%",
      height: "42px",
      "box-sizing": "border-box",
      background: "transparent",
    };
    window.setIfieldStyle?.("card-number", style);
    window.setIfieldStyle?.("cvv", style);
  };
  const [sdk, setSdk] = useState(false),
    [sdkError, setSdkError] = useState(false),
    [localDonor, setDonor] = useState(""),
    [localAmount, setAmount] = useState(""),
    [expiry, setExpiry] = useState(""),
    [zip, setZip] = useState("");
  const [consent, setConsent] = useState(false),
    [saveCard, setSaveCard] = useState(false),
    [key, setKey] = useState(""),
    [stage, setStage] = useState("checking"),
    [result, setResult] = useState<Result | null>(null);
  const [cards, setCards] = useState<SavedCard[]>([]),
    [selected, setSelected] = useState("new"),
    [cardsError, setCardsError] = useState("");
  const donor = embedded?.donor ?? localDonor,
    amount = embedded?.amount ?? localAmount;
  const clearTokens = () => {
    if (card.current) card.current.value = "";
    if (cvv.current) cvv.current.value = "";
    if (fieldError.current) fieldError.current.textContent = "";
  };
  const check = async (requestKey: string) => {
    setStage("checking");
    try {
      const r = await fetch(
        `${endpoint}?request_key=${encodeURIComponent(requestKey)}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error();
      const data = await r.json();
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
          error: `Unable to check the previous ${saving ? "card save" : "payment"}. Do not submit again; check status or the Sola portal.`,
        });
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    try {
      const stored = sessionStorage.getItem(storageKey),
        requestKey =
          stored && /^[a-f0-9-]{36}$/i.test(stored)
            ? stored
            : crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestKey);
      setKey(requestKey);
      void check(requestKey);
    } catch {
      setResult({
        state: "unknown",
        error: "Enable browser session storage before continuing.",
      });
      setStage("result");
    }
    return () => {
      alive.current = false;
      clearTokens();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setCards([]);
    setSelected("new");
    setCardsError("");
    if (!vaultEnabled || !donor || saving) return;
    fetch(`/api/sola/cards?donor=${encodeURIComponent(donor)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const body = await r.json();
        if (active) setCards(body.cards ?? []);
      })
      .catch(() => {
        if (active)
          setCardsError(
            "Saved cards could not be loaded. You can enter a new card.",
          );
      });
    return () => {
      active = false;
    };
  }, [donor, vaultEnabled, saving]);
  const init = () => {
    if (!window.setAccount || !window.getTokens) {
      setSdkError(true);
      return;
    }
    try {
      window.setAccount(ifieldsKey, "Cedar & Olive", "0.1.0");
      styleFields();
      (window.enableAutoFormatting ?? window.enableAutoFormat)?.(" ");
      if (
        !brandCallbackRegistered.current &&
        window.addIfieldKeyPressCallback
      ) {
        window.addIfieldKeyPressCallback((data) => {
          // Only the allow-listed issuer name is consumed; never retain payloads.
          if (alive.current) {
            setBrand(cardBrand(data?.issuer));
            if (
              typeof data?.cardNumberIsValid === "boolean" &&
              typeof data.cardNumberFormattedLength === "number"
            ) {
              setNumberStatus(
                data.cardNumberFormattedLength === 0
                  ? "empty"
                  : data.cardNumberIsValid
                    ? "valid"
                    : data.cardNumberFormattedLength < 12
                      ? "incomplete"
                      : "invalid",
              );
            }
          }
        });
        brandCallbackRegistered.current = true;
      }
      setSdk(true);
    } catch {
      setSdkError(true);
    }
  };
  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (
      pending.current ||
      stage !== "entry" ||
      !key ||
      !donor ||
      !consent ||
      (selected === "new" &&
        (!sdk || numberStatus === "invalid" || numberStatus === "incomplete"))
    )
      return;
    if (!saving && !/^\d{1,9}(\.\d{1,2})?$/.test(amount)) return;
    const [whole, part = ""] = amount.split("."),
      minor = Number(whole || 0) * 100 + Number(part.padEnd(2, "0"));
    if (!saving && (minor < 1 || minor > limit)) {
      setResult({
        state: "not_started",
        error: `Enter an amount between $0.01 and $${(limit / 100).toFixed(2)}.`,
      });
      return;
    }
    if (
      selected === "new" &&
      (!/^(0[1-9]|1[0-2])\d{2}$/.test(expiry) ||
        (zip && !/^\d{5}(?:-\d{4})?$/.test(zip)))
    ) {
      setResult({
        state: "not_started",
        error: "Enter expiration as MMYY and a valid ZIP code, if supplied.",
      });
      return;
    }
    const context = embedded?.beforeSubmit();
    if (embedded && !context) return;
    pending.current = true;
    embedded?.onBusy?.(true);
    setStage("submitting");
    setResult(null);
    clearTokens();
    let cardToken = "",
      cvvToken = "";
    if (selected === "new") {
      try {
        await new Promise<void>((resolve, reject) =>
          window.getTokens!(resolve, () => reject(new Error()), 30000),
        );
      } catch {
        clearTokens();
        pending.current = false;
        embedded?.onBusy?.(false);
        if (alive.current) {
          setStage("entry");
          setResult({
            state: "not_started",
            error:
              "Secure fields did not complete. No provider request was submitted.",
          });
        }
        return;
      }
      cardToken = card.current?.value ?? "";
      cvvToken = cvv.current?.value ?? "";
      clearTokens();
    }
    if (!alive.current) {
      pending.current = false;
      embedded?.onBusy?.(false);
      return;
    }
    try {
      const body = saving
        ? {
            organization: context?.organization,
            donor,
            request_key: key,
            card_token: cardToken,
            cvv_token: cvvToken,
            expiry,
            ...(zip ? { zip } : {}),
            save_consent: true,
          }
        : {
            donor,
            amount_minor: minor,
            request_key: key,
            consent: true,
            ...(context ?? {}),
            ...(selected !== "new"
              ? { saved_card: selected }
              : {
                  card_token: cardToken,
                  cvv_token: cvvToken,
                  expiry,
                  ...(zip ? { zip } : {}),
                  ...(saveCard ? { save_card: true, save_consent: true } : {}),
                }),
          };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        if (data.state) void embedded?.onRecorded().catch(() => {});
      }
    } catch {
      if (alive.current) {
        setStage("result");
        setResult({
          state: "unknown",
          error: saving
            ? "Connection lost. Check the card-save status before trying again. No charge was requested."
            : "Connection lost. The card may have been charged. Check status; do not submit again.",
        });
      }
    } finally {
      cardToken = "";
      cvvToken = "";
      pending.current = false;
      embedded?.onBusy?.(false);
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
    setNumberStatus("empty");
    setBrand("");
    setExpiry("");
    setZip("");
    setConsent(false);
    setSaveCard(false);
    setSelected("new");
    setResult(null);
    setStage("entry");
    clearTokens();
  };
  const FormTag = embedded ? "div" : "form";
  return (
    <section className="sola-inline-card">
      <p className="notice">
        <strong>
          {saving ? "Save card securely — no charge." : "LIVE card payment."}
        </strong>
        {!saving && (
          <>
            {" "}
            The Charge button charges a real card. Limit:{" "}
            {(limit / 100).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}{" "}
            per payment.
          </>
        )}{" "}
        No automatic or recurring payment is authorized.
      </p>
      {sdkError && (
        <p role="alert">
          Secure fields could not load. Check the iFields key, allowed domain
          and connectivity.
        </p>
      )}
      {cardsError && <p role="alert">{cardsError}</p>}
      {stage !== "result" && (
        <FormTag
          {...(!embedded ? { onSubmit: submit, method: "post" } : {})}
          autoComplete="off"
        >
          <fieldset
            disabled={stage !== "entry" || pending.current}
            style={{ border: 0, padding: 0 }}
          >
            {!embedded && (
              <>
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
              </>
            )}
            {!saving && cards.length > 0 && (
              <label>
                Card to use
                <select
                  aria-label="Card to use"
                  value={selected}
                  onChange={(e) => {
                    setNumberStatus("empty");
                    setBrand("");
                    setSelected(e.target.value);
                    setConsent(false);
                    setSaveCard(false);
                    setSdk(false);
                    clearTokens();
                  }}
                >
                  <option value="new">Enter a new card</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.brand} •••• {c.last4} · {c.expiry.slice(0, 2)}/
                      {c.expiry.slice(2)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected === "new" ? (
              <>
                <Script
                  key={key}
                  src={`${IFIELDS_BASE}/ifields.min.js`}
                  strategy="afterInteractive"
                  onReady={init}
                  onError={() => setSdkError(true)}
                />
                <div className="card-entry-surface">
                  <div className="card-entry-heading">
                    <CardBrands active={brand} />
                    <span className="card-secure-label">
                      <LockKeyhole size={13} aria-hidden="true" /> Secure entry
                    </span>
                  </div>
                  <label htmlFor="live-sola-card" className="card-input-label">
                    Card number — securely hosted by Sola
                  </label>
                  <div
                    className={`card-number-shell card-number-${numberStatus}`}
                  >
                    <CreditCard size={23} aria-hidden="true" />
                    <iframe
                      id="live-sola-card"
                      inert={stage !== "entry"}
                      title="Secure card number"
                      data-ifields-id="card-number"
                      data-ifields-placeholder="0000  0000  0000  0000"
                      src={`${IFIELDS_BASE}/ifield.htm`}
                      className="sola-hosted-field"
                      onLoad={styleFields}
                    />
                  </div>
                  {numberStatus !== "empty" && (
                    <p
                      className={`card-number-feedback ${numberStatus}`}
                      role="status"
                    >
                      {numberStatus === "valid" ? (
                        <>
                          <CircleCheck size={14} aria-hidden="true" /> Card
                          number passes validation
                        </>
                      ) : numberStatus === "invalid" ? (
                        <>
                          <CircleAlert size={14} aria-hidden="true" /> Check the
                          card number
                        </>
                      ) : (
                        "Keep entering the card number…"
                      )}
                    </p>
                  )}
                  <div className="card-entry-details">
                    <label>
                      Expiration (MMYY)
                      <input
                        required
                        inputMode="numeric"
                        pattern="(0[1-9]|1[0-2])[0-9]{2}"
                        maxLength={4}
                        value={expiry}
                        onChange={(e) =>
                          setExpiry(e.target.value.replace(/\D/g, ""))
                        }
                        placeholder="MMYY"
                      />
                    </label>
                    <div className="card-cvv-field">
                      <label
                        htmlFor="live-sola-cvv"
                        className="card-input-label"
                      >
                        Security code (CVV)
                      </label>
                      <iframe
                        id="live-sola-cvv"
                        inert={stage !== "entry"}
                        title="Secure security code"
                        data-ifields-id="cvv"
                        data-ifields-placeholder="CVV"
                        src={`${IFIELDS_BASE}/ifield.htm`}
                        className="sola-hosted-field"
                        onLoad={styleFields}
                      />
                    </div>
                    <label>
                      ZIP code
                      <input
                        inputMode="numeric"
                        pattern="[0-9]{5}(-[0-9]{4})?"
                        maxLength={10}
                        value={zip}
                        onChange={(e) => setZip(e.target.value)}
                        placeholder="ZIP code"
                      />
                    </label>
                    {!saving && vaultEnabled && (
                      <label className="check-label card-save-option">
                        <input
                          type="checkbox"
                          checked={saveCard}
                          onChange={(e) => setSaveCard(e.target.checked)}
                        />{" "}
                        Save card to donor file
                      </label>
                    )}
                  </div>
                  {!saving && vaultEnabled && (
                    <p className="card-save-caption">
                      Save only with the cardholder’s permission for future
                      donations.
                    </p>
                  )}
                </div>
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
              </>
            ) : (
              <p>
                Using {cards.find((c) => c.id === selected)?.brand} ending{" "}
                {cards.find((c) => c.id === selected)?.last4}. No CVV is stored.
              </p>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              {saving
                ? "I have the cardholder’s permission to save this card to this donor’s file for future donations."
                : "I have the cardholder’s permission to charge this amount once."}
            </label>
            <button
              type={embedded ? "button" : "submit"}
              onClick={embedded ? submit : undefined}
              disabled={
                (selected === "new" &&
                  (!sdk ||
                    numberStatus === "invalid" ||
                    numberStatus === "incomplete")) ||
                !consent ||
                !donor ||
                stage !== "entry"
              }
            >
              {stage === "submitting"
                ? "Submitting — do not retry…"
                : saving
                  ? "Save card to donor file"
                  : `Charge ${Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
            </button>
          </fieldset>
        </FormTag>
      )}
      {stage === "checking" && (
        <p role="status">
          Checking the saved {saving ? "card-save" : "payment"} attempt…
        </p>
      )}
      {stage === "submitting" && (
        <p role="status">
          Submitting once. Do not refresh or start another attempt.
        </p>
      )}
      {key && (
        <p className="muted">
          {saving ? "Card-save attempt" : "Payment attempt / Sola invoice"}:{" "}
          <code>{key}</code>
        </p>
      )}
      {result && (
        <section role="status" aria-live="polite">
          <h2>
            {result.state === "approved"
              ? saving
                ? "Card saved to donor file"
                : "Payment approved and recorded"
              : result.state === "declined"
                ? "Card declined"
                : result.state === "not_started"
                  ? "Payment not submitted"
                  : saving
                    ? "Card save needs review — do not retry"
                    : "Payment needs review — do not retry"}
          </h2>
          {result.error && <p>{result.error}</p>}
          {result.reference && <p>Sola reference: {result.reference}</p>}
          {result.card_saved && !saving && (
            <p>Card saved to this donor’s file.</p>
          )}
          {result.save_error && (
            <p role="alert">
              Payment succeeded, but the card was not saved. Do not charge again
              to save it. Use Add card on the donor’s profile.
            </p>
          )}
          {result.allocation_review && (
            <p>
              Received money is recorded as donor credit. Pledge allocations
              need review.
            </p>
          )}
          {result.state === "approved" && !embedded && !saving && (
            <Link href="/dashboard?page=payments">
              Open payments and receipt →
            </Link>
          )}
          {stage === "result" && (
            <button type="button" onClick={() => void check(key)}>
              Check saved status
            </button>
          )}
          {["approved", "declined"].includes(result.state) && (
            <button type="button" onClick={reset}>
              {saving ? "Add another card" : "Start another payment"}
            </button>
          )}
        </section>
      )}
      <p className="muted">
        Card numbers and CVV stay in Sola-hosted fields. Only encrypted provider
        tokens and masked card details are saved with permission. Uncertain
        responses are never retried automatically.
      </p>
    </section>
  );
}
