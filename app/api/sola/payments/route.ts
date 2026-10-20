import { NextRequest, NextResponse } from "next/server";
import {
  solaIdentity,
  solaAdmin,
  liveConfigured,
  liveLimit,
} from "@/lib/sola/server";
import { validExpiry, validSut, submitSolaSale } from "@/lib/sola/transaction";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(request: NextRequest) {
  const identity = await solaIdentity();
  if (!identity)
    return reply({ error: "Sign in as the configured merchant owner." }, 403);
  const key = request.nextUrl.searchParams.get("request_key") ?? "";
  if (!uuid.test(key)) return reply({ error: "Invalid attempt key." }, 400);
  const { data, error } = await identity.db
    .from("sola_payment_attempts")
    .select(
      "state,payment_id,provider_reference,allocation_review,amount_minor,donor_id",
    )
    .eq("organization_id", identity.org)
    .eq("request_key", key)
    .maybeSingle();
  if (error)
    return reply(
      {
        error:
          "Unable to check the saved payment attempt. Do not retry a charge.",
      },
      503,
    );
  return data
    ? reply({
        state: data.state,
        payment: data.payment_id,
        reference: data.provider_reference,
        allocation_review: data.allocation_review,
        amount_minor: data.amount_minor,
        donor: data.donor_id,
      })
    : reply({ state: "not_started" });
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  if (!liveConfigured())
    return reply({ error: "Live processing is not configured." }, 503);
  const identity = await solaIdentity();
  if (!identity)
    return reply({ error: "Sign in as the configured merchant owner." }, 403);
  let input: Record<string, unknown>;
  try {
    if (
      !request.headers.get("content-type")?.includes("application/json") ||
      Number(request.headers.get("content-length") ?? 0) > 16384
    )
      return reply({ error: "Invalid request." }, 400);
    const text = await request.text();
    if (text.length > 16384) return reply({ error: "Invalid request." }, 400);
    input = JSON.parse(text);
    const allowed = [
      "donor",
      "amount_minor",
      "request_key",
      "card_token",
      "cvv_token",
      "expiry",
      "consent",
      "allocations",
    ];
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !allowed.includes(k))
    )
      throw new Error();
    if (
      !uuid.test(String(input.donor)) ||
      !uuid.test(String(input.request_key)) ||
      !Number.isSafeInteger(input.amount_minor) ||
      Number(input.amount_minor) < 1 ||
      Number(input.amount_minor) > liveLimit() ||
      input.consent !== true ||
      !validSut(input.card_token) ||
      !validSut(input.cvv_token) ||
      !validExpiry(input.expiry)
    )
      throw new Error();
    if (
      input.allocations !== undefined &&
      (!Array.isArray(input.allocations) || input.allocations.length > 100)
    )
      throw new Error();
    for (const allocation of (input.allocations ?? []) as Record<
      string,
      unknown
    >[]) {
      if (
        !allocation ||
        typeof allocation !== "object" ||
        Array.isArray(allocation) ||
        Object.keys(allocation).some(
          (k) => !["pledge_id", "amount_minor"].includes(k),
        ) ||
        !uuid.test(String(allocation.pledge_id)) ||
        !Number.isSafeInteger(allocation.amount_minor) ||
        Number(allocation.amount_minor) < 1
      )
        throw new Error();
    }
  } catch {
    return reply(
      {
        error:
          "Check the donor, amount, expiration, secure card fields and cardholder permission.",
      },
      400,
    );
  }
  const { data: prepared, error: preparationError } = await identity.db.rpc(
    "prepare_sola_payment",
    {
      org: identity.org,
      donor: input.donor,
      amount: input.amount_minor,
      request_key: input.request_key,
      allocations: input.allocations ?? [],
    },
  );
  if (preparationError || !prepared)
    return reply(
      {
        error:
          "Payment was not submitted. Check pending attempts, donor balance, database setup and your permissions.",
      },
      409,
    );
  if (!prepared.send) return reply({ ...prepared, already_submitted: true });
  const result = await submitSolaSale({
    key: process.env.SOLA_API_KEY!,
    amountMinor: Number(prepared.amount_minor),
    cardToken: String(input.card_token),
    cvvToken: String(input.cvv_token),
    expiry: String(input.expiry),
    invoice: String(input.request_key),
  });
  const { data: finished, error: finishError } = await solaAdmin().rpc(
    "finish_sola_payment",
    {
      attempt: prepared.attempt,
      outcome: result.state,
      reference: result.reference,
    },
  );
  if (finishError || !finished)
    return reply(
      {
        state: "unknown",
        reference: result.reference,
        error:
          "The provider request was submitted but bookkeeping needs review. Do not submit another charge. Check Sola and this payment attempt.",
      },
      202,
    );
  return reply(finished);
}
