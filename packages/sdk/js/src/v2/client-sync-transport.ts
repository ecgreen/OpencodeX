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
  if (event.type === "plugin.added" || event.type === "lsp.updated" || event.type === "mcp.tools.changed")
    return "capabilities" as const
  if (
    event.type === "opencodex.project.created" ||
    event.type === "opencodex.project.updated" ||
    event.type === "opencodex.project.reordered" ||
    event.type === "opencodex.project.deleted" ||
    event.type === "opencodex.project.session_assigned" ||
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
  return input.type === "ready" || input.type === "event" || input.type === "reset_required"
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
