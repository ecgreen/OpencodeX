import {
  selectClientOperationsSnapshot,
  selectClientCapabilitiesSnapshot,
  selectClientSessionMessages,
  selectClientStateSyncSnapshot,
  clientAttentionItems,
  clientWorkItems,
  type Event,
  type ClientStateSyncState,
} from "@opencode-ai/sdk/v2"
import path from "node:path"

export type TuiLiveDetailChange = {
  messageIDs: Set<string>
  partIDs: Set<string>
}

export function projectTuiClientState(
  state: ClientStateSyncState,
  options: {
    directory?: string
    workItems?: ReturnType<typeof clientWorkItems>
    includeDetails?: boolean
  } = {},
) {
  const directory = options.directory
  const matchesDirectory = directory
    ? (session: { directory: string }) => path.resolve(session.directory) === path.resolve(directory)
    : undefined
  const catalog = selectClientStateSyncSnapshot(state, matchesDirectory)
  if (!catalog) return undefined
  const operations = selectClientOperationsSnapshot(state)
  const capabilities = selectClientCapabilitiesSnapshot(state)
  const sessions = catalog.sessions
  const sessionIDs = new Set(sessions.map((session) => session.id))
  const workItems = (options.workItems ?? clientWorkItems(state)).filter(
    (item) => !item.sessionID || sessionIDs.has(item.sessionID),
  )
  return {
    revision: state.digest,
    projects: catalog.projects.map((project) => ({
      ...project,
      sessions: project.sessions.filter((session) => sessionIDs.has(session.id)),
    })),
    views: catalog.views.map((view) => {
      return {
        ...view,
        sessions: view.sessions.filter((session) => sessionIDs.has(session.id)),
        // Scope renderable terminal panes to the directory like sessions.
        // `members` stays complete: it is persisted membership, and pruning it
        // here would let a scoped client write member deletions it never saw.
        terminalSessions: (view.terminalSessions ?? []).filter(
          (terminal) => !matchesDirectory || matchesDirectory(terminal),
        ),
        focusedSessionID:
          view.focusedSessionID && view.sessionIDs.includes(view.focusedSessionID)
            ? view.focusedSessionID
            : view.sessionIDs[0],
      }
    }),
    jobs: operations?.jobs,
    swarms: operations?.swarms,
    sessions: sessions.toSorted((a, b) => a.id.localeCompare(b.id)),
    sessionStatus: Object.fromEntries(
      Object.entries(catalog.sessionStatus).filter(([sessionID]) => sessionIDs.has(sessionID)),
    ),
    sessionUiState: Object.fromEntries(
      Object.entries(catalog.sessionUiState).filter(([sessionID]) => sessionIDs.has(sessionID)),
    ),
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
    details:
      options.includeDetails === false
        ? {}
        : Object.fromEntries(
            Object.keys(state.sessionDetails)
              .filter((sessionID) => sessionIDs.has(sessionID))
              .flatMap((sessionID) => {
                const detail = projectTuiSessionDetail(state, sessionID)
                return detail ? [[sessionID, detail]] : []
              }),
          ),
  }
}

export function projectTuiSessionDetail(state: ClientStateSyncState, sessionID: string) {
  const detail = state.sessionDetails[sessionID]
  if (!detail) return
  return {
    version: `${state.epoch ?? ""}:${detail.revision}`,
    messages: selectClientSessionMessages(state, sessionID),
    todos: detail.snapshot.todos,
    diff: detail.snapshot.diff,
    session: detail.snapshot.session,
  }
}

export function tuiClientStateChanges(current: ClientStateSyncState | undefined, next: ClientStateSyncState) {
  if (!current)
    return {
      catalog: true,
      operations: true,
      capabilities: true,
      details: true,
      presentation: true,
    }
  const phase = current.phase !== next.phase
  return {
    catalog:
      phase ||
      current.projects !== next.projects ||
      current.sessions !== next.sessions ||
      current.terminalSessions !== next.terminalSessions ||
      current.views !== next.views ||
      current.permissions !== next.permissions ||
      current.questions !== next.questions ||
      current.sessionStatus !== next.sessionStatus ||
      current.sessionUiState !== next.sessionUiState,
    operations: phase || current.jobs !== next.jobs || current.swarms !== next.swarms,
    capabilities: current.capabilities !== next.capabilities,
    details: current.sessionDetails !== next.sessionDetails,
    presentation:
      current.epoch !== next.epoch ||
      current.scope?.projectID !== next.scope?.projectID ||
      current.scope?.workspaceID !== next.scope?.workspaceID ||
      current.scope?.directory !== next.scope?.directory ||
      current.sessions !== next.sessions,
  }
}

export function changedTuiSessionDetails(
  current: ClientStateSyncState | undefined,
  next: ClientStateSyncState,
  presentation: boolean,
) {
  return Object.entries(next.sessionDetails).filter(
    ([sessionID, detail]) => presentation || current?.sessionDetails[sessionID] !== detail,
  )
}

export function collectTuiLiveDetailChanges(events: readonly Event[]) {
  const changes = new Map<string, TuiLiveDetailChange>()
  const add = (sessionID: string, messageID?: string, partID?: string) => {
    const change = changes.get(sessionID) ?? { messageIDs: new Set<string>(), partIDs: new Set<string>() }
    if (messageID) change.messageIDs.add(messageID)
    if (partID) change.partIDs.add(partID)
    changes.set(sessionID, change)
  }
  events.forEach((event) => {
    switch (event.type) {
      case "message.updated":
        add(event.properties.info.sessionID, event.properties.info.id)
        return
      case "message.removed":
        add(event.properties.sessionID, event.properties.messageID)
        return
      case "message.part.updated":
        add(event.properties.part.sessionID, event.properties.part.messageID, event.properties.part.id)
        return
      case "message.part.delta":
      case "message.part.removed":
        add(event.properties.sessionID, event.properties.messageID, event.properties.partID)
        return
      case "todo.updated":
      case "session.diff":
        add(event.properties.sessionID)
        return
      case "session.deleted":
        add(event.properties.info.id)
    }
  })
  return changes
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
