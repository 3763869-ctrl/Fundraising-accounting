import { NextRequest, NextResponse } from "next/server";
import {
  solaIdentity,
  solaOwner,
  liveConfigured,
  liveLimit,
} from "@/lib/sola/server";
import { vaultConfigured } from "@/lib/sola/card-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  const owner = await solaOwner();
  if (!owner)
    return reply(
      {
        enabled: false,
        error: "Only the verified merchant owner can enter or charge cards.",
      },
      403,
    );
  const org = request.nextUrl.searchParams.get("organization");
  if (!org || !/^[a-f0-9-]{36}$/i.test(org))
    return reply({ enabled: false, error: "Choose an organization." }, 400);
  const { data: member } = await owner.db
    .from("memberships")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", owner.user.id)
    .maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role))
    return reply(
      { enabled: false, error: "Organization owner access required." },
      403,
    );
  if (!liveConfigured())
    return reply({
      enabled: false,
      error: "The Sola deployment settings need attention.",
    });
  const identity = await solaIdentity();
  if (!identity)
    return reply({
      enabled: false,
      connect: true,
      error: "Connect this organization to your Sola merchant account below.",
    });
  if (identity.org !== org)
    return reply(
      { enabled: false, error: "Sola is connected to another organization." },
      403,
    );
  return reply({
    enabled: true,
    ifields_key: process.env.NEXT_PUBLIC_SOLA_IFIELDS_KEY,
    limit: liveLimit(),
    vault_enabled: vaultConfigured(),
  });
}
