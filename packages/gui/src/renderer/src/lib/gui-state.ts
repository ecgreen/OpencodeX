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
  const catalog = selectClientStateSyncSnapshot(state, isRenderableSession)
  const operations = selectClientOperationsSnapshot(state)
  const capabilities = selectClientCapabilitiesSnapshot(state)
  if (!catalog) return current
  const base = current ?? emptyGuiSnapshot()
  const merged = mergeSessionCardSnapshot(base, { ...catalog, stateRevision: state.digest })
  const jobs = operations && !sameItems(merged.jobs, operations.jobs) ? operations.jobs : merged.jobs
  const swarms = operations && !sameItems(merged.swarms, operations.swarms) ? operations.swarms : merged.swarms
  const root = merged.jobs === jobs && merged.swarms === swarms ? merged : { ...merged, jobs, swarms }
  return capabilities ? reconcileGuiCapabilities(root, capabilities) : root
}

function sameItems<T>(current: T[], next: T[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}
