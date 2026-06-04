import path from "node:path"
import { app, BrowserWindow, ipcMain, session, shell } from "electron"
import { type SidecarConnection, startSidecar, stopSidecar } from "./sidecar.js"

const isDev = !app.isPackaged
let authorizedSidecar: { origin: string; header: string } | undefined

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

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: "OpencodeX",
    backgroundColor: "#090a0f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev) {
    await window.loadURL("http://127.0.0.1:5173")
    window.webContents.openDevTools({ mode: "detach" })
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"))
}

ipcMain.handle("opencodex:connection", async () => {
  const connection = await startSidecar()
  authorizeSidecar(connection)
  return { url: connection.url }
})

app.whenReady().then(() => {
  registerSidecarAuthorization()
  return createWindow()
})
app.on("window-all-closed", () => {
  stopSidecar()
  if (process.platform !== "darwin") app.quit()
})
app.on("before-quit", stopSidecar)
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
