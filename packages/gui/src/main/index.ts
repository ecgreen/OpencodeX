import path from "node:path"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import launch from "cross-spawn"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type MessageBoxOptions,
} from "electron"
import { type SidecarConnection, startSidecar, stopSidecar } from "./sidecar.js"
import { editorCommand } from "./editor-command.js"
import { registerBrowserIpc, secureSession } from "./browser-ipc.js"
import { registerTerminalIpc } from "./terminal-ipc.js"
import { validString } from "./ipc-validation.js"

const isDev = !app.isPackaged
const rendererURL = isDev ? developmentRendererURL() : undefined
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

function appIconPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "app-icon.png")
  return path.join(app.getAppPath(), "build", "icon.png")
}

function developmentRendererURL() {
  const value = process.env.OPENCODEX_GUI_RENDERER_URL ?? "http://127.0.0.1:5173"
  const url = new URL(value)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:") {
    throw new Error("OPENCODEX_GUI_RENDERER_URL must use HTTP on a loopback host.")
  }
  return url.origin
}

function isRendererNavigation(value: string) {
  if (!rendererURL) return false
  try {
    return new URL(value).origin === rendererURL
  } catch {
    return false
  }
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

function validEditorInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { value?: unknown; cwd?: unknown }
  const text = validString(input.value)
  if (text === undefined) return undefined
  const cwd = validString(input.cwd)
  return { value: text, ...(cwd ? { cwd } : {}) }
}

async function createWindow() {
  const background = process.env.OPENCODEX_GUI_E2E_BACKGROUND === "1"
  const window = new BrowserWindow({
    ...(background ? { x: -10000, y: -10000 } : {}),
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: "OpencodeX",
    icon: appIconPath(),
    backgroundColor: "#090a0f",
    frame: false,
    show: !background,
    skipTaskbar: background,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !background,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalURL(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (isRendererNavigation(url)) return
    event.preventDefault()
    openExternalURL(url)
  })

  if (isDev) {
    await window.loadURL(rendererURL!)
    if (background) window.showInactive()
    if (process.env.OPENCODEX_GUI_DEVTOOLS === "1") window.webContents.openDevTools({ mode: "detach" })
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"))
  if (background) window.showInactive()
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

ipcMain.handle("opencodex:edit", (event, action: unknown) => {
  if (action === "cut") event.sender.cut()
  if (action === "copy") event.sender.copy()
  if (action === "paste") event.sender.paste()
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
  const type = choice.response === 1 ? ("directory" as const) : ("file" as const)
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
  const editor = editorCommand(process.env.VISUAL || process.env.EDITOR || "")
  if (!editor) return undefined
  const dir = await mkdtemp(path.join(tmpdir(), "opencodex-editor-"))
  const file = path.join(dir, "prompt.md")
  await writeFile(file, input.value)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = launch(editor.command, [...editor.args, file], {
        cwd: input.cwd,
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      })
      child.on("error", reject)
      child.on("exit", (code: number | null) => {
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

registerTerminalIpc()
registerBrowserIpc(openExternalURL)

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
    const body = await response.json()
    if (!body || typeof body !== "object" || !("healthy" in body) || body.healthy !== true) {
      throw new Error("sidecar health response was not healthy")
    }
  } finally {
    clearTimeout(timeout)
  }
}

void app
  .whenReady()
  .then(() => {
    registerAppIcon()
    secureSession(session.defaultSession)
    registerContentSecurityPolicy()
    registerSidecarAuthorization()
    return createWindow()
  })
  .catch((error) => console.error(error))
app.on("window-all-closed", () => {
  stopSidecar()
  if (process.platform !== "darwin") app.quit()
})
app.on("before-quit", stopSidecar)
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
