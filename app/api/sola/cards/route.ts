import { NextRequest, NextResponse } from "next/server";
import { solaIdentity, solaAdmin, liveConfigured } from "@/lib/sola/server";
import { encryptedCard, vaultConfigured } from "@/lib/sola/card-server";
import {
  submitSolaCardSave,
  validExpiry,
  validSut,
} from "@/lib/sola/transaction";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: NextRequest) {
  const identity = await solaIdentity();
  if (!identity)
    return reply({ error: "Verified merchant owner required." }, 403);
  const requestKey = request.nextUrl.searchParams.get("request_key");
  if (requestKey) {
    if (!uuid.test(requestKey))
      return reply({ error: "Invalid attempt." }, 400);
    const { data, error } = await solaAdmin()
      .from("sola_card_save_attempts")
      .select("state")
      .eq("organization_id", identity.org)
      .eq("request_key", requestKey)
      .maybeSingle();
    return error
      ? reply({ error: "Unable to check card-save status." }, 503)
      : reply(
          data
            ? { state: data.state, card_saved: data.state === "approved" }
            : { state: "not_started" },
        );
  }
  const donor = request.nextUrl.searchParams.get("donor");
  if (!donor || !uuid.test(donor))
    return reply({ error: "Choose a donor." }, 400);
  const { data, error } = await identity.db
    .from("donor_payment_methods")
    .select("id,donor_id,brand,last4,expiry,consent_at")
    .eq("organization_id", identity.org)
    .eq("donor_id", donor)
    .eq("active", true)
    .order("created_at");
  return error
    ? reply({ error: "Saved cards could not be loaded." }, 503)
    : reply({ cards: data });
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  if (!liveConfigured() || !vaultConfigured())
    return reply({ error: "Secure card saving is not configured." }, 503);
  const identity = await solaIdentity();
  if (!identity)
    return reply({ error: "Verified merchant owner required." }, 403);
  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 12000) throw new Error();
    input = JSON.parse(text);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) =>
          ![
            "organization",
            "donor",
            "request_key",
            "card_token",
            "cvv_token",
            "expiry",
            "zip",
            "save_consent",
          ].includes(k),
      ) ||
      input.organization !== identity.org ||
      !uuid.test(String(input.donor)) ||
      !uuid.test(String(input.request_key)) ||
      input.save_consent !== true ||
      !validSut(input.card_token) ||
      !validSut(input.cvv_token) ||
      !validExpiry(input.expiry) ||
      (input.zip !== undefined && !/^\d{5}(?:-\d{4})?$/.test(String(input.zip)))
    )
      throw new Error();
  } catch {
    return reply(
      { error: "Check donor, secure card fields and permission to save." },
      400,
    );
  }
  const admin = solaAdmin();
  const { data: prepared, error } = await admin.rpc("prepare_sola_card_save", {
    org: identity.org,
    donor: input.donor,
    actor: identity.user.id,
    request_key: input.request_key,
  });
  if (error || !prepared)
    return reply(
      {
        error:
          "Card was not submitted. Check previous attempts and donor access.",
      },
      409,
    );
  if (!prepared.send)
    return reply({
      state: prepared.state,
      card_saved: prepared.state === "approved",
    });
  const result = await submitSolaCardSave({
    key: process.env.SOLA_API_KEY!,
    cardToken: String(input.card_token),
    cvvToken: String(input.cvv_token),
    expiry: String(input.expiry),
    invoice: String(input.request_key),
    ...(input.zip ? { zip: String(input.zip) } : {}),
  });
  const { data: finished, error: finishError } = await admin.rpc(
    "finish_sola_card_save",
    {
      attempt: prepared.attempt,
      outcome: result.state,
      card: encryptedCard(
        result.card,
        identity.org,
        String(input.donor),
        prepared.method,
      ),
    },
  );
  return finishError
    ? reply(
        {
          state: "unknown",
          error:
            "Card-save result needs review. No charge was submitted; do not repeat this save until checked.",
        },
        202,
      )
    : reply(finished);
}
export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  const identity = await solaIdentity();
  if (!identity)
    return reply({ error: "Verified merchant owner required." }, 403);
  let method: string;
  try {
    const text = await request.text();
    if (text.length > 256) throw new Error();
    const input = JSON.parse(text);
    method = String(input.method);
    if (!uuid.test(method) || Object.keys(input).some((k) => k !== "method"))
      throw new Error();
  } catch {
    return reply({ error: "Choose a saved card." }, 400);
  }
  const { error } = await solaAdmin().rpc("retire_sola_card", {
    org: identity.org,
    method,
  });
  return error
    ? reply({ error: "Unable to remove card." }, 409)
    : reply({ removed: true });
}
