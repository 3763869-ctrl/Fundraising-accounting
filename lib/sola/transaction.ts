export const SOLA_TRANSACTION_URL = "https://x1.cardknox.com/gatewayjson";
export type SolaOutcome = {
  state: "approved" | "declined" | "unknown";
  reference: string | null;
};

export function usdAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 99999999999)
    throw new Error("Invalid amount.");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
export function validSut(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    value.includes(";sut_") &&
    !/[\r\n]/.test(value)
  );
}
export function validExpiry(value: unknown, now = new Date()): value is string {
  if (typeof value !== "string" || !/^(0[1-9]|1[0-2])\d{2}$/.test(value))
    return false;
  const month = Number(value.slice(0, 2)),
    year = 2000 + Number(value.slice(2));
  return (
    year > now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month >= now.getUTCMonth() + 1)
  );
}
export function interpretSolaResponse(
  body: unknown,
  expectedMinor: number,
): SolaOutcome {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { state: "unknown", reference: null };
  const response = body as Record<string, unknown>;
  const rawRef = response.xRefNum ?? response.xRefnum;
  const reference =
    typeof rawRef === "number" || typeof rawRef === "string"
      ? String(rawRef)
      : "";
  const safeReference = /^[A-Za-z0-9_-]{1,100}$/.test(reference)
    ? reference
    : null;
  if (response.xResult === "D")
    return { state: "declined", reference: safeReference };
  const rawAmount = String(response.xAuthAmount ?? "");
  const [whole, decimal = ""] = rawAmount.split(".");
  const approvedMinor = /^\d{1,9}(\.\d{1,2})?$/.test(rawAmount)
    ? Number(whole) * 100 + Number(decimal.padEnd(2, "0"))
    : -1;
  return {
    state:
      response.xResult === "A" &&
      safeReference &&
      approvedMinor === expectedMinor
        ? "approved"
        : "unknown",
    reference: safeReference,
  };
}

// No retries, failover, card-on-file saves or recurring commands. The caller must
// durably reserve an attempt before calling this server-only transport helper.
export async function submitSolaSale(
  input: {
    key: string;
    amountMinor: number;
    cardToken: string;
    cvvToken: string;
    expiry: string;
    invoice: string;
  },
  transport: typeof fetch = fetch,
): Promise<SolaOutcome> {
  if (
    !input.key ||
    !validSut(input.cardToken) ||
    !validSut(input.cvvToken) ||
    !validExpiry(input.expiry) ||
    !/^[a-f0-9-]{36}$/i.test(input.invoice)
  )
    throw new Error("Invalid secure payment request.");
  const amount = usdAmount(input.amountMinor);
  try {
    const response = await transport(SOLA_TRANSACTION_URL, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        xKey: input.key,
        xVersion: "5.0.0",
        xSoftwareName: "Cedar & Olive",
        xSoftwareVersion: "0.1.0",
        xCommand: "cc:sale",
        xAmount: amount,
        xCardNum: input.cardToken,
        xCVV: input.cvvToken,
        xExp: input.expiry,
        xInvoice: input.invoice,
      }),
    });
    if (!response.ok) return { state: "unknown", reference: null };
    const text = await response.text();
    if (text.length > 65536) return { state: "unknown", reference: null };
    return interpretSolaResponse(JSON.parse(text), input.amountMinor);
  } catch {
    return { state: "unknown", reference: null };
  }
}
