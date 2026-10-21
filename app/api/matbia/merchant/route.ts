import { NextRequest, NextResponse } from "next/server";
import { matbiaOwner, matbiaAdmin, matbiaMissing } from "@/lib/matbia/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (request.headers.get("origin") !== "https://cedar-olive.vercel.app")
    return reply({ error: "Invalid request origin." }, 403);
  const owner = await matbiaOwner();
  if (!owner) return reply({ error: "Verified owner required." }, 403);
  if (matbiaMissing().length)
    return reply({ error: "Matbia live setup is incomplete." }, 503);
  let org: string;
  try {
    const text = await request.text();
    if (text.length > 256) throw new Error();
    const body = JSON.parse(text);
    org = String(body.organization);
    if (
      !/^[a-f0-9-]{36}$/i.test(org) ||
      Object.keys(body).some((k) => k !== "organization")
    )
      throw new Error();
  } catch {
    return reply({ error: "Choose an organization." }, 400);
  }
  const { error } = await matbiaAdmin().rpc("bind_matbia_merchant", {
    org,
    owner_user: owner.user.id,
  });
  return error
    ? reply(
        {
          error:
            "Could not connect this organization. Confirm ownership and existing merchant binding.",
        },
        409,
      )
    : reply({ connected: true });
}
