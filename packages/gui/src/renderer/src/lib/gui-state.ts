import {
  selectClientOperationsSnapshot,
  selectClientCapabilitiesSnapshot,
  selectClientStateSyncSnapshot,
  type ClientStateSyncState,
} from "@opencode-ai/sdk/v2/client-sync"
import { mergeSessionCardSnapshot } from "./live-session-patch"
import { reconcileGuiCapabilities } from "./capabilities"
import { isRenderableSession } from "./session-filter"
import type { GuiSnapshot } from "./store-types"

export function emptyGuiSnapshot(): GuiSnapshot {
  return {
    projects: [],
    sessions: [],
    terminalSessions: [],
    sessionStatus: {},
    sessionUiState: {},
    permissions: [],
    questions: [],
    providers: [],
    connectedProviderIDs: [],
    agents: [],
    commands: [],
    lsp: [],
    mcp: {},
    mcpResources: {},
    plugins: [],
    swarms: [],
    jobs: [],
    views: [],
  }
}

export function reconcileGuiAuthoritativeState(current: GuiSnapshot | undefined, state: ClientStateSyncState) {
  const catalog = reconcileGuiCatalog(current, state)
  const operations = reconcileGuiOperations(catalog, state)
  return reconcileGuiCapabilityState(operations, state)
}

export function reconcileGuiCatalog(current: GuiSnapshot | undefined, state: ClientStateSyncState) {
  const catalog = selectClientStateSyncSnapshot(state, isRenderableSession)
  if (!catalog) return current
  return mergeSessionCardSnapshot(current ?? emptyGuiSnapshot(), { ...catalog, stateRevision: state.digest })
}

export function reconcileGuiOperations(current: GuiSnapshot | undefined, state: ClientStateSyncState) {
  const operations = selectClientOperationsSnapshot(state)
  if (!operations) return current
  const base = current ?? emptyGuiSnapshot()
  const jobs = sameItems(base.jobs, operations.jobs) ? base.jobs : operations.jobs
  const swarms = sameItems(base.swarms, operations.swarms) ? base.swarms : operations.swarms
  return base.jobs === jobs && base.swarms === swarms ? base : { ...base, jobs, swarms }
}

export function reconcileGuiCapabilityState(current: GuiSnapshot | undefined, state: ClientStateSyncState) {
  const capabilities = selectClientCapabilitiesSnapshot(state)
  if (!capabilities) return current
  return reconcileGuiCapabilities(current ?? emptyGuiSnapshot(), capabilities)
}

function sameItems<T>(current: T[], next: T[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}
