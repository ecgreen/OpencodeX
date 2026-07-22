import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"
import { execFile } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const backendURL = "http://127.0.0.1:4097"
const directory = mkdtempSync(path.join(os.tmpdir(), "opencodex-gui-git-e2e-"))
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": directory,
}
const title = `Git Workspace ${path.basename(directory)}`
const run = promisify(execFile)
let ready = false

test("streams metrics, renders deletion patches, and refreshes without remounting", async ({
  page,
  request,
}, testInfo) => {
  await ensureFixture(request)
  await configure(page, { width: 1440, height: 960 }, "dark", "no-preference")
  const metricGates = [deferred(), deferred(), deferred()]
  const refreshGate = deferred()
  let metricRequests = 0
  let manifestRequests = 0
  await page.route("**/experimental/opencodex/workbench/changes/metrics/page**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("limit") !== "32") {
      await route.continue()
      return
    }
    const gate = metricGates[metricRequests++]
    if (gate) await gate.promise
    await route.continue()
  })
  await page.route("**/experimental/opencodex/workbench/changes/page**", async (route) => {
    manifestRequests++
    if (manifestRequests === 2) await refreshGate.promise
    await route.continue()
  })
  await openGitWorkspace(page)

  const root = page.locator(".session-side-diff")
  const header = root.locator(":scope > header")
  await expect(header).toContainText("68 files")
  await expect(header).toContainText("Measuring 1/68")
  metricGates[0].resolve()
  await expect(header).toContainText("Measuring 32/68")
  metricGates[1].resolve()
  await expect(header).toContainText("Measuring 64/68")
  metricGates[2].resolve()
  await expect(header).not.toContainText("Measuring")
  await expect(header).toContainText("+132")
  await expect(header).toContainText("-3")

  const list = page.locator(".session-side-file-list")
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const deleted = list.getByRole("treeitem", { name: /deleted\.ts/ })
  await expect(deleted).toBeVisible()
  await deleted.click()
  await expect(deleted).toHaveClass(/deleted/)
  const deletedPatch = page.locator('[data-side-panel-file="src/deleted.ts"]')
  await expect(deletedPatch).toBeVisible()
  await expect(deletedPatch.getByRole("button", { name: "Edit" })).toHaveCount(0)
  await expect(page.locator(".session-side-patch")).toContainText("export const removed")

  await list.evaluate((element) => {
    element.scrollTop = 0
  })
  const disappearing = list.getByRole("treeitem", { name: /file-000\.ts/ })
  await disappearing.click()
  await root.evaluate((element) => {
    Reflect.set(window, "__opencodexGitRoot", element)
  })
  await rm(path.join(directory, "generated", "group-00", "file-000.ts"))
  await page.evaluate(() => {
    const now = Date.now
    Date.now = () => now() + 31_000
    window.dispatchEvent(new Event("focus"))
  })
  await expect(header).toContainText("Refreshing")
  await expect(root).toBeVisible()
  expect(
    await page.evaluate(
      () => Reflect.get(window, "__opencodexGitRoot") === document.querySelector(".session-side-diff"),
    ),
  ).toBe(true)
  await expect(disappearing).toBeVisible()
  refreshGate.resolve()
  await expect(header).toContainText("67 files")
  await expect(disappearing).toHaveCount(0)
  await expect(page.locator(".session-side-patch header[data-side-panel-file]")).toBeVisible()
  await expectNoDocumentOverflow(page)
  await attachScreenshot(page, testInfo, "git-workspace-progressive-refresh")
})

for (const viewport of [
  { width: 980, height: 680 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
]) {
  for (const theme of ["dark", "light"] as const) {
    for (const motion of ["no-preference", "reduce"] as const) {
      test(`Git workspace geometry at ${viewport.width}x${viewport.height}, ${theme}, ${motion}`, async ({
        page,
        request,
      }, testInfo) => {
        await ensureFixture(request)
        await configure(page, viewport, theme, motion)
        await openGitWorkspace(page)
        await expect(page.locator(".session-side-diff > header")).toContainText(/67|68 files/)
        await expect(page.locator(".session-side-file-list")).toBeVisible()
        await expect(page.locator(".session-side-patch")).toBeVisible()
        await expectNoDocumentOverflow(page)
        await attachScreenshot(page, testInfo, `git-workspace-${viewport.width}-${theme}-${motion}`)
      })
    }
  }
}

async function ensureFixture(request: APIRequestContext) {
  if (ready) return
  await mkdir(path.join(directory, "src"), { recursive: true })
  await writeFile(path.join(directory, "src", "modified.ts"), "export const value = 1\nexport const keep = true\n")
  await writeFile(path.join(directory, "src", "deleted.ts"), "export const removed = true\nexport const oldValue = 1\n")
  await run("git", ["init", "--quiet"], { cwd: directory })
  await run("git", ["config", "user.email", "e2e@opencodex.local"], { cwd: directory })
  await run("git", ["config", "user.name", "OpencodeX E2E"], { cwd: directory })
  await run("git", ["add", "."], { cwd: directory })
  await run("git", ["commit", "--quiet", "-m", "fixture"], { cwd: directory })
  await writeFile(
    path.join(directory, "src", "modified.ts"),
    "export const value = 2\nexport const keep = true\nexport const added = true\n",
  )
  await rm(path.join(directory, "src", "deleted.ts"))
  await Promise.all(
    Array.from({ length: 65 }, async (_, index) => {
      const group = path.join(
        directory,
        "generated",
        `group-${Math.floor(index / 10)
          .toString()
          .padStart(2, "0")}`,
      )
      await mkdir(group, { recursive: true })
      await writeFile(
        path.join(group, `file-${index.toString().padStart(3, "0")}.ts`),
        `export const value${index} = ${index}\nexport const ready${index} = true\n`,
      )
    }),
  )
  await writeFile(path.join(directory, "image.bin"), Buffer.from([0, 1, 2, 3]))
  const project = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "Git Workspace", directory, folders: [directory] },
  })
  expect(project.ok(), await project.text()).toBe(true)
  const body = (await project.json()) as { id: string }
  const session = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: body.id, directory, title },
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

async function openGitWorkspace(page: Page) {
  await page.goto("/")
  const card = page.locator(".session-link-shell", { hasText: title }).first()
  await expect(card).toBeVisible()
  await card.locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()
  await page.getByRole("button", { name: "Open side panel" }).click()
  await expect(page.locator(".session-side-panel")).toBeVisible()
  const newTab = page.getByRole("button", { name: "New tab" })
  if (await newTab.count()) await newTab.click()
  await page
    .locator(".session-side-panel")
    .getByRole("button", { name: /^Git Review/ })
    .dispatchEvent("click")
  await expect(page.locator(".session-side-diff")).toBeVisible()
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" })
}
