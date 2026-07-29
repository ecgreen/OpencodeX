import { BrowserWindow, Notification, ipcMain, type WebContents } from "electron"
import { validNotificationRequest } from "./ipc-validation.js"

export const NOTIFICATION_SHOW_CHANNEL = "opencodex:notification:show"
export const NOTIFICATION_ACTIVATE_CHANNEL = "opencodex:notification:activate"

/**
 * OS notifications for work that needs a human, at parity with the TUI.
 *
 * The renderer decides *whether* to notify - it owns the attention projection
 * and the "only while blurred" rule - and main owns only the platform call,
 * because `Notification` exists in the main process alone. Clicking one brings
 * the window forward and routes the renderer to the session behind the item.
 */
export function registerNotificationIpc() {
  ipcMain.on(NOTIFICATION_SHOW_CHANNEL, (event, raw: unknown) => {
    const request = validNotificationRequest(raw)
    if (!request || !Notification.isSupported()) return
    const notification = new Notification({ title: request.title, body: request.body })
    notification.on("click", () => activateNotification(event.sender, request.sessionID))
    notification.show()
  })
}

function activateNotification(sender: WebContents, sessionID: string | undefined) {
  if (sender.isDestroyed()) return
  const window = BrowserWindow.fromWebContents(sender)
  if (window) {
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
  }
  if (sessionID) sender.send(NOTIFICATION_ACTIVATE_CHANNEL, { sessionID })
}
