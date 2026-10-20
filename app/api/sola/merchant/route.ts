import { NextRequest, NextResponse } from "next/server";
import { solaOwner, solaAdmin } from "@/lib/sola/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  const owner = await solaOwner();
  if (!owner || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return reply({ error: "Verified merchant owner access required." }, 403);
  let org: string;
  try {
    const text = await request.text();
    if (text.length > 256) throw new Error();
    const input = JSON.parse(text);
    org = String(input.organization ?? "");
    if (
      !/^[a-f0-9-]{36}$/i.test(org) ||
      Object.keys(input).some((k) => k !== "organization")
    )
      throw new Error();
  } catch {
    return reply({ error: "Choose your organization." }, 400);
  }
  const { data: member } = await owner.db
    .from("memberships")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", owner.user.id)
    .maybeSingle();
  if (member?.role !== "owner")
    return reply({ error: "Organization owner required." }, 403);
  const { error } = await solaAdmin().rpc("bind_sola_merchant", {
    org,
    owner_user: owner.user.id,
  });
  return error
    ? reply(
        {
          error:
            "Unable to bind this organization. The merchant may already be bound; contact the administrator.",
        },
        409,
      )
    : reply({ connected: true });
}
