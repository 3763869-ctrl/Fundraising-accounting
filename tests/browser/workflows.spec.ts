import { test, expect } from "@playwright/test";

test("connected sample workflows, persistent allocations, Hebrew receipts, and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("SAMPLE DATA", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Donors", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Donors", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1–10 of 16 records")).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("11–16 of 16 records")).toBeVisible();
  await page
    .getByRole("button", { name: "Add new donor", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("First name", { exact: true }).fill("Test");
  await dialog.getByLabel("Last name", { exact: true }).fill("donor workflow");
  await dialog.getByLabel("Primary email").fill("workflow@example.test");
  await dialog.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByLabel("Hebrew name").fill("תורם לדוגמה");
  await dialog.getByLabel("Receipt language").selectOption("he");
  await dialog
    .getByRole("button", { name: "Notes, tags & attachments", exact: true })
    .click();
  await dialog
    .getByLabel("Notes", { exact: true })
    .fill("Created in the browser test.");
  await dialog.getByRole("button", { name: "Save New Donor" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Search Donors", exact: true })
    .fill("Test donor workflow");
  await expect(
    page.getByRole("cell", { name: "Test donor workflow", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search Donors", exact: true })
    .fill("Test donor workflow");
  await expect(
    page.getByRole("cell", { name: "Test donor workflow", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page.getByRole("button", { name: "Edit donor", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Notes, tags & attachments", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Notes", { exact: true })
    .fill("Updated and persisted contact notes.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save Donor" })
    .click();
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await expect(
    page.getByText("Updated and persisted contact notes."),
  ).toBeVisible();
  await page.getByLabel("Add donor attachment").setInputFiles({
    name: "sample-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic attachment for browser validation."),
  });
  await expect(
    page.getByRole("button", { name: "sample-note.txt", exact: true }),
  ).toBeVisible();
  const attachment = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "sample-note.txt", exact: true })
    .click();
  expect((await attachment).suggestedFilename()).toBe("sample-note.txt");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Pledges", exact: true }).click();
  await page
    .getByRole("button", { name: "Add new pledge", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor", { exact: false })
    .first()
    .selectOption({ label: "Test donor workflow" });
  await dialog
    .getByLabel("Campaign", { exact: false })
    .first()
    .selectOption({ label: "Annual community appeal" });
  await dialog.getByLabel("Pledge amount").fill("100.01");
  await dialog.getByLabel("Due date").fill("2027-01-31");
  await dialog.getByLabel("Receipt requested").selectOption("yes");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page
    .getByRole("button", { name: "Add new payment", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor", { exact: false })
    .first()
    .selectOption({ label: "Test donor workflow" });
  await dialog.getByLabel("Payment amount").fill("120.01");
  await dialog.getByLabel("Method", { exact: false }).selectOption("check");
  await dialog.getByLabel("Status", { exact: false }).selectOption("processed");
  await dialog
    .getByRole("spinbutton", {
      name: "Allocate to Annual community appeal",
      exact: true,
    })
    .fill("100.01");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Search Payments", exact: true })
    .fill("Test donor workflow");
  await expect(
    page.getByRole("cell", { name: "$20.00", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page
    .getByRole("button", { name: "Create acknowledgment", exact: true })
    .click();
  await expect(page.locator(".receipt-document")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("תורם לדוגמה", { exact: true })).toBeVisible();
  await expect(page.getByText("SAMPLE — NOT A TAX RECEIPT")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: "test-results/receipt.pdf" });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("link", { name: "Fundraising reports", exact: true })
    .click();
  await page.getByLabel("Report", { exact: true }).selectOption("payments");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  await file.saveAs("test-results/report.xlsx");
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile("test-results/report.xlsx");
  expect(typeof workbook.worksheets[0].getCell(2, 5).value).toBe("number");
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".calendar-grid")).toBeVisible();
  await expect(page.locator(".holiday").first()).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".app-frame")).toHaveClass(/nav-collapsed/);
  expect(errors).toEqual([]);
});

test("schedule fulfillment, batch entry, task completion, and organization settings", async ({
  page,
}) => {
  await page.goto("/demo?page=schedules");
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Miriam Cohen", exact: true }),
  });
  await row.getByRole("button", { name: "View →" }).click();
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Payment amount")).toHaveValue("300");
  await dialog.getByLabel("Method", { exact: false }).selectOption("check");
  await dialog.getByLabel("Status", { exact: false }).selectOption("processed");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).not.toBeVisible();
  await row.getByRole("button", { name: "View →" }).click();
  await expect(
    page.getByRole("dialog").getByRole("cell", { name: "Paid", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Pause plan" }).click();
  await expect(page.getByRole("button", { name: "Resume plan" })).toBeVisible();
  await page.getByRole("button", { name: "Resume plan" }).click();
  await expect(page.getByRole("button", { name: "Pause plan" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page.getByRole("button", { name: "Batch entry" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Donor", { exact: false })
    .selectOption({ label: "Miriam Cohen" });
  await dialog.getByLabel("Amount (USD)").fill("18");
  await dialog.getByRole("button", { name: "Add payment row" }).click();
  await dialog
    .getByLabel("Donor", { exact: false })
    .nth(1)
    .selectOption({ label: "Jacob Stein" });
  await dialog.getByLabel("Amount (USD)").nth(1).fill("36");
  await dialog.getByRole("button", { name: "Record 2 payments" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "View →" }).first().click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByRole("button", { name: "Reopen task" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name: "Edit organization" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: false })
    .first()
    .fill("Test community settings");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save record" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Test community settings" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Test community settings" }),
  ).toBeVisible();
});

test("saved views, selection, column customization, and mobile navigation", async ({
  page,
}) => {
  await page.goto("/demo?page=donors");
  await page.getByRole("textbox", { name: "Search Donors" }).fill("Cohen");
  await page.getByText("Views", { exact: true }).click();
  await page.getByLabel("View name").fill("Cohen view");
  await page.getByRole("button", { name: "Save current view" }).click();
  await page.getByRole("textbox", { name: "Search Donors" }).fill("");
  await page.getByRole("button", { name: "Cohen view", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search Donors" }),
  ).toHaveValue("Cohen");
  await page.getByText("Views", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Select this page" }).check();
  await expect(page.getByText("1 selected", { exact: false })).toBeVisible();
  await page.getByText("Columns", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Email", exact: true }).uncheck();
  await expect(
    page.getByRole("columnheader", { name: "Email", exact: false }),
  ).not.toBeVisible();
  await page.getByText("Columns", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("accounting ledger, bank match/create, reports, and reconciliation", async ({
  page,
}) => {
  await page.goto("/demo?page=transactions");
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search Transactions" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Bank feed", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Bank feed" })
    .fill("Unmatched incoming transfer");
  await page.getByRole("button", { name: "View →" }).click();
  await page
    .getByRole("button", { name: "Create new transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Income / expense category", { exact: true })
    .selectOption({ label: "4100 · Other income" });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save accounting record" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "matched", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Financial reports", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "TOTAL INCOME", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Accounting basis").selectOption("cash");
  await expect(
    page.getByRole("cell", { name: "NET OPERATING RESULT", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Financial report", { exact: true })
    .selectOption("balance");
  await expect(
    page.getByRole("cell", { name: "TOTAL ASSETS", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reconciliation", exact: true }).click();
  await page
    .getByRole("button", { name: "Reconcile statement", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Bank account", { exact: true })
    .selectOption({ label: "1000 · Chase operating account" });
  await page.getByRole("dialog").getByRole("checkbox").check();
  const ending = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("cedar-olive-sample-v1");
      request.onsuccess = () => resolve(request.result);
    });
    const state = await new Promise<any>((resolve) => {
      const request = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("state");
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return (state.tables.reconciliations[0].ending_balance_minor + 18000) / 100;
  });
  await page.getByLabel("Statement ending balance (USD)").fill(String(ending));
  await page.getByRole("button", { name: "Complete reconciliation" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("1–2 of 2 records")).toBeVisible();
  await page.getByRole("link", { name: "Print checks", exact: true }).click();
  await page.getByRole("button", { name: "View →" }).click();
  await expect(
    page.getByText("SAMPLE · CHECK PAYMENT VOUCHER — NOT NEGOTIABLE"),
  ).toBeVisible();
});

test("operations settings, role safeguards, custom fields, and API authentication", async ({
  page,
  request,
}) => {
  await page.goto("/demo?page=users");
  await page.getByRole("button", { name: "Invite user", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Invite email").fill("new-staff@example.test");
  await dialog.getByLabel("Role", { exact: true }).selectOption("viewer");
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByLabel("Invitation link")).toHaveValue(/SAMPLE ONLY/);
  await page
    .getByRole("button", { name: "View →", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Change role" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("New role").selectOption("viewer");
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(dialog.getByRole("alert")).toContainText("retain an owner");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("link", { name: "Modules & custom fields", exact: true })
    .click();
  await page.getByRole("button", { name: "Add new", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Membership number");
  await dialog.getByLabel("Field key").fill("membership_number");
  await dialog.getByLabel("Field type").selectOption("number");
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("cell", { name: "Membership number", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Donors", exact: true }).click();
  await page
    .getByRole("button", { name: "Add new donor", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("First name", { exact: true }).fill("Operations");
  await dialog.getByLabel("Last name", { exact: true }).fill("donor");
  await dialog
    .getByRole("button", { name: "Custom Fields", exact: true })
    .click();
  await dialog.getByLabel("Membership number").fill("42");
  await dialog.getByRole("button", { name: "Save New Donor" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Automations", exact: true }).click();
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page.getByRole("button", { name: "Disable rule" }).click();
  await expect(page.getByRole("button", { name: "Enable rule" })).toBeVisible();
  await page.getByRole("button", { name: "Enable rule" }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page.getByRole("button", { name: "Pending", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Payments" })
    .fill("Ben & Leah Adler");
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page.getByRole("button", { name: "Mark failed", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark failed", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("link", { name: "Background jobs", exact: true })
    .click();
  await expect(page.getByText("1–2 of 2 records")).toBeVisible();
  expect(
    (
      await request.get(
        "/api/v1/donors?organization_id=00000000-0000-0000-0000-000000000001",
      )
    ).status(),
  ).toBe(401);
  expect((await request.get("/api/v1/not-a-resource")).status()).toBe(404);
  expect((await request.get("/api")).status()).toBe(200);
});
