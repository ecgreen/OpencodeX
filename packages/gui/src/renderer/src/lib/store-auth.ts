import type { GuiClient } from "./client"

export function authHeaders(gui: GuiClient) {
  return gui.authHeader ? { authorization: gui.authHeader } : undefined
}
