import { NextRequest, NextResponse } from "next/server";
import {
  matbiaIdentity,
  matbiaAdmin,
  matbiaMissing,
  matbiaLimit,
} from "@/lib/matbia/server";
import { parseMatbiaInput } from "@/lib/matbia/input";
import { submitMatbiaCharge } from "@/lib/matbia/transaction";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: NextRequest) {
  const identity = await matbiaIdentity();
  if (!identity)
    return reply({ error: "Verified Matbia merchant owner required." }, 403);
  const key = request.nextUrl.searchParams.get("request_key") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(key))
    return reply({ error: "Invalid attempt key." }, 400);
  const { data, error } = await identity.db
    .from("matbia_payment_attempts")
    .select(
      "state,payment_id,provider_reference,allocation_review,amount_minor,donor_id",
    )
    .eq("organization_id", identity.org)
    .eq("request_key", key)
    .maybeSingle();
  return error
    ? reply(
        { error: "Unable to check the saved attempt. Do not retry a charge." },
        503,
      )
    : reply(
        data
          ? {
              state: data.state,
              payment: data.payment_id,
              reference: data.provider_reference,
              allocation_review: data.allocation_review,
              amount_minor: data.amount_minor,
              donor: data.donor_id,
            }
          : { state: "not_started" },
      );
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  const identity = await matbiaIdentity();
  if (!identity)
    return reply({ error: "Verified Matbia merchant owner required." }, 403);
  if (matbiaMissing().length)
    return reply({ error: "Matbia live processing is disabled." }, 503);
  let input: ReturnType<typeof parseMatbiaInput>;
  try {
    if (
      !request.headers.get("content-type")?.includes("application/json") ||
      Number(request.headers.get("content-length") ?? 0) > 16384
    )
      throw new Error();
    const text = await request.text();
    if (text.length > 16384) throw new Error();
    input = parseMatbiaInput(JSON.parse(text), identity.org, matbiaLimit());
  } catch {
    return reply(
      {
        error:
          "Check donor, amount, campaign, Matbia card, expiration, pledge allocations and permission.",
      },
      400,
    );
  }
  const { data: prepared, error } = await identity.db.rpc(
    "prepare_matbia_payment",
    {
      org: identity.org,
      donor: input.donor,
      amount: input.amount_minor,
      request_key: input.request_key,
      allocations: input.allocations,
      details: input.donation,
    },
  );
  if (error || !prepared)
    return reply(
      {
        error:
          "No charge was submitted. Check pending attempts and donation details.",
      },
      409,
    );
  if (!prepared.send) return reply({ ...prepared, already_submitted: true });
  const result = await submitMatbiaCharge({
    environment: "production",
    token: process.env.MATBIA_API_TOKEN!,
    organizationHandle: process.env.MATBIA_ORG_USER_HANDLE!,
    cardNumber: input.card_number,
    expiry: input.expiry,
    amountMinor: Number(prepared.amount_minor),
    requestKey: input.request_key,
    transactionDate: new Date(prepared.created_at).toISOString(),
  });
  input.card_number = "";
  input.expiry = "";
  const { data: finished, error: finishError } = await matbiaAdmin().rpc(
    "finish_matbia_payment",
    {
      attempt: prepared.attempt,
      outcome: result.state,
      reference: result.reference,
    },
  );
  return finishError
    ? reply(
        {
          state: "unknown",
          error:
            "Provider request submitted but bookkeeping needs review. Do not charge again.",
          reference: result.reference,
        },
        202,
      )
    : reply(finished, result.state === "unknown" ? 202 : 200);
}
