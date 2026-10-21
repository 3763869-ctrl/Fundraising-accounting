import { NextRequest, NextResponse } from "next/server";
import {
  matbiaOwner,
  matbiaIdentity,
  matbiaMissing,
  matbiaLimit,
} from "@/lib/matbia/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  const owner = await matbiaOwner();
  if (!owner)
    return reply(
      { enabled: false, error: "Verified merchant owner required." },
      403,
    );
  const org = request.nextUrl.searchParams.get("organization");
  if (!org || !/^[a-f0-9-]{36}$/i.test(org))
    return reply({ enabled: false, error: "Select an organization." }, 400);
  const { data: member } = await owner.db
    .from("memberships")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", owner.user.id)
    .maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role))
    return reply(
      { enabled: false, error: "Organization owner required." },
      403,
    );
  const missing = matbiaMissing();
  if (missing.length)
    return reply({
      enabled: false,
      missing,
      error: "Matbia live processing is disabled pending provider activation.",
    });
  const identity = await matbiaIdentity();
  if (!identity)
    return reply({
      enabled: false,
      connect: true,
      error: "Connect this organization to Matbia.",
    });
  return identity.org === org
    ? reply({ enabled: true, limit: matbiaLimit() })
    : reply(
        { enabled: false, error: "Matbia belongs to another organization." },
        403,
      );
}
