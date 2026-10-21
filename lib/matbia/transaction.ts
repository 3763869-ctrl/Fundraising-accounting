export const MATBIA_HOSTS = {
  sandbox: "https://sandbox.api.matbia.org",
  production: "https://api.matbia.org",
} as const;
export const MATBIA_SANDBOX_TOKEN = "DA8874A1-9393-4D59-8A79-5E436F2538A0";
export const MATBIA_SANDBOX_CARDS = {
  funded: "8628249448173425",
  declined: "8628249723938096",
};
export const MATBIA_SANDBOX_ORG = "e542199755e04395b6a5c5bafb7c40be";
export type MatbiaOutcome = {
  state: "approved" | "declined" | "unknown";
  reference: string | null;
  providerStatus?: "Success" | "Declined" | "Failed" | "Error";
};
export function validMatbiaCard(card: unknown): card is string {
  return typeof card === "string" && /^862824\d{10}$/.test(card);
}
export function validMatbiaExpiry(
  exp: unknown,
  now = new Date(),
): exp is string {
  if (typeof exp !== "string" || !/^(0[1-9]|1[0-2])\d{2}$/.test(exp))
    return false;
  const year = 2000 + Number(exp.slice(2)),
    month = Number(exp.slice(0, 2));
  return (
    year > now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month >= now.getUTCMonth() + 1)
  );
}
export function interpretMatbiaResponse(body: unknown): MatbiaOutcome {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { state: "unknown", reference: null };
  const r = body as Record<string, unknown>,
    status = r.status;
  const reference =
    typeof r.referenceId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(r.referenceId)
      ? r.referenceId
      : null;
  const providerStatus = ["Success", "Declined", "Failed", "Error"].includes(
    String(status),
  )
    ? (status as MatbiaOutcome["providerStatus"])
    : undefined;
  const rejected =
    (status === "Error" || status === "Failed") &&
    [
      "insufficient wallet balance",
      "invalid card number",
      "invalid expiration date",
      "card expired",
    ].includes(
      typeof r.error === "string"
        ? r.error.trim().replace(/\.$/, "").toLowerCase()
        : "",
    );
  // Generic Error/Failed can include duplicate or uncertain outcomes. Never
  // reinterpret them as permission to retry a possibly successful payment.
  return {
    state:
      status === "Success" && (r.error == null || r.error === "") && reference
        ? "approved"
        : status === "Declined" || rejected
          ? "declined"
          : "unknown",
    reference,
    ...(providerStatus ? { providerStatus } : {}),
  };
}
export async function submitMatbiaCharge(
  input: {
    environment: "sandbox" | "production";
    token: string;
    organizationHandle: string;
    cardNumber: string;
    expiry: string;
    amountMinor: number;
    requestKey: string;
    transactionDate: string;
  },
  transport: typeof fetch = fetch,
): Promise<MatbiaOutcome> {
  if (
    !Object.hasOwn(MATBIA_HOSTS, input.environment) ||
    !input.token ||
    !input.organizationHandle ||
    !validMatbiaCard(input.cardNumber) ||
    !validMatbiaExpiry(input.expiry) ||
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < 1 ||
    input.amountMinor > 99999999999 ||
    !/^[a-f0-9-]{36}$/i.test(input.requestKey) ||
    !Number.isFinite(Date.parse(input.transactionDate))
  )
    throw new Error("Invalid Matbia payment request.");
  if (
    input.environment === "production" &&
    (input.token === MATBIA_SANDBOX_TOKEN ||
      input.organizationHandle === MATBIA_SANDBOX_ORG ||
      Object.values(MATBIA_SANDBOX_CARDS).includes(input.cardNumber))
  )
    throw new Error("Sandbox credentials cannot be used for production.");
  try {
    const response = await transport(
      `${MATBIA_HOSTS[input.environment]}/v1/Matbia/Charge`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: input.token,
          Accept: "application/json",
          "Content-Type": "application/json-patch+json",
        },
        body: JSON.stringify({
          orgUserHandle: input.organizationHandle,
          cardNum: input.cardNumber,
          exp: input.expiry,
          amount: Number((input.amountMinor / 100).toFixed(2)),
          transDate: new Date(input.transactionDate).toISOString(),
          note: `Cedar & Olive ${input.requestKey}`,
          externalTransactionId: input.requestKey,
          allowDuplicates: false,
        }),
      },
    );
    const text = await response.text();
    if (text.length > 65536) return { state: "unknown", reference: null };
    const result = interpretMatbiaResponse(JSON.parse(text));
    // Matbia's sandbox returns HTTP 406 with an explicit Declined result for
    // insufficient funds. Other HTTP failures remain uncertain, never approved.
    return response.ok ||
      (response.status === 406 && result.state === "declined")
      ? result
      : { state: "unknown", reference: null };
  } catch {
    return { state: "unknown", reference: null };
  }
}
