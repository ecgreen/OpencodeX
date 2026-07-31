import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { authHeaders } from "./store-auth"

/**
 * Support for fetching a workflow's delegation tree outside the catalog.
 *
 * The session catalog deliberately drops swarm-delegated children at every
 * layer (server card queries, client event ingestion), so the graph and the
 * team strip fetch descendants through the children endpoint and merge them
 * with whatever the catalog does carry. The helpers here are the pure parts of
 * that: the merge, and deciding which live events mean the tree changed shape.
 */

/**
 * Direct children of a session, straight from the server. The catalog's card
 * queries exclude swarm-delegated children, but this endpoint does not.
 */
export async function loadSessionChildren(gui: GuiClient, input: { sessionID: string; directory?: string }) {
  const response = await gui.client.session.children(
    { sessionID: input.sessionID, directory: input.directory || gui.directory || undefined },
    { headers: authHeaders(gui), throwOnError: true },
  )
  return response.data ?? []
}

/** Generous bounds: a runaway delegation loop should not DoS the backend. */
export const GRAPH_FETCH_MAX_SESSIONS = 200
export const GRAPH_FETCH_MAX_DEPTH = 6
export const GRAPH_FETCH_DEBOUNCE_MS = 400

/**
 * Catalog and fetched sessions as one list, deduped by id. On a conflict the
 * newer `time.updated` wins: whichever side saw the session last has the
 * fresher title and metadata. Catalog order is preserved so downstream memos
 * see a stable list.
 */
export function mergeSessionLists(
  catalog: readonly Session[],
  fetched: readonly Session[],
): readonly Session[] {
  if (fetched.length === 0) return catalog
  const merged = new Map(catalog.map((session) => [session.id, session]))
  for (const session of fetched) {
    const existing = merged.get(session.id)
    if (!existing || session.time.updated >= existing.time.updated) merged.set(session.id, session)
  }
  return [...merged.values()]
}

/**
 * Whether a live event could have changed the delegation tree rooted in the
 * ids we already know: a session in the tree changed or vanished, or a new
 * child appeared under one. Status churn is deliberately excluded - status is
 * already reactive through the snapshot and must not trigger refetches.
 */
export function sessionGraphEventTouchesTree(
  payload: { type?: unknown; properties?: unknown } | undefined,
  known: ReadonlySet<string>,
): boolean {
  const type = typeof payload?.type === "string" ? payload.type : ""
  if (type !== "session.created" && type !== "session.updated" && type !== "session.deleted") return false
  const properties = payload?.properties
  if (!isRecord(properties) || !isRecord(properties.info)) return false
  const { id, parentID } = properties.info
  return (typeof id === "string" && known.has(id)) || (typeof parentID === "string" && known.has(parentID))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
