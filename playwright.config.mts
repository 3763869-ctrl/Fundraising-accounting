import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1050 },
    launchOptions: {
      executablePath: await chromium.executablePath(),
      args: chromium.args.filter((arg) => arg !== "--single-process"),
      env: { ...process.env, XDG_CACHE_HOME: "/tmp/fundraising-browser-cache" },
    },
  },
  webServer: {
    command:
      process.env.E2E_PRODUCTION === "1"
        ? "npm run start -- --port 3100"
        : "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
