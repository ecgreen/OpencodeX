import { defineConfig } from "@playwright/test"

const hostChrome = process.env.OPENCODEX_GUI_E2E_HOST_CHROME === "1"

export default defineConfig({
  testDir: "e2e",
  outputDir: ".artifacts/e2e/results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["junit", { outputFile: ".artifacts/e2e/junit.xml" }]]
    : [["line"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: hostChrome ? "chrome" : undefined,
    colorScheme: "dark",
    launchOptions: {
      args: [
        "--enable-gpu",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        ...(hostChrome && process.platform === "win32" ? ["--use-angle=d3d11"] : []),
      ],
    },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: "bun run scripts/e2e-server.ts",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
