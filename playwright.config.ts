import { defineConfig, devices } from "@playwright/test"

import { CLIPBOARD_CLEAR_MS } from "./tests/e2e/clipboard-clear-timing"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev --hostname 127.0.0.1 --port 3100",
    env: {
      APP_ORIGIN: "http://127.0.0.1:3100",
      AUTH_TRUSTED_IP_HEADER: "x-e2e-client-ip",
      NEXT_PUBLIC_CLIPBOARD_CLEAR_MS: String(CLIPBOARD_CLEAR_MS),
    },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
})
