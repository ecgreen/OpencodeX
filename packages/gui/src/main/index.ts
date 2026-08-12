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
import { isCoordinatorHealthy } from "@opencode-ai/sdk/coordinator"
import { type SidecarConnection, startSidecar, stopSidecar, waitForSidecarShutdown } from "./sidecar.js"
import { editorCommand } from "./editor-command.js"
import { registerBrowserIpc, secureSession } from "./browser-ipc.js"
import { registerNotificationIpc } from "./notification-ipc.js"
import { registerTerminalIpc } from "./terminal-ipc.js"
import { validString } from "./ipc-validation.js"
import { MAIN_PERFORMANCE_MILESTONES, markMainPerformance } from "./performance.js"
import { loopbackSidecarURL } from "./sidecar-connection.js"
import { createSidecarLifecycle } from "./sidecar-lifecycle.js"
import { attachEditContextMenu } from "./context-menu.js"
import { nextZoomLevel, zoomShortcutAction } from "./zoom-shortcuts.js"

markMainPerformance(MAIN_PERFORMANCE_MILESTONES.bootstrap)
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
const sidecarLifecycle = createSidecarLifecycle({
  start: startSidecar,
  health: isCoordinatorHealthy,
  install: authorizeSidecar,
  reset: () => {
    authorizedSidecar = undefined
  },
  stop: stopSidecar,
  awaitStopped: waitForSidecarShutdown,
})

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
  const url = loopbackSidecarURL(connection.url)
  if (!url) throw new Error("OpencodeX sidecar URL must use HTTP on a loopback host")
  authorizedSidecar = {
    origin: url.origin,
    header: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
  }
}

function ensureSidecar() {
  return sidecarLifecycle.ensure()
}

function stopOwnedSidecar() {
  return sidecarLifecycle.stop()
}

async function restartSidecar() {
  return sidecarLifecycle.restart()
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

function openWindow() {
  void ensureSidecar().catch((error) => console.error("Failed to prewarm OpencodeX sidecar", error))
  return createWindow()
}

async function createWindow() {
  markMainPerformance(MAIN_PERFORMANCE_MILESTONES.windowCreateStarted)
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
  markMainPerformance(MAIN_PERFORMANCE_MILESTONES.windowCreated)

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalURL(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (isRendererNavigation(url)) return
    event.preventDefault()
    openExternalURL(url)
  })
  attachEditContextMenu(window.webContents)
  window.webContents.on("before-input-event", (event, input) => {
    const action = zoomShortcutAction(input, process.platform)
    if (!action) return
    // Also stops the default menu's zoomOut accelerator from double-firing.
    event.preventDefault()
    window.webContents.zoomLevel = nextZoomLevel(window.webContents.zoomLevel, action)
  })

  markMainPerformance(MAIN_PERFORMANCE_MILESTONES.rendererLoadStarted)
  if (isDev) {
    await window.loadURL(rendererURL!)
    markMainPerformance(MAIN_PERFORMANCE_MILESTONES.rendererLoaded)
    if (background) window.showInactive()
    if (process.env.OPENCODEX_GUI_DEVTOOLS === "1") window.webContents.openDevTools({ mode: "detach" })
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"))
  markMainPerformance(MAIN_PERFORMANCE_MILESTONES.rendererLoaded)
  if (background) window.showInactive()
  if (process.env.OPENCODEX_GUI_SMOKE === "1") {
    try {
      await runSmokeCheck(window)
      process.exitCode = 0
      app.quit()
    } catch (error) {
      console.error(error)
      process.exitCode = 1
      app.quit()
    }
  }
}

ipcMain.handle("opencodex:connection", async () => {
  markMainPerformance(MAIN_PERFORMANCE_MILESTONES.sidecarRequestStarted)
  const connection = await ensureSidecar()
  markMainPerformance(MAIN_PERFORMANCE_MILESTONES.sidecarReady)
  return { url: connection.url, directory: connection.directory }
})

ipcMain.handle("opencodex:restart", async (event) => {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Backend restart is only available from the main OpencodeX window.")
  }
  const connection = await restartSidecar()
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
registerNotificationIpc()

async function runSmokeCheck(window: BrowserWindow) {
  await ensureSidecar()
  const hasRoot = await window.webContents.executeJavaScript("Boolean(document.querySelector('#root'))")
  if (hasRoot !== true) throw new Error("Packaged GUI smoke failed: renderer root was not mounted")
}

void app
  .whenReady()
  .then(() => {
    markMainPerformance(MAIN_PERFORMANCE_MILESTONES.appReady)
    registerAppIcon()
    secureSession(session.defaultSession)
    registerContentSecurityPolicy()
    registerSidecarAuthorization()
    return openWindow()
  })
  .catch((error) => console.error(error))
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
    return
  }
  void stopOwnedSidecar()
})
let quitAfterSidecarStop = false
let sidecarStopForQuit: Promise<void> | undefined
app.on("before-quit", (event) => {
  if (quitAfterSidecarStop) return
  event.preventDefault()
  if (sidecarStopForQuit) return
  sidecarStopForQuit = stopOwnedSidecar()
  void sidecarStopForQuit.then(
    () => {
      quitAfterSidecarStop = true
      app.quit()
    },
    (error) => {
      sidecarStopForQuit = undefined
      console.error("Failed to stop OpencodeX sidecar", error)
    },
  )
})
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void openWindow()
})
