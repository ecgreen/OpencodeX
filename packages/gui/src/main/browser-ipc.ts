import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  type Session,
  type WebContents,
} from "electron"
import { validString } from "./ipc-validation.js"

type BrowserView = {
  ownerID: number
  windowID: number
  view: WebContentsView
}

const browserViews = new Map<string, BrowserView>()
const visibleBrowserViews = new Set<string>()
const browserViewOwners = new Set<number>()
const securedSessions = new WeakSet<Session>()

export function registerBrowserIpc(openExternalURL: (url: string) => void) {
  ipcMain.handle("opencodex:browser:create", async (event, raw: unknown) => {
    const input = validBrowserInput(raw)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!input || !window) return undefined
    const view = createBrowserView(input.id, event.sender, window.id, openExternalURL)
    if (!view) return undefined
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
    const view = activeBrowserView(input.id, event.sender.id)
    if (!view) return undefined
    showBrowserView(input.id, window, view)
    view.setBounds({ x: input.x, y: input.y, width: input.width, height: input.height })
    return browserState(input.id, view)
  })

  ipcMain.handle("opencodex:browser:hide", (event, id: unknown) => {
    const browserID = validString(id)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!browserID || !window) return undefined
    const view = activeBrowserView(browserID, event.sender.id)
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
    const view = createBrowserView(input.id, event.sender, window.id, openExternalURL)
    if (!view) return undefined
    await loadBrowserURL(view, url)
    return browserState(input.id, view)
  })

  ipcMain.handle("opencodex:browser:action", (event, raw: unknown) => {
    const input = validBrowserAction(raw)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!input || !window) return undefined
    const view = activeBrowserView(input.id, event.sender.id)
    if (!view) return undefined
    if (input.action === "back" && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
    if (input.action === "forward" && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
    if (input.action === "reload") view.webContents.reload()
    if (input.action === "stop") view.webContents.stop()
    return browserState(input.id, view)
  })

  ipcMain.handle("opencodex:browser:screenshot", async (event, id: unknown) => {
    const browserID = validString(id)
    if (!browserID) return undefined
    const view = activeBrowserView(browserID, event.sender.id)
    if (!view) return undefined
    return (await view.webContents.capturePage()).toDataURL()
  })

  ipcMain.handle("opencodex:browser:devtools", (event, id: unknown) => {
    const browserID = validString(id)
    if (!browserID) return undefined
    const view = activeBrowserView(browserID, event.sender.id)
    if (!view) return undefined
    if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()
    else view.webContents.openDevTools({ mode: "detach" })
    return browserState(browserID, view)
  })

  ipcMain.handle("opencodex:browser:destroy", (event, id: unknown) => {
    const browserID = validString(id)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!browserID || !window) return undefined
    return destroyBrowserView(browserID, event.sender.id)
  })
}

export function secureSession(target: Session) {
  if (securedSessions.has(target)) return
  securedSessions.add(target)
  target.setPermissionCheckHandler(() => false)
  target.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  target.setDevicePermissionHandler(() => false)
  target.on("will-download", (event) => event.preventDefault())
}

function validBrowserInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; url?: unknown }
  const id = validString(input.id)
  if (!id) return undefined
  return { id, url: validString(input.url) }
}

function validBrowserBounds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  const id = validString(input.id)
  const x = typeof input.x === "number" ? input.x : undefined
  const y = typeof input.y === "number" ? input.y : undefined
  const width = typeof input.width === "number" ? input.width : undefined
  const height = typeof input.height === "number" ? input.height : undefined
  if (!id || x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  if (width < 1 || height < 1) return undefined
  return { id, x: Math.max(0, x), y: Math.max(0, y), width: Math.max(1, width), height: Math.max(1, height) }
}

function validBrowserAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; action?: unknown }
  const id = validString(input.id)
  if (!id) return undefined
  if (input.action === "back" || input.action === "forward" || input.action === "reload" || input.action === "stop") {
    return { id, action: input.action }
  }
  return undefined
}

function normalizeBrowserURL(input: string) {
  const raw = input.trim()
  if (!raw) return undefined
  const value = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
    ? raw
    : /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(raw)
      ? `http://${raw}`
      : `https://${raw}`
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol)) return undefined
    return url.toString()
  } catch {
    return undefined
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
    if (cause instanceof Error && "code" in cause && cause.code === "ERR_ABORTED") return
    throw cause
  }
}

function activeBrowserView(id: string, ownerID: number) {
  const entry = browserViews.get(id)
  return entry?.ownerID === ownerID ? entry.view : undefined
}

function createBrowserView(id: string, owner: WebContents, windowID: number, openExternalURL: (url: string) => void) {
  const existing = browserViews.get(id)
  if (existing) return existing.ownerID === owner.id ? existing.view : undefined
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
  secureSession(view.webContents.session)
  browserViews.set(id, { ownerID: owner.id, windowID, view })
  view.webContents.once("destroyed", () => {
    if (browserViews.get(id)?.view !== view) return
    browserViews.delete(id)
    visibleBrowserViews.delete(id)
  })
  if (!browserViewOwners.has(owner.id)) {
    browserViewOwners.add(owner.id)
    owner.once("destroyed", () => {
      browserViews.forEach((entry, browserID) => {
        if (entry.ownerID === owner.id) destroyBrowserView(browserID)
      })
      browserViewOwners.delete(owner.id)
    })
  }
  return view
}

function destroyBrowserView(id: string, ownerID?: number) {
  const entry = browserViews.get(id)
  if (!entry || (ownerID !== undefined && entry.ownerID !== ownerID)) return false
  hideBrowserView(id, entry.view)
  entry.view.webContents.close()
  browserViews.delete(id)
  visibleBrowserViews.delete(id)
  return true
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
  const entry = browserViews.get(id)
  if (entry?.view === view) BrowserWindow.fromId(entry.windowID)?.contentView.removeChildView(view)
  visibleBrowserViews.delete(id)
}
