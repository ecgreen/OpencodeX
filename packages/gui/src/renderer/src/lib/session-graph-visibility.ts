/**
 * Which sessions the workflow graph currently knows about, for the one place
 * that needs the answer outside Solid's reactive graph: the view-session
 * hydration guard. That guard drops a loaded transcript when the session is
 * missing from the catalog snapshot - correct for deleted sessions, wrong for
 * swarm-delegated children, which the catalog hides by design.
 *
 * A module singleton, same pattern as the session workspace bridge: the graph
 * controller writes on every descendant refresh, the hydration guard reads
 * inside an async continuation where reactivity would not help anyway.
 */

const graphSessionIDs = new Set<string>()

export function setGraphVisibleSessions(ids: Iterable<string>) {
  graphSessionIDs.clear()
  for (const id of ids) graphSessionIDs.add(id)
}

export function isGraphVisibleSession(sessionID: string) {
  return graphSessionIDs.has(sessionID)
}

/** Every id the graph knows, for callers reconciling against the catalog. */
export function graphVisibleSessionIDs(): ReadonlySet<string> {
  return graphSessionIDs
}
