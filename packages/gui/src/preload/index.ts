import { contextBridge, ipcRenderer } from "electron"

export type GuiConnection = {
  url: string
  directory?: string
}

contextBridge.exposeInMainWorld("opencodex", {
  connection: () => ipcRenderer.invoke("opencodex:connection") as Promise<GuiConnection>,
  folder: (defaultPath?: string) => ipcRenderer.invoke("opencodex:folder", defaultPath) as Promise<string | undefined>,
  editor: (input: { value: string; cwd?: string }) => ipcRenderer.invoke("opencodex:editor", input) as Promise<string | undefined>,
  window: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("opencodex:window", action),
})
