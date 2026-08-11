import type { Session } from "@opencode-ai/sdk/v2/client"
import type { SessionGraph, SessionGraphCounts } from "./session-graph"

/**
 * The parts of the graph that the eager app model needs before any graph is
 * built: the empty value, the root walk, the availability predicate, and the
 * spawn grace window.
 *
 * Split out for weight, not for tidiness. `session-graph.ts` pulls in node
 * projection, goal enrichment, placement and reporting - about 100 KB of
 * source - and the session-graph controller is constructed eagerly in
 * `app.tsx`. A single runtime import from there dragged that whole cluster
 * into the renderer's entry chunk, past the bundle budget. Nothing here may
 * import a module that does real graph work; the builder is reached by
 * dynamic import instead, and lands in the lazy session-page chunk with the
 * views that use it.
 *
 * Type-only imports are free - they erase - so the graph types still live in
 * `session-graph.ts`, which re-exports everything below for existing callers.
 */

/** A child that has only just been spawned is still "starting", not stalled. */
export const GRAPH_SPAWN_GRACE_MS = 3_000

export const EMPTY_SESSION_GRAPH_COUNTS: SessionGraphCounts = {
  total: 0,
  delegated: 0,
  running: 0,
  retrying: 0,
  queued: 0,
  blocked: 0,
  needsReview: 0,
  completed: 0,
  returned: 0,
  failed: 0,
  cancelled: 0,
}

export const EMPTY_SESSION_GRAPH: SessionGraph = {
  rootID: "",
  rootSessionID: "",
  nodes: [],
  edges: [],
  counts: EMPTY_SESSION_GRAPH_COUNTS,
}

/** Walks to the top of the spawn chain, tolerating cycles and missing parents. */
export function graphRootSessionID(sessions: readonly Session[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const seen = new Set<string>()
  let current = byID.get(sessionID)
  if (!current) return sessionID
  while (current.parentID && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = byID.get(current.parentID)
    if (!parent) break
    current = parent
  }
  return current.id
}

/** One node is a session, not a workflow: there is nothing to draw. */
export function sessionGraphAvailable(graph: SessionGraph) {
  return graph.counts.total > 1
}
