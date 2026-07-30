import { EventV2 } from "@opencode-ai/core/event"
import { OpencodeXStateEventTable } from "@opencode-ai/core/opencodex/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { MessageV2 } from "@/session/message-v2"
import { and, eq, isNull, or } from "drizzle-orm"
import { Effect } from "effect"
import { EPOCH, OpencodeXStateCursor, type OpencodeXStateEvent, type OpencodeXStateScope } from "./state-schema"

export const currentStateScope = Effect.fn("OpencodeXState.scope")(function* () {
  const instance = yield* InstanceRef
  if (!instance) return yield* Effect.die("OpencodeX state requires an instance scope")
  const workspaceID = yield* WorkspaceRef
  return {
    projectID: ProjectV2.ID.make(instance.project.id),
    ...(workspaceID ? { workspaceID } : {}),
    directory: instance.directory,
  }
})

export function encodeCursor(databaseID: string, scope: OpencodeXStateScope, position: number) {
  return OpencodeXStateCursor.make(
    Buffer.from(JSON.stringify({ epoch: EPOCH, databaseID, scope, position })).toString("base64url"),
  )
}

export function revision(position: number) {
  return `${EPOCH}:${position.toString(36)}`
}

export function sameScope(left: OpencodeXStateScope, right: OpencodeXStateScope) {
  return (
    left.projectID === right.projectID && left.workspaceID === right.workspaceID && left.directory === right.directory
  )
}

export function groupBySession<T extends { sessionID: string }>(items: readonly T[]) {
  return items.reduce((result, item) => {
    const requests = result.get(item.sessionID)
    if (requests) {
      requests.push(item)
      return result
    }
    result.set(item.sessionID, [item])
    return result
  }, new Map<string, T[]>())
}

export function durableDomain(event: EventV2.Payload) {
  if (
    event.type === MessageV2.Event.PartDelta.type ||
    event.type.startsWith("tui.") ||
    event.type.startsWith("terminal.")
  )
    return undefined
  return eventDomain(event)
}

export function aggregateID(event: EventV2.Payload) {
  if (isCapabilitiesEvent(event)) return "capabilities"
  const data = event.data && typeof event.data === "object" ? Object.fromEntries(Object.entries(event.data)) : {}
  const definition = EventV2.registry.get(event.type)
  const configured = definition?.sync ? data[definition.sync.aggregate] : undefined
  if (typeof configured === "string") return configured
  for (const key of ["sessionID", "projectID", "messageID", "requestID", "id"]) {
    if (typeof data[key] === "string") return data[key]
  }
  for (const key of ["info", "part"]) {
    const value = data[key]
    if (!value || typeof value !== "object" || !("sessionID" in value)) continue
    if (typeof value.sessionID === "string") return value.sessionID
  }
  return event.id
}

export function eventVisibility(event: EventV2.Payload, domain: NonNullable<ReturnType<typeof durableDomain>>) {
  if (event.type === "opencodex.settings.updated") return "global" as const
  if (event.type === "opencodex.plugin_config.updated") {
    const data = event.data && typeof event.data === "object" ? event.data : undefined
    return data && "global" in data && data.global === true ? ("global" as const) : ("instance" as const)
  }
  return domain === "capabilities" ? ("instance" as const) : ("global" as const)
}

function eventDomain(event: EventV2.Payload): "capabilities" | "catalog" | "operations" | "session" | undefined {
  if (isCapabilitiesEvent(event)) return "capabilities"
  if (event.type.startsWith("opencodex.job.") || event.type.startsWith("opencodex.swarm.")) return "operations"
  if (event.type.startsWith("message.") || event.type === "todo.updated" || event.type === "session.diff")
    return "session"
  if (
    event.type.startsWith("session.") ||
    event.type.startsWith("permission.") ||
    event.type.startsWith("question.") ||
    event.type.startsWith("opencodex.session_state.") ||
    event.type.startsWith("opencodex.project.") ||
    event.type.startsWith("opencodex.terminal_session.") ||
    event.type.startsWith("opencodex.view.")
  )
    return "catalog"
  return undefined
}

function isCapabilitiesEvent(event: EventV2.Payload) {
  return (
    event.type === "plugin.added" ||
    event.type === "lsp.updated" ||
    event.type === "mcp.tools.changed" ||
    event.type === "opencodex.settings.updated" ||
    event.type === "opencodex.plugin_config.updated"
  )
}

export function whereScope(scope: OpencodeXStateScope) {
  return and(
    eq(OpencodeXStateEventTable.project_id, scope.projectID),
    scope.workspaceID === undefined
      ? isNull(OpencodeXStateEventTable.workspace_id)
      : eq(OpencodeXStateEventTable.workspace_id, scope.workspaceID),
    eq(OpencodeXStateEventTable.directory, scope.directory),
  )
}

export function whereVisible(scope: OpencodeXStateScope) {
  return or(
    eq(OpencodeXStateEventTable.visibility, "global"),
    and(eq(OpencodeXStateEventTable.visibility, "instance"), whereScope(scope)),
  )
}

export function whereVisibilityBucket(visibility: "global" | "instance", scope: OpencodeXStateScope) {
  if (visibility === "global") return eq(OpencodeXStateEventTable.visibility, "global")
  return and(eq(OpencodeXStateEventTable.visibility, "instance"), whereScope(scope))
}

export function hydrateStateEvent(
  row: typeof OpencodeXStateEventTable.$inferSelect,
  databaseID: string,
  targetScope: OpencodeXStateScope,
): OpencodeXStateEvent {
  const visibility = row.visibility === "global" ? ("global" as const) : ("instance" as const)
  const scope =
    visibility === "global"
      ? targetScope
      : {
          projectID: ProjectV2.ID.make(row.project_id),
          ...(row.workspace_id === null ? {} : { workspaceID: WorkspaceV2.ID.make(row.workspace_id) }),
          directory: row.directory,
        }
  return {
    id: EventV2.ID.make(row.id),
    scope,
    epoch: EPOCH,
    cursor: encodeCursor(databaseID, scope, row.position),
    position: row.position,
    visibility,
    aggregateSequence: row.aggregate_sequence,
    domain:
      row.domain === "session"
        ? "session"
        : row.domain === "operations"
          ? "operations"
          : row.domain === "capabilities"
            ? "capabilities"
            : "catalog",
    operation: "invalidate",
    payload: { aggregateID: row.aggregate_id, eventType: row.event_type },
  }
}
