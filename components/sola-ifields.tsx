"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { IFIELDS_BASE, discardSetupTokens } from "@/lib/sola/ifields";

declare global {
  interface Window {
    setAccount?: (key: string, name: string, version: string) => void;
    getTokens?: (
      success: () => void,
      failure: () => void,
      timeout: number,
    ) => void;
  }
}

// Mounted only by the server-authorized, explicitly enabled sandbox setup page.
// No fetch, transaction endpoint, form action, storage or logging is used here.
export function SolaIFields({ sandboxKey }: { sandboxKey: string }) {
  const [state, setState] = useState<
    "loading" | "ready" | "busy" | "success" | "error"
  >("loading");
  const card = useRef<HTMLInputElement>(null),
    cvv = useRef<HTMLInputElement>(null);
  const alive = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      discardSetupTokens(card.current, cvv.current);
    };
  }, []);
  const ready = () => {
    if (!window.setAccount || !window.getTokens) {
      setState("error");
      return;
    }
    try {
      window.setAccount(sandboxKey, "Cedar & Olive", "0.1.0");
      setState("ready");
    } catch {
      setState("error");
    }
  };
  const check = () => {
    if (pending.current || !window.getTokens) return;
    pending.current = true;
    discardSetupTokens(card.current, cvv.current);
    setState("busy");
    const finish = (success: boolean) => {
      const complete = discardSetupTokens(card.current, cvv.current);
      pending.current = false;
      if (alive.current) setState(success && complete ? "success" : "error");
    };
    try {
      window.getTokens(
        () => finish(true),
        () => finish(false),
        30000,
      );
    } catch {
      finish(false);
    }
  };
  return (
    <section>
      <h2>Sandbox secure-field check</h2>
      <p>
        Use Sola sandbox test card details only. This checks tokenization and
        immediately discards the tokens. It does not charge or save a card.
      </p>
      <Script
        src={`${IFIELDS_BASE}/ifields.min.js`}
        strategy="afterInteractive"
        onReady={ready}
        onError={() => setState("error")}
      />
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
        <label htmlFor="sola-card-frame">Card number — Sola hosted field</label>
        <iframe
          id="sola-card-frame"
          title="Sandbox card number"
          data-ifields-id="card-number"
          data-ifields-placeholder="Sandbox card number"
          src={`${IFIELDS_BASE}/ifield.htm`}
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            width: "100%",
            height: 48,
            border: "1px solid #d4dcd7",
            borderRadius: 6,
          }}
        />
        <label htmlFor="sola-cvv-frame">
          Security code — Sola hosted field
        </label>
        <iframe
          id="sola-cvv-frame"
          title="Sandbox security code"
          data-ifields-id="cvv"
          data-ifields-placeholder="Sandbox CVV"
          src={`${IFIELDS_BASE}/ifield.htm`}
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            width: "100%",
            height: 48,
            border: "1px solid #d4dcd7",
            borderRadius: 6,
          }}
        />
        <input ref={card} type="hidden" data-ifields-id="card-number-token" />
        <input ref={cvv} type="hidden" data-ifields-id="cvv-token" />
        <p role="status" aria-live="polite">
          {state === "loading"
            ? "Loading Sola secure fields…"
            : state === "busy"
              ? "Checking sandbox tokenization…"
              : state === "success"
                ? "Sandbox tokens received and discarded. No payment was submitted."
                : state === "error"
                  ? "Secure-field check did not complete. Check sandbox keys, allowed domain, and provider connectivity. No payment was submitted."
                  : "Secure fields initialized. No payment processing is enabled."}
        </p>
        <button
          type="button"
          disabled={state === "loading" || state === "busy"}
          onClick={check}
        >
          Check sandbox tokenization
        </button>
      </form>
    </section>
  );
}
