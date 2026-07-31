import { compactPath } from "../lib/format"
import { updateWeightedLRUEntries } from "../lib/resource-limits"
import { workbenchBufferDirty, workbenchPathKey } from "../lib/workbench"
import { OPEN_PANEL_TAB_LIMIT, type OpenPanelState, type OpenTab } from "./session-side-open-types"

const STORAGE_PREFIX = "opencodex.gui.sessionWorkspace.tabs.v1."
const WORKSPACE_STATE_LIMIT = 12
export const WORKSPACE_STATE_CACHE_BYTES = 64 * 1024 * 1024
const stateBySession = new Map<string, OpenPanelState>()
const persistTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; state: OpenPanelState }>()

export function openTabDefaults(id: string): OpenTab {
  return { id, kind: "picker", input: "", title: "New tab", text: "", original: "" }
}

export function restoreOpenPanelState(sessionID: string) {
  const state = stateBySession.get(sessionID) ?? readStoredState(sessionID)
  if (!state) return { tabs: [], activeID: "" }
  cacheState(sessionID, state)
  return {
    tabs: state.tabs,
    activeID: state.tabs.some((tab) => tab.id === state.activeID) ? state.activeID : state.tabs[0]?.id ?? "",
  }
}

export function saveOpenPanelState(sessionID: string, tabs: OpenTab[], activeID: string) {
  if (!sessionID) return
  const state = {
    tabs: tabs.map(persistTab).filter((tab) => tab.kind !== "terminal"),
    activeID: tabs.some((tab) => tab.id === activeID && tab.kind !== "terminal") ? activeID : tabs.find((tab) => tab.kind !== "terminal")?.id ?? "",
  }
  if (typeof localStorage !== "undefined" && !sessionID.startsWith("pending:")) {
    const pending = persistTimers.get(sessionID)
    if (pending) clearTimeout(pending.timer)
    const timer = setTimeout(() => {
      if (persistTimers.get(sessionID)?.state !== state) return
      persistTimers.delete(sessionID)
      writeStoredState(sessionID, state)
    }, 150)
    persistTimers.set(sessionID, { timer, state })
  }
  cacheState(sessionID, state)
}

export function openTabLabel(tab: OpenTab) {
  if (tab.kind === "context") return "Context"
  if (tab.kind === "file" && tab.path) return compactPath(tab.path)
  if (tab.kind === "files" || tab.kind === "picker") return "Files"
  if (tab.kind === "git") return "Git"
  if (tab.kind === "graph") return "Graph"
  if (tab.kind === "terminal") return tab.title || "Terminal"
  if (tab.kind === "web") return tab.state?.title || tab.title || tab.url || "Web"
  return tab.title || "New tab"
}

export function openTabIcon(tab: OpenTab) {
  if (tab.kind === "context") return "context"
  if (tab.kind === "file" || tab.kind === "files" || tab.kind === "picker") return "file"
  if (tab.kind === "git") return "branch"
  if (tab.kind === "graph") return "graph"
  if (tab.kind === "terminal") return "terminal"
  return "browser"
}

export function openTabDirty(tab: OpenTab) {
  return tab.kind === "file" && !tab.readOnly && workbenchBufferDirty({ content: tab.text, original: tab.original })
}

/**
 * How a file should be marked in the explorer.
 *
 * Unsaved edits win over a session change: they are the ones that will be lost,
 * and the only ones the reader can act on from the explorer.
 */
export function openFileChangeStatus(
  path: string,
  keys: { dirty: ReadonlySet<string>; session: ReadonlySet<string> },
  pathKey: (value: string) => string,
) {
  const key = pathKey(path)
  if (keys.dirty.has(key)) return "dirty" as const
  if (keys.session.has(key)) return "session" as const
  return undefined
}

export function openTabFileIdentity(tab: Pick<OpenTab, "directory" | "path" | "root">, fallbackDirectory = "") {
  const directory = workbenchPathKey(tab.directory || fallbackDirectory)
  return [directory, workbenchPathKey(tab.root ?? directory), workbenchPathKey(tab.path)].join("\0")
}

function readStoredState(sessionID: string): OpenPanelState | undefined {
  if (typeof localStorage === "undefined" || !sessionID) return
  const value = localStorage.getItem(`${STORAGE_PREFIX}${sessionID}`)
  if (!value) return
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return
    const storedTabs = parsed.tabs.flatMap((value) => isStoredTab(value) ? [normalizeTab(value)] : [])
    const requestedActiveID = typeof parsed.activeID === "string" ? parsed.activeID : ""
    const keep = new Set(storedTabs.slice(0, OPEN_PANEL_TAB_LIMIT).map((tab) => tab.id))
    if (requestedActiveID && storedTabs.some((tab) => tab.id === requestedActiveID)) {
      if (keep.size >= OPEN_PANEL_TAB_LIMIT) keep.delete(Array.from(keep).at(-1)!)
      keep.add(requestedActiveID)
    }
    const tabs = storedTabs.filter((tab) => keep.has(tab.id))
    const activeID = typeof parsed.activeID === "string" && tabs.some((tab) => tab.id === parsed.activeID)
      ? parsed.activeID
      : tabs[0]?.id ?? ""
    return { tabs, activeID }
  } catch {
    return
  }
}

function cacheState(sessionID: string, state: OpenPanelState) {
  const next = updateWeightedLRUEntries({
    entries: Array.from(stateBySession.entries()),
    key: sessionID,
    value: state,
    maxEntries: WORKSPACE_STATE_LIMIT,
    maxWeight: WORKSPACE_STATE_CACHE_BYTES,
    weight: openPanelStateBytes,
  })
  stateBySession.clear()
  next.entries.forEach(([id, value]) => stateBySession.set(id, value))
  next.evicted.forEach(([id]) => flushStoredState(id))
}

function flushStoredState(sessionID: string) {
  const pending = persistTimers.get(sessionID)
  if (!pending) return
  clearTimeout(pending.timer)
  persistTimers.delete(sessionID)
  writeStoredState(sessionID, pending.state)
}

function writeStoredState(sessionID: string, state: OpenPanelState) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${sessionID}`, JSON.stringify(state))
  } catch {
    return
  }
}

export function openPanelStateBytes(state: OpenPanelState) {
  return state.tabs.reduce((total, tab) => total + 256 + [
    tab.id,
    tab.input,
    tab.title,
    tab.path,
    tab.directory,
    tab.root,
    tab.url,
    tab.text,
    tab.original,
    tab.message,
    tab.externalText,
    tab.content?.content,
    tab.content?.mimeType,
    tab.state?.id,
    tab.state?.url,
    tab.state?.title,
  ].reduce((bytes, value) => bytes + (value?.length ?? 0) * 2, 0), 64)
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
  // Terminals are deliberately absent: a restored terminal tab would have no
  // live PTY behind it. The graph rebuilds itself from state, so it restores.
  return ["context", "file", "files", "git", "graph", "picker", "web"].includes(String(value.kind))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
