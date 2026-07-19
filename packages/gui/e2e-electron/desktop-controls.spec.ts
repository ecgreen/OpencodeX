import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { packagedExecutable } from "../scripts/packaged-executable"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const runtime = path.join(gui, ".artifacts", "e2e-electron", "runtime")
const workspace = path.join(runtime, "workspace")
const readme = path.join(workspace, "README.md")
const run = promisify(execFile)
const packaged = process.env.OPENCODEX_GUI_E2E_PACKAGED === "1"
const backgrounded = process.env.OPENCODEX_GUI_E2E_BACKGROUND === "1"
const browserServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end("<!doctype html><title>OpencodeX browser acceptance</title><main>Embedded browser ready.</main>")
})
let browserFixtureURL = ""

test.beforeAll(async () => {
  await rm(runtime, { recursive: true, force: true })
  await Promise.all(
    ["config", "data", "home", "state", "user-data", "workspace"].map((directory) =>
      mkdir(path.join(runtime, directory), { recursive: true }),
    ),
  )
  await writeFile(readme, "# Electron acceptance\n\nBaseline.\n")
  await git("init")
  await git("config", "user.name", "OpencodeX Acceptance")
  await git("config", "user.email", "acceptance@opencodex.local")
  await git("add", "README.md")
  await git("commit", "-m", "test: seed disposable workspace")
  await new Promise<void>((resolve) => browserServer.listen(0, "127.0.0.1", resolve))
  const address = browserServer.address()
  if (!address || typeof address === "string") throw new Error("Browser fixture server did not start.")
  browserFixtureURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(() => new Promise<void>((resolve, reject) => browserServer.close((error) => error ? reject(error) : resolve())))

test("drives native desktop controls and disposable workspace mutations", async () => {
  let application: ElectronApplication | undefined
  try {
    const executablePath = packaged ? packagedExecutable(gui) : electronExecutable()
    if (!executablePath) throw new Error("Packaged OpencodeX executable was not found.")
    const graphicsArgs = [
      "--enable-gpu",
      "--enable-gpu-rasterization",
      "--enable-zero-copy",
      ...(backgrounded ? ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] : []),
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
    ]
    application = await electron.launch({
      executablePath,
      args: packaged
        ? [`--user-data-dir=${path.join(runtime, "user-data")}`, ...graphicsArgs]
        : [".", `--user-data-dir=${path.join(runtime, "user-data")}`, ...graphicsArgs],
      cwd: gui,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        OPENCODE_CONFIG_DIR: path.join(runtime, "config"),
        OPENCODE_DB: path.join(runtime, "state", "opencodex.sqlite"),
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
        OPENCODE_PURE: "1",
        OPENCODE_TEST_HOME: path.join(runtime, "home"),
        OPENCODEX_GUI_DIRECTORY: workspace,
        ...(packaged ? {} : { OPENCODEX_GUI_RENDERER_URL: "http://127.0.0.1:4174" }),
        XDG_CONFIG_HOME: path.join(runtime, "config"),
        XDG_DATA_HOME: path.join(runtime, "data"),
        XDG_STATE_HOME: path.join(runtime, "state"),
      },
    })

    const page = await application.firstWindow()
    if (!backgrounded) await expectElectronHardwareAcceleration(application)
    const failures = collectRendererFailures(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect.poll(() => page.evaluate(() => Boolean(window.opencodex))).toBe(true)
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    await stubNativeDialogs(application)

    await createProjectWithNativePicker(page)
    if (!backgrounded) await exerciseWindowControls(application, page)
    await exerciseWorkbench(application, page)
    await exerciseSessionDesktopTools(application, page)

    expect(failures).toEqual([])
    const closed = application.waitForEvent("close")
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await closed
    application = undefined
  } finally {
    await application?.close()
  }
})

async function expectElectronHardwareAcceleration(application: ElectronApplication) {
  const status = await application.evaluate(({ app }) => app.getGPUFeatureStatus())
  expect(status.gpu_compositing, JSON.stringify(status, null, 2)).not.toMatch(/disabled_software/i)
}

async function createProjectWithNativePicker(page: Page) {
  await openTitlebarMenu(page, "File")
  await clickTitlebarMenuItem(page, "New Project")
  await expect(page.getByRole("button", { name: "workspace", exact: true })).toBeVisible()
}

async function exerciseWindowControls(application: ElectronApplication, page: Page) {
  await page.getByRole("button", { name: "Maximize", exact: true }).click()
  await expect.poll(() => windowState(application, "maximized")).toBe(true)
  await page.getByRole("button", { name: "Maximize", exact: true }).click()
  await expect.poll(() => windowState(application, "maximized")).toBe(false)

  await page.getByRole("button", { name: "Minimize", exact: true }).click()
  await expect.poll(() => windowState(application, "minimized")).toBe(true)
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore())
}

async function exerciseWorkbench(application: ElectronApplication, page: Page) {
  await openTitlebarMenu(page, "View")
  await clickTitlebarMenuItem(page, "Browser / Workbench")
  await expect(page.getByRole("navigation", { name: "Workbench tabs" })).toBeVisible()
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click()
  const editor = page.locator(".cm-content")
  await expect(editor).toBeVisible()
  await editor.click()
  if (backgrounded) {
    await openTitlebarMenu(page, "Edit")
    await expect(page.getByRole("menuitem").filter({ hasText: "Cut" })).toBeVisible()
    await expect(page.getByRole("menuitem").filter({ hasText: "Copy" })).toBeVisible()
    await expect(page.getByRole("menuitem").filter({ hasText: "Paste" })).toBeVisible()
    await page.keyboard.press("Escape")
  }
  if (!backgrounded) {
    await page.keyboard.press("Control+A")
    await runEditMenuAction(page, "Cut")
    await expect(editor).toHaveText("")
    await runEditMenuAction(page, "Paste")
    await expect(editor).toContainText("Baseline.")
    await page.keyboard.press("Control+A")
    await runEditMenuAction(page, "Copy")
    await page.keyboard.insertText("temporary replacement")
    await page.keyboard.press("Control+A")
    await runEditMenuAction(page, "Paste")
    await expect(editor).toContainText("Baseline.")
  }
  await editor.click()
  await editor.press("Control+A")
  await page.keyboard.insertText("# Electron acceptance\n\nChanged through the desktop GUI.\n")
  await expect(editor).toContainText("Changed through the desktop GUI.")
  await page.getByRole("button", { name: "Save file", exact: true }).click()
  await expect(page.locator(".workbench-page .notice")).toHaveText("Saved.")
  await expect.poll(() => readFile(readme, "utf8")).toContain("Changed through the desktop GUI")

  await page.getByRole("button", { name: "Git", exact: true }).click()
  const changedFiles = page.getByRole("listbox", { name: "Changed files" })
  await expect(changedFiles.getByText("README.md", { exact: true })).toBeVisible()
  const stageFile = changedFiles.getByRole("checkbox", { name: "Stage README.md", exact: true })
  await stageFile.locator("..").locator('[data-slot="checkbox-v2-control"]').click()
  await expect(changedFiles.getByRole("checkbox", { name: "Unstage README.md", exact: true })).toBeChecked()
  await expect(page.getByText("Staged", { exact: true })).toBeVisible()
  await page.getByPlaceholder("Summary").fill("test: commit desktop mutation")
  await page.getByRole("button", { name: /Commit to/ }).click()
  await expect(page.getByText("No local changes.", { exact: true })).toBeVisible()
  expect((await git("log", "-1", "--pretty=%s")).stdout.trim()).toBe("test: commit desktop mutation")

  await page.getByRole("button", { name: "Browser", exact: true }).click()
  await expect(page.getByText("Open a webpage", { exact: true })).toBeVisible()
  await navigateBrowserInOwner(application, browserFixtureURL)
  await expect.poll(() => activeBrowserURL(application)).toBe(`${browserFixtureURL}/`)
  await expectBrowserViewBounds(application, page)
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await resizeWindow(application, 1180, 800)
  await expectBrowserViewBounds(application, page)
  if (!backgrounded) {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize())
    await expect.poll(() => windowState(application, "maximized")).toBe(true)
    await expectBrowserViewBounds(application, page)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.unmaximize())
    await expect.poll(() => windowState(application, "maximized")).toBe(false)
    await expectBrowserViewBounds(application, page)
  }
  await clickDom(page, "Capture screenshot")
  await expect.poll(() => page.evaluate(() => document.querySelector(".workbench-page .notice")?.textContent ?? "")).toBe("Captured browser screenshot.")
  await page.getByRole("button", { name: "Git", exact: true }).click()
  await expectBrowserViewVisible(application, false)
  await page.getByRole("button", { name: "Browser", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await openTitlebarMenu(page, "View")
  await clickTitlebarMenuItem(page, "Dashboard")
  await expectBrowserViewVisible(application, false)
}

async function exerciseSessionDesktopTools(application: ElectronApplication, page: Page) {
  await openTitlebarMenu(page, "File")
  await clickTitlebarMenuItem(page, "New Session")
  await createSessionInOwner(application)
  await openSessionInOwner(application)
  await page.getByRole("button", { name: "Open side panel", exact: true }).click()
  await page.getByRole("button", { name: /^Terminal/ }).click()
  await expect(page.locator(".session-open-terminal-host .xterm")).toBeVisible()
  await page.keyboard.type("echo OPENCODEX_TERMINAL_OK")
  await page.keyboard.press("Enter")
  await expect(page.locator(".session-open-terminal-host")).toContainText("OPENCODEX_TERMINAL_OK")

  await page.getByRole("button", { name: "Add context or change mode", exact: true }).click()
  await page.getByRole("menuitem", { name: "File & Folder context", exact: true }).click()
  await expect(page.getByText("README.md", { exact: true })).toBeVisible()
}

async function stubNativeDialogs(application: ElectronApplication) {
  await application.evaluate(({ dialog }, fixture) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: async (...args: unknown[]) => {
        const options = args.at(-1)
        const properties = options && typeof options === "object" && "properties" in options ? options.properties : undefined
        const directory = Array.isArray(properties) && properties.includes("openDirectory")
        return { canceled: false, filePaths: [directory ? fixture.workspace : fixture.readme] }
      },
    })
    Object.defineProperty(dialog, "showMessageBox", {
      configurable: true,
      value: async () => ({ response: 0, checkboxChecked: false }),
    })
  }, { workspace, readme })
}

function collectRendererFailures(page: Page) {
  const failures: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text())
  })
  page.on("pageerror", (error) => failures.push(error.message))
  return failures
}

async function windowState(application: ElectronApplication, state: "maximized" | "minimized") {
  return application.evaluate(({ BrowserWindow }, requested) => {
    const window = BrowserWindow.getAllWindows()[0]
    return requested === "maximized" ? window?.isMaximized() : window?.isMinimized()
  }, state)
}

async function expectBrowserViewBounds(application: ElectronApplication, page: Page) {
  const host = await page.locator(".workbench-browser-host").boundingBox()
  if (!host) throw new Error("Embedded browser host did not have bounds.")
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const view = window?.contentView.children.find((item) => "webContents" in item && item.webContents.id !== window.webContents.id)
    return view?.getBounds()
  })).toEqual({
    x: Math.round(host.x),
    y: Math.round(host.y),
    width: Math.round(host.width),
    height: Math.round(host.height),
  })
  await expectBrowserViewVisible(application, true)
}

async function expectBrowserViewVisible(application: ElectronApplication, expected: boolean) {
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return window?.contentView.children.some((item) => "webContents" in item && item.webContents.id !== window.webContents.id && item.getVisible()) ?? false
  })).toBe(expected)
}

async function resizeWindow(application: ElectronApplication, width: number, height: number) {
  await application.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]?.setSize(bounds.width, bounds.height)
  }, { width, height })
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return undefined
    const [width, height] = window.getSize()
    return { width, height }
  })).toEqual({ width, height })
}

async function activeBrowserURL(application: ElectronApplication) {
  return application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const view = window?.contentView.children.find((item) => "webContents" in item && item.webContents.id !== window.webContents.id)
    return view && "webContents" in view ? view.webContents.getURL() : undefined
  })
}

async function navigateBrowserInOwner(application: ElectronApplication, url: string) {
  await application.evaluate(({ BrowserWindow }, value) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    return owner.executeJavaScript(`(() => {
      const input = document.querySelector('.workbench-browser-bar input')
      if (!input) throw new Error('Browser address input was not available.')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const button = document.querySelector('.workbench-browser-bar button[aria-label="Go"]')
      if (!button) throw new Error('Browser Go button was not available.')
      button.click()
    })()`)
  }, url)
}

async function createSessionInOwner(application: ElectronApplication) {
  await application.evaluate(({ BrowserWindow }, directory) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    return owner.executeJavaScript(`(async () => {
      const connection = await window.opencodex.connection()
      const projects = await fetch(new URL('/experimental/opencodex/project', connection.url)).then((response) => response.json())
      const project = projects[0]
      if (!project) throw new Error('Acceptance project was not available.')
      const response = await fetch(new URL('/experimental/opencodex/session', connection.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectID: project.id, directory: ${JSON.stringify(directory)}, title: 'Electron Terminal Session' }),
      })
      if (!response.ok) throw new Error(await response.text())
    })()`)
  }, workspace)
}

async function openSessionInOwner(application: ElectronApplication) {
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) return false
    return owner.executeJavaScript(`Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Electron Terminal Session'))`)
  })).toBe(true)
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    return owner.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Electron Terminal Session'))?.click()`)
  })
}

async function runEditMenuAction(page: Page, action: "Cut" | "Copy" | "Paste") {
  await openTitlebarMenu(page, "Edit")
  await clickTitlebarMenuItem(page, action)
}

async function openTitlebarMenu(page: Page, label: string) {
  const trigger = page.locator(".titlebar-menu-trigger").filter({ hasText: label })
  await trigger.focus()
  await trigger.press("Enter")
  await expect(page.locator('[data-component="menu-v2-content"]')).toBeVisible()
}

async function clickTitlebarMenuItem(page: Page, label: string) {
  const item = page.getByRole("menuitem").filter({ hasText: label })
  await item.focus()
  await item.press("Enter")
}

async function clickDom(page: Page, label: string) {
  await page.evaluate((name) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.getAttribute("aria-label") === name)
    if (!button) throw new Error(`Button not found: ${name}`)
    button.click()
  }, label)
}

function electronExecutable() {
  const executable = process.platform === "win32" ? "electron.exe" : "electron"
  return [
    path.join(gui, "node_modules", "electron", "dist", executable),
    path.join(root, "node_modules", "electron", "dist", executable),
  ].find(existsSync) ?? executable
}

function git(...args: string[]) {
  return run("git", args, { cwd: workspace })
}
