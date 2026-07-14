import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const runtime = path.join(gui, ".artifacts", "e2e-electron", "runtime")
const workspace = path.join(runtime, "workspace")
const readme = path.join(workspace, "README.md")
const run = promisify(execFile)

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
})

test("drives native desktop controls and disposable workspace mutations", async () => {
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({
      executablePath: electronExecutable(),
      args: [".", `--user-data-dir=${path.join(runtime, "user-data")}`],
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
        OPENCODEX_GUI_RENDERER_URL: "http://127.0.0.1:4174",
        XDG_CONFIG_HOME: path.join(runtime, "config"),
        XDG_DATA_HOME: path.join(runtime, "data"),
        XDG_STATE_HOME: path.join(runtime, "state"),
      },
    })

    const page = await application.firstWindow()
    const failures = collectRendererFailures(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect.poll(() => page.evaluate(() => Boolean(window.opencodex))).toBe(true)
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    await stubNativeDialogs(application)

    await createProjectWithNativePicker(page)
    await exerciseWindowControls(application, page)
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

async function createProjectWithNativePicker(page: Page) {
  await openTitlebarMenu(page, "File")
  await page.getByRole("button", { name: "New Project", exact: true }).click()
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
  await page.bringToFront()
}

async function exerciseWorkbench(application: ElectronApplication, page: Page) {
  await openTitlebarMenu(page, "View")
  await page.getByRole("button", { name: "Browser / Workbench", exact: true }).click()
  await expect(page.getByRole("navigation", { name: "Workbench tabs" })).toBeVisible()
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click()
  const editor = page.locator(".cm-content")
  await expect(editor).toBeVisible()
  await editor.click()
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
  await changedFiles.getByRole("checkbox", { name: "Stage README.md", exact: true }).check()
  await expect(page.getByText("Staged", { exact: true })).toBeVisible()
  await page.getByPlaceholder("Summary").fill("test: commit desktop mutation")
  await page.getByRole("button", { name: /Commit to/ }).click()
  await expect(changedFiles).toContainText("No local changes")
  expect((await git("log", "-1", "--pretty=%s")).stdout.trim()).toBe("test: commit desktop mutation")

  await page.getByRole("button", { name: "Browser", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await resizeWindow(application, 1180, 800)
  await expectBrowserViewBounds(application, page)
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize())
  await expect.poll(() => windowState(application, "maximized")).toBe(true)
  await expectBrowserViewBounds(application, page)
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.unmaximize())
  await expect.poll(() => windowState(application, "maximized")).toBe(false)
  await expectBrowserViewBounds(application, page)
  await clickDom(page, "Capture screenshot")
  await expect.poll(() => page.evaluate(() => document.querySelector(".workbench-page .notice")?.textContent ?? "")).toBe("Captured browser screenshot.")
  await navigateBrowserInOwner(application, "http://127.0.0.1:4174")
  await expect.poll(() => activeBrowserURL(application)).toBe("http://127.0.0.1:4174/")
  await page.getByRole("button", { name: "Git", exact: true }).click()
  await expectBrowserViewVisible(application, false)
  await page.getByRole("button", { name: "Browser", exact: true }).click()
  await expectBrowserViewBounds(application, page)
  await openTitlebarMenu(page, "View")
  await page.getByRole("button", { name: "Dashboard", exact: true }).click()
  await expectBrowserViewVisible(application, false)
}

async function exerciseSessionDesktopTools(application: ElectronApplication, page: Page) {
  await clickTitlebarMenuItemInOwner(application, "File", "New Session")
  await createSessionInOwner(application)
  await openSessionInOwner(application)
  await page.getByRole("button", { name: "Open side panel", exact: true }).click()
  await page.locator('.session-open-empty-actions button[data-tone="terminal"]').click()
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
    const views = BrowserWindow.getAllWindows()[0]?.contentView.children ?? []
    return views.at(-1)?.getBounds()
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
    const views = BrowserWindow.getAllWindows()[0]?.contentView.children ?? []
    return views.at(-1)?.getVisible()
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
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.at(-1)
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
  await page.locator(".titlebar-menu-popover .titlebar-menu-item").filter({ hasText: action }).click()
}

async function openTitlebarMenu(page: Page, label: string) {
  await page.locator(".titlebar-menu-group summary").filter({ hasText: label }).click()
}

async function clickDom(page: Page, label: string) {
  await page.evaluate((name) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.getAttribute("aria-label") === name)
    if (!button) throw new Error(`Button not found: ${name}`)
    button.click()
  }, label)
}

async function clickTitlebarMenuItemInOwner(application: ElectronApplication, menu: string, item: string) {
  await application.evaluate(async ({ BrowserWindow }, labels) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    await owner.executeJavaScript(`Array.from(document.querySelectorAll('.titlebar-menu-group summary')).find((element) => element.textContent?.trim() === ${JSON.stringify(labels.menu)})?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await owner.executeJavaScript(`Array.from(document.querySelectorAll('.titlebar-menu-item')).find((element) => element.querySelector('span')?.textContent?.trim() === ${JSON.stringify(labels.item)})?.click()`)
  }, { menu, item })
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
