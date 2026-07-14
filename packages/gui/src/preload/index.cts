import { contextBridge, ipcRenderer, webUtils } from "electron"

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

export type TerminalResult = {
  ok: boolean
  message?: string
  pid?: number
}

export type TerminalDataEvent = {
  id: string
  data: string
}

export type TerminalExitEvent = {
  id: string
  exitCode?: number
  signal?: number | string
}

export type ContextPath = {
  path: string
  type: "file" | "directory"
}

contextBridge.exposeInMainWorld("opencodex", {
  connection: () => ipcRenderer.invoke("opencodex:connection") as Promise<GuiConnection>,
  folder: (defaultPath?: string) => ipcRenderer.invoke("opencodex:folder", defaultPath) as Promise<string | undefined>,
  folders: (defaultPath?: string) => ipcRenderer.invoke("opencodex:folders", defaultPath) as Promise<string[] | undefined>,
  file: (defaultPath?: string) => ipcRenderer.invoke("opencodex:file", defaultPath) as Promise<string | undefined>,
  contextPaths: (defaultPath?: string) => ipcRenderer.invoke("opencodex:contextPaths", defaultPath) as Promise<ContextPath[] | undefined>,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  editor: (input: { value: string; cwd?: string }) => ipcRenderer.invoke("opencodex:editor", input) as Promise<string | undefined>,
  terminal: {
    create: (input: { id: string; cwd?: string; cols?: number; rows?: number }) => ipcRenderer.invoke("opencodex:terminal:create", input) as Promise<TerminalResult>,
    write: (input: { id: string; data: string }) => ipcRenderer.send("opencodex:terminal:write", input),
    resize: (input: { id: string; cols: number; rows: number }) => ipcRenderer.send("opencodex:terminal:resize", input),
    destroy: (id: string) => ipcRenderer.invoke("opencodex:terminal:destroy", id) as Promise<boolean>,
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
  window: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("opencodex:window", action),
  edit: (action: "cut" | "copy" | "paste") => ipcRenderer.invoke("opencodex:edit", action),
  browser: {
    create: (input: { id: string; url?: string }) => ipcRenderer.invoke("opencodex:browser:create", input) as Promise<BrowserState | undefined>,
    bounds: (input: { id: string; x: number; y: number; width: number; height: number }) => ipcRenderer.invoke("opencodex:browser:bounds", input) as Promise<BrowserState | undefined>,
    hide: (id: string) => ipcRenderer.invoke("opencodex:browser:hide", id) as Promise<BrowserState | undefined>,
    navigate: (input: { id: string; url: string }) => ipcRenderer.invoke("opencodex:browser:navigate", input) as Promise<BrowserState | undefined>,
    action: (input: { id: string; action: "back" | "forward" | "reload" | "stop" }) => ipcRenderer.invoke("opencodex:browser:action", input) as Promise<BrowserState | undefined>,
    screenshot: (id: string) => ipcRenderer.invoke("opencodex:browser:screenshot", id) as Promise<string | undefined>,
    devtools: (id: string) => ipcRenderer.invoke("opencodex:browser:devtools", id) as Promise<BrowserState | undefined>,
    destroy: (id: string) => ipcRenderer.invoke("opencodex:browser:destroy", id) as Promise<boolean | undefined>,
  },
})
