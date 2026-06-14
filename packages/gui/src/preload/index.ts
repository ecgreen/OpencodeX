import { contextBridge, ipcRenderer } from "electron"

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

contextBridge.exposeInMainWorld("opencodex", {
  connection: () => ipcRenderer.invoke("opencodex:connection") as Promise<GuiConnection>,
  folder: (defaultPath?: string) => ipcRenderer.invoke("opencodex:folder", defaultPath) as Promise<string | undefined>,
  editor: (input: { value: string; cwd?: string }) => ipcRenderer.invoke("opencodex:editor", input) as Promise<string | undefined>,
  window: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("opencodex:window", action),
  browser: {
    create: (input: { id: string; url?: string }) => ipcRenderer.invoke("opencodex:browser:create", input) as Promise<BrowserState | undefined>,
    bounds: (input: { id: string; x: number; y: number; width: number; height: number }) => ipcRenderer.invoke("opencodex:browser:bounds", input) as Promise<BrowserState | undefined>,
    navigate: (input: { id: string; url: string }) => ipcRenderer.invoke("opencodex:browser:navigate", input) as Promise<BrowserState | undefined>,
    action: (input: { id: string; action: "back" | "forward" | "reload" | "stop" }) => ipcRenderer.invoke("opencodex:browser:action", input) as Promise<BrowserState | undefined>,
    screenshot: (id: string) => ipcRenderer.invoke("opencodex:browser:screenshot", id) as Promise<string | undefined>,
    devtools: (id: string) => ipcRenderer.invoke("opencodex:browser:devtools", id) as Promise<BrowserState | undefined>,
    destroy: (id: string) => ipcRenderer.invoke("opencodex:browser:destroy", id) as Promise<boolean | undefined>,
  },
})
