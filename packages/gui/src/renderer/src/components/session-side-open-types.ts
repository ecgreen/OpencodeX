import type { FileContent } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchBrowserTabState } from "../lib/workbench"

export type OpenTab = {
  id: string
  input: string
  title: string
  kind: "context" | "file" | "files" | "git" | "picker" | "terminal" | "web"
  path?: string
  directory?: string
  url?: string
  state?: WorkbenchBrowserTabState
  content?: FileContent
  text: string
  original: string
  terminalStatus?: "connecting" | "open" | "closed" | "error"
  message?: string
  externalText?: string
  externallyChanged?: boolean
  agentControlled?: boolean
}

export type OpenPanelState = {
  tabs: OpenTab[]
  activeID: string
}

export type OpenTabRow =
  | { type: "tab"; tab: OpenTab }
  | { type: "placeholder"; id: string; width: number }

export type OpenTabDragPreview = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type PopupMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

export const OPEN_PANEL_EDIT_LIMIT = 750_000
export const OPEN_PANEL_OVERFLOW_VISIBLE_ROWS = 5
export const OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT = 182
