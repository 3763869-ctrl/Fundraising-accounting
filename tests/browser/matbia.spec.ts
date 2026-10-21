import { test, expect, type Page } from "@playwright/test";
async function newPayment(page: Page, outcome: string) {
  await page.getByText("New donation", { exact: true }).click();
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Donor", exact: true })
    .selectOption({ label: "Matbia Browser Test" });
  await d.getByLabel("Payment amount (USD)", { exact: true }).fill("25");
  await d
    .getByLabel("Goes to / Campaign", { exact: false })
    .selectOption({ label: "Annual community appeal" });
  await d
    .getByRole("button", { name: "Auto select: exact match, then oldest" })
    .click();
  await d
    .getByRole("combobox", { name: "Payment method" })
    .selectOption("charity_card");
  await expect(
    d.getByRole("heading", { name: "Matbia · sample simulation" }),
  ).toBeVisible();
  await expect(d.locator("input[type=password]")).toHaveCount(0);
  await d
    .getByRole("combobox", { name: "Matbia test outcome" })
    .selectOption(outcome);
  await d
    .getByRole("checkbox", {
      name: "I want to run this simulated Matbia payment.",
    })
    .check();
  return d;
}
test("Matbia sample approval, decline and timeout recovery persist without gateway or live-book requests", async ({
  page,
}) => {
  test.setTimeout(120000);
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/api\/matbia|api\.matbia\.org|supabase\.co/.test(r.url()))
      requests.push(r.url());
  });
  await page.goto("/demo?page=donors");
  await page
    .getByRole("button", { name: "Add new donor", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await d.getByLabel("First name", { exact: true }).fill("Matbia");
  await d.getByLabel("Last name", { exact: true }).fill("Browser Test");
  await d.getByRole("button", { name: "Save New Donor" }).click();
  await expect(d).not.toBeVisible();
  await page.getByRole("link", { name: "Pledges", exact: true }).click();
  await page.getByText("New donation", { exact: true }).click();
  await page.getByRole("button", { name: "New pledge", exact: true }).click();
  d = page.getByRole("dialog");
  await d
    .getByLabel("Donor", { exact: true })
    .selectOption({ label: "Matbia Browser Test" });
  await d
    .getByLabel("Campaign", { exact: true })
    .selectOption({ label: "Annual community appeal" });
  await d.getByLabel("Pledge amount (USD)", { exact: true }).fill("100");
  await d.getByRole("button", { name: "Save record" }).click();
  await expect(d).not.toBeVisible();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  d = await newPayment(page, "approved");
  await d
    .getByRole("button", { name: "Run Matbia test $25.00", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    d.getByRole("heading", { name: "Simulated Matbia payment approved" }),
  ).toBeVisible();
  await d.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Payments" })
    .fill("Matbia Browser Test");
  await expect(page.getByText("of 1 records", { exact: false })).toBeVisible();
  d = await newPayment(page, "declined");
  await d
    .getByRole("button", { name: "Run Matbia test $25.00", exact: true })
    .click();
  await expect(
    d.getByRole("heading", { name: "Simulated Matbia payment declined" }),
  ).toBeVisible();
  await d.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Pledges", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Pledges" })
    .fill("Matbia Browser Test");
  await expect(
    page.getByRole("cell", { name: "$75.00", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  d = await newPayment(page, "unknown");
  await d
    .getByRole("button", { name: "Run Matbia test $25.00", exact: true })
    .click();
  await expect(
    d.getByRole("heading", { name: "Simulated payment needs review" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search Payments" })
    .fill("Matbia Browser Test");
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "pending", exact: true }) })
    .getByRole("button", { name: "View →", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Confirm externally received payment",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Review Matbia attempt" }).click();
  await page
    .getByRole("button", { name: "Simulate confirmed approval" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Simulated Matbia payment approved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Pledges", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Pledges" })
    .fill("Matbia Browser Test");
  // Paid and open balances are both $50 after two approved $25 payments.
  await expect(
    page.getByRole("cell", { name: "$50.00", exact: true }),
  ).toHaveCount(2);
  expect(requests).toEqual([]);
});
test("Matbia endpoints reject signed-out access and expose no card entry or credentials", async ({
  request,
}) => {
  const config = await request.get(
    "/api/matbia/config?organization=00000000-0000-0000-0000-000000000001",
  );
  expect(config.status()).toBe(403);
  expect((await config.json()).token).toBeUndefined();
  const status = await request.get(
    "/api/matbia/payments?request_key=00000000-0000-0000-0000-000000000001",
  );
  expect(status.status()).toBe(403);
  const payment = await request.post("/api/matbia/payments", {
    headers: { origin: "https://cedar-olive.vercel.app" },
    data: {},
  });
  expect(payment.status()).toBe(403);
  const bind = await request.post("/api/matbia/merchant", {
    headers: { origin: "https://cedar-olive.vercel.app" },
    data: { organization: "00000000-0000-0000-0000-000000000001" },
  });
  expect(bind.status()).toBe(403);
});
