import { expect, test, type Page, type TestInfo } from "@playwright/test"

test("renders through authoritative state and capabilities without legacy or idle polling", async ({
  page,
}, testInfo) => {
  const failures: string[] = []
  const requests: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text())
  })
  page.on("pageerror", (error) => failures.push(error.message))
  page.on("request", (request) => requests.push(new URL(request.url()).pathname))

  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await expect(page.getByRole("complementary", { name: "OpencodeX navigation" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Swarms" })).toBeVisible()
  await expect(page.getByText("Workspace", { exact: true })).toHaveCount(0)
  await expect(page.locator(".dashboard-overview")).toHaveCount(0)
  const sectionTitles = await page.locator(".dashboard-sections .dashboard-section-title").allTextContents()
  expect(sectionTitles.map((value) => value.replace(/\s*\(\d+\)\s*$/, ""))).toEqual([
    "Active sessions",
    "Views",
    "Swarms",
    "Projects",
  ])
  const createButtons = page.locator(".dashboard-section>header .ui-button", { hasText: "New" })
  await expect(createButtons).toHaveCount(4)
  await expect(createButtons.locator(".icon")).toHaveCount(4)
  await expect(page.locator(".error-card")).toHaveCount(0)
  expect(requests.filter((pathname) => pathname === "/experimental/opencodex/session-sync")).toEqual([])
  expect(requests).toEqual(
    expect.arrayContaining(["/experimental/opencodex/state", "/experimental/opencodex/state/capabilities"]),
  )
  expect(requests).not.toEqual(
    expect.arrayContaining(["/provider", "/config/providers", "/agent", "/command", "/lsp", "/formatter", "/mcp"]),
  )
  const logoAnimation = await page
    .locator(".opencodex-logo")
    .first()
    .evaluate(
      (element) =>
        new Promise<{ mutations: number; reducedMotion: boolean }>((resolve) => {
          let count = 0
          const observer = new MutationObserver((mutations) => (count += mutations.length))
          observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true })
          window.setTimeout(() => {
            observer.disconnect()
            resolve({ mutations: count, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches })
          }, 250)
        }),
    )
  expect(logoAnimation.reducedMotion).toBe(true)
  expect(logoAnimation.mutations).toBe(0)

  await attachScreenshot(page, testInfo, "dashboard-initial")

  await page.getByRole("button", { name: /^Swarms:/ }).click()
  await expect(page.locator(".swarms-page")).toBeVisible()
  await page.getByRole("button", { name: /^Dashboard:/ }).click()
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Swarms" })).toBeVisible()

  await page.waitForTimeout(250)
  const idleBaseline = synchronizedRequestCount(requests)
  await page.waitForTimeout(1_250)
  expect(synchronizedRequestCount(requests)).toBe(idleBaseline)
  expect(failures).toEqual([])

  await attachScreenshot(page, testInfo, "dashboard-after-navigation")
})

function synchronizedRequestCount(requests: string[]) {
  const synchronized = new Set([
    "/experimental/opencodex/state",
    "/experimental/opencodex/state/operations",
    "/experimental/opencodex/state/capabilities",
  ])
  return requests.filter((pathname) => synchronized.has(pathname)).length
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot })
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" })
}
