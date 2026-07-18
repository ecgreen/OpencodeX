import {
  selectClientOperationsSnapshot,
  selectClientCapabilitiesSnapshot,
  selectClientSessionMessages,
  selectClientStateSyncSnapshot,
  clientAttentionItems,
  clientWorkItems,
  type ClientStateSyncState,
} from "@opencode-ai/sdk/v2"
import path from "node:path"

export function projectTuiClientState(state: ClientStateSyncState, options: { directory?: string; workItems?: ReturnType<typeof clientWorkItems> } = {}) {
  const catalog = selectClientStateSyncSnapshot(state)
  if (!catalog) return undefined
  const operations = selectClientOperationsSnapshot(state)
  const capabilities = selectClientCapabilitiesSnapshot(state)
  const directory = options.directory
  const sessions = directory
    ? catalog.sessions.filter((session) => path.resolve(session.directory) === path.resolve(directory))
    : catalog.sessions
  const sessionIDs = new Set(sessions.map((session) => session.id))
  const workItems = (options.workItems ?? clientWorkItems(state)).filter((item) => !item.sessionID || sessionIDs.has(item.sessionID))
  return {
    revision: state.digest,
    projects: catalog.projects,
    views: catalog.views,
    jobs: operations?.jobs,
    swarms: operations?.swarms,
    sessions: sessions.toSorted((a, b) => a.id.localeCompare(b.id)),
    sessionStatus: Object.fromEntries(Object.entries(catalog.sessionStatus).filter(([sessionID]) => sessionIDs.has(sessionID))),
    sessionUiState: Object.fromEntries(Object.entries(catalog.sessionUiState).filter(([sessionID]) => sessionIDs.has(sessionID))),
    permissions: groupRequestsBySession(catalog.permissions.filter((request) => sessionIDs.has(request.sessionID))),
    questions: groupRequestsBySession(catalog.questions.filter((request) => sessionIDs.has(request.sessionID))),
    workItems,
    attentionItems: clientAttentionItems(workItems),
    capabilities: capabilities
      ? {
          providers: capabilities.providers,
          providerDefaults: capabilities.providerDefaults,
          providerList: {
            all: capabilities.providers,
            default: capabilities.providerDefaults,
            connected: capabilities.connectedProviderIDs,
          },
          agents: capabilities.agents,
          commands: capabilities.commands,
          lsp: capabilities.lsp,
          mcp: capabilities.mcp,
          config: capabilities.config,
          mcpResources: capabilities.mcpResources,
          formatter: capabilities.formatter,
        }
      : undefined,
    details: Object.fromEntries(
      Object.entries(state.sessionDetails).filter(([sessionID]) => sessionIDs.has(sessionID)).map(([sessionID, detail]) => [
        sessionID,
        {
          version: `${state.epoch ?? ""}:${detail.revision}`,
          messages: selectClientSessionMessages(state, sessionID),
          todos: detail.snapshot.todos,
          diff: detail.snapshot.diff,
          session: detail.snapshot.session,
        },
      ]),
    ),
  }
}

function groupRequestsBySession<T extends { id: string; sessionID: string }>(requests: readonly T[]) {
  return requests.reduce<Record<string, T[]>>(
    (result, request) => ({
      ...result,
      [request.sessionID]: [...(result[request.sessionID] ?? []), request].toSorted((a, b) => a.id.localeCompare(b.id)),
    }),
    {},
  )
}
