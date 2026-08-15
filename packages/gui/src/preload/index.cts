import { contextBridge, ipcRenderer, webUtils } from "electron"
import type {
  ClaudeCodeStatus,
  TerminalCreateInput,
  TerminalLaunchProfile,
  TerminalResult,
} from "../shared/terminal.js"

export type { ClaudeCodeStatus, TerminalCreateInput, TerminalLaunchProfile, TerminalResult }

export type GuiConnection = {
  url: string
  directory?: string
}

export type BrowserState = {
  id: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export type BrowserSnapshotItem = {
  tag: string
  role?: string
  label?: string
  name?: string
  text?: string
  href?: string
  value?: string
  type?: string
  disabled?: boolean
  checked?: boolean
}

export type BrowserSnapshot = {
  url: string
  title: string
  bodyText: string
  items: BrowserSnapshotItem[]
}

export type BrowserCapture = {
  url: string
  dataURL: string
}

export type TerminalDataEvent = {
  id: string
  data: string
}

export type TerminalExitEvent = {
  id: string
  exitCode?: number
  signal?: number | string
  message?: string
}

export type ContextPath = {
  path: string
  type: "file" | "directory"
}

export type NotificationRequest = {
  title: string
  body: string
  sessionID?: string
}

export type NotificationActivateEvent = {
  sessionID: string
}

/**
 * `ipcRenderer.invoke` is typed `Promise<any>`, so every call site would need
 * its own assertion. Narrowing once here keeps the bridge readable and confines
 * the unavoidable cast to a single place.
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

contextBridge.exposeInMainWorld("opencodex", {
  connection: () => invoke<GuiConnection>("opencodex:connection"),
  attachVersionMismatch: () => invoke<void>("opencodex:attach-version-mismatch"),
  restart: () => invoke<GuiConnection>("opencodex:restart"),
  installationID: () => invoke<string>("opencodex:installation-id"),
  claude: {
    status: () => invoke<ClaudeCodeStatus>("opencodex:claude:status"),
  },
  folder: (defaultPath?: string) => invoke<string | undefined>("opencodex:folder", defaultPath),
  folders: (defaultPath?: string) => invoke<string[] | undefined>("opencodex:folders", defaultPath),
  file: (defaultPath?: string) => invoke<string | undefined>("opencodex:file", defaultPath),
  contextPaths: (defaultPath?: string) => invoke<ContextPath[] | undefined>("opencodex:contextPaths", defaultPath),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  editor: (input: { value: string; cwd?: string }) => invoke<string | undefined>("opencodex:editor", input),
  terminal: {
    create: (input: TerminalCreateInput) => invoke<TerminalResult>("opencodex:terminal:create", input),
    write: (input: { id: string; data: string }) => ipcRenderer.send("opencodex:terminal:write", input),
    resize: (input: { id: string; cols: number; rows: number }) => ipcRenderer.send("opencodex:terminal:resize", input),
    destroy: (id: string) => invoke<boolean>("opencodex:terminal:destroy", id),
    onData: (listener: (event: TerminalDataEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => listener(payload)
      ipcRenderer.on("opencodex:terminal:data", handler)
      return () => ipcRenderer.off("opencodex:terminal:data", handler)
    },
    onExit: (listener: (event: TerminalExitEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => listener(payload)
      ipcRenderer.on("opencodex:terminal:exit", handler)
      return () => ipcRenderer.off("opencodex:terminal:exit", handler)
    },
  },
  notifications: {
    show: (input: NotificationRequest) => ipcRenderer.send("opencodex:notification:show", input),
    onActivate: (listener: (event: NotificationActivateEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: NotificationActivateEvent) => listener(payload)
      ipcRenderer.on("opencodex:notification:activate", handler)
      return () => ipcRenderer.off("opencodex:notification:activate", handler)
    },
  },
  window: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("opencodex:window", action),
  edit: (action: "cut" | "copy" | "paste") => ipcRenderer.invoke("opencodex:edit", action),
  browser: {
    create: (input: { id: string; url?: string }) => invoke<BrowserState | undefined>("opencodex:browser:create", input),
    bounds: (input: { id: string; x: number; y: number; width: number; height: number }) => invoke<BrowserState | undefined>("opencodex:browser:bounds", input),
    hide: (id: string) => invoke<BrowserState | undefined>("opencodex:browser:hide", id),
    navigate: (input: { id: string; url: string }) => invoke<BrowserState | undefined>("opencodex:browser:navigate", input),
    action: (input: { id: string; action: "back" | "forward" | "reload" | "stop" }) => invoke<BrowserState | undefined>("opencodex:browser:action", input),
    screenshot: (id: string) => invoke<string | undefined>("opencodex:browser:screenshot", id),
    capture: (input: { id: string; expectedURL: string }) => invoke<BrowserCapture | undefined>("opencodex:browser:capture", input),
    snapshot: (id: string) => invoke<BrowserSnapshot | undefined>("opencodex:browser:snapshot", id),
    external: (url: string) => invoke<boolean>("opencodex:browser:external", url),
    devtools: (id: string) => invoke<BrowserState | undefined>("opencodex:browser:devtools", id),
    destroy: (id: string) => invoke<boolean | undefined>("opencodex:browser:destroy", id),
  },
})
