import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e-electron",
  outputDir: ".artifacts/e2e-electron/results",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["junit", { outputFile: ".artifacts/e2e-electron/junit.xml" }]]
    : [["line"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
