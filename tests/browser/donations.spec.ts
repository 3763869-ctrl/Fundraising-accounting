import { test, expect } from "@playwright/test";
test("pledge allocation, explicit credit confirmation, paid archive, editable cards and ordered columns", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo?page=donors");
  await page
    .getByRole("button", { name: "Add new donor", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("First name", { exact: true }).fill("Donation");
  await dialog.getByLabel("Last name", { exact: true }).fill("Allocation Test");
  await dialog.getByRole("button", { name: "Save New Donor" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Pledges", exact: true }).click();
  await page.getByText("New donation", { exact: true }).click();
  await page.getByRole("button", { name: "New pledge", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor", { exact: true })
    .selectOption({ label: "Donation Allocation Test" });
  await dialog
    .getByLabel("Campaign", { exact: true })
    .selectOption({ label: "Annual community appeal" });
  await dialog.getByLabel("Pledge amount (USD)", { exact: true }).fill("100");
  await dialog.getByLabel("Receipt requested").selectOption("yes");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Search Pledges" })
    .fill("Donation Allocation Test");
  await expect(page.getByText("of 1 records", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Move Donor up", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Search columns" })
    .fill("Donor Email");
  await dialog
    .getByRole("checkbox", { name: "Donor Email", exact: true })
    .check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("thead th").nth(1)).toContainText("Donor");
  await expect(
    page.getByRole("columnheader", { name: "Donor Email", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("thead th").nth(1)).toContainText("Donor");
  await page
    .getByRole("textbox", { name: "Search Pledges" })
    .fill("Donation Allocation Test");
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page.getByRole("button", { name: "Edit pledge", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor-visible description")
    .fill("A public pledge description");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByText("New donation", { exact: true }).click();
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor", { exact: true })
    .selectOption({ label: "Donation Allocation Test" });
  await dialog.getByLabel("Payment amount (USD)", { exact: true }).fill("20");
  await dialog
    .getByLabel("Goes to / Campaign", { exact: false })
    .selectOption({ label: "Annual community appeal" });
  await dialog
    .getByRole("button", { name: "Save payment", exact: true })
    .click();
  await expect(
    dialog.getByText("This donor has open pledges.", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("checkbox", {
      name: "I confirm: do not apply this payment to any pledge.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Save payment", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  // Unapplied credit must not close the pledge.
  await expect(page.getByText("of 1 records", { exact: false })).toBeVisible();
  await page.getByText("New donation", { exact: true }).click();
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor", { exact: true })
    .selectOption({ label: "Donation Allocation Test" });
  await dialog.getByLabel("Payment amount (USD)", { exact: true }).fill("100");
  await dialog
    .getByLabel("Goes to / Campaign", { exact: false })
    .selectOption({ label: "Annual community appeal" });
  await dialog
    .getByRole("button", { name: "Auto select: exact match, then oldest" })
    .click();
  await expect(
    dialog.getByRole("spinbutton", { name: /^Allocation / }),
  ).toHaveValue("100.00");
  await page.screenshot({
    path: "test-results/donation-allocation.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Save payment", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No pledges found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "All pledges (including paid & void)" })
    .click();
  await expect(
    page.getByRole("cell", { name: "Paid", exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Actions /).click();
  await expect(
    page.getByRole("button", {
      name: "Print Invoice / Statement",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Print Invoice / Statement", exact: true })
    .click();
  await expect(page.locator(".receipt-document")).toContainText(
    "A public pledge description",
  );
  await expect(page.locator(".receipt-document")).toContainText(
    "Open balance: $0.00",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Payments" })
    .fill("Donation Allocation Test");
  await expect(page.getByText("of 2 records", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
