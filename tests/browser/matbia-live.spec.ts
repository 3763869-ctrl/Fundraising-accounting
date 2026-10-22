import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { readFile } from "node:fs/promises";
let bundle: string;
const org = "00000000-0000-0000-0000-000000000001",
  donor = "00000000-0000-0000-0000-000000000002",
  saved = "00000000-0000-0000-0000-000000000003";
test.beforeAll(async () => {
  const r = await build({
    write: false,
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MatbiaPayment}from'./components/matbia-payment';import{tableNames}from'./lib/workspace/domain';const data={organization:{id:'${org}'},role:'owner',tables:Object.fromEntries(tableNames.map(t=>[t,[]]))};if(new URLSearchParams(location.search).has('pending'))data.tables.payments.push({id:'${saved}',provider:'matbia',status:'pending',donor_id:'${donor}',idempotency_key:'${saved}'});createRoot(document.getElementById('root')).render(<MatbiaPayment data={data} demo={false} donor='${donor}' amount='25' onSave={async()=>{throw Error('Unexpected manual entry')}} onRecorded={async()=>{window.recorded=true}} onBusy={()=>{}} beforeSubmit={()=>({organization:'${org}',allocations:[],donation:{campaign_id:'${org}',collector:'',description:'Synthetic note',credit_confirmed:true,remainder_mode:'donation'}})}/>);`,
    },
    plugins: [
      {
        name: "alias",
        setup(b) {
          b.onResolve({ filter: /^@\// }, (args) => ({
            path: path.join(process.cwd(), args.path.slice(2) + ".ts"),
          }));
        },
      },
    ],
  });
  bundle = r.outputFiles[0].text;
});
async function open(page: Page, pending = false) {
  await page.route("**/matbia-live-harness**", (r) =>
    r.fulfill({
      body: '<!doctype html><html><body><div id="root"></div></body></html>',
      contentType: "text/html",
    }),
  );
  await page.route("**/api/matbia/config**", (r) =>
    r.fulfill({ json: { enabled: true, limit: 10000 } }),
  );
  await page.goto("/matbia-live-harness" + (pending ? "?pending=1" : ""));
  await page.addStyleTag({
    content: await readFile("app/globals.css", "utf8"),
  });
  await page.addStyleTag({
    content: await readFile("app/workspace.css", "utf8"),
  });
  await page.addScriptTag({ content: bundle });
}
async function fill(page: Page) {
  await page
    .getByLabel("Matbia card number", { exact: true })
    .fill("8628240000000000");
  await page.getByLabel("Expiration (MM/YY)", { exact: true }).fill("1250");
  await page
    .getByRole("checkbox", {
      name: "I have permission to charge this Matbia card once.",
      exact: true,
    })
    .check();
}
test("Matbia direct entry formats pasted input, validates expiration, posts once and never saves card details in browser storage", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/matbia/payments**", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { state: "not_started" } });
    posts++;
    const b = r.request().postDataJSON();
    expect(b.card_number).toBe("8628240000000000");
    expect(b.expiry).toBe("1250");
    expect(b.amount_minor).toBe(2500);
    expect(b.consent).toBe(true);
    expect(b.donation.remainder_mode).toBe("donation");
    expect(
      await page.getByLabel("Matbia card number", { exact: true }).count(),
    ).toBe(0);
    return r.fulfill({
      json: {
        state: "approved",
        payment: "synthetic",
        reference: "SYNTHETIC_ONLY",
      },
    });
  });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Pay with Matbia $25.00", exact: true }),
  ).toBeDisabled();
  await fill(page);
  const number = page.getByLabel("Matbia card number", { exact: true });
  await expect(number).toHaveValue("8628 2400 0000 0000");
  await expect(number).toHaveAttribute("type", "password");
  await page
    .getByRole("button", { name: "Show Matbia card number", exact: true })
    .click();
  await expect(number).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Hide Matbia card number", exact: true })
    .click();
  await expect(
    page.getByLabel("Expiration (MM/YY)", { exact: true }),
  ).toHaveValue("12/50");
  await page.getByLabel("Expiration (MM/YY)", { exact: true }).fill("1299");
  await expect(
    page.getByRole("button", { name: "Pay with Matbia $25.00", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Expiration (MM/YY)", { exact: true }).fill("0100");
  await expect(page.getByRole("alert")).toContainText("must not be expired");
  await expect(
    page.getByRole("button", { name: "Pay with Matbia $25.00", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Expiration (MM/YY)", { exact: true }).fill("1250");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".matbia-entry")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Pay with Matbia $25.00", exact: true })
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect(
    page.getByRole("heading", {
      name: "Matbia payment approved and recorded",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const values = await page.evaluate(() => [
    ...Object.values(sessionStorage),
    ...Object.values(localStorage),
  ]);
  expect(values).toHaveLength(1);
  expect(values.join(" ")).not.toContain("862824");
  expect(values.join(" ")).not.toContain("1250");
});
test("an interrupted Matbia request stays blocked and reload checks the saved attempt without posting again", async ({
  page,
}) => {
  let posts = 0,
    key = "";
  await page.route("**/api/matbia/payments**", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { state: key ? "unknown" : "not_started" } });
    posts++;
    key = r.request().postDataJSON().request_key;
    return r.abort("failed");
  });
  await open(page);
  await fill(page);
  await page
    .getByRole("button", { name: "Pay with Matbia $25.00", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Matbia payment needs review — do not retry",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Start another Matbia payment",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await expect(
    page.getByRole("heading", {
      name: "Matbia payment needs review — do not retry",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(1);
});
test("reviewing a pending Matbia donor payment restores its database request ID even without session storage", async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route("**/api/matbia/payments**", (r) => {
    expect(r.request().method()).toBe("GET");
    keys.push(new URL(r.request().url()).searchParams.get("request_key")!);
    return r.fulfill({ json: { state: "unknown" } });
  });
  await open(page, true);
  await expect(
    page.getByRole("heading", {
      name: "Matbia payment needs review — do not retry",
      exact: true,
    }),
  ).toBeVisible();
  expect(keys).toEqual([saved]);
  await expect(
    page.getByLabel("Matbia card number", { exact: true }),
  ).toHaveCount(0);
});
