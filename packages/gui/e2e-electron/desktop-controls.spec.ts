import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test"
import type { WebPreferences } from "electron"
import { packagedExecutable } from "../scripts/packaged-executable"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const runtime = path.join(gui, ".artifacts", "e2e-electron", "runtime")
const workspace = path.join(runtime, "workspace")
const readme = path.join(workspace, "README.md")
const run = promisify(execFile)
const packaged = process.env.OPENCODEX_GUI_E2E_PACKAGED === "1"
const backgrounded = process.env.OPENCODEX_GUI_E2E_BACKGROUND === "1"
const skipHardwareAssertion = backgrounded || process.env.OPENCODEX_GUI_E2E_SKIP_GPU === "1"

test.beforeAll(async () => {
  await rm(runtime, { recursive: true, force: true })
  await Promise.all(
    ["bin", "config", "data", "home", "state", "user-data", "workspace"].map((directory) =>
      mkdir(path.join(runtime, directory), { recursive: true }),
    ),
  )
  await writeFile(readme, "# Electron acceptance\n\nBaseline.\n")
  await git("init")
  await git("config", "user.name", "OpencodeX Acceptance")
  await git("config", "user.email", "acceptance@opencodex.local")
  await git("add", "README.md")
  await git("commit", "-m", "test: seed disposable workspace")
  await createFakeClaude()
})

test("drives native desktop controls and session workspace tools", async () => {
  let application: ElectronApplication | undefined
  try {
    const executablePath = packaged ? packagedExecutable(gui) : electronExecutable()
    if (!executablePath) throw new Error("Packaged OpencodeX executable was not found.")
    const graphicsArgs = skipHardwareAssertion
      ? ["--disable-gpu"]
      : [
          "--enable-gpu",
          "--enable-gpu-rasterization",
          "--enable-zero-copy",
          ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
        ]
    if (backgrounded)
      graphicsArgs.push(
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      )
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
        PATH: `${path.join(runtime, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
        ...(packaged ? {} : { OPENCODEX_GUI_RENDERER_URL: "http://127.0.0.1:4174" }),
        XDG_CONFIG_HOME: path.join(runtime, "config"),
        XDG_DATA_HOME: path.join(runtime, "data"),
        XDG_STATE_HOME: path.join(runtime, "state"),
      },
    })

    const page = await application.firstWindow()
    if (!skipHardwareAssertion) await expectElectronHardwareAcceleration(application)
    const failures = collectRendererFailures(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect.poll(() => page.evaluate(() => Boolean(window.opencodex))).toBe(true)
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    await stubNativeDialogs(application)

    await createProjectWithNativePicker(page)
    if (!backgrounded) await exerciseWindowControls(application, page)
    await exerciseSessionDesktopTools(application, page)
    await exerciseClaudeCode(application, page)
    await exerciseSessionPromptStream(page)

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

async function exerciseSessionDesktopTools(application: ElectronApplication, page: Page) {
  await openTitlebarMenu(page, "File")
  await clickTitlebarMenuItem(page, "New Session")
  await createSessionInOwner(application)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.locator(".dialog-backdrop")).toBeHidden()
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

async function exerciseSessionPromptStream(page: Page) {
  await expect(page.locator(".sync-status-banner")).toHaveCount(0)
  await page.evaluate(() => {
    Reflect.set(globalThis, "__opencodexPerformanceEnabled", true)
    Reflect.set(globalThis, "__opencodexReconnectBannerObserved", false)
    new MutationObserver(() => {
      if (document.querySelector(".sync-status-banner")) {
        Reflect.set(globalThis, "__opencodexReconnectBannerObserved", true)
      }
    }).observe(document.body, { childList: true, subtree: true })
  })

  const composer = page.getByRole("textbox", { name: "Message OpencodeX..." })
  await composer.fill("stream stays connected")
  await page.getByRole("button", { name: "Send message" }).click()
  await expect(composer).toHaveValue("")
  const running = page.getByRole("main").getByLabel("running")
  await expect(running).toBeVisible()
  await expect(running).toHaveCount(0, { timeout: 60_000 })

  const outcome = await page.evaluate(() => {
    const details = Reflect.get(globalThis, "__opencodexPerformanceDetails") as {
      stateSync?: { reconnects?: number; reconnectAttempts?: number; eventConnections?: number }
      stateSyncLifecycle?: unknown
    }
    return {
      banner: document.querySelector(".sync-status-banner")?.textContent,
      bannerObserved: Reflect.get(globalThis, "__opencodexReconnectBannerObserved"),
      stateSync: details?.stateSync,
      stateSyncLifecycle: details?.stateSyncLifecycle,
    }
  })
  expect(outcome, JSON.stringify(outcome, null, 2)).toEqual({
    banner: undefined,
    bannerObserved: false,
    stateSync: expect.objectContaining({ reconnects: 0 }),
    stateSyncLifecycle: expect.objectContaining({ status: "connected" }),
  })
}

async function exerciseClaudeCode(application: ElectronApplication, page: Page) {
  await openTitlebarMenu(page, "File")
  await clickTitlebarMenuItem(page, "New Claude Code Session")
  await page.getByLabel("Display name").fill("Electron Claude Session")
  await page.getByLabel("Working directory").fill(workspace)
  await page.getByRole("button", { name: "Create", exact: true }).click()

  const terminal = page.locator('section[aria-label="Electron Claude Session terminal"]')
  await expect(terminal).toBeVisible()
  await expect(terminal).toContainText("FAKE_CLAUDE_ARGS --session-id")
  await page.keyboard.type("FIRST_INPUT")
  await page.keyboard.press("Enter")
  await expect(terminal).toContainText("FAKE_CLAUDE_ECHO FIRST_INPUT")

  await page.getByRole("button", { name: "Dashboard", exact: true }).click()
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await openTerminalSessionInOwner(application)
  await expect(terminal).toBeVisible()
  await page.keyboard.type("AFTER_NAVIGATION")
  await page.keyboard.press("Enter")
  await expect(terminal).toContainText("FAKE_CLAUDE_ECHO AFTER_NAVIGATION")

  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Resume", exact: true }).click()
  await expect(terminal).toContainText("FAKE_CLAUDE_ARGS --resume")

  const record = await terminalSessionRecord(page)
  const duplicate = await application.evaluate(async ({ BrowserWindow }, input) => {
    const owner = BrowserWindow.getAllWindows()[0]
    if (!owner) throw new Error("Owning window was not available.")
    const webContents = owner.webContents as typeof owner.webContents & { getLastWebPreferences(): WebPreferences }
    const duplicateWindow = new BrowserWindow({ show: false, webPreferences: webContents.getLastWebPreferences() })
    try {
      await duplicateWindow.loadURL(owner.webContents.getURL())
      return await duplicateWindow.webContents.executeJavaScript(
        `window.opencodex.terminal.create(${JSON.stringify(input)})`,
      )
    } finally {
      duplicateWindow.destroy()
    }
  }, {
    id: `terminal-session:${record.id}`,
    cwd: record.directory,
    cols: 80,
    rows: 24,
    profile: {
      kind: "claude-code",
      mode: "resume",
      resumeID: record.resumeID,
      installationID: record.installationID,
    },
  })
  expect(duplicate).toMatchObject({ ok: false, code: "duplicate-window" })

  await createMixedViewInOwner(application, record.id)
  await openMixedViewInOwner(application)
  await expect(page.getByText("Electron View Session", { exact: true })).toBeVisible()
  await expect(page.getByText("Electron Claude Session", { exact: true }).first()).toBeVisible()
  await expect(page.locator('section[aria-label="Electron Claude Session terminal"]')).toBeVisible()
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

async function openTerminalSessionInOwner(application: ElectronApplication) {
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) return false
    return owner.executeJavaScript(`Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Electron Claude Session'))`)
  })).toBe(true)
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    return owner.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Electron Claude Session'))?.click()`)
  })
}

async function terminalSessionRecord(page: Page) {
  return await page.evaluate(async () => {
    const connection = await window.opencodex!.connection()
    const records = await fetch(new URL("/experimental/opencodex/terminal-session", connection.url)).then((response) => response.json()) as Array<{
      id: string
      title: string
      directory: string
      resumeID: string
      installationID: string
    }>
    const record = records.find((item) => item.title === "Electron Claude Session")
    if (!record) throw new Error("Claude terminal session record was not available.")
    return record
  })
}

async function createMixedViewInOwner(application: ElectronApplication, terminalSessionID: string) {
  await application.evaluate(({ BrowserWindow }, input) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    return owner.executeJavaScript(`(async () => {
      const connection = await window.opencodex.connection()
      const sessionResponse = await fetch(new URL('/session', connection.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Electron View Session' }),
      })
      if (!sessionResponse.ok) throw new Error(await sessionResponse.text())
      const session = await sessionResponse.json()
      const viewResponse = await fetch(new URL('/experimental/opencodex/view', connection.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Electron Mixed View',
          members: [{ kind: 'session', id: session.id }, { kind: 'terminal', id: ${JSON.stringify(input.terminalSessionID)} }],
          focusedItemID: ${JSON.stringify(input.terminalSessionID)},
        }),
      })
      if (!viewResponse.ok) throw new Error(await viewResponse.text())
    })()`)
  }, { terminalSessionID })
}

async function openMixedViewInOwner(application: ElectronApplication) {
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) return false
    return owner.executeJavaScript(`Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Electron Mixed View'))`)
  })).toBe(true)
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]?.webContents
    if (!owner) throw new Error("Owning renderer was not available.")
    return owner.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Electron Mixed View'))?.click()`)
  })
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

function electronExecutable() {
  const executable = process.platform === "win32" ? "electron.exe" : "electron"
  return [
    path.join(gui, "node_modules", "electron", "dist", executable),
    path.join(root, "node_modules", "electron", "dist", executable),
  ].find(existsSync) ?? executable
}

async function createFakeClaude() {
  const directory = path.join(runtime, "bin")
  if (process.platform === "win32") {
    const executable = path.join(directory, "claude.exe")
    const source = [
      "using System;",
      "public static class FakeClaude {",
      "  public static void Main(string[] args) {",
      "    if (Array.IndexOf(args, \"--version\") >= 0) { Console.WriteLine(\"fake-claude 1.0\"); return; }",
      "    Console.WriteLine(\"FAKE_CLAUDE_ARGS \" + String.Join(\" \", args));",
      "    string line;",
      "    while ((line = Console.ReadLine()) != null) Console.WriteLine(\"FAKE_CLAUDE_ECHO \" + line);",
      "  }",
      "}",
    ].join("\n")
    const sourceFile = path.join(directory, "fake-claude.cs")
    const compileScript = path.join(directory, "compile-fake-claude.ps1")
    await writeFile(sourceFile, source)
    await writeFile(
      compileScript,
      'param([string]$Source, [string]$Output)\n$ErrorActionPreference = "Stop"\nAdd-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication\n',
    )
    await run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      compileScript,
      "-Source",
      sourceFile,
      "-Output",
      executable,
    ])
    return
  }
  const executable = path.join(directory, "claude")
  await writeFile(
    executable,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake-claude 1.0"; exit 0; fi\nprintf "FAKE_CLAUDE_ARGS %s\\n" "$*"\nwhile IFS= read -r line; do printf "FAKE_CLAUDE_ECHO %s\\n" "$line"; done\n',
  )
  await chmod(executable, 0o755)
}

function git(...args: string[]) {
  return run("git", args, { cwd: workspace })
}
