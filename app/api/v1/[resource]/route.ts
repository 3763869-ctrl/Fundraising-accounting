import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const resources: Record<string, { table: string; columns: string }> = {
  donors: {
    table: "donors",
    columns: "id,organization_id,name,hebrew_name,email,tags,created_at",
  },
  campaigns: {
    table: "campaigns",
    columns: "id,organization_id,name,fund_id,goal_minor,status,created_at",
  },
  pledges: {
    table: "pledges",
    columns:
      "id,organization_id,donor_id,campaign_id,amount_minor,pledged_on,due_date,description,created_at",
  },
  payments: {
    table: "payments",
    columns:
      "id,organization_id,donor_id,amount_minor,paid_on,method,status,reference,deposit_status,collector,created_at",
  },
  allocations: {
    table: "payment_allocations",
    columns: "id,organization_id,payment_id,pledge_id,amount_minor,created_at",
  },
  schedules: {
    table: "schedules",
    columns:
      "id,organization_id,donor_id,pledge_id,total_minor,payment_count,frequency,status,created_at",
  },
  jobs: {
    table: "job_logs",
    columns: "id,organization_id,name,status,details,created_at",
  },
};
const response = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function authenticated(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];
  if (!token)
    return {
      error: response(
        { error: "A Supabase user access token is required." },
        401,
      ),
    };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return {
      error: response({ error: "Supabase project setup is required." }, 503),
    };
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user)
    return {
      error: response({ error: "Invalid or expired access token." }, 401),
    };
  return { db };
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  if (!resources[resource])
    return response({ error: "Unknown API resource." }, 404);
  const auth = await authenticated(request);
  if (auth.error) return auth.error;
  const org = request.nextUrl.searchParams.get("organization_id") ?? "",
    offset = Number(request.nextUrl.searchParams.get("offset") ?? 0),
    limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  if (
    !/^[a-f0-9-]{36}$/i.test(org) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    return response(
      {
        error:
          "Provide organization_id, offset >= 0, and limit between 1 and 100.",
      },
      400,
    );
  const r = resources[resource],
    result = await auth
      .db!.from(r.table)
      .select(r.columns)
      .eq("organization_id", org)
      .order("created_at")
      .order("id")
      .range(offset, offset + limit - 1);
  if (result.error)
    return response(
      {
        error:
          "The resource could not be read. Check database setup and permissions.",
      },
      400,
    );
  return response({
    data: result.data,
    pagination: { offset, limit, returned: result.data?.length ?? 0 },
  });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  if (resource !== "payments")
    return response(
      { error: "This resource is read-only through the API." },
      405,
    );
  const auth = await authenticated(request);
  if (auth.error) return auth.error;
  if (Number(request.headers.get("content-length") ?? 0) > 16384)
    return response({ error: "Request too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 16384)
      return response({ error: "Request too large." }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
  } catch {
    return response({ error: "A JSON object is required." }, 400);
  }
  const allowed = [
    "organization_id",
    "donor_id",
    "amount_minor",
    "paid_on",
    "method",
    "status",
    "reference",
    "idempotency_key",
    "allocations",
    "collector",
  ];
  if (
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    !Number.isSafeInteger(body.amount_minor) ||
    Number(body.amount_minor) <= 0
  )
    return response(
      {
        error:
          "Use documented fields and positive integer cents. Card credentials are not accepted.",
      },
      400,
    );
  const result = await auth.db!.rpc("record_payment", {
    org: body.organization_id,
    donor: body.donor_id,
    amount: body.amount_minor,
    payment_date: body.paid_on,
    payment_method: body.method,
    payment_status: body.status,
    payment_reference: body.reference ?? "",
    request_key: body.idempotency_key,
    allocations: body.allocations ?? [],
    collector_name: body.collector ?? "",
  });
  if (result.error) return response({ error: result.error.message }, 400);
  return response({ payment_id: result.data }, 201);
}
