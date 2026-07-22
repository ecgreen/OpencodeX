import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"
import { environmentCeiling, PERFORMANCE_BUDGETS } from "../e2e-performance/performance-budgets"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}
const viewports = [
  { width: 980, height: 680 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
] as const
for (const viewport of viewports) {
  for (const theme of ["dark", "light"] as const) {
    for (const motion of ["no-preference", "reduce"] as const) {
      test(`captures precision slice at ${viewport.width}x${viewport.height}, ${theme}, ${motion}`, async ({
        page,
        request,
      }, testInfo) => {
        const visualFixture = await createFixture(request, testInfo)
        await configurePage(page, viewport, theme, motion)
        await page.goto("/")
        await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
        const sessionCard = page
          .locator(".dashboard-active-sessions .session-link-shell", { hasText: visualFixture.sessionTitle })
          .first()
        await expect(sessionCard).toBeVisible()
        await expectNavigationContract(page)
        await expect(page.getByRole("button", { name: "New session", exact: true }).first()).toBeVisible()
        await expect(page.locator(".dashboard-page .row-actions")).toHaveCount(0)
        await expectNoDocumentOverflow(page)
        await attachScreenshot(page, testInfo, `dashboard-${viewport.width}-${theme}-${motion}`)

        await sessionCard.click({ button: "right" })
        await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible()
        await page.keyboard.press("Escape")
        await sessionCard.locator(".session-link").click()
        await expect(page.locator(".session-page")).toBeVisible()
        await expect(page.locator(".transcript-shell")).toBeVisible()
        await expect(page.locator(".composer-input")).toBeVisible()
        await expectNoDocumentOverflow(page)
        await attachScreenshot(page, testInfo, `session-${viewport.width}-${theme}-${motion}`)
      })
    }
  }
}

test("records navigation, collapse, disclosure, session opening, and composer focus", async ({
  browser,
  request,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir: testInfo.outputPath("interaction-video"), size: { width: 1440, height: 960 } },
  })
  const page = await context.newPage()
  try {
    const visualFixture = await createFixture(request, testInfo)
    await configurePage(page, { width: 1440, height: 960 }, "dark", "no-preference")
    await page.goto("/")
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()

    await page.getByRole("button", { name: /^Projects:/ }).click()
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /^Dashboard:/ }).click()
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    await page.getByRole("button", { name: "Toggle sidebar" }).click()
    await expect(page.locator(".app-shell")).toHaveClass(/rail-collapsed/)
    await page.getByRole("button", { name: "Toggle sidebar" }).click()

    const card = page
      .locator(".dashboard-active-sessions .session-link-shell", { hasText: visualFixture.sessionTitle })
      .first()
    await card.hover()
    await expect(card.locator(".pin-toggle")).toHaveCount(0)
    await card.click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible()
    await page.keyboard.press("Escape")
    await card.locator(".session-link").click()
    await expect(page.locator(".session-page")).toBeVisible()
    await page.getByRole("textbox", { name: "Message OpencodeX..." }).click()
    await expect(page.getByRole("textbox", { name: "Message OpencodeX..." })).toBeFocused()
  } finally {
    const video = page.video()
    await context.close()
    const path = await video?.path()
    if (path) await testInfo.attach("precision-interaction", { path, contentType: "video/webm" })
  }
})

test("keeps warm route interactions inside the precision performance budget", async ({ page }) => {
  await configurePage(page, { width: 1440, height: 960 }, "dark", "reduce")
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await page.getByRole("button", { name: /^Projects:/ }).click()
  await expect(page.locator(".project-command-page")).toBeVisible()
  await page.getByRole("button", { name: /^Dashboard:/ }).click()
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await page.evaluate(() => {
    const durations: number[] = []
    const observer = new PerformanceObserver((list) =>
      durations.push(...list.getEntries().map((entry) => entry.duration)),
    )
    observer.observe({ type: "longtask" })
    Object.assign(window, { __precisionLongTasks: durations, __precisionObserver: observer })
  })
  const durations: number[] = []
  for (let index = 0; index < 20; index += 1) {
    const target = index % 2 === 0 ? "Projects:" : "Dashboard:"
    durations.push(
      await page.evaluate(async (prefix) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
          element.getAttribute("aria-label")?.startsWith(prefix),
        )
        if (!button) throw new Error(`Navigation button not found: ${prefix}`)
        const started = performance.now()
        button.click()
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        return performance.now() - started
      }, target),
    )
  }
  const sorted = durations.toSorted((a, b) => a - b)
  expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThan(
    environmentCeiling(PERFORMANCE_BUDGETS.enforced.warmRoutePaintMs),
  )
  const longTasks = await page.evaluate(() => {
    const value = Reflect.get(window, "__precisionLongTasks")
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []
  })
  expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(100)
})

async function configurePage(
  page: Page,
  viewport: { width: number; height: number },
  theme: "dark" | "light",
  reducedMotion: "no-preference" | "reduce",
) {
  await page.setViewportSize(viewport)
  await page.emulateMedia({ colorScheme: theme, reducedMotion })
  await page.addInitScript((mode) => localStorage.setItem("opencodex.gui.theme", mode), theme)
}

async function expectNavigationContract(page: Page) {
  const nav = page.locator(".nav")
  await expect(nav.locator(":scope > button")).toHaveCount(4)
  await expect(nav.locator("small")).toHaveCount(0)
  await expect(nav.getByRole("button", { name: /^Status:/ })).toHaveCount(0)
  await expect(nav.getByRole("button", { name: /^Settings:/ })).toHaveCount(0)
  await expect(nav.locator(".nav-label")).toHaveText(["Dashboard", "Projects", "Swarms", "Views"])
}

async function expectNoDocumentOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1 &&
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true)
}

async function createProject(request: APIRequestContext, name: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name, directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const body: unknown = await response.json()
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
    throw new Error("Project creation did not return an id.")
  }
  return { id: body.id }
}

async function createSession(request: APIRequestContext, projectID: string, title: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID, directory: fixtureDirectory, title },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<{ id: string }>
}

async function createFixture(request: APIRequestContext, testInfo: TestInfo) {
  const suffix = `${testInfo.title.replaceAll(/[^a-z0-9]+/gi, "-")}-${testInfo.retry}`
  const project = await createProject(request, `Precision Slice ${suffix}`)
  const sessionTitle = `Precision Slice Session ${suffix}`
  const session = await createSession(request, project.id, sessionTitle)
  return { projectID: project.id, sessionID: session.id, sessionTitle }
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" })
}
