import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  buildSessionGraph,
  sessionGraphAvailable,
  EMPTY_SESSION_GRAPH,
  type SessionGraph,
  type SessionGraphNode,
} from "../lib/session-graph"
import {
  GRAPH_FETCH_DEBOUNCE_MS,
  GRAPH_FETCH_MAX_DEPTH,
  GRAPH_FETCH_MAX_SESSIONS,
  loadSessionChildren,
  mergeSessionLists,
  sessionGraphEventTouchesTree,
} from "../lib/session-graph-fetch"
import { setGraphVisibleSessions } from "../lib/session-graph-visibility"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createSessionSelectionController } from "./session-selection-controller"

const DISMISSED_KEY = "opencodex.gui.sessionGraph.promptDismissed.v1"

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
  const [dismissed, setDismissed] = createSignal(readDismissed())
  const [descendants, setDescendants] = createSignal<readonly Session[]>([])

  const mergedSessions = createMemo(() =>
    mergeSessionLists(input.authoritative.snapshot()?.sessions ?? [], descendants()),
  )

  const knownIDs = createMemo(() => {
    const ids = new Set<string>()
    const rootID = input.selection.activeSessionID()
    if (rootID) ids.add(rootID)
    for (const session of descendants()) ids.add(session.id)
    return ids
  })

  /** Guards against a stale fetch landing after the selection moved on. */
  let fetchToken = 0
  async function refreshDescendants() {
    const gui = input.authoritative.client()
    const rootID = untrack(() => input.selection.activeSessionID())
    const directory = untrack(() => input.selection.selectedSession())?.directory
    if (!gui || !rootID || rootID.startsWith("pending:")) {
      fetchToken += 1
      setDescendants([])
      return
    }
    const token = ++fetchToken
    const collected: Session[] = []
    const seen = new Set([rootID])
    let frontier = [rootID]
    for (let depth = 0; depth < GRAPH_FETCH_MAX_DEPTH && frontier.length > 0; depth += 1) {
      const pages = await Promise.all(
        frontier.map((sessionID) =>
          loadSessionChildren(gui, { sessionID, directory }).catch(() => [] as Session[]),
        ),
      )
      if (token !== fetchToken) return
      const next: string[] = []
      for (const child of pages.flat()) {
        if (seen.has(child.id) || collected.length >= GRAPH_FETCH_MAX_SESSIONS) continue
        seen.add(child.id)
        collected.push(child)
        next.push(child.id)
      }
      frontier = next
    }
    setDescendants(collected)
  }

  createEffect(
    on(
      () => input.selection.activeSessionID(),
      () => {
        setDescendants([])
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

  const graph: Accessor<SessionGraph> = createMemo(() => {
    const session = input.selection.selectedSession()
    const snapshot = input.authoritative.snapshot()
    if (!session || !snapshot) return EMPTY_SESSION_GRAPH
    return buildSessionGraph({
      sessionID: session.id,
      workItems: input.authoritative.workItems(),
      sessions: mergedSessions(),
      jobs: snapshot.jobs,
      swarms: snapshot.swarms,
      sessionStatus: snapshot.sessionStatus,
    })
  })

  const available = createMemo(() => sessionGraphAvailable(graph()))

  const nodeSession: Accessor<Session | undefined> = createMemo(() => {
    const sessionID = nodeSessionID()
    if (!sessionID) return undefined
    return mergedSessions().find((session) => session.id === sessionID)
  })

  /** Which node the canvas draws as selected: the opened one, else nothing. */
  const selectedNodeID = createMemo(() => (nodeSessionID() ? `session:${nodeSessionID()}` : ""))

  function openNode(node: SessionGraphNode) {
    // A queued job has no session to read yet; the canvas already disables it,
    // and this keeps a stale selection from surviving a programmatic call.
    // The root's own nodes (the top card and its merge node) mean "back to the
    // top session" - its transcript is already the page behind the graph.
    if (!node.sessionID || node.root || node.sessionID === graph().rootSessionID) {
      setNodeSessionID("")
      return
    }
    setNodeSessionID(node.sessionID)
  }

  function back() {
    setNodeSessionID("")
  }

  const promptVisible = createMemo(() => {
    const session = input.selection.selectedSession()
    return Boolean(session) && available() && !dismissed().has(session!.id)
  })

  function dismissPrompt() {
    const session = input.selection.selectedSession()
    if (!session) return
    const next = new Set([...dismissed(), session.id])
    setDismissed(next)
    writeDismissed(next)
  }

  // The opened node leaving the graph (or the reader leaving the session) closes
  // the embedded view rather than stranding a transcript with no way back.
  createEffect(() => {
    const current = nodeSessionID()
    if (!current) return
    if (!input.selection.activeSessionID() || !graph().nodes.some((node) => node.sessionID === current))
      setNodeSessionID("")
  })

  return {
    graph,
    available,
    /** Fetched delegation-tree sessions the catalog does not carry. */
    descendants,
    mergedSessions,
    nodeSessionID,
    setNodeSessionID,
    nodeSession,
    selectedNodeID,
    openNode,
    back,
    promptVisible,
    dismissPrompt,
  }
}

function readDismissed(): ReadonlySet<string> {
  if (typeof localStorage === "undefined") return new Set()
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [])
  } catch {
    return new Set()
  }
}

function writeDismissed(value: ReadonlySet<string>) {
  if (typeof localStorage === "undefined") return
  try {
    // Bounded: this is a per-session "I have seen it" flag, not a history.
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...value].slice(-200)))
  } catch {
    return
  }
}
