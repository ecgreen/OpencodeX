export type SessionSidePanelTab = "context" | "git" | "open"

import type { SessionWorkspaceTarget } from "../lib/session-workspace-bridge"

export type SessionSidePanelTarget = SessionWorkspaceTarget

export type SessionSidePanelRequest = SessionSidePanelTarget & { token: number }

export type SessionSidePanelContextOption = {
  id: string
  label: string
  description?: string
}
