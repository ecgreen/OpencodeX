import { contextBridge, ipcRenderer } from "electron"

export type GuiConnection = {
  url: string
  directory?: string
}

contextBridge.exposeInMainWorld("opencodex", {
  connection: () => ipcRenderer.invoke("opencodex:connection") as Promise<GuiConnection>,
  folder: () => ipcRenderer.invoke("opencodex:folder") as Promise<string | undefined>,
  window: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("opencodex:window", action),
})
