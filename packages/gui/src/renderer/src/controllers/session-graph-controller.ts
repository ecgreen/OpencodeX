import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  buildSessionGraph,
  graphRootSessionID,
  sessionGraphAvailable,
  EMPTY_SESSION_GRAPH,
  type SessionGraph,
  type SessionGraphNode,
} from "../lib/session-graph"
import { sessionGoal } from "../lib/goal-graph-view"
import { GRAPH_SPAWN_GRACE_MS } from "../lib/session-graph-nodes"
import {
  GRAPH_FETCH_DEBOUNCE_MS,
  IDLE_GRAPH_TOPOLOGY,
  collectSessionDescendants,
  loadSessionChildren,
  mergeSessionLists,
  sessionGraphEventTouchesTree,
  settleGraphTopology,
  type GraphTopologyState,
} from "../lib/session-graph-fetch"
import { setGraphVisibleSessions } from "../lib/session-graph-visibility"
import { createStableEffect } from "../lib/stable-effect"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createSessionSelectionController } from "./session-selection-controller"

/**
 * State for the workflow graph: the graph itself, the delegation tree behind
 * it, and which node the reader has opened into the session view.
 *
 * The catalog deliberately hides swarm-delegated children at every layer, so
 * the tree is fetched here through the children endpoint and merged with the
 * catalog. Structure updates ride the same SSE push as everything else: a
 * session event that touches the tree schedules one debounced refetch, and
 * live status needs no refetch at all because status events are applied by id
 * into the snapshot regardless of catalog visibility.
 */
export function createSessionGraphController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  selection: ReturnType<typeof createSessionSelectionController>
}) {
  const [nodeSessionID, setNodeSessionID] = createSignal("")
  /**
   * The node the reader last activated - independent of the transcript.
   * Planned steps, queued jobs, merges, and discovery markers can all be
   * *selected* (highlight, announcement, keyboard anchor) even though only a
   * session-bearing node can open a transcript.
   */
  const [selectedID, setSelectedID] = createSignal("")
  const [descendants, setDescendants] = createSignal<readonly Session[]>([])
  const [topology, setTopology] = createSignal(IDLE_GRAPH_TOPOLOGY)

  const mergedSessions = createMemo(() =>
    mergeSessionLists(input.authoritative.snapshot()?.sessions ?? [], descendants()),
  )

  const knownIDs = createMemo(() => {
    const ids = new Set<string>()
    const activeID = input.selection.activeSessionID()
    if (activeID) {
      ids.add(activeID)
      // The whole workflow, not just the subtree under the open session: a new
      // sibling branch under the root must still schedule a refetch while a
      // child session is the one on screen.
      ids.add(graphRootSessionID(mergedSessions(), activeID))
    }
    for (const session of descendants()) ids.add(session.id)
    return ids
  })

  /** Guards against a stale fetch landing after the selection moved on. */
  let fetchToken = 0
  let fetchAbort: AbortController | undefined
  async function refreshDescendants() {
    const gui = input.authoritative.client()
    const activeID = untrack(() => input.selection.activeSessionID())
    const fallbackDirectory = untrack(() => input.selection.selectedSession())?.directory
    fetchAbort?.abort()
    if (!gui || !activeID || activeID.startsWith("pending:")) {
      fetchToken += 1
      setDescendants([])
      setTopology(IDLE_GRAPH_TOPOLOGY)
      return
    }
    const token = ++fetchToken
    const abort = new AbortController()
    fetchAbort = abort
    // Whatever was on screen stays on screen while the sweep runs; the phase
    // only moves to `loading` when there is nothing yet. `refreshing` is what
    // disables Retry and tells the reader a sweep is already in flight.
    setTopology((current) => ({
      ...current,
      phase: current.phase === "idle" ? "loading" : current.phase,
      refreshing: true,
    }))
    // Sweep from the workflow's root, not the session on screen: routing into a
    // child must not rebuild only that child's subtree while its hidden
    // siblings quietly vanish. The catalog and any previously fetched
    // descendants both contribute ancestry here - and each session is expanded
    // against its own directory, so worktree branches resolve too.
    const known = untrack(mergedSessions)
    const rootID = graphRootSessionID(known, activeID)
    const rootDirectory = known.find((session) => session.id === rootID)?.directory ?? fallbackDirectory
    const sweep = await collectSessionDescendants({
      rootID,
      ...(rootDirectory ? { rootDirectory } : {}),
      load: (sessionID, context) =>
        loadSessionChildren(gui, {
          sessionID,
          directory: context.directory ?? fallbackDirectory,
          signal: abort.signal,
        }),
      cancelled: () => token !== fetchToken,
    })
    if (!sweep) return
    const settled = settleGraphTopology({ sweep, hadDescendants: untrack(descendants).length > 0 })
    if (settled.apply) setDescendants(sweep.sessions)
    setTopology(settled.topology)
  }

  createEffect(
    on(
      () => input.selection.activeSessionID(),
      () => {
        setDescendants([])
        setTopology(IDLE_GRAPH_TOPOLOGY)
        setSelectedID("")
        void refreshDescendants()
      },
    ),
  )

  // Non-reactive mirror for the hydration guard; see session-graph-visibility.
  createEffect(() => setGraphVisibleSessions(knownIDs()))

  createEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = input.authoritative.subscribeGlobalEvents((event) => {
      if (!sessionGraphEventTouchesTree(event.payload, untrack(knownIDs))) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => void refreshDescendants(), GRAPH_FETCH_DEBOUNCE_MS)
    })
    onCleanup(() => {
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
    })
  })

  // Rebuilds the graph as each spawn-grace window closes: a just-created
  // child reads `queued` instead of flashing a terminal state, but nothing
  // else may ever recompute in a quiet session, and the card must not stay
  // `queued` forever. The timer targets the *earliest* expiry among this
  // workflow's own children - a newer spawn must not postpone an older
  // child's flip, and a spawn in some unrelated project must not arm this
  // graph's timer at all. When it fires, the rebuild re-runs this effect and
  // the next-earliest expiry gets its own timer.
  const [spawnGraceTick, setSpawnGraceTick] = createSignal(0)
  createEffect(() => {
    const byID = new Map(mergedSessions().map((session) => [session.id, session]))
    const now = Date.now()
    const remaining = graph().nodes.flatMap((node) => {
      if (!node.sessionID || node.root || node.kind !== "session") return []
      const created = byID.get(node.sessionID)?.time.created
      if (created === undefined) return []
      const left = created + GRAPH_SPAWN_GRACE_MS - now
      return left > 0 ? [left] : []
    })
    if (remaining.length === 0) return
    const timer = setTimeout(() => setSpawnGraceTick((tick) => tick + 1), Math.min(...remaining) + 50)
    onCleanup(() => clearTimeout(timer))
  })

  const graph: Accessor<SessionGraph> = createMemo(() => {
    spawnGraceTick()
    const session = input.selection.selectedSession()
    const snapshot = input.authoritative.snapshot()
    if (!session || !snapshot) return EMPTY_SESSION_GRAPH
    // The plan this session declared, when it declared one. The graph is the one
    // surface for both, so a goal is drawn as the pipeline it became.
    const goal = sessionGoal(session, snapshot.goals ?? [])
    return buildSessionGraph({
      sessionID: session.id,
      workItems: input.authoritative.workItems(),
      sessions: mergedSessions(),
      jobs: snapshot.jobs,
      swarms: snapshot.swarms,
      sessionStatus: snapshot.sessionStatus,
      unexpanded: topology().unexpanded,
      ...(goal ? { goal } : {}),
    })
  })

  const available = createMemo(() => sessionGraphAvailable(graph()))

  const nodeSession: Accessor<Session | undefined> = createMemo(() => {
    const sessionID = nodeSessionID()
    if (!sessionID) return undefined
    return mergedSessions().find((session) => session.id === sessionID)
  })

  function openNode(node: SessionGraphNode) {
    // Every activation selects: the highlight, the announcement, and keyboard
    // anchoring work for planned steps, queued jobs, merges, and discovery
    // markers alike. Only the transcript needs a session behind the node.
    setSelectedID(node.id)
    if (!node.sessionID || node.kind === "sentinel") return
    // The root's own nodes (the top card and its merge node) mean "back to the
    // top session" - its transcript is already the page behind the graph.
    if (node.root || node.sessionID === graph().rootSessionID) {
      setNodeSessionID("")
      return
    }
    setNodeSessionID(node.sessionID)
  }

  function back() {
    setNodeSessionID("")
  }

  // The opened node leaving the graph (or the reader leaving the session) closes
  // the embedded view rather than stranding a transcript with no way back; a
  // selection whose node vanished clears the same way.
  // Guarded: this writes the signals it reads, so a disagreement between two
  // runs would otherwise be a synchronous spin.
  createStableEffect("sessionGraph.closeMissingNode", () => {
    const current = nodeSessionID()
    if (current) {
      if (!input.selection.activeSessionID() || !graph().nodes.some((node) => node.sessionID === current))
        setNodeSessionID("")
    }
    const selected = selectedID()
    if (selected && !graph().nodes.some((node) => node.id === selected)) setSelectedID("")
  })

  return {
    graph,
    available,
    /** How complete the drawn graph is: loading, stale, error, truncated. */
    topology,
    /** Re-runs the descendant sweep; the canvas retry button ends up here. */
    retryTopology: () => void refreshDescendants(),
    /** Fetched delegation-tree sessions the catalog does not carry. */
    descendants,
    mergedSessions,
    nodeSessionID,
    setNodeSessionID,
    nodeSession,
    /** The activated node - which may have no transcript behind it. */
    selectedNodeID: selectedID,
    openNode,
    back,
  }
}
