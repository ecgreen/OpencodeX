import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}
const title = "File Workspace Navigation"
let ready = false

test("navigates definitions and uses the compact file finder", async ({ page, request }) => {
  await ensureFixture(request)
  await configure(page, { width: 1440, height: 960 }, "dark", "no-preference")
  await installFileAnalysisRoutes(page)
  await openSourceFile(page)

  const footer = page.locator(".workbench-diagnostics-bar")
  await expect(footer).toContainText("1 issue in this file")
  expect(Math.round((await footer.boundingBox())?.height ?? 0)).toBe(28)

  await controlClickText(page, "answer", 0)
  await expect(page.locator(".session-open-file-breadcrumb")).toContainText("src/value.ts")
  await controlClickText(page, "answer", 1)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("answer")

  await page.keyboard.press("Control+f")
  const finder = page.getByRole("search", { name: "Find in file" })
  await expect(finder).toBeVisible()
  const input = finder.getByRole("searchbox", { name: "Find in file" })
  await input.fill("answer")
  await expect(finder).toContainText("2 matches")
  await input.press("Enter")
  await input.press("Shift+Enter")
  await input.press("Escape")
  await expect(finder).toHaveCount(0)
  await expect(page.locator(".workbench-codemirror .cm-editor")).toHaveClass(/cm-focused/)
  await expectNoDocumentOverflow(page)
})

test("shows non-Git project files as additions and offers initialization", async ({ page, request }, testInfo) => {
  await ensureFixture(request)
  await configure(page, { width: 1440, height: 960 }, "dark", "reduce")
  await openSourceFile(page)
  const releaseBackgroundWork = await holdBackgroundMetricsAndPatches(page)
  await page.getByRole("button", { name: "New tab" }).click()
  await page.getByRole("button", { name: "Git", exact: true }).click()

  try {
    await expect(page.locator(".session-side-git-setup")).toHaveCount(0)
    await expect(page.getByText("Git is not initialized")).toHaveCount(0)
    const split = page.getByRole("button", { name: "Split diff" })
    const initialize = page.getByRole("button", { name: "Initialize Git" })
    await expect(split).toBeVisible()
    await expect(initialize).toBeVisible()
    await expect.poll(async () => Math.round((await split.boundingBox())?.width ?? 0))
      .toBe(Math.round((await initialize.boundingBox())?.width ?? 0))
    await expect(page.locator(".session-side-file-list")).toContainText("src")
    const selected = page.getByRole("treeitem", { name: /value\.ts/ })
    await expect(selected).toContainText("Measuring")
    await selected.click()
    await expect(selected).toContainText("+2")
    await expect(selected).not.toContainText("Measuring")
  } finally {
    releaseBackgroundWork()
  }
  await expectNoDocumentOverflow(page)
  await attachScreenshot(page, testInfo, "file-workspace-non-git")
})

for (const viewport of [{ width: 980, height: 680 }, { width: 1440, height: 960 }, { width: 1920, height: 1080 }]) {
  for (const theme of ["dark", "light"] as const) {
    for (const motion of ["no-preference", "reduce"] as const) {
      test(`file workspace geometry at ${viewport.width}x${viewport.height}, ${theme}, ${motion}`, async ({ page, request }, testInfo) => {
        await ensureFixture(request)
        await configure(page, viewport, theme, motion)
        await installFileAnalysisRoutes(page)
        await openSourceFile(page)
        await page.locator(".workbench-codemirror .cm-content").click()
        await page.keyboard.press("Control+f")
        await page.getByRole("searchbox", { name: "Find in file" }).fill("answer")
        const footer = page.locator(".workbench-diagnostics-bar")
        expect(Math.round((await footer.boundingBox())?.height ?? 0)).toBe(28)
        await expect(page.getByRole("search", { name: "Find in file" })).toBeVisible()
        await expectNoDocumentOverflow(page)
        await attachScreenshot(page, testInfo, `file-workspace-${viewport.width}-${theme}-${motion}`)
      })
    }
  }
}

async function ensureFixture(request: APIRequestContext) {
  if (ready) return
  await mkdir(path.join(fixtureDirectory, "src"), { recursive: true })
  await writeFile(path.join(fixtureDirectory, "src", "app.ts"), 'import { answer } from "./value"\nconsole.log(answer)\n')
  await writeFile(path.join(fixtureDirectory, "src", "value.ts"), "export const answer = 42\nconsole.log(answer)\n")
  const project = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "File Workspace", directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(project.ok(), await project.text()).toBe(true)
  const body = await project.json() as { id: string }
  const session = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: body.id, directory: path.join(fixtureDirectory, "src"), title },
  })
  expect(session.ok(), await session.text()).toBe(true)
  ready = true
}

async function configure(
  page: Page,
  viewport: { width: number; height: number },
  theme: "dark" | "light",
  motion: "no-preference" | "reduce",
) {
  await page.setViewportSize(viewport)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion })
  await page.addInitScript((value) => localStorage.setItem("opencodex.gui.theme", value), theme)
}

async function installFileAnalysisRoutes(page: Page) {
  await page.route("**/experimental/opencodex/workbench/file/diagnostics**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      supported: true,
      diagnostics: [{ path: "src/app.ts", line: 2, column: 13, endLine: 2, endColumn: 19, severity: "warning", message: "Fixture warning" }],
    }),
  }))
  await page.route("**/experimental/opencodex/workbench/file/definition**", async (route) => {
    const payload = route.request().postDataJSON() as { path: string }
    const target = payload.path === "src/app.ts"
      ? { path: "src/value.ts", line: 1, column: 14, endLine: 1, endColumn: 20 }
      : { path: "src/value.ts", line: 1, column: 14, endLine: 1, endColumn: 20 }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([target]) })
  })
}

async function holdBackgroundMetricsAndPatches(page: Page) {
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/experimental/opencodex/workbench/changes/metrics/page**", async (route) => {
    if (new URL(route.request().url()).searchParams.has("path")) return route.continue()
    await held
    await route.continue()
  })
  await page.route("**/experimental/opencodex/workbench/changes/patch/page**", async (route) => {
    await held
    await route.continue()
  })
  return release
}

async function openSourceFile(page: Page) {
  await page.goto("/")
  const card = page.locator(".session-link-shell", { hasText: title }).first()
  await expect(card).toBeVisible()
  await card.locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()
  await page.getByRole("button", { name: "Open side panel" }).click()
  await expect(page.locator(".session-side-panel")).toBeVisible()
  const content = page.locator(".workbench-codemirror .cm-content")
  if (await content.count()) {
    await expect(content).toContainText("console.log(answer)")
    return
  }
  await page.getByRole("button", { name: "Open file" }).click()
  await page.getByRole("treeitem", { name: "src" }).dispatchEvent("click")
  await page.getByRole("treeitem", { name: "app.ts" }).dispatchEvent("click")
  await expect(content).toContainText("console.log(answer)")
}

async function controlClickText(page: Page, text: string, line: number) {
  const point = await page.locator(".workbench-codemirror .cm-content").evaluate((root, input) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const ranges: Array<{ x: number; y: number }> = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      const value = node.textContent ?? ""
      let offset = value.indexOf(input.text)
      while (offset >= 0) {
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + input.text.length)
        const rect = range.getBoundingClientRect()
        ranges.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        offset = value.indexOf(input.text, offset + input.text.length)
      }
    }
    return ranges[input.occurrence]
  }, { text, occurrence: line })
  if (!point) throw new Error(`Could not find ${text} occurrence ${line}`)
  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX: x,
      clientY: y,
      ctrlKey: true,
    }))
  }, point)
}

async function expectNoDocumentOverflow(page: Page) {
  expect(await page.evaluate(() =>
    document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1 &&
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" })
}
