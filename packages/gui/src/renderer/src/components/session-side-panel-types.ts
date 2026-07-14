export type SessionSidePanelTab = "context" | "git" | "open"

export type SessionSidePanelTarget =
  | { tab: "context" }
  | { tab: "git"; value?: string }
  | { tab: "open"; value?: string; title?: string }

export type SessionSidePanelRequest = SessionSidePanelTarget & { token: number }

export type SessionSidePanelContextOption = {
  id: string
  label: string
  description?: string
}
