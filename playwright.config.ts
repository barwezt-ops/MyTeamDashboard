import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./web/test",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:3210",
    permissions: ["clipboard-read", "clipboard-write"],
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npm run build:smoke && node --import tsx web/test/start-smoke.ts",
    url: "http://127.0.0.1:3210/api/health",
    timeout: 90_000,
    reuseExistingServer: false,
  },
});
