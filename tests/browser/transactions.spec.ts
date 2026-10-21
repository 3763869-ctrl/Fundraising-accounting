import { test, expect, type Page } from "@playwright/test";
async function start(page: Page, name?: string) {
  await page
    .getByRole("button", { name: "New Transaction", exact: true })
    .click();
  const d = page.getByRole("dialog");
  if (name) {
    await d.getByLabel("Donor name", { exact: true }).fill(name);
    await d.getByRole("button", { name: "Next", exact: true }).click();
  } else
    await d
      .getByRole("button", { name: "Skip — anonymous donation", exact: true })
      .click();
  await expect(
    d.getByLabel("Transaction amount (USD)", { exact: true }),
  ).toBeVisible();
  return d;
}
async function amount(page: Page, value: string) {
  const d = page.getByRole("dialog");
  await d.getByLabel("Transaction amount (USD)", { exact: true }).fill(value);
  await d.getByRole("button", { name: "Next", exact: true }).click();
  return d;
}
async function state(page: Page) {
  return page.evaluate(
    async () =>
      await new Promise<any>((resolve, reject) => {
        const r = indexedDB.open("cedar-olive-sample-v1", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db
              .transaction("workspace")
              .objectStore("workspace")
              .get("state");
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
test("global transaction wizard creates a named pledge, splits campaigns, defaults surplus to donation, and supports explicit credit and anonymous donations", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const gatewayRequests: string[] = [];
  page.on("request", (r) => {
    if (/api\/sola|api\/matbia|api\.matbia|supabase\.co/.test(r.url()))
      gatewayRequests.push(r.url());
  });
  await page.goto("/demo");
  let d = await start(page, "Transaction Browser Test");
  d = await amount(page, "60");
  await d.getByRole("button", { name: "Pledge", exact: true }).click();
  await d
    .getByLabel("Transaction campaign", { exact: true })
    .selectOption({ label: "Annual community appeal" });
  await d.getByRole("button", { name: "Create pledge", exact: true }).click();
  await expect(d).not.toBeVisible();
  await start(page, "Transaction Browser Test");
  d = await amount(page, "100");
  await d.getByRole("button", { name: "Cash", exact: true }).click();
  await expect(
    d.getByText("Apply to open pledges", { exact: true }),
  ).toBeVisible();
  await d.getByRole("button", { name: "Auto select", exact: true }).click();
  await expect(
    d.locator(".transaction-summary").getByText("$40.00", { exact: true }),
  ).toBeVisible();
  await expect(
    d
      .locator(".transaction-split")
      .getByText("Annual community appeal", { exact: false }),
  ).toBeVisible();
  await expect(
    d.getByRole("button", {
      name: "+ Add remainder as account credit",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(d).not.toBeVisible();
  let s = await state(page);
  const donor = s.tables.donors.find(
      (x: any) => x.name === "Transaction Browser Test",
    ),
    payment = s.tables.payments.find((x: any) => x.donor_id === donor.id);
  let allocations = s.tables.payment_allocations.filter(
    (a: any) => a.payment_id === payment.id,
  );
  expect(
    allocations
      .map((a: any) => a.amount_minor)
      .sort((a: number, b: number) => a - b),
  ).toEqual([4000, 6000]);
  const direct = s.tables.pledges.find(
    (p: any) => p.id === payment.direct_pledge_id,
  );
  expect(direct.campaign_id).toBe(s.organization.default_donation_campaign_id);
  expect(direct.source_type).toBe("direct_donation");
  await start(page, "Transaction Browser Test");
  d = await amount(page, "25");
  await d.getByRole("button", { name: "Cash", exact: true }).click();
  await d
    .getByRole("button", {
      name: "+ Add remainder as account credit",
      exact: true,
    })
    .click();
  await expect(d.locator(".transaction-split")).toContainText(
    "Donor account credit",
  );
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(d).not.toBeVisible();
  await start(page);
  d = await amount(page, "7");
  await d.getByRole("button", { name: "Cash", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Pledge", exact: true }),
  ).toBeDisabled();
  await expect(
    d.getByRole("button", {
      name: "+ Add remainder as account credit",
      exact: true,
    }),
  ).toHaveCount(0);
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(d).not.toBeVisible();
  await page.reload();
  s = await state(page);
  const credit = s.tables.payments.find(
    (p: any) => p.donor_id === donor.id && p.amount_minor === 2500,
  );
  expect(credit.remainder_mode).toBe("credit");
  expect(credit.direct_pledge_id).toBeUndefined();
  const anon = s.tables.donors.filter(
    (d: any) => d.system_role === "anonymous",
  );
  expect(anon).toHaveLength(1);
  const anonPayment = s.tables.payments.find(
    (p: any) => p.donor_id === anon[0].id,
  );
  expect(anonPayment.amount_minor).toBe(700);
  expect(anonPayment.direct_pledge_id).toBeTruthy();
  expect(errors).toEqual([]);
  expect(gatewayRequests).toEqual([]);
});
