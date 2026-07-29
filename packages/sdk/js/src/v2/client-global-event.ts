/**
 * Shared normalization for the global event envelope both first-party clients
 * receive.
 *
 * The server multiplexes domain events onto one stream. Live frames arrive
 * verbatim (`{ type, properties }`), while replayed/synced frames arrive
 * wrapped (`{ type: "sync", name, id, data }`) with a `.<version>` suffix on
 * the name. The TUI and the GUI both had their own copy of the unwrapping and
 * both had to agree about the suffix, so it lives here now.
 */
import type { Event } from "./client.js"

const EVENT_NAME_VERSION_SUFFIX = /\.\d+$/

/** Unwraps a sync envelope into the plain `Event` shape both clients dispatch on. */
export function normalizeClientGlobalEventPayload(payload: unknown): Event | undefined {
  if (!isRecord(payload)) return undefined
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- transport frames are only structurally typed
  if (payload.type !== "sync") return payload as Event
  const name = syncEventName(payload)
  if (!name) return undefined
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the payload/name correlation is lost by sync normalization
  return { id: payload.id, type: name, properties: payload.data } as Event
}

/** The event type a payload represents, with the sync envelope and version suffix removed. */
export function clientGlobalEventKind(payload: unknown): string {
  if (!isRecord(payload)) return ""
  const type = typeof payload.type === "string" ? payload.type : ""
  if (type !== "sync") return type
  return syncEventName(payload) ?? type
}

/** The event body, whether it arrived as a live `properties` or a synced `data`. */
export function clientGlobalEventData(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined
  const data = payload.properties ?? payload.data
  return isRecord(data) ? data : undefined
}

/**
 * Classifies the completed `plan_enter` / `plan_exit` tool call that means the
 * agent switched itself out of (or into) plan mode, so a client can follow the
 * switch in its own agent picker instead of drifting out of sync with the
 * session.
 */
export function clientPlanModeSwitch(
  event: Event,
): { sessionID: string; partID: string; agent: "plan" | "build" } | undefined {
  if (event.type !== "message.part.updated") return undefined
  const part = event.properties.part
  if (part.type !== "tool" || part.state.status !== "completed") return undefined
  if (part.tool === "plan_enter") return { sessionID: part.sessionID, partID: part.id, agent: "plan" }
  if (part.tool === "plan_exit") return { sessionID: part.sessionID, partID: part.id, agent: "build" }
  return undefined
}

function syncEventName(payload: Record<string, unknown>) {
  if (typeof payload.name !== "string") return undefined
  const name = payload.name.replace(EVENT_NAME_VERSION_SUFFIX, "")
  return name || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
