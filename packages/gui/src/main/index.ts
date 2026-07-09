import path from "node:path"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as pty from "@lydell/node-pty"
import { app, BrowserWindow, WebContentsView, dialog, ipcMain, session, shell, type MessageBoxOptions, type WebContents } from "electron"
import { type SidecarConnection, startSidecar, stopSidecar } from "./sidecar.js"

const isDev = !app.isPackaged
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* data:",
].join("; ")
let authorizedSidecar: { origin: string; header: string } | undefined
const browserViews = new Map<string, WebContentsView>()
const visibleBrowserViews = new Set<string>()
const terminalProcesses = new Map<string, TerminalProcess>()

type TerminalProcess = {
  ownerID: number
  proc: pty.IPty
  closed: boolean
}

type PtyWithErrorEvents = pty.IPty & {
  on?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
  _agent?: {
    inSocket?: {
      on?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
    }
  }
}

function appIconPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "app-icon.png")
  return path.join(app.getAppPath(), "build", "icon.png")
}

function registerAppIcon() {
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath())
}

function authorizeSidecar(connection: SidecarConnection) {
  authorizedSidecar = {
    origin: new URL(connection.url).origin,
    header: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
  }
}

function registerSidecarAuthorization() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (authorizedSidecar) {
      try {
        if (new URL(details.url).origin === authorizedSidecar.origin) {
          details.requestHeaders.authorization = authorizedSidecar.header
        }
      } catch {
        // Ignore non-standard internal URLs.
      }
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

function registerContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [RENDERER_CSP],
      },
    })
  })
}

function openExternalURL(url: string) {
  try {
    const parsed = new URL(url)
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return
    void shell.openExternal(url)
  } catch {
    return
  }
}

function validString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function validBrowserInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { id?: unknown; url?: unknown }
  const id = validString(input.id)
  if (!id) return
  return { id, url: validString(input.url) }
}

function validBrowserBounds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { id?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  const id = validString(input.id)
  const x = typeof input.x === "number" ? input.x : undefined
  const y = typeof input.y === "number" ? input.y : undefined
  const width = typeof input.width === "number" ? input.width : undefined
  const height = typeof input.height === "number" ? input.height : undefined
  if (!id || x === undefined || y === undefined || width === undefined || height === undefined) return
  if (width < 1 || height < 1) return
  return { id, x: Math.max(0, x), y: Math.max(0, y), width: Math.max(1, width), height: Math.max(1, height) }
}

function validBrowserAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { id?: unknown; action?: unknown }
  const id = validString(input.id)
  if (!id) return
  if (input.action === "back" || input.action === "forward" || input.action === "reload" || input.action === "stop") {
    return { id, action: input.action }
  }
}

function normalizeBrowserURL(input: string) {
  const raw = input.trim()
  if (!raw) return
  const value = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
    ? raw
    : /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(raw)
      ? `http://${raw}`
      : `https://${raw}`
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol)) return
    return url.toString()
  } catch {
    return
  }
}

function browserState(id: string, view: WebContentsView) {
  const history = view.webContents.navigationHistory
  return {
    id,
    url: view.webContents.getURL(),
    title: view.webContents.getTitle(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    loading: view.webContents.isLoading(),
  }
}

async function loadBrowserURL(view: WebContentsView, url: string) {
  try {
    await view.webContents.loadURL(url)
  } catch (cause) {
    if (isAbortedNavigation(cause)) return
    throw cause
  }
}

function isAbortedNavigation(cause: unknown) {
  return cause instanceof Error && "code" in cause && cause.code === "ERR_ABORTED"
}

function activeBrowserView(id: string) {
  return browserViews.get(id)
}

function createBrowserView(id: string) {
  const existing = browserViews.get(id)
  if (existing) return existing
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      partition: "persist:opencodex-workbench-browser",
    },
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    openExternalURL(url)
    return { action: "deny" }
  })
  browserViews.set(id, view)
  return view
}

function showBrowserView(id: string, window: BrowserWindow, view: WebContentsView) {
  if (!visibleBrowserViews.has(id)) {
    window.contentView.addChildView(view)
    visibleBrowserViews.add(id)
  }
  view.setVisible(true)
}

function hideBrowserView(id: string, view: WebContentsView) {
  if (!visibleBrowserViews.has(id)) return
  view.setVisible(false)
}

function validEditorInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { value?: unknown; cwd?: unknown }
  const text = validString(input.value)
  if (text === undefined) return
  const cwd = validString(input.cwd)
  return { value: text, ...(cwd ? { cwd } : {}) }
}

function validTerminalCreateInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { id?: unknown; cwd?: unknown; cols?: unknown; rows?: unknown }
  const id = validString(input.id)
  if (!id) return
  const cwd = validString(input.cwd)?.trim()
  return {
    id,
    ...(cwd ? { cwd } : {}),
    cols: terminalDimension(input.cols, 100),
    rows: terminalDimension(input.rows, 30),
  }
}

function validTerminalWriteInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { id?: unknown; data?: unknown }
  const id = validString(input.id)
  const data = validString(input.data)
  if (!id || data === undefined) return
  return { id, data }
}

function validTerminalResizeInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { id?: unknown; cols?: unknown; rows?: unknown }
  const id = validString(input.id)
  if (!id) return
  return { id, cols: terminalDimension(input.cols, 100), rows: terminalDimension(input.rows, 30) }
}

function terminalDimension(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(400, Math.round(value)))
}

function terminalShell() {
  if (process.platform === "win32") {
    const command = process.env.OPENCODEX_TERMINAL_SHELL || "powershell.exe"
    const shellName = path.basename(command).toLowerCase()
    const isPowerShell = shellName === "powershell.exe" || shellName === "powershell" || shellName === "pwsh.exe" || shellName === "pwsh"
    return { command, args: isPowerShell ? ["-NoLogo", "-NoProfile", "-NoExit"] : [] }
  }
  return { command: process.env.SHELL || "/bin/sh", args: [] as string[] }
}

function terminalEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

function destroyTerminal(id: string) {
  const terminal = terminalProcesses.get(id)
  if (!terminal) return false
  terminal.closed = true
  terminalProcesses.delete(id)
  try {
    terminal.proc.kill()
    return true
  } catch {
    return false
  }
}

function closeTerminal(id: string) {
  const terminal = terminalProcesses.get(id)
  if (!terminal) return
  terminal.closed = true
  terminalProcesses.delete(id)
}

function handleTerminalError(id: string) {
  closeTerminal(id)
}

function sendTerminalEvent(sender: WebContents, channel: "opencodex:terminal:data" | "opencodex:terminal:exit", payload: object) {
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

function writeTerminal(id: string, data: string) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || terminal.closed) return false
  try {
    terminal.proc.write(data)
    return true
  } catch {
    closeTerminal(id)
    return false
  }
}

function resizeTerminal(id: string, cols: number, rows: number) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || terminal.closed) return false
  try {
    terminal.proc.resize(cols, rows)
    return true
  } catch {
    closeTerminal(id)
    return false
  }
}

function registerTerminalErrorHandler(id: string, proc: pty.IPty) {
  const procWithErrors = proc as PtyWithErrorEvents
  procWithErrors.on?.("error", () => handleTerminalError(id))
  procWithErrors._agent?.inSocket?.on?.("error", () => handleTerminalError(id))
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: "OpencodeX",
    icon: appIconPath(),
    backgroundColor: "#090a0f",
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalURL(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith("http://127.0.0.1:5173/")) return
    event.preventDefault()
    openExternalURL(url)
  })

  if (isDev) {
    await window.loadURL("http://127.0.0.1:5173")
    if (process.env.OPENCODEX_GUI_DEVTOOLS === "1") window.webContents.openDevTools({ mode: "detach" })
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"))
  if (process.env.OPENCODEX_GUI_SMOKE === "1") {
    try {
      await runSmokeCheck(window)
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  }
}

ipcMain.handle("opencodex:connection", async () => {
  const connection = await startSidecar()
  authorizeSidecar(connection)
  return { url: connection.url, directory: connection.directory }
})

ipcMain.handle("opencodex:window", (event, action: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (action === "minimize") window.minimize()
  if (action === "maximize") {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  }
  if (action === "close") window.close()
})

ipcMain.handle("opencodex:folder", async (_event, defaultPath?: unknown) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath: validString(defaultPath),
  })
  return result.canceled ? undefined : result.filePaths[0]
})

ipcMain.handle("opencodex:folders", async (_event, defaultPath?: unknown) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory", "multiSelections"],
    defaultPath: validString(defaultPath),
  })
  return result.canceled ? undefined : result.filePaths
})

ipcMain.handle("opencodex:file", async (_event, defaultPath?: unknown) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    defaultPath: validString(defaultPath),
  })
  return result.canceled ? undefined : result.filePaths[0]
})

ipcMain.handle("opencodex:contextPaths", async (event, defaultPath?: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options: MessageBoxOptions = {
    type: "question",
    title: "Add context",
    message: "Add file or folder context",
    buttons: ["Files", "Folders", "Cancel"],
    cancelId: 2,
    noLink: true,
  }
  const choice = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  if (choice.response === 2) return undefined
  const type = choice.response === 1 ? "directory" as const : "file" as const
  const result = await dialog.showOpenDialog({
    properties: [type === "directory" ? "openDirectory" : "openFile", "multiSelections"],
    defaultPath: validString(defaultPath),
  })
  if (result.canceled) return undefined
  return result.filePaths.map((filePath) => ({ path: filePath, type }))
})

ipcMain.handle("opencodex:editor", async (_event, raw: unknown) => {
  const input = validEditorInput(raw)
  if (!input) return undefined
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) return undefined
  const dir = await mkdtemp(path.join(tmpdir(), "opencodex-editor-"))
  const file = path.join(dir, "prompt.md")
  await writeFile(file, input.value)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(`${editor} "${file}"`, {
        cwd: input.cwd,
        shell: true,
        stdio: "inherit",
      })
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code === 0) return resolve()
        reject(new Error(`Editor exited with code ${code ?? "unknown"}`))
      })
    })
    const content = await readFile(file, "utf8")
    return content || undefined
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

ipcMain.handle("opencodex:terminal:create", (event, raw: unknown) => {
  const input = validTerminalCreateInput(raw)
  if (!input) return { ok: false, message: "Invalid terminal request." }
  const existing = terminalProcesses.get(input.id)
  if (existing) return { ok: true, pid: existing.proc.pid }
  const shell = terminalShell()
  const sender = event.sender
  const ownerID = sender.id
  try {
    const proc = pty.spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd || app.getPath("home"),
      env: terminalEnvironment(),
    })
    terminalProcesses.set(input.id, { ownerID, proc, closed: false })
    registerTerminalErrorHandler(input.id, proc)
    proc.onData((data) => sendTerminalEvent(sender, "opencodex:terminal:data", { id: input.id, data }))
    proc.onExit((exit) => {
      closeTerminal(input.id)
      sendTerminalEvent(sender, "opencodex:terminal:exit", {
        id: input.id,
        ...(typeof exit.exitCode === "number" ? { exitCode: exit.exitCode } : {}),
        ...(typeof exit.signal === "number" || typeof exit.signal === "string" ? { signal: exit.signal } : {}),
      })
    })
    sender.once("destroyed", () => {
      terminalProcesses.forEach((terminal, id) => {
        if (terminal.ownerID === ownerID) destroyTerminal(id)
      })
    })
    return { ok: true, pid: proc.pid }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Failed to open terminal." }
  }
})

ipcMain.handle("opencodex:terminal:write", (_event, raw: unknown) => {
  const input = validTerminalWriteInput(raw)
  if (!input) return false
  return writeTerminal(input.id, input.data)
})

ipcMain.on("opencodex:terminal:write", (_event, raw: unknown) => {
  const input = validTerminalWriteInput(raw)
  if (!input) return
  writeTerminal(input.id, input.data)
})

ipcMain.handle("opencodex:terminal:resize", (_event, raw: unknown) => {
  const input = validTerminalResizeInput(raw)
  if (!input) return false
  return resizeTerminal(input.id, input.cols, input.rows)
})

ipcMain.on("opencodex:terminal:resize", (_event, raw: unknown) => {
  const input = validTerminalResizeInput(raw)
  if (!input) return
  resizeTerminal(input.id, input.cols, input.rows)
})

ipcMain.handle("opencodex:terminal:destroy", (_event, id: unknown) => {
  const terminalID = validString(id)
  return terminalID ? destroyTerminal(terminalID) : false
})

ipcMain.handle("opencodex:browser:create", async (event, raw: unknown) => {
  const input = validBrowserInput(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !window) return undefined
  const view = createBrowserView(input.id)
  if (input.url) {
    const url = normalizeBrowserURL(input.url)
    if (url) await loadBrowserURL(view, url)
  }
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:bounds", (event, raw: unknown) => {
  const input = validBrowserBounds(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !window) return undefined
  const view = activeBrowserView(input.id)
  if (!view) return undefined
  showBrowserView(input.id, window, view)
  view.setBounds({ x: input.x, y: input.y, width: input.width, height: input.height })
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:hide", (event, id: unknown) => {
  const browserID = validString(id)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!browserID || !window) return undefined
  const view = activeBrowserView(browserID)
  if (!view) return undefined
  hideBrowserView(browserID, view)
  return browserState(browserID, view)
})

ipcMain.handle("opencodex:browser:navigate", async (event, raw: unknown) => {
  const input = validBrowserInput(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !input.url || !window) return undefined
  const url = normalizeBrowserURL(input.url)
  if (!url) return undefined
  const view = createBrowserView(input.id)
  await loadBrowserURL(view, url)
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:action", (event, raw: unknown) => {
  const input = validBrowserAction(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !window) return undefined
  const view = activeBrowserView(input.id)
  if (!view) return undefined
  if (input.action === "back" && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
  if (input.action === "forward" && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
  if (input.action === "reload") view.webContents.reload()
  if (input.action === "stop") view.webContents.stop()
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:screenshot", async (_event, id: unknown) => {
  const browserID = validString(id)
  if (!browserID) return undefined
  const view = activeBrowserView(browserID)
  if (!view) return undefined
  return (await view.webContents.capturePage()).toDataURL()
})

ipcMain.handle("opencodex:browser:devtools", (_event, id: unknown) => {
  const browserID = validString(id)
  if (!browserID) return undefined
  const view = activeBrowserView(browserID)
  if (!view) return undefined
  if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()
  else view.webContents.openDevTools({ mode: "detach" })
  return browserState(browserID, view)
})

ipcMain.handle("opencodex:browser:destroy", (event, id: unknown) => {
  const browserID = validString(id)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!browserID || !window) return undefined
  const view = activeBrowserView(browserID)
  if (!view) return undefined
  hideBrowserView(browserID, view)
  if (visibleBrowserViews.has(browserID)) window.contentView.removeChildView(view)
  view.webContents.close()
  browserViews.delete(browserID)
  visibleBrowserViews.delete(browserID)
  return true
})

async function runSmokeCheck(window: BrowserWindow) {
  const connection = await startSidecar()
  authorizeSidecar(connection)
  const hasRoot = await window.webContents.executeJavaScript("Boolean(document.querySelector('#root'))")
  if (hasRoot !== true) throw new Error("Packaged GUI smoke failed: renderer root was not mounted")
  await checkSidecarHealth(connection)
}

async function checkSidecarHealth(connection: SidecarConnection) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch(new URL("/global/health", connection.url), {
      headers: {
        authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`sidecar health returned ${response.status}`)
    const body = (await response.json()) as { healthy?: unknown }
    if (body.healthy !== true) throw new Error("sidecar health response was not healthy")
  } finally {
    clearTimeout(timeout)
  }
}

app.whenReady().then(() => {
  registerAppIcon()
  registerContentSecurityPolicy()
  registerSidecarAuthorization()
  return createWindow()
})
app.on("window-all-closed", () => {
  stopSidecar()
  if (process.platform !== "darwin") app.quit()
})
app.on("before-quit", stopSidecar)
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
