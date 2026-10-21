import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { readFile } from "node:fs/promises";
let bundle: string;
const donor = "00000000-0000-0000-0000-000000000001",
  org = "00000000-0000-0000-0000-000000000002",
  campaign = "00000000-0000-0000-0000-000000000003",
  pledge = "00000000-0000-0000-0000-000000000004",
  saved = "00000000-0000-0000-0000-000000000005";
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
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{DonationForm}from'./components/donation-form';import{DonorSavedCards}from'./components/donor-saved-cards';import{tableNames}from'./lib/workspace/domain';window.setAccount=()=>{};window.addIfieldKeyPressCallback=(fn)=>{window.cardIssuer=fn};window.setIfieldStyle=(field,style)=>{window.fieldStyles={...window.fieldStyles,[field]:style}};window.getTokens=(ok)=>{document.querySelector('[data-ifields-id="card-number-token"]').value='masked;sut_synthetic_card';document.querySelector('[data-ifields-id="cvv-token"]').value='xxx;sut_synthetic_cvv';ok();};const data={organization:{id:'${org}',name:'Synthetic organization'},role:'owner',tables:Object.fromEntries(tableNames.map((n)=>[n,[]]))};data.tables.donors=[{id:'${donor}',name:'Synthetic donor'}];data.tables.campaigns=[{id:'${campaign}',name:'Synthetic campaign'}];data.tables.pledges=[{id:'${pledge}',donor_id:'${donor}',campaign_id:'${campaign}',amount_minor:100,pledged_on:'2026-01-01',due_date:'2050-01-01'}];const profile=new URLSearchParams(location.search).has('profile');createRoot(document.getElementById('root')).render(profile?<DonorSavedCards organization='${org}' donor='${donor}' demo={false}/>:<DonationForm data={data} demo={false} onSave={async()=>{throw Error('Manual payment must not be called for cards')}} onClose={()=>{}} onRecorded={async()=>{window.recorded=true}}/>);`,
    },
    plugins: [
      {
        name: "next-test-stubs",
        setup(b) {
          b.onResolve({ filter: /^next\/(script|link)$/ }, (args) => ({
            path: args.path,
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              args.path === "next/script"
                ? `import{useEffect}from'react';export default function Script({onReady}){useEffect(()=>{onReady()},[]);return null}`
                : `import React from'react';export default function Link({href,children}){return <a href={href}>{children}</a>}`,
          }));
          b.onResolve({ filter: /^@\// }, (args) => ({
            path: path.join(process.cwd(), args.path.slice(2) + ".ts"),
          }));
        },
      },
    ],
  });
  bundle = r.outputFiles[0].text;
});
async function open(page: Page, profile = false) {
  await page.route("**/api/sola/config**", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        ifields_key: "fake-public-test-key",
        limit: 10000,
        vault_enabled: true,
      },
    }),
  );
  await page.route("https://cdn.cardknox.com/**", (r) =>
    r.fulfill({
      body: "<html>Mock hosted field</html>",
      contentType: "text/html",
    }),
  );
  await page.route("**/inline-card-harness**", (r) =>
    r.fulfill({
      body: '<!doctype html><html><body><div id="root"></div></body></html>',
      contentType: "text/html",
    }),
  );
  await page.goto("/inline-card-harness" + (profile ? "?profile=1" : ""));
  await page.addStyleTag({
    content: await readFile("app/globals.css", "utf8"),
  });
  await page.addStyleTag({
    content: await readFile("app/workspace.css", "utf8"),
  });
  await page.addScriptTag({ content: bundle });
}
async function donation(page: Page) {
  await page
    .getByRole("combobox", { name: "Donor", exact: true })
    .selectOption(donor);
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("1");
  await page
    .getByLabel("Goes to / Campaign", { exact: false })
    .selectOption(campaign);
  await page
    .getByRole("button", { name: "Auto select: exact match, then oldest" })
    .click();
  await page
    .getByRole("combobox", { name: "Payment method", exact: true })
    .selectOption("external_card");
}
test("credit-card choice opens secure fields in the same form and saves only with explicit permission", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/sola/cards**", (r) =>
    r.fulfill({ json: { cards: [] } }),
  );
  await page.route("**/api/sola/payments**", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { state: "not_started" } });
    posts++;
    const body = r.request().postDataJSON();
    expect(body.organization).toBe(org);
    expect(body.allocations).toEqual([
      { pledge_id: pledge, amount_minor: 100 },
    ]);
    expect(body.donation.campaign_id).toBe(campaign);
    expect(body.save_card).toBe(true);
    expect(body.save_consent).toBe(true);
    expect(body.card_token).toBe("masked;sut_synthetic_card");
    expect(
      await page.locator('[data-ifields-id="card-number-token"]').inputValue(),
    ).toBe("");
    return r.fulfill({
      json: {
        state: "approved",
        payment: "synthetic-payment",
        card_saved: true,
      },
    });
  });
  await open(page);
  await expect(page.locator("iframe")).toHaveCount(0);
  await donation(page);
  await expect(page.locator("iframe")).toHaveCount(2);
  for (const [issuer, label] of [
    ["visa", "Visa"],
    ["mastercard", "Mastercard"],
    ["amex", "American Express"],
  ]) {
    await page.evaluate(
      (issuer) => (window as any).cardIssuer({ issuer }),
      issuer,
    );
    await expect(
      page.getByLabel(`${label} detected`, { exact: true }),
    ).toHaveClass(/is-active/);
  }
  await page.evaluate(() => (window as any).cardIssuer({ issuer: "unknown" }));
  await expect(page.locator(".card-network.is-active")).toHaveCount(0);
  expect(
    await page
      .locator("#live-sola-card")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(56);
  expect(
    await page.evaluate(
      () => (window as any).fieldStyles["card-number"]["font-size"],
    ),
  ).toBe("19px");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".card-entry-surface")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(page.locator("form")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Sola/ })).toHaveCount(0);
  const save = page.getByRole("checkbox", { name: /Save card to donor file/ });
  await expect(save).not.toBeChecked();
  await save.check();
  await page.getByLabel("Expiration (MMYY)").fill("1250");
  await page.getByLabel("ZIP code", { exact: true }).fill("11211");
  await page
    .getByRole("checkbox", {
      name: "I have the cardholder’s permission to charge this amount once.",
    })
    .check();
  await page
    .getByRole("button", { name: "Charge $1.00", exact: true })
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect(
    page.getByRole("heading", { name: "Payment approved and recorded" }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await expect(
    page.getByText("Card saved to this donor’s file."),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.values(sessionStorage))).toHaveLength(
    1,
  );
});
test("a saved card sends its record ID, without card number, CVV or reusable provider token", async ({
  page,
}) => {
  await page.route("**/api/sola/cards**", (r) =>
    r.fulfill({
      json: {
        cards: [{ id: saved, brand: "Visa", last4: "1111", expiry: "1250" }],
      },
    }),
  );
  let body: Record<string, unknown> = {};
  await page.route("**/api/sola/payments**", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { state: "not_started" } });
    body = r.request().postDataJSON();
    return r.fulfill({ json: { state: "approved" } });
  });
  await open(page);
  await donation(page);
  await page.getByRole("combobox", { name: "Card to use" }).selectOption(saved);
  await expect(page.locator("iframe")).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: "I have the cardholder’s permission to charge this amount once.",
    })
    .check();
  await page.getByRole("button", { name: "Charge $1.00", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment approved and recorded" }),
  ).toBeVisible();
  expect(body.saved_card).toBe(saved);
  expect(body.card_token).toBeUndefined();
  expect(body.cvv_token).toBeUndefined();
  expect(body.expiry).toBeUndefined();
  expect(body.save_card).toBeUndefined();
});
test("donor profile can save a card without creating a charge", async ({
  page,
}) => {
  let posted = false;
  await page.route("**/api/sola/cards**", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({
        json: r.request().url().includes("request_key")
          ? { state: "not_started" }
          : {
              cards: posted
                ? [{ id: saved, brand: "Visa", last4: "1111", expiry: "1250" }]
                : [],
            },
      });
    posted = true;
    const body = r.request().postDataJSON();
    expect(body.donor).toBe(donor);
    expect(body.save_consent).toBe(true);
    expect(body.amount_minor).toBeUndefined();
    return r.fulfill({ json: { state: "approved", card_saved: true } });
  });
  let charges = 0;
  await page.route("**/api/sola/payments**", (r) => {
    charges++;
    return r.abort();
  });
  await open(page, true);
  await page.getByRole("button", { name: "Add card to donor file" }).click();
  await page.getByLabel("Expiration (MMYY)").fill("1250");
  await page
    .getByRole("checkbox", {
      name: "I have the cardholder’s permission to save this card to this donor’s file for future donations.",
    })
    .check();
  await page
    .getByRole("button", { name: "Save card to donor file", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Card saved to donor file" }),
  ).toBeVisible();
  await expect(page.getByText("Visa •••• 1111 · Expires 12/50")).toBeVisible();
  expect(charges).toBe(0);
});
