import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  type NativeImage,
  type Session,
  type WebContents,
} from "electron"
import {
  BROWSER_CAPTURE_MAX_ENCODED_BYTES,
  PNG_DATA_URL_PREFIX,
  browserCaptureEncodedBytes,
  fitBrowserCaptureDimensions,
  shrinkBrowserCaptureDimensions,
} from "./browser-capture-limits.js"
import { shapeBrowserSnapshot, validExternalBrowserURL } from "./browser-capabilities.js"
import { validString } from "./ipc-validation.js"
import { createKeyedSingleFlight, ownerHasResourceCapacity } from "./native-resource-limits.js"
import { browserViewBoundsForZoom } from "./browser-view-bounds.js"

type BrowserView = {
  ownerID: number
  windowID: number
  view: WebContentsView
}

const browserViews = new Map<string, BrowserView>()
const visibleBrowserViews = new Set<string>()
const browserViewOwners = new Set<number>()
const securedSessions = new WeakSet<Session>()
const browserCaptureRequests = createKeyedSingleFlight<string, { view: WebContentsView; url: string; dataURL: string } | undefined>()

const BROWSER_SNAPSHOT_SCRIPT = String.raw`(() => {
  const MAX_BODY_TEXT = 24000
  const MAX_ITEMS = 200
  const MAX_SCANNED_ITEMS = 2000
  const MAX_TOTAL_BYTES = 64000
  const line = (value, limit) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : ""
  const bodyText = (value) =>
    typeof value === "string"
      ? value.replace(/\r/g, "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_TEXT)
      : ""
  const size = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  const visible = (element) => {
    if (typeof element.checkVisibility === "function" &&
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const style = getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false
    return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)
  }
  const labelFor = (element) => {
    const labels = element.labels
      ? Array.from(element.labels).map((label) => line(label.innerText || label.textContent, 500)).filter(Boolean).join(" ")
      : ""
    const labelledBy = line(element.getAttribute("aria-labelledby"), 500)
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((target) => line(target.innerText || target.textContent, 500))
      .filter(Boolean)
      .join(" ")
    return line(element.getAttribute("aria-label") || labels || labelledBy || element.getAttribute("placeholder"), 500)
  }
  const itemFor = (element) => {
    const tag = element.tagName.toLowerCase()
    const role = line(element.getAttribute("role"), 100)
    const label = labelFor(element)
    const name = line(element.getAttribute("name"), 500)
    const text = line(element.innerText || element.textContent, 500)
    const href = tag === "a" ? line(typeof element.href === "string" ? element.href : element.getAttribute("href"), 2048) : ""
    const type = line(element.getAttribute("type") || ((tag === "input" || tag === "button") ? element.type : ""), 100).toLowerCase()
    const hasValue = tag === "input" || tag === "select" || tag === "textarea"
    const value = hasValue ? (type === "password" ? "[REDACTED]" : line(element.value, 1000)) : ""
    const hasDisabled = "disabled" in element || element.hasAttribute("aria-disabled")
    const disabled = Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true"
    const hasChecked = tag === "input" && (type === "checkbox" || type === "radio")
    return {
      tag,
      ...(role ? { role } : {}),
      ...(label ? { label } : {}),
      ...(name ? { name } : {}),
      ...(text ? { text } : {}),
      ...(href ? { href } : {}),
      ...(hasValue ? { value } : {}),
      ...(type ? { type } : {}),
      ...(hasDisabled ? { disabled } : {}),
      ...(hasChecked ? { checked: Boolean(element.checked) } : {}),
    }
  }
  const snapshot = {
    url: line(location.href, 2048),
    title: line(document.title, 500),
    bodyText: bodyText(document.body?.innerText),
    items: [],
  }
  while (size(snapshot) > MAX_TOTAL_BYTES && snapshot.bodyText) {
    snapshot.bodyText = snapshot.bodyText.slice(0, Math.floor(snapshot.bodyText.length * 0.8))
  }
  const elements = document.querySelectorAll("a,button,input,select,textarea,[role]")
  for (let index = 0; index < elements.length && index < MAX_SCANNED_ITEMS && snapshot.items.length < MAX_ITEMS; index += 1) {
    const element = elements[index]
    if (!visible(element)) continue
    snapshot.items.push(itemFor(element))
    if (size(snapshot) > MAX_TOTAL_BYTES) snapshot.items.pop()
  }
  return snapshot
})()`

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
    if (activeBrowserView(input.id, event.sender.id) !== view) return undefined
    return browserState(input.id, view)
  })

  ipcMain.handle("opencodex:browser:bounds", (event, raw: unknown) => {
    const input = validBrowserBounds(raw)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!input || !window) return undefined
    const view = activeBrowserView(input.id, event.sender.id)
    if (!view) return undefined
    showBrowserView(input.id, window, view)
    view.setBounds(browserViewBoundsForZoom(input, event.sender.getZoomFactor()))
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
    if (activeBrowserView(input.id, event.sender.id) !== view) return undefined
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
    const capture = await captureBrowserView(browserID, view)
    return capture?.view === view ? capture.dataURL : undefined
  })

  ipcMain.handle("opencodex:browser:capture", async (event, raw: unknown) => {
    const input = validBrowserCapture(raw)
    if (!input) return undefined
    const view = activeBrowserView(input.id, event.sender.id)
    if (!view || view.webContents.getURL() !== input.expectedURL) return undefined
    const capture = await captureBrowserView(input.id, view)
    return capture?.view === view && capture.url === input.expectedURL
      ? { url: capture.url, dataURL: capture.dataURL }
      : undefined
  })

  ipcMain.handle("opencodex:browser:snapshot", async (event, id: unknown) => {
    const browserID = validString(id)
    if (!browserID) return undefined
    const view = activeBrowserView(browserID, event.sender.id)
    if (!view) return undefined
    const snapshot = await view.webContents.executeJavaScript(BROWSER_SNAPSHOT_SCRIPT)
    return activeBrowserView(browserID, event.sender.id) === view ? shapeBrowserSnapshot(snapshot) : undefined
  })

  ipcMain.handle("opencodex:browser:external", (event, raw: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false
    const url = validExternalBrowserURL(raw)
    if (!url) return false
    openExternalURL(url)
    return true
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

function validBrowserCapture(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; expectedURL?: unknown }
  const id = validString(input.id)
  const expectedURL = validString(input.expectedURL)
  if (!id || !expectedURL || normalizeBrowserURL(expectedURL) !== expectedURL) return undefined
  return { id, expectedURL }
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
  if (!ownerHasResourceCapacity(browserViews.values(), owner.id)) return undefined
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
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

async function captureBrowserView(id: string, view: WebContentsView) {
  return browserCaptureRequests.run(id, async () => {
    if (browserViews.get(id)?.view !== view || view.webContents.isDestroyed()) return undefined
    const image = await view.webContents.capturePage()
    if (browserViews.get(id)?.view !== view || view.webContents.isDestroyed()) return undefined
    const dataURL = boundedBrowserCaptureDataURL(image)
    if (!dataURL) return undefined
    return { view, url: view.webContents.getURL(), dataURL }
  }).catch(() => undefined)
}

function boundedBrowserCaptureDataURL(image: NativeImage) {
  const original = image.getSize()
  const initial = fitBrowserCaptureDimensions(original)
  let current = initial.width === original.width && initial.height === original.height
    ? image
    : image.resize({ ...initial, quality: "good" })
  for (const _ of Array.from({ length: 16 })) {
    const png = current.toPNG()
    const encodedBytes = browserCaptureEncodedBytes(png.byteLength)
    if (encodedBytes <= BROWSER_CAPTURE_MAX_ENCODED_BYTES) return `${PNG_DATA_URL_PREFIX}${png.toString("base64")}`
    const size = current.getSize()
    if (size.width === 1 && size.height === 1) return undefined
    current = current.resize({ ...shrinkBrowserCaptureDimensions(size, encodedBytes), quality: "good" })
  }
  return undefined
}
