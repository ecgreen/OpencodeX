import { workbenchNormalizeBrowserURL } from "./workbench-browser"
import type { WorkbenchArtifact, WorkbenchBrowserTab, WorkbenchPersistedState, WorkbenchTab } from "./workbench"

export const WORKBENCH_STATE_STORAGE_KEY = "opencodex.gui.workbench"
export const WORKBENCH_EXPLORER_WIDTH = { min: 220, max: 520, default: 300 }
export const WORKBENCH_ASSISTANT_WIDTH = { min: 280, max: 560, default: 340 }

export function workbenchClampPaneWidth(value: number | undefined, bounds: { min: number; max: number; default: number }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return bounds.default
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)))
}

export function parseWorkbenchState(value: string | null | undefined): Partial<WorkbenchPersistedState> {
  if (!value) return {}
  try {
    return normalizeWorkbenchState(JSON.parse(value))
  } catch {
    return {}
  }
}

export function readWorkbenchState(storage: Storage | undefined = globalStorage()) {
  return parseWorkbenchState(storage?.getItem(WORKBENCH_STATE_STORAGE_KEY))
}

export function writeWorkbenchState(state: WorkbenchPersistedState, storage: Storage | undefined = globalStorage()) {
  if (!storage) return
  storage.setItem(WORKBENCH_STATE_STORAGE_KEY, JSON.stringify(normalizeWorkbenchState(state)))
}

function normalizeWorkbenchState(input: unknown): Partial<WorkbenchPersistedState> {
  if (typeof input !== "object" || input === null) return {}
  const value = input as Partial<WorkbenchPersistedState>
  const browserTabs = normalizeWorkbenchBrowserTabs(value.browserTabs)
  const activeBrowserID = typeof value.activeBrowserID === "string" && browserTabs.some((tab) => tab.id === value.activeBrowserID)
    ? value.activeBrowserID
    : browserTabs[0]?.id
  return {
    ...(isWorkbenchTab(value.tab) ? { tab: value.tab } : {}),
    ...(typeof value.explorerCollapsed === "boolean" ? { explorerCollapsed: value.explorerCollapsed } : {}),
    explorerWidth: workbenchClampPaneWidth(value.explorerWidth, WORKBENCH_EXPLORER_WIDTH),
    ...(typeof value.assistantOpen === "boolean" ? { assistantOpen: value.assistantOpen } : {}),
    assistantWidth: workbenchClampPaneWidth(value.assistantWidth, WORKBENCH_ASSISTANT_WIDTH),
    assistantSessions: normalizeStringRecord(value.assistantSessions),
    ...(browserTabs.length > 0 ? { browserTabs } : {}),
    ...(activeBrowserID ? { activeBrowserID } : {}),
    artifacts: normalizeWorkbenchArtifacts(value.artifacts),
  }
}

function normalizeStringRecord(input: unknown) {
  if (typeof input !== "object" || input === null) return {}
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (!key || typeof value !== "string" || !value.trim()) return []
    return [[key, value]]
  }))
}

function normalizeWorkbenchBrowserTabs(input: unknown) {
  if (!Array.isArray(input)) return [] as WorkbenchBrowserTab[]
  return input.flatMap((item): WorkbenchBrowserTab[] => {
    if (typeof item !== "object" || item === null) return []
    const tab = item as Partial<WorkbenchBrowserTab>
    if (typeof tab.id !== "string" || !tab.id.trim()) return []
    if (typeof tab.url !== "string" || !tab.url.trim()) return []
    return [{
      id: tab.id,
      url: workbenchNormalizeBrowserURL(tab.url),
      ...(typeof tab.title === "string" && tab.title.trim() ? { title: tab.title.slice(0, 160) } : {}),
    }]
  }).slice(0, 8)
}

function normalizeWorkbenchArtifacts(input: unknown) {
  if (!Array.isArray(input)) return [] as WorkbenchArtifact[]
  return input.flatMap((item): WorkbenchArtifact[] => {
    if (typeof item !== "object" || item === null) return []
    const artifact = item as Partial<WorkbenchArtifact>
    if (typeof artifact.id !== "string" || !artifact.id.trim()) return []
    if (artifact.kind !== "note" && artifact.kind !== "screenshot" && artifact.kind !== "link") return []
    if (typeof artifact.title !== "string" || !artifact.title.trim()) return []
    const text = typeof artifact.text === "string" ? artifact.text.slice(0, 50_000) : undefined
    const url = typeof artifact.url === "string" && artifact.url.length <= 200_000 ? artifact.url : undefined
    if (artifact.kind === "note" && !text) return []
    if (artifact.kind === "screenshot" && !url) return []
    if (artifact.kind === "link" && !url) return []
    return [{
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title.slice(0, 180),
      created: typeof artifact.created === "number" && Number.isFinite(artifact.created) ? artifact.created : Date.now(),
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
    }]
  }).sort((left, right) => right.created - left.created).slice(0, 50)
}

function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return value === "files" || value === "git" || value === "browser" || value === "artifacts"
}

function globalStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
