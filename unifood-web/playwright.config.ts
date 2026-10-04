import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: externalBaseURL || "http://localhost:3100",
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    defaultBrowserType: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command: "node tests/helpers/auth-provider-server.mjs",
          url: "http://127.0.0.1:3101/health",
          reuseExistingServer: false,
        },
        {
          command: "npm run dev -- --port 3100",
          url: "http://localhost:3100/login",
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            API_URL: "http://127.0.0.1:3101",
            SUPABASE_URL: "http://127.0.0.1:3101",
            SUPABASE_PUBLISHABLE_KEY: "opaque-public-key-test-only",
          },
        },
      ],
});
