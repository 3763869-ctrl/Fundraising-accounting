import { test, expect } from "@playwright/test";

test("signed-out Sola setup exposes no card entry or provider requests", async ({
  page,
}) => {
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/cardknox\.com|solapayments\.com/.test(request.url()))
      providerRequests.push(request.url());
  });
  await page.goto("/settings/sola");
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("heading", { name: "Secure card-entry setup" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sandbox setup required" }),
    ).toBeVisible();
  }
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('script[src*="cardknox.com"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check sandbox tokenization" }),
  ).toHaveCount(0);
  expect(providerRequests).toEqual([]);
});
