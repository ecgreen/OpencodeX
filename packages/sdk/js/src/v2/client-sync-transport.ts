import type { Event, OpencodeXStateStreamFrame } from "./client.js"
import type { ClientStateSyncOptions, ClientStateSyncTransport } from "./client-sync-types.js"

export function clientStateSyncTransport(options: ClientStateSyncOptions): ClientStateSyncTransport {
  if (!options.client) throw new Error("createClientStateSync requires client or transport")
  const client = options.client
  return {
    snapshot: async () =>
      (
        await client.opencodex.state.snapshot(
          { directory: options.directory, workspace: options.workspace },
          { throwOnError: true },
        )
      ).data,
    operations: async () =>
      (
        await client.opencodex.state.operations(
          { directory: options.directory, workspace: options.workspace },
          { throwOnError: true },
        )
      ).data,
    cards: async (input) =>
      (
        await client.opencodex.state.sessionCards(
          {
            directory: options.directory,
            workspace: options.workspace,
            cursor: input.cursor,
            limit: input.limit === undefined ? undefined : String(input.limit),
            ids: input.sessionIDs?.join(","),
          },
          { throwOnError: true, signal: input.signal },
        )
      ).data,
    session: async (input) =>
      (
        await client.opencodex.state.session(
          {
            sessionID: input.sessionID,
            directory: options.directory,
            workspace: options.workspace,
            limit: input.limit === undefined ? undefined : String(input.limit),
            before: input.before,
          },
          { throwOnError: true, signal: input.signal },
        )
      ).data,
    events: async (input) =>
      (
        await client.opencodex.state.event(
          { directory: options.directory, workspace: options.workspace, after: input.after },
          { signal: input.signal, sseMaxRetryAttempts: 0 },
        )
      ).stream,
    capabilities: async () => {
      const snapshot = (
        await client.opencodex.state.capabilities(
          { directory: options.directory, workspace: options.workspace },
          { throwOnError: true },
        )
      ).data
      return {
        scope: snapshot.scope,
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        providers: snapshot.payload.provider.all,
        connectedProviderIDs: snapshot.payload.provider.connected,
        providerDefaults: snapshot.payload.provider.default,
        agents: snapshot.payload.agents,
        commands: snapshot.payload.commands,
        lsp: snapshot.payload.lsp,
        mcp: snapshot.payload.mcp,
        config: snapshot.payload.config,
        mcpResources: snapshot.payload.mcpResources,
        plugins: snapshot.payload.plugins,
        formatter: snapshot.payload.formatter,
      }
    },
  }
}

export function clientEventInvalidation(event: Event): "capabilities" | "catalog" | "operations" | undefined {
  if (
    event.type === "models-dev.refreshed" ||
    event.type === "plugin.added" ||
    event.type === "lsp.updated" ||
    event.type === "mcp.tools.changed"
  )
    return "capabilities" as const
  if (
    event.type === "opencodex.project.created" ||
    event.type === "opencodex.project.updated" ||
    event.type === "opencodex.project.reordered" ||
    event.type === "opencodex.project.deleted" ||
    event.type === "opencodex.project.session_assigned" ||
    event.type === "opencodex.terminal_session.created" ||
    event.type === "opencodex.terminal_session.updated" ||
    event.type === "opencodex.terminal_session.deleted" ||
    event.type === "opencodex.view.created" ||
    event.type === "opencodex.view.updated" ||
    event.type === "opencodex.view.reordered" ||
    event.type === "opencodex.view.deleted"
  )
    return "catalog" as const
  if (
    event.type === "opencodex.job.created" ||
    event.type === "opencodex.job.transitioned" ||
    event.type === "opencodex.swarm.created" ||
    event.type === "opencodex.swarm.updated" ||
    event.type === "opencodex.swarm.deleted"
  )
    return "operations" as const
  return undefined
}

export function decodeClientStateFrame(input: unknown): OpencodeXStateStreamFrame {
  const value = typeof input === "string" ? (JSON.parse(input) as unknown) : input
  if (isClientStateFrame(value)) return value
  throw new Error("Unknown state stream frame")
}

function isClientStateFrame(input: unknown): input is OpencodeXStateStreamFrame {
  if (!isRecord(input)) return false
  if (input.type === "heartbeat") return typeof input.epoch === "string"
  if (input.type === "event") return isClientStateEvent(input.event)
  if (input.type === "ready")
    return isClientStateScope(input.scope) && typeof input.epoch === "string" && typeof input.cursor === "string"
  if (input.type === "reset_required")
    return (
      isClientStateScope(input.scope) &&
      typeof input.epoch === "string" &&
      typeof input.cursor === "string" &&
      typeof input.reason === "string"
    )
  return false
}

function isClientStateEvent(input: unknown) {
  if (!isRecord(input) || !isRecord(input.payload)) return false
  return (
    typeof input.id === "string" &&
    isClientStateScope(input.scope) &&
    typeof input.epoch === "string" &&
    typeof input.cursor === "string" &&
    typeof input.position === "number" &&
    Number.isSafeInteger(input.position) &&
    (input.visibility === "global" || input.visibility === "instance") &&
    typeof input.aggregateSequence === "number" &&
    Number.isSafeInteger(input.aggregateSequence) &&
    (input.domain === "capabilities" ||
      input.domain === "catalog" ||
      input.domain === "operations" ||
      input.domain === "session") &&
    input.operation === "invalidate" &&
    typeof input.payload.aggregateID === "string" &&
    typeof input.payload.eventType === "string"
  )
}

function isClientStateScope(input: unknown) {
  return (
    isRecord(input) &&
    typeof input.projectID === "string" &&
    typeof input.directory === "string" &&
    (input.workspaceID === undefined || typeof input.workspaceID === "string")
  )
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
