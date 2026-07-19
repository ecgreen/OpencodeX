import { compactPath } from "../lib/format"
import { workbenchBufferDirty } from "../lib/workbench"
import type { OpenPanelState, OpenTab } from "./session-side-open-types"

const STORAGE_PREFIX = "opencodex.gui.sessionWorkspace.tabs.v1."
const stateBySession = new Map<string, OpenPanelState>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function openTabDefaults(id: string): OpenTab {
  return { id, kind: "picker", input: "", title: "New tab", text: "", original: "" }
}

export function restoreOpenPanelState(sessionID: string) {
  const state = stateBySession.get(sessionID) ?? readStoredState(sessionID)
  if (!state) return { tabs: [], activeID: "" }
  stateBySession.set(sessionID, state)
  return {
    tabs: state.tabs,
    activeID: state.tabs.some((tab) => tab.id === state.activeID) ? state.activeID : state.tabs[0]?.id ?? "",
  }
}

export function saveOpenPanelState(sessionID: string, tabs: OpenTab[], activeID: string) {
  const state = {
    tabs: tabs.map(persistTab).filter((tab) => tab.kind !== "terminal"),
    activeID: tabs.some((tab) => tab.id === activeID && tab.kind !== "terminal") ? activeID : tabs.find((tab) => tab.kind !== "terminal")?.id ?? "",
  }
  stateBySession.set(sessionID, { tabs, activeID: tabs.some((tab) => tab.id === activeID) ? activeID : tabs[0]?.id ?? "" })
  if (typeof localStorage === "undefined" || !sessionID || sessionID.startsWith("pending:")) return
  const pending = persistTimers.get(sessionID)
  if (pending) clearTimeout(pending)
  persistTimers.set(sessionID, setTimeout(() => {
    persistTimers.delete(sessionID)
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${sessionID}`, JSON.stringify(state))
    } catch {
      localStorage.removeItem(`${STORAGE_PREFIX}${sessionID}`)
    }
  }, 150))
}

export function openTabLabel(tab: OpenTab) {
  if (tab.kind === "context") return "Context"
  if (tab.kind === "file" && tab.path) return compactPath(tab.path)
  if (tab.kind === "files" || tab.kind === "picker") return "Files"
  if (tab.kind === "git") return "Git"
  if (tab.kind === "terminal") return tab.title || "Terminal"
  if (tab.kind === "web") return tab.state?.title || tab.title || tab.url || "Web"
  return tab.title || "New tab"
}

export function openTabIcon(tab: OpenTab) {
  if (tab.kind === "context") return "context"
  if (tab.kind === "file" || tab.kind === "files" || tab.kind === "picker") return "file"
  if (tab.kind === "git") return "branch"
  if (tab.kind === "terminal") return "terminal"
  return "browser"
}

export function openTabDirty(tab: OpenTab) {
  return tab.kind === "file" && workbenchBufferDirty({ content: tab.text, original: tab.original })
}

function readStoredState(sessionID: string): OpenPanelState | undefined {
  if (typeof localStorage === "undefined" || !sessionID) return
  const value = localStorage.getItem(`${STORAGE_PREFIX}${sessionID}`)
  if (!value) return
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return
    const tabs = parsed.tabs.flatMap((value) => isStoredTab(value) ? [normalizeTab(value)] : [])
    const activeID = typeof parsed.activeID === "string" && tabs.some((tab) => tab.id === parsed.activeID)
      ? parsed.activeID
      : tabs[0]?.id ?? ""
    return { tabs, activeID }
  } catch {
    localStorage.removeItem(`${STORAGE_PREFIX}${sessionID}`)
    return
  }
}

function normalizeTab(tab: OpenTab): OpenTab {
  if (tab.kind === "picker") return { ...tab, kind: "files", title: "Files", message: "" }
  if (tab.kind === "web") return { ...tab, input: tab.url || tab.input, message: "", agentControlled: false }
  return { ...tab, message: "", externallyChanged: false, externalText: undefined }
}

function persistTab(tab: OpenTab): OpenTab {
  const normalized = normalizeTab(tab)
  if (normalized.kind !== "file") return normalized
  if (!openTabDirty(normalized)) return { ...normalized, content: undefined, text: "", original: "" }
  return {
    ...normalized,
    content: normalized.content?.type === "text" ? { ...normalized.content, content: "" } : normalized.content,
  }
}

function isStoredTab(value: unknown): value is OpenTab {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string" || typeof value.input !== "string" || typeof value.title !== "string") return false
  if (typeof value.text !== "string" || typeof value.original !== "string") return false
  return ["context", "file", "files", "git", "picker", "web"].includes(String(value.kind))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
