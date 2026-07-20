import type { ClientStateSyncState } from "@opencode-ai/sdk/v2/client-sync"

export function authoritativeStateChanges(
  current: ClientStateSyncState | undefined,
  next: ClientStateSyncState,
) {
  if (!current) return { catalog: true, operations: true, capabilities: true, presentation: true, details: true }
  const phase = current.phase !== next.phase
  return {
    catalog:
      phase ||
      current.projects !== next.projects ||
      current.sessions !== next.sessions ||
      current.views !== next.views ||
      current.permissions !== next.permissions ||
      current.questions !== next.questions ||
      current.sessionStatus !== next.sessionStatus ||
      current.sessionUiState !== next.sessionUiState,
    operations: phase || current.jobs !== next.jobs || current.swarms !== next.swarms,
    capabilities: current.capabilities !== next.capabilities,
    presentation:
      current.epoch !== next.epoch ||
      current.scope?.projectID !== next.scope?.projectID ||
      current.scope?.workspaceID !== next.scope?.workspaceID ||
      current.scope?.directory !== next.scope?.directory ||
      current.sessions !== next.sessions,
    details: current.sessionDetails !== next.sessionDetails,
  }
}
