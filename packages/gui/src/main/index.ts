import path from "node:path"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { app, BrowserView, BrowserWindow, dialog, ipcMain, session, shell } from "electron"
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
const browserViews = new Map<string, BrowserView>()

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

function browserState(id: string, view: BrowserView) {
  return {
    id,
    url: view.webContents.getURL(),
    title: view.webContents.getTitle(),
    canGoBack: view.webContents.canGoBack(),
    canGoForward: view.webContents.canGoForward(),
    loading: view.webContents.isLoading(),
  }
}

function activeBrowserView(id: string) {
  return browserViews.get(id)
}

function createBrowserView(id: string, window: BrowserWindow) {
  const existing = browserViews.get(id)
  if (existing) return existing
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:opencodex-workbench-browser",
    },
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    openExternalURL(url)
    return { action: "deny" }
  })
  browserViews.set(id, view)
  window.addBrowserView(view)
  return view
}

function validEditorInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as { value?: unknown; cwd?: unknown }
  const text = validString(input.value)
  if (text === undefined) return
  const cwd = validString(input.cwd)
  return { value: text, ...(cwd ? { cwd } : {}) }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: "OpencodeX",
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

ipcMain.handle("opencodex:browser:create", async (event, raw: unknown) => {
  const input = validBrowserInput(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !window) return undefined
  const view = createBrowserView(input.id, window)
  if (input.url) {
    const url = normalizeBrowserURL(input.url)
    if (url) await view.webContents.loadURL(url)
  }
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:bounds", (event, raw: unknown) => {
  const input = validBrowserBounds(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !window) return undefined
  const view = activeBrowserView(input.id)
  if (!view) return undefined
  if (!window.getBrowserViews().includes(view)) window.addBrowserView(view)
  view.setBounds({ x: input.x, y: input.y, width: input.width, height: input.height })
  view.setAutoResize({ width: true, height: true })
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:navigate", async (event, raw: unknown) => {
  const input = validBrowserInput(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !input.url || !window) return undefined
  const url = normalizeBrowserURL(input.url)
  if (!url) return undefined
  const view = createBrowserView(input.id, window)
  await view.webContents.loadURL(url)
  return browserState(input.id, view)
})

ipcMain.handle("opencodex:browser:action", (event, raw: unknown) => {
  const input = validBrowserAction(raw)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!input || !window) return undefined
  const view = activeBrowserView(input.id)
  if (!view) return undefined
  if (input.action === "back" && view.webContents.canGoBack()) view.webContents.goBack()
  if (input.action === "forward" && view.webContents.canGoForward()) view.webContents.goForward()
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
  window.removeBrowserView(view)
  view.webContents.close()
  browserViews.delete(browserID)
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
