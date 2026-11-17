import { defineConfig } from "@playwright/test";

// Cash register e2e on its own ports, beside other sessions' servers: web 3700, the Spring
// stand-in for /api/cash 8700 and the auth provider fixture 3701. One worker, one Chromium
// (the msedge channel the repo already uses on Windows: no browser download). Needs a previous
// `npm run build`; run with `npx playwright test -c playwright.cash.config.ts`.
const WEB = 3700;
const BACKEND = 8700;
const PROVIDER = 3701;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "cash.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  updateSnapshots: "none",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${WEB}`,
    viewport: { width: 1024, height: 768 },
    browserName: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
  webServer: [
    {
      command: "node tests/helpers/auth-provider-server.mjs",
      url: `http://127.0.0.1:${PROVIDER}/health`,
      reuseExistingServer: false,
      env: { AUTH_PROVIDER_PORT: String(PROVIDER), E2E_WEB_PORT: String(WEB) },
    },
    {
      command: "node tests/helpers/cash-backend-server.mjs",
      url: `http://127.0.0.1:${BACKEND}/health`,
      reuseExistingServer: false,
      env: {
        CASH_BACKEND_PORT: String(BACKEND),
        AUTH_PROVIDER_PORT: String(PROVIDER),
      },
    },
    {
      command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${WEB}`,
      url: `http://localhost:${WEB}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_URL: `http://127.0.0.1:${BACKEND}`,
        SUPABASE_URL: `http://127.0.0.1:${PROVIDER}`,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_FAKE_E2E_ONLY_NOT_A_REAL_KEY",
      },
    },
  ],
});
