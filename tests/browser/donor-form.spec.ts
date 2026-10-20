import { test, expect } from "@playwright/test";

test("compact donor entry persists labeled contacts, explicit consent and structured addresses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/demo?page=donors");
  await page
    .getByRole("button", { name: "Add new donor", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("First name", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Home phone", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Cell phone", { exact: true })).toBeVisible();
  await expect(
    dialog.getByLabel("Business phone", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("English / internal name", { exact: true }),
  ).not.toBeVisible();
  await expect(
    dialog.getByLabel("Additional email 1", { exact: true }),
  ).not.toBeVisible();
  await expect(
    dialog.getByLabel("Primary address line 1", { exact: true }),
  ).not.toBeVisible();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Donor agrees to text messages for donations and pledges",
      exact: true,
    }),
  ).not.toBeChecked();
  await page.screenshot({
    path: "test-results/add-donor-mobile.png",
    fullPage: true,
  });
  await dialog.getByLabel("Title", { exact: true }).fill("Rabbi");
  await dialog.getByLabel("First name", { exact: true }).fill("שלום");
  await dialog.getByLabel("Last name", { exact: true }).fill("Review");
  await dialog
    .getByRole("button", { name: "Add English / internal name", exact: true })
    .click();
  await dialog
    .getByLabel("English / internal name", { exact: true })
    .fill("Shalom Review");
  await dialog
    .getByLabel("Home phone", { exact: true })
    .fill("+1 212 555 0100");
  await dialog
    .getByLabel("Cell phone", { exact: true })
    .fill("+1 917 555 0101");
  await dialog
    .getByLabel("Business phone", { exact: true })
    .fill("+1 646 555 0102");
  await dialog
    .getByRole("checkbox", {
      name: "Donor agrees to text messages for donations and pledges",
      exact: true,
    })
    .check();
  await dialog
    .getByLabel("Primary email", { exact: true })
    .fill("shalom@example.test");
  await dialog
    .getByRole("button", { name: "Add another email", exact: true })
    .click();
  await dialog
    .getByLabel("Additional email 1", { exact: true })
    .fill("office@example.test");
  await dialog
    .getByRole("button", { name: "Add another name", exact: true })
    .click();
  await dialog
    .getByLabel("Additional name 1", { exact: true })
    .fill("שלום בן דוד");
  await dialog
    .getByRole("button", { name: "Address Details", exact: true })
    .click();
  await expect(
    dialog.getByLabel("First name", { exact: true }),
  ).not.toBeVisible();
  await dialog
    .getByLabel("Primary address number", { exact: true })
    .fill("123");
  await dialog
    .getByLabel("Primary address line 1", { exact: true })
    .fill("Sample Street");
  await dialog.getByLabel("Primary city", { exact: true }).fill("Brooklyn");
  await dialog.getByLabel("State", { exact: true }).first().fill("NY");
  await dialog
    .getByLabel("Business address line 1", { exact: true })
    .fill("Business Road");
  await page.screenshot({
    path: "test-results/add-donor-address-mobile.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Save New Donor", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search Donors", exact: true })
    .fill("שלום Review");
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page.getByRole("button", { name: "Edit donor", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("English / internal name", { exact: true }),
  ).toHaveValue("Shalom Review");
  await expect(dialog.getByLabel("Cell phone", { exact: true })).toHaveValue(
    "+1 917 555 0101",
  );
  await expect(
    dialog.getByRole("checkbox", {
      name: "Donor agrees to text messages for donations and pledges",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    dialog.getByLabel("Additional email 1", { exact: true }),
  ).toHaveValue("office@example.test");
  await expect(
    dialog.getByLabel("Additional name 1", { exact: true }),
  ).toHaveValue("שלום בן דוד");
  await dialog
    .getByRole("checkbox", {
      name: "Donor agrees to text messages for donations and pledges",
      exact: true,
    })
    .uncheck();
  await dialog
    .getByRole("button", { name: "Address Details", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Primary address number", { exact: true }),
  ).toHaveValue("123");
  await expect(
    dialog.getByLabel("Primary address line 1", { exact: true }),
  ).toHaveValue("Sample Street");
  await dialog.getByRole("button", { name: "Save Donor", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "View →", exact: true }).click();
  await page.getByRole("button", { name: "Edit donor", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Donor agrees to text messages for donations and pledges",
      exact: true,
    }),
  ).not.toBeChecked();
});
