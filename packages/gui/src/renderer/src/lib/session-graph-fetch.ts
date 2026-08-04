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
export async function loadSessionChildren(
  gui: GuiClient,
  input: { sessionID: string; directory?: string; signal?: AbortSignal },
) {
  const response = await gui.client.session.children(
    { sessionID: input.sessionID, directory: input.directory || gui.directory || undefined },
    { headers: authHeaders(gui), throwOnError: true, ...(input.signal ? { signal: input.signal } : {}) },
  )
  return response.data ?? []
}

/** Generous bounds: a runaway delegation loop should not DoS the backend. */
export const GRAPH_FETCH_MAX_SESSIONS = 200
export const GRAPH_FETCH_MAX_DEPTH = 6
export const GRAPH_FETCH_DEBOUNCE_MS = 400
/** How many child requests may be in flight at once - a pool, not a layer. */
export const GRAPH_FETCH_CONCURRENCY = 8

/** Why a branch's children were never checked. */
export type UnexpandedReason = "depth_limit" | "session_limit" | "load_error"

export type UnexpandedBranch = { sessionID: string; reason: UnexpandedReason }

/**
 * What the graph knows about its own completeness. The canvas looks
 * authoritative whatever it draws, so the difference between "this is the
 * workflow" and "this is what survived a failed fetch" has to be state the UI
 * can show, not something the fetch code swallows.
 *
 * `partial` is a *first* load that applied with failures - there was never a
 * previous good tree to fall back on, which is exactly what distinguishes it
 * from `stale`. `refreshing` is orthogonal: a sweep is in flight while the
 * screen keeps showing what it already had.
 */
export type GraphTopologyState = {
  phase: "idle" | "loading" | "ready" | "partial" | "stale" | "error"
  refreshing: boolean
  /** Branches whose descendants were not checked, and why - not "the tree
   * continues": past a bound the client genuinely does not know. */
  unexpanded: readonly UnexpandedBranch[]
  error?: string
}

export const IDLE_GRAPH_TOPOLOGY: GraphTopologyState = { phase: "idle", refreshing: false, unexpanded: [] }

/** Whether the drawn graph may be missing work, whatever the reason. */
export function graphTopologyIncomplete(topology: GraphTopologyState) {
  return (
    topology.unexpanded.length > 0 ||
    topology.phase === "partial" ||
    topology.phase === "stale" ||
    topology.phase === "error"
  )
}

/** One pass over the delegation tree: what was found, and what went wrong. */
export type DescendantSweep = {
  sessions: Session[]
  failures: number
  error?: string
  unexpanded: UnexpandedBranch[]
}

/**
 * Breadth-first sweep of a session's descendants through the given loader.
 *
 * Requests run through a bounded pool rather than one all-at-once layer, and
 * the sweep stops issuing work the moment the session cap is reached. Every
 * branch that was *not* queried - depth bound, session bound, or a failed
 * request - is returned by ID with its reason, so the graph can mark the
 * actual branch instead of hanging one marker on an arbitrary node. Each
 * session is expanded against its own directory, so a workflow spanning
 * worktrees resolves every branch. Returns `undefined` once `cancelled`
 * reports the sweep is stale.
 */
export async function collectSessionDescendants(input: {
  rootID: string
  rootDirectory?: string
  load: (sessionID: string, context: { directory?: string }) => Promise<readonly Session[]>
  cancelled?: () => boolean
  maxDepth?: number
  maxSessions?: number
  concurrency?: number
}): Promise<DescendantSweep | undefined> {
  const maxDepth = input.maxDepth ?? GRAPH_FETCH_MAX_DEPTH
  const maxSessions = input.maxSessions ?? GRAPH_FETCH_MAX_SESSIONS
  const concurrency = Math.max(1, input.concurrency ?? GRAPH_FETCH_CONCURRENCY)
  const sessions: Session[] = []
  const seen = new Set([input.rootID])
  const unexpanded = new Map<string, UnexpandedReason>()
  let failures = 0
  let error: string | undefined
  let capped = false
  const queue: Array<{ sessionID: string; directory?: string; depth: number }> = [
    { sessionID: input.rootID, ...(input.rootDirectory ? { directory: input.rootDirectory } : {}), depth: 0 },
  ]

  // `capped` is checked at the top rather than in the condition: it is only
  // ever set inside the in-flight batch below, which static analysis cannot
  // see from the loop header.
  while (queue.length > 0) {
    if (capped) break
    if (input.cancelled?.()) return undefined
    const batch = queue.splice(0, concurrency)
    await Promise.all(
      batch.map(async (entry) => {
        // The cap may have tripped while this batch was in flight; issuing
        // this entry's request would be work past the bound.
        if (capped) {
          unexpanded.set(entry.sessionID, "session_limit")
          return
        }
        let children: readonly Session[]
        try {
          children = await input.load(entry.sessionID, entry.directory ? { directory: entry.directory } : {})
        } catch (cause) {
          failures += 1
          error ??= cause instanceof Error ? cause.message : String(cause)
          unexpanded.set(entry.sessionID, "load_error")
          return
        }
        for (const child of children) {
          if (seen.has(child.id)) continue
          if (sessions.length >= maxSessions) {
            capped = true
            unexpanded.set(entry.sessionID, "session_limit")
            break
          }
          seen.add(child.id)
          sessions.push(child)
          if (entry.depth + 1 >= maxDepth) {
            // Never queried: whether this child has its own children is
            // unknown, which is exactly what the marker must say.
            unexpanded.set(child.id, "depth_limit")
          } else {
            queue.push({
              sessionID: child.id,
              ...(child.directory ? { directory: child.directory } : {}),
              depth: entry.depth + 1,
            })
          }
        }
      }),
    )
  }
  if (input.cancelled?.()) return undefined
  // Whatever is still queued when the cap trips was discovered but never
  // queried - its descendants are unchecked, not absent.
  if (capped) for (const entry of queue) unexpanded.set(entry.sessionID, "session_limit")
  return {
    sessions,
    failures,
    ...(error !== undefined ? { error } : {}),
    unexpanded: [...unexpanded.entries()].map(([sessionID, reason]) => ({ sessionID, reason })),
  }
}

/**
 * Turns a finished sweep into topology state plus the decision that matters:
 * whether to replace the descendants on screen. A failed refresh keeps the
 * last good tree and marks it stale - branches must not vanish because one
 * request dropped. A first load has nothing to keep, so it applies what it
 * got as `partial`, or reports the error outright when nothing arrived.
 */
export function settleGraphTopology(input: {
  sweep: DescendantSweep
  hadDescendants: boolean
}): { topology: GraphTopologyState; apply: boolean } {
  const { sweep } = input
  const unexpanded = sweep.unexpanded
  if (sweep.failures === 0)
    return { topology: { phase: "ready", refreshing: false, unexpanded }, apply: true }
  const error = sweep.error ?? "Some sessions could not be loaded"
  if (input.hadDescendants)
    return { topology: { phase: "stale", refreshing: false, unexpanded, error }, apply: false }
  if (sweep.sessions.length === 0)
    return { topology: { phase: "error", refreshing: false, unexpanded, error }, apply: false }
  return { topology: { phase: "partial", refreshing: false, unexpanded, error }, apply: true }
}

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
