import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Isolated browser harness: fake public key, mocked SDK and mocked application
// API. No provider or production credentials are loaded by these tests.
let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    write: false,
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SolaLivePayment}from'./components/sola-live-payment';window.setAccount=()=>{};window.getTokens=(success)=>{document.querySelector('[data-ifields-id="card-number-token"]').value='masked;sut_synthetic_card';document.querySelector('[data-ifields-id="cvv-token"]').value='xxx;sut_synthetic_cvv';success();};createRoot(document.getElementById('root')).render(<SolaLivePayment ifieldsKey="fake-public-sandbox-test-key" donors={[{id:'00000000-0000-0000-0000-000000000001',name:'Synthetic donor'}]} limit={10000}/>);`,
    },
    plugins: [
      {
        name: "next-test-stubs",
        setup(b) {
          b.onResolve({ filter: /^next\/(script|link)$/ }, (args) => ({
            path: args.path,
            namespace: "test-stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "test-stub" }, (args) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              args.path === "next/script"
                ? `import{useEffect}from'react';export default function Script({onReady}){useEffect(()=>{onReady()},[]);return null;}`
                : `import React from'react';export default function Link({href,children}){return <a href={href}>{children}</a>;}`,
          }));
          b.onResolve({ filter: /^@\// }, (args) => ({
            path: path.join(process.cwd(), args.path.slice(2) + ".ts"),
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function openHarness(page: import("@playwright/test").Page) {
  await page.route("**/ifields/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><p>Mock hosted field</p>",
    }),
  );
  await page.route("**/sola-test-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="root"></div>',
    }),
  );
  await page.goto("/sola-test-harness");
  await page.addScriptTag({ content: bundle });
}
test("live card form submits once, clears nonce fields and retains only its request UUID", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/sola/payments**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { state: "not_started" } });
    posts++;
    const input = route.request().postDataJSON();
    expect(input.amount_minor).toBe(123);
    expect(input.consent).toBe(true);
    expect(input.card_token).toBe("masked;sut_synthetic_card");
    expect(
      await page.locator('[data-ifields-id="card-number-token"]').inputValue(),
    ).toBe("");
    await route.fulfill({
      json: {
        state: "approved",
        reference: "SYNTHETIC123",
        payment: "fake-payment",
      },
    });
  });
  await openHarness(page);
  await page
    .getByRole("combobox", { name: "Donor", exact: true })
    .selectOption("00000000-0000-0000-0000-000000000001");
  await page.getByLabel("Amount (USD)").fill("1.23");
  await page.getByLabel("Expiration (MMYY)").fill("1250");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Charge $1.23", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(
    page.getByRole("heading", { name: "Payment approved and recorded" }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const stored = await page.evaluate(() => Object.entries(sessionStorage));
  expect(stored).toHaveLength(1);
  expect(stored[0][1]).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.locator("iframe")).toHaveCount(0);
});
test("a lost response blocks resubmission and reload checks status without charging again", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/sola/payments**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { state: posts ? "sending" : "not_started" },
      });
    posts++;
    await route.abort("failed");
  });
  await openHarness(page);
  await page
    .getByRole("combobox", { name: "Donor", exact: true })
    .selectOption("00000000-0000-0000-0000-000000000001");
  await page.getByLabel("Amount (USD)").fill("1.23");
  await page.getByLabel("Expiration (MMYY)").fill("1250");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Charge $1.23", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment needs review — do not retry" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start another payment" }),
  ).toHaveCount(0);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await expect(
    page.getByRole("heading", { name: "Payment needs review — do not retry" }),
  ).toBeVisible();
  expect(posts).toBe(1);
});
