import { NextRequest, NextResponse } from "next/server";
import { plaidOwner, plaidAdmin, plaidMissing } from "@/lib/plaid/server";
import {
  plaidSandbox,
  PlaidFailure,
  readSandboxSync,
} from "@/lib/plaid/client";
import { sealPlaid, openPlaid, plaidContext } from "@/lib/plaid/vault";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get("organization") ?? "";
  if (!(await plaidOwner(org)))
    return reply(
      { error: "Sign in as the configured organization owner." },
      403,
    );
  const missing = plaidMissing();
  if (missing.length)
    return reply({ enabled: false, environment: "sandbox", missing });
  const admin = plaidAdmin(),
    { data: connection, error } = await admin
      .from("plaid_sandbox_connections")
      .select("id,institution_name,state,last_synced_at,error_code")
      .eq("organization_id", org)
      .maybeSingle();
  if (error)
    return reply({ error: "Plaid Sandbox database setup is incomplete." }, 503);
  const transactions = connection
    ? await admin
        .from("plaid_sandbox_transactions")
        .select("id,posted_on,name,amount_minor,currency,pending")
        .eq("organization_id", org)
        .eq("connection_id", connection.id)
        .eq("removed", false)
        .order("posted_on", { ascending: false })
        .order("id")
        .limit(100)
    : { data: [], error: null };
  if (transactions.error)
    return reply({ error: "Unable to read saved Sandbox transactions." }, 503);
  return reply({
    enabled: true,
    environment: "sandbox",
    connection,
    transactions: transactions.data,
  });
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  let org: string, action: string;
  try {
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw Error();
    const text = await request.text();
    if (text.length > 2048) throw Error();
    const body = JSON.parse(text);
    if (
      !body ||
      typeof body !== "object" ||
      Object.keys(body).some((k) => !["organization", "action"].includes(k)) ||
      !["connect", "sync", "disconnect"].includes(body.action) ||
      typeof body.organization !== "string"
    )
      throw Error();
    org = body.organization;
    action = body.action;
  } catch {
    return reply({ error: "Invalid Sandbox operation." }, 400);
  }
  if (!(await plaidOwner(org)))
    return reply({ error: "Verified organization owner required." }, 403);
  if (plaidMissing().length)
    return reply({ error: "Plaid Sandbox settings are incomplete." }, 503);
  const admin = plaidAdmin(),
    { data: reserved, error } = await admin.rpc("reserve_plaid_sandbox", {
      org,
    });
  if (error || !reserved)
    return reply(
      { error: "Another bank operation is running. Refresh and try later." },
      409,
    );
  const id = String(reserved.id),
    context = plaidContext(org, id),
    call = plaidSandbox(
      process.env.PLAID_CLIENT_ID!,
      process.env.PLAID_SANDBOX_SECRET!,
    );
  let token = "";
  let tokenSaved = Boolean(reserved.encrypted_token);
  try {
    if (reserved.encrypted_token)
      token = openPlaid(
        reserved.encrypted_token,
        process.env.PLAID_TOKEN_ENCRYPTION_KEY!,
        context,
      );
    if (action === "disconnect") {
      if (token) await call("/item/remove", { access_token: token });
      const result = await admin
        .from("plaid_sandbox_connections")
        .delete()
        .eq("id", id)
        .eq("organization_id", org);
      if (result.error) throw new PlaidFailure("DATABASE_ERROR");
      return reply({ state: "disconnected", environment: "sandbox" });
    }
    if (!token) {
      if (action !== "connect") throw new PlaidFailure("CONNECT_REQUIRED");
      await admin
        .from("plaid_sandbox_connections")
        .update({ state: "connecting", error_code: null })
        .eq("id", id);
      const institutions = await call("/institutions/search", {
        query: "Chase",
        products: ["transactions"],
        country_codes: ["US"],
      });
      const chase = Array.isArray(institutions.institutions)
        ? institutions.institutions.find(
            (i: { name?: unknown; institution_id?: unknown }) =>
              typeof i.name === "string" &&
              /\bchase\b/i.test(i.name) &&
              typeof i.institution_id === "string",
          )
        : null;
      if (!chase) throw new PlaidFailure("SANDBOX_CHASE_UNAVAILABLE");
      const created = await call("/sandbox/public_token/create", {
        institution_id: chase.institution_id,
        initial_products: ["transactions"],
      });
      if (
        typeof created.public_token !== "string" ||
        !created.public_token.startsWith("public-sandbox-")
      )
        throw new PlaidFailure("INVALID_RESPONSE");
      const exchanged = await call("/item/public_token/exchange", {
        public_token: created.public_token,
      });
      token = exchanged.access_token;
      const encrypted = sealPlaid(
        token,
        process.env.PLAID_TOKEN_ENCRYPTION_KEY!,
        context,
      );
      const saved = await admin
        .from("plaid_sandbox_secrets")
        .insert({ connection_id: id, encrypted_token: encrypted });
      if (saved.error) throw new PlaidFailure("DATABASE_ERROR");
      tokenSaved = true;
      const marked = await admin
        .from("plaid_sandbox_connections")
        .update({
          state: "connected",
          institution_name: "Simulated Chase (Plaid Sandbox)",
        })
        .eq("id", id);
      if (marked.error) throw new PlaidFailure("DATABASE_ERROR");
    }
    const batch = await readSandboxSync(call, token, String(reserved.cursor));
    const committed = await admin.rpc("commit_plaid_sandbox_sync", {
      connection: id,
      expected_version: Number(reserved.version),
      added: batch.added,
      modified: batch.modified,
      removed: batch.removed,
      next_cursor: batch.cursor,
    });
    if (committed.error) throw new PlaidFailure("DATABASE_ERROR");
    return reply({
      state: "connected",
      environment: "sandbox",
      added: batch.added.length,
      updated: batch.modified.length,
      removed: batch.removed.length,
    });
  } catch (e) {
    const code = e instanceof PlaidFailure ? e.code : "SANDBOX_SETUP_ERROR";
    await admin
      .from("plaid_sandbox_connections")
      .update({
        state: tokenSaved ? "connected" : "error",
        operation_until: null,
        error_code: code,
      })
      .eq("id", id);
    return reply(
      {
        error:
          code === "PRODUCT_NOT_READY"
            ? "Sandbox transactions are still being prepared. Select Sync again shortly."
            : "Plaid Sandbox operation did not complete. Check setup and try again.",
        code,
        environment: "sandbox",
      },
      code === "PRODUCT_NOT_READY" ? 202 : 503,
    );
  } finally {
    token = "";
  }
}
