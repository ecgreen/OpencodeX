import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": "C:/Work/OpencodeX",
}
const viewports = [
  { width: 980, height: 680 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
] as const
let fixture: { projectID: string; sessionTitle: string } | undefined

for (const viewport of viewports) {
  for (const theme of ["dark", "light"] as const) {
    for (const motion of ["no-preference", "reduce"] as const) {
      test(`captures precision slice at ${viewport.width}x${viewport.height}, ${theme}, ${motion}`, async ({ page, request }, testInfo) => {
        await configurePage(page, viewport, theme, motion)
        await page.goto("/")
        await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
        const visualFixture = await ensureFixture(request)
        const sessionCard = page.locator(".dashboard-status-card", { hasText: visualFixture.sessionTitle }).first()
        await expect(sessionCard).toBeVisible()
        await expectNavigationContract(page)
        await expect(page.getByRole("button", { name: "New session", exact: true }).first()).toBeVisible()
        await expect(page.locator(".dashboard-page .row-actions")).toHaveCount(0)
        await expectNoDocumentOverflow(page)
        await attachScreenshot(page, testInfo, `dashboard-${viewport.width}-${theme}-${motion}`)

        await sessionCard.locator(".dashboard-card-open").focus()
        await expect(sessionCard.locator(".card-action-menu")).toHaveCSS("opacity", "1")
        await sessionCard.locator(".card-action-menu summary").press("Enter")
        await expect(sessionCard.getByRole("menuitem", { name: "Edit" })).toBeVisible()
        await sessionCard.locator(".card-action-menu summary").press("Enter")
        await sessionCard.locator(".dashboard-card-open").click()
        await expect(page.locator(".session-page")).toBeVisible()
        await expect(page.locator(".transcript-shell")).toBeVisible()
        await expect(page.locator(".composer-input")).toBeVisible()
        await expectNoDocumentOverflow(page)
        await attachScreenshot(page, testInfo, `session-${viewport.width}-${theme}-${motion}`)
      })
    }
  }
}

test("records navigation, collapse, disclosure, session opening, and composer focus", async ({ browser, request }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir: testInfo.outputPath("interaction-video"), size: { width: 1440, height: 960 } },
  })
  const page = await context.newPage()
  try {
    await configurePage(page, { width: 1440, height: 960 }, "dark", "no-preference")
    await page.goto("/")
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    const visualFixture = await ensureFixture(request)

    await page.getByRole("button", { name: /^Projects:/ }).click()
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /^Dashboard:/ }).click()
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    await page.getByRole("button", { name: "Toggle sidebar" }).click()
    await expect(page.locator(".app-shell")).toHaveClass(/rail-collapsed/)
    await page.getByRole("button", { name: "Toggle sidebar" }).click()

    const card = page.locator(".dashboard-status-card", { hasText: visualFixture.sessionTitle }).first()
    await card.hover()
    await expect(card.locator(".card-action-menu")).toHaveCSS("opacity", "1")
    await card.locator(".dashboard-card-open").focus()
    await card.locator(".card-action-menu summary").press("Enter")
    await expect(card.getByRole("menuitem", { name: "Pin" })).toBeVisible()
    await card.locator(".card-action-menu summary").press("Enter")
    await card.locator(".dashboard-card-open").click()
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
  await page.evaluate(() => {
    const durations: number[] = []
    const observer = new PerformanceObserver((list) => durations.push(...list.getEntries().map((entry) => entry.duration)))
    observer.observe({ type: "longtask", buffered: true })
    Object.assign(window, { __precisionLongTasks: durations, __precisionObserver: observer })
  })
  const durations: number[] = []
  for (let index = 0; index < 20; index += 1) {
    const target = index % 2 === 0 ? /^Projects:/ : /^Dashboard:/
    const started = await page.evaluate(() => performance.now())
    await page.getByRole("button", { name: target }).click()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    durations.push((await page.evaluate(() => performance.now())) - started)
  }
  const sorted = durations.toSorted((a, b) => a - b)
  expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThan(150)
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
  await expect(nav.locator(":scope > button")).toHaveCount(6)
  await expect(nav.locator("small")).toHaveCount(0)
  await expect(nav.getByRole("button", { name: /^Status:/ })).toHaveCount(0)
  await expect(nav.getByRole("button", { name: /^Settings:/ })).toHaveCount(0)
  await expect(nav.locator(".nav-label")).toHaveText(["Dashboard", "Projects", "Swarms", "Views", "Plugins", "Workbench"])
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
    data: { name, directory: "C:/Work/OpencodeX", folders: ["C:/Work/OpencodeX"] },
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
    data: { projectID, directory: "C:/Work/OpencodeX", title },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function ensureFixture(request: APIRequestContext) {
  if (fixture) return fixture
  const project = await createProject(request, "Precision Slice")
  const sessionTitle = "Precision Slice Session"
  await createSession(request, project.id, sessionTitle)
  fixture = { projectID: project.id, sessionTitle }
  return fixture
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" })
}
