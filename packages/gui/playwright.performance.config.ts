import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e-performance",
  outputDir: ".artifacts/e2e-performance/results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["line"],
        ["junit", { outputFile: ".artifacts/e2e-performance/junit.xml" }],
        ["json", { outputFile: ".artifacts/e2e-performance/report.json" }],
      ]
    : [["line"], ["json", { outputFile: ".artifacts/e2e-performance/report.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    colorScheme: "dark",
    contextOptions: { reducedMotion: "reduce" },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: "bun run scripts/e2e-server.ts --production-renderer",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
