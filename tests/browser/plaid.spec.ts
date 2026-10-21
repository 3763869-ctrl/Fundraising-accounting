import { test, expect } from "@playwright/test";
test("sample bank page labels isolated Plaid testing and never calls bank APIs", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/api\/plaid|sandbox\.plaid\.com|production\.plaid\.com/.test(r.url()))
      requests.push(r.url());
  });
  await page.goto("/demo?page=bank");
  const panel = page.getByRole("region", {
    name: "Plaid Sandbox bank connection",
  });
  await expect(
    panel.getByRole("heading", { name: "Plaid Sandbox", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("TEST DATA", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Connect simulated Chase", exact: true }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
});
test("Plaid Sandbox endpoints reject signed-out access and arbitrary caller payloads", async ({
  request,
}) => {
  const r = await request.get(
    "/api/plaid/sandbox?organization=00000000-0000-0000-0000-000000000001",
  );
  expect(r.status()).toBe(403);
  expect((await r.json()).secret).toBeUndefined();
  const p = await request.post("/api/plaid/sandbox", {
    headers: { origin: "https://cedar-olive.vercel.app" },
    data: {
      organization: "00000000-0000-0000-0000-000000000001",
      action: "connect",
    },
  });
  expect(p.status()).toBe(403);
  const invalid = await request.post("/api/plaid/sandbox", {
    headers: { origin: "https://cedar-olive.vercel.app" },
    data: {
      organization: "00000000-0000-0000-0000-000000000001",
      action: "connect",
      environment: "production",
    },
  });
  expect(invalid.status()).toBe(400);
});
