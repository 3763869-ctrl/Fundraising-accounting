"use client";
import { useEffect, useRef, useState } from "react";
import {
  CreditCard,
  LockKeyhole,
  Eye,
  EyeOff,
  CircleCheck,
} from "lucide-react";
import {
  matbiaDigits,
  formatMatbiaCard,
  formatMatbiaExpiry,
  validMatbiaCard,
  validMatbiaExpiry,
} from "@/lib/matbia/card";
import {
  cents,
  today,
  type WorkspaceData,
  type Command,
} from "@/lib/workspace/domain";
import type { CardDonationContext } from "./sola-live-payment";
type Props = {
  data: WorkspaceData;
  demo: boolean;
  donor: string;
  amount: string;
  beforeSubmit: () => CardDonationContext | null;
  onSave: (c: Command) => Promise<void>;
  onRecorded: () => Promise<void>;
  onBusy: (b: boolean) => void;
};
export function MatbiaPayment(props: Props) {
  return props.demo ? (
    <MatbiaSimulation {...props} />
  ) : (
    <MatbiaLive {...props} />
  );
}
function MatbiaSimulation({
  data,
  donor,
  amount,
  beforeSubmit,
  onSave,
  onBusy,
}: Props) {
  const [, setVersion] = useState(0);
  const key = useRef(""),
    pending = useRef(false),
    [scenario, setScenario] = useState("approved"),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const previous = data.tables.payments
    .filter((p) => p.donor_id === donor && p.matbia_intent)
    .find((p) => ["sending", "unknown"].includes(String(p.matbia_state)));
  const current =
    data.tables.payments.find(
      (p) => p.idempotency_key === key.current && p.matbia_intent,
    ) ?? previous;
  const finish = async (outcome: string, requestKey: string) => {
    if (pending.current) return;
    key.current = requestKey;
    pending.current = true;
    onBusy(true);
    setError("");
    try {
      await onSave({
        type: "matbia_demo_finish",
        values: { request_key: requestKey, outcome },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to resolve test.");
    } finally {
      pending.current = false;
      onBusy(false);
    }
  };
  return (
    <section className="matbia-panel">
      <h3>Matbia · sample simulation</h3>
      <p className="notice">
        Synthetic sample records only. These controls simulate Matbia responses;
        they do not contact Matbia or charge a card. Real Matbia cards cannot be
        entered here.
      </p>
      {error && <p role="alert">{error}</p>}
      {current ? (
        <div role="status">
          <h3>
            {current.matbia_state === "approved"
              ? "Simulated Matbia payment approved"
              : current.matbia_state === "declined"
                ? "Simulated Matbia payment declined"
                : "Simulated payment needs review"}
          </h3>
          <p>
            {current.matbia_state === "approved"
              ? "Recorded once in your sample database."
              : current.matbia_state === "declined"
                ? "Pledge paid totals did not change."
                : "Payment stays pending; no pledge is marked paid and no automatic retry occurs."}
          </p>
          {Boolean(current.allocation_review) && (
            <p>Received money remains donor credit; allocations need review.</p>
          )}
          {["sending", "unknown"].includes(String(current.matbia_state)) ? (
            <>
              <button
                type="button"
                onClick={() =>
                  void finish("approved", String(current.idempotency_key))
                }
              >
                Simulate confirmed approval
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void finish("declined", String(current.idempotency_key))
                }
              >
                Simulate confirmed decline
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                key.current = "";
                setConsent(false);
                setScenario("approved");
                setVersion((v) => v + 1);
              }}
            >
              Start another Matbia test
            </button>
          )}
        </div>
      ) : (
        <>
          <label>
            Test outcome
            <select
              aria-label="Matbia test outcome"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              <option value="approved">Approved</option>
              <option value="declined">Declined / insufficient funds</option>
              <option value="unknown">Connection lost / unknown</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I want to run this simulated Matbia payment.
          </label>
          <button
            type="button"
            disabled={!donor || !consent}
            onClick={async () => {
              if (pending.current) return;
              const context = beforeSubmit();
              if (!context) return;
              pending.current = true;
              onBusy(true);
              setError("");
              try {
                if (!key.current) key.current = crypto.randomUUID();
                await onSave({
                  type: "matbia_demo_prepare",
                  values: {
                    ...context.donation,
                    donor_id: donor,
                    amount_minor: cents(amount),
                    paid_on: today(),
                    idempotency_key: key.current,
                    allocations: context.allocations ?? [],
                  },
                });
                await onSave({
                  type: "matbia_demo_finish",
                  values: { request_key: key.current, outcome: scenario },
                });
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Matbia simulation failed.",
                );
              } finally {
                pending.current = false;
                onBusy(false);
              }
            }}
          >
            Run Matbia test{" "}
            {(Number(amount) || 0).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </button>
        </>
      )}
    </section>
  );
}
type Config = {
  enabled: boolean;
  limit?: number;
  missing?: string[];
  error?: string;
  connect?: boolean;
};
type Result = {
  state: string;
  reference?: string;
  payment?: string;
  error?: string;
  allocation_review?: boolean;
};
function MatbiaLive({
  data,
  donor,
  amount,
  beforeSubmit,
  onRecorded,
  onBusy,
}: Props) {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [consent, setConsent] = useState(false),
    [stage, setStage] = useState("checking"),
    [result, setResult] = useState<Result | null>(null),
    [key, setKey] = useState(""),
    [cardState, setCardState] = useState("empty"),
    [expiryState, setExpiryState] = useState("empty"),
    [showNumber, setShowNumber] = useState(false),
    [connecting, setConnecting] = useState(false);
  const number = useRef<HTMLInputElement>(null),
    expiry = useRef<HTMLInputElement>(null),
    pending = useRef(false),
    alive = useRef(true),
    generation = useRef(0);
  const storageKey = `cedar-olive-matbia-attempt-${data.organization.id}`;
  const check = async (requestKey: string, run = generation.current) => {
    setStage("checking");
    try {
      const r = await fetch(
        `/api/matbia/payments?request_key=${encodeURIComponent(requestKey)}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (!alive.current || run !== generation.current) return;
      setResult(body.state === "not_started" ? null : body);
      setStage(body.state === "not_started" ? "entry" : "result");
    } catch {
      if (alive.current && run === generation.current) {
        setResult({
          state: "unknown",
          error:
            "Unable to check the prior Matbia payment. Do not submit another charge.",
        });
        setStage("result");
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    const run = ++generation.current;
    setCardState("empty");
    setExpiryState("empty");
    setShowNumber(false);
    setConsent(false);
    setError("");
    setConfig(null);
    fetch(
      `/api/matbia/config?organization=${encodeURIComponent(data.organization.id)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        const c = await r.json();
        if (!alive.current || run !== generation.current) return;
        setConfig(c);
        if (c.enabled) {
          try {
            const pendingAttempt = data.tables.payments.find(
              (p) =>
                p.provider === "matbia" &&
                p.status === "pending" &&
                p.donor_id === donor,
            );
            const saved =
                typeof pendingAttempt?.idempotency_key === "string"
                  ? pendingAttempt.idempotency_key
                  : sessionStorage.getItem(storageKey),
              requestKey =
                saved && /^[a-f0-9-]{36}$/i.test(saved)
                  ? saved
                  : crypto.randomUUID();
            sessionStorage.setItem(storageKey, requestKey);
            setKey(requestKey);
            void check(requestKey, run);
          } catch {
            setError("Enable session storage before processing payments.");
          }
        }
      })
      .catch(() => {
        if (alive.current && run === generation.current)
          setError("Matbia setup could not be checked.");
      });
    return () => {
      alive.current = false;
      if (number.current) number.current.value = "";
      if (expiry.current) expiry.current.value = "";
    };
  }, [data.organization.id, donor, version]);
  if (error)
    return (
      <section className="matbia-panel">
        <p role="alert">{error}</p>
        <button
          type="button"
          className="secondary"
          onClick={() => setVersion(version + 1)}
        >
          Check Matbia setup again
        </button>
      </section>
    );
  if (!config) return <p role="status">Checking Matbia setup…</p>;
  if (!config.enabled)
    return (
      <section className="matbia-panel">
        <h3>Matbia charity card</h3>
        <p className="notice">
          {config.error ?? "Matbia live payments are not activated yet."} No
          charge can be submitted.
        </p>
        {config.missing && (
          <ul>
            {config.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {config.connect && (
          <button
            type="button"
            disabled={connecting}
            onClick={async () => {
              if (connecting) return;
              setConnecting(true);
              try {
                const r = await fetch("/api/matbia/merchant", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ organization: data.organization.id }),
                });
                if (!r.ok) throw new Error();
                setVersion(version + 1);
              } catch {
                setError("Matbia could not be connected to this organization.");
              } finally {
                setConnecting(false);
              }
            }}
          >
            {connecting ? "Connecting…" : "Connect this organization to Matbia"}
          </button>
        )}
        <p>
          Sample testing is available under{" "}
          <a href="/demo?page=payments">
            Sample workspace → New payment → Charity card → Matbia
          </a>
          .
        </p>
      </section>
    );
  const reset = () => {
    if (!result || !["approved", "declined"].includes(result.state)) return;
    try {
      const next = crypto.randomUUID();
      sessionStorage.setItem(storageKey, next);
      setKey(next);
      setResult(null);
      setConsent(false);
      setCardState("empty");
      setExpiryState("empty");
      setShowNumber(false);
      setStage("entry");
    } catch {
      setError("Session storage is unavailable.");
    }
  };
  return (
    <section className="matbia-panel">
      <h3>Matbia charity card</h3>
      <p className="notice">
        <strong>Live Matbia payment.</strong> Limit{" "}
        {(Number(config.limit) / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })}
        . A deliberate payment submission charges the card once.
      </p>
      {stage === "entry" && (
        <>
          <div className="card-entry-surface matbia-entry">
            <div className="card-entry-heading">
              <span className="matbia-wordmark">
                MATBIA <small>Charity card</small>
              </span>
              <span className="card-secure-label">
                <LockKeyhole size={13} aria-hidden="true" /> One-time payment
              </span>
            </div>
            <label htmlFor="matbia-card-number">Matbia card number</label>
            <div
              className={`card-number-shell ${cardState === "invalid" ? "card-number-invalid" : cardState === "ready" ? "card-number-valid" : ""}`}
            >
              <CreditCard size={20} aria-hidden="true" />
              <input
                id="matbia-card-number"
                ref={number}
                type={showNumber ? "text" : "password"}
                inputMode="numeric"
                autoComplete="off"
                maxLength={19}
                minLength={16}
                pattern="[0-9 ]{16,19}"
                placeholder="8628 24•• •••• ••••"
                required
                aria-label="Matbia card number"
                aria-describedby="matbia-card-hint"
                aria-invalid={cardState === "invalid"}
                onInput={(e) => {
                  const input = e.currentTarget;
                  input.value = formatMatbiaCard(input.value);
                  const digits = matbiaDigits(input.value);
                  setCardState(
                    !digits
                      ? "empty"
                      : digits.length < 16
                        ? "incomplete"
                        : validMatbiaCard(digits)
                          ? "ready"
                          : "invalid",
                  );
                }}
              />
              <button
                type="button"
                className="matbia-show-number"
                aria-label={
                  showNumber
                    ? "Hide Matbia card number"
                    : "Show Matbia card number"
                }
                aria-pressed={showNumber}
                onClick={() => setShowNumber(!showNumber)}
              >
                {showNumber ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <p
              id="matbia-card-hint"
              className={`card-number-feedback ${cardState === "invalid" ? "invalid" : cardState === "ready" ? "valid" : ""}`}
              role="status"
            >
              {cardState === "invalid" ? (
                "Enter a 16-digit Matbia card number beginning with 862824."
              ) : cardState === "ready" ? (
                <>
                  <CircleCheck size={13} aria-hidden="true" />
                  Matbia card number entered
                </>
              ) : (
                "Type or paste the 16-digit number on the card."
              )}
            </p>
            <div className="matbia-expiry-row">
              <label htmlFor="matbia-expiry">
                Expiration (MM/YY)
                <input
                  id="matbia-expiry"
                  ref={expiry}
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="(0[1-9]|1[0-2])/[0-9]{2}"
                  maxLength={5}
                  placeholder="MM/YY"
                  required
                  aria-describedby="matbia-expiry-hint"
                  aria-invalid={expiryState === "invalid"}
                  onInput={(e) => {
                    const input = e.currentTarget;
                    input.value = formatMatbiaExpiry(input.value);
                    const digits = matbiaDigits(input.value);
                    setExpiryState(
                      !digits
                        ? "empty"
                        : digits.length < 4
                          ? "incomplete"
                          : validMatbiaExpiry(digits)
                            ? "ready"
                            : "invalid",
                    );
                  }}
                />
              </label>
              <p className="muted">
                No CVV needed.
                <br />
                Card details are not saved.
              </p>
            </div>
            {expiryState === "invalid" && (
              <p
                id="matbia-expiry-hint"
                className="card-number-feedback invalid"
                role="alert"
              >
                Check the month and year. The card must not be expired.
              </p>
            )}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I have permission to charge this Matbia card once.
          </label>
          <button
            type="button"
            disabled={
              !donor ||
              !consent ||
              cardState !== "ready" ||
              expiryState !== "ready"
            }
            onClick={async () => {
              if (pending.current) return;
              if (
                !validMatbiaCard(matbiaDigits(number.current?.value ?? "")) ||
                !validMatbiaExpiry(matbiaDigits(expiry.current?.value ?? ""))
              ) {
                setResult({
                  state: "not_started",
                  error: "Check the Matbia number and expiration.",
                });
                return;
              }
              const context = beforeSubmit();
              if (!context) return;
              let minor: number;
              try {
                minor = cents(amount);
                if (minor < 1 || minor > Number(config.limit))
                  throw new Error();
              } catch {
                setResult({
                  state: "not_started",
                  error: "Check the amount and payment limit.",
                });
                return;
              }
              let cardNumber = matbiaDigits(number.current?.value ?? ""),
                exp = matbiaDigits(expiry.current?.value ?? "");
              if (number.current) number.current.value = "";
              if (expiry.current) expiry.current.value = "";
              pending.current = true;
              onBusy(true);
              setStage("submitting");
              setResult(null);
              try {
                const r = await fetch("/api/matbia/payments", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...context,
                    donor,
                    amount_minor: minor,
                    request_key: key,
                    consent: true,
                    card_number: cardNumber,
                    expiry: exp,
                  }),
                });
                const body = await r.json();
                if (alive.current) {
                  setResult(
                    body.state
                      ? body
                      : {
                          state: "unknown",
                          error:
                            body.error ??
                            "Check saved status before another attempt.",
                        },
                  );
                  setStage("result");
                  if (body.state) void onRecorded().catch(() => {});
                }
              } catch {
                if (alive.current) {
                  setStage("result");
                  setResult({
                    state: "unknown",
                    error:
                      "Connection lost. Check the saved attempt and Matbia account. Do not charge again.",
                  });
                }
              } finally {
                cardNumber = "";
                exp = "";
                pending.current = false;
                onBusy(false);
              }
            }}
          >
            Pay with Matbia{" "}
            {(Number(amount) || 0).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </button>
        </>
      )}
      {stage === "checking" && (
        <p role="status">Checking saved Matbia attempt…</p>
      )}
      {stage === "submitting" && (
        <p role="status">Submitting once. Do not refresh or retry.</p>
      )}
      {result && (
        <div role="status">
          <h3>
            {result.state === "approved"
              ? "Matbia payment approved and recorded"
              : result.state === "declined"
                ? "Matbia card declined"
                : result.state === "not_started"
                  ? "Matbia payment not submitted"
                  : "Matbia payment needs review — do not retry"}
          </h3>
          {result.error && <p>{result.error}</p>}
          {result.reference && <p>Reference: {result.reference}</p>}
          {result.allocation_review && (
            <p>Money is recorded as donor credit; allocations need review.</p>
          )}
          {stage === "result" && (
            <button
              type="button"
              className="secondary"
              onClick={() => void check(key)}
            >
              Check saved Matbia status
            </button>
          )}
          {["approved", "declined"].includes(result.state) && (
            <button type="button" className="secondary" onClick={reset}>
              Start another Matbia payment
            </button>
          )}
        </div>
      )}
      {key && (
        <p className="muted">
          Matbia external transaction ID: <code>{key}</code>
        </p>
      )}
    </section>
  );
}
