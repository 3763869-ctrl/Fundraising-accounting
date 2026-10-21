// Sandbox only: no caller-controlled host or production credential is accepted.
export class PlaidFailure extends Error {
  code: string;
  constructor(code: string) {
    super("Plaid Sandbox request did not complete.");
    this.code = code;
  }
}
const codes = new Set([
  "PRODUCT_NOT_READY",
  "ITEM_LOGIN_REQUIRED",
  "RATE_LIMIT_EXCEEDED",
  "INSTITUTION_DOWN",
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
]);
export function plaidSandbox(
  clientId: string,
  secret: string,
  transport: typeof fetch = fetch,
) {
  return async (path: string, payload: Record<string, unknown>) => {
    if (
      ![
        "/institutions/search",
        "/sandbox/public_token/create",
        "/item/public_token/exchange",
        "/transactions/sync",
        "/item/remove",
      ].includes(path) ||
      !clientId ||
      !secret
    )
      throw new PlaidFailure("CONFIGURATION_REQUIRED");
    let r: Response;
    try {
      r = await transport(`https://sandbox.plaid.com${path}`, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "Plaid-Version": "2020-09-14",
        },
        body: JSON.stringify({ ...payload, client_id: clientId, secret }),
      });
    } catch {
      throw new PlaidFailure("CONNECTION_ERROR");
    }
    const text = await r.text();
    if (text.length > 4000000) throw new PlaidFailure("INVALID_RESPONSE");
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new PlaidFailure("INVALID_RESPONSE");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PlaidFailure("INVALID_RESPONSE");
    if (!r.ok || body.error_code)
      throw new PlaidFailure(
        codes.has(body.error_code) ? body.error_code : "PROVIDER_ERROR",
      );
    return body;
  };
}
const id = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(v);
export type SandboxRow = {
  transaction_id: string;
  account_id: string;
  posted_on: string;
  name: string;
  amount_minor: number;
  currency: string;
  pending: boolean;
  pending_transaction_id: string | null;
};
export function cleanTransaction(v: Record<string, unknown>): SandboxRow {
  const amount = Number(v.amount),
    minor = Math.round(amount * 100),
    date = String(v.date),
    currency = v.iso_currency_code;
  if (
    !id(v.transaction_id) ||
    !id(v.account_id) ||
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(minor) ||
    Math.abs(minor) > 99999999999 ||
    currency !== "USD" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    typeof v.pending !== "boolean" ||
    typeof v.name !== "string"
  )
    throw new PlaidFailure("INVALID_RESPONSE");
  return {
    transaction_id: v.transaction_id as string,
    account_id: v.account_id as string,
    posted_on: date,
    name: v.name.slice(0, 500),
    amount_minor: minor,
    currency: "USD",
    pending: v.pending,
    pending_transaction_id: id(v.pending_transaction_id)
      ? (v.pending_transaction_id as string)
      : null,
  };
}
export async function readSandboxSync(
  call: ReturnType<typeof plaidSandbox>,
  accessToken: string,
  cursor: string,
) {
  if (!/^access-sandbox-[a-zA-Z0-9_-]{1,250}$/.test(accessToken))
    throw new PlaidFailure("INVALID_SANDBOX_TOKEN");
  for (let attempt = 0; attempt < 3; attempt++) {
    let next = cursor;
    const added: SandboxRow[] = [],
      modified: SandboxRow[] = [],
      removed: string[] = [];
    try {
      for (let page = 0; page < 100; page++) {
        const body = await call("/transactions/sync", {
          access_token: accessToken,
          ...(next ? { cursor: next } : {}),
          count: 500,
        });
        if (
          !Array.isArray(body.added) ||
          !Array.isArray(body.modified) ||
          !Array.isArray(body.removed) ||
          typeof body.next_cursor !== "string" ||
          body.next_cursor.length > 20000 ||
          typeof body.has_more !== "boolean"
        )
          throw new PlaidFailure("INVALID_RESPONSE");
        added.push(...body.added.map(cleanTransaction));
        modified.push(...body.modified.map(cleanTransaction));
        for (const r of body.removed) {
          if (!id(r.transaction_id)) throw new PlaidFailure("INVALID_RESPONSE");
          removed.push(r.transaction_id);
        }
        if (added.length + modified.length + removed.length > 50000)
          throw new PlaidFailure("SYNC_TOO_LARGE");
        next = body.next_cursor;
        if (!body.has_more) return { added, modified, removed, cursor: next };
      }
      throw new PlaidFailure("SYNC_TOO_LARGE");
    } catch (e) {
      if (
        e instanceof PlaidFailure &&
        e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        attempt < 2
      )
        continue;
      throw e;
    }
  }
  throw new PlaidFailure("SYNC_RETRY_REQUIRED");
}
