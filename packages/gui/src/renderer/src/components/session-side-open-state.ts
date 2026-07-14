import { compactPath } from "../lib/format"
import type { OpenPanelState, OpenTab } from "./session-side-open-types"

const stateBySession = new Map<string, OpenPanelState>()

export function openTabDefaults(id: string): OpenTab {
  return { id, kind: "picker", input: "", title: "New tab", text: "", original: "" }
}

export function restoreOpenPanelState(sessionID: string) {
  const state = stateBySession.get(sessionID)
  if (!state) return { tabs: [], activeID: "" }
  return {
    tabs: state.tabs,
    activeID: state.tabs.some((tab) => tab.id === state.activeID) ? state.activeID : state.tabs[0]?.id ?? "",
  }
}

export function saveOpenPanelState(sessionID: string, tabs: OpenTab[], activeID: string) {
  stateBySession.set(sessionID, {
    tabs,
    activeID: tabs.some((tab) => tab.id === activeID) ? activeID : tabs[0]?.id ?? "",
  })
}

export function openTabLabel(tab: OpenTab) {
  if (tab.kind === "context") return "Context"
  if (tab.kind === "file" && tab.path) return compactPath(tab.path)
  if (tab.kind === "git") return "Git"
  if (tab.kind === "picker") return "Open file"
  if (tab.kind === "terminal") return tab.title || "Terminal"
  if (tab.kind === "web") return tab.state?.title || tab.title || tab.url || "Web"
  return tab.title || "New tab"
}

export function openTabIcon(tab: OpenTab) {
  if (tab.kind === "context") return "context"
  if (tab.kind === "file" || tab.kind === "picker") return "file"
  if (tab.kind === "git") return "branch"
  if (tab.kind === "terminal") return "terminal"
  return "browser"
}

export function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
