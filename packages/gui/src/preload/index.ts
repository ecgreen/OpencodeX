import { contextBridge, ipcRenderer } from "electron"

export type GuiConnection = {
  url: string
}

contextBridge.exposeInMainWorld("opencodex", {
  connection: () => ipcRenderer.invoke("opencodex:connection") as Promise<GuiConnection>,
})
