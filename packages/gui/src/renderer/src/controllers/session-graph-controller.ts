import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  buildSessionGraph,
  sessionGraphAvailable,
  EMPTY_SESSION_GRAPH,
  type SessionGraph,
  type SessionGraphNode,
} from "../lib/session-graph"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createSessionSelectionController } from "./session-selection-controller"

const DISMISSED_KEY = "opencodex.gui.sessionGraph.promptDismissed.v1"

/**
 * State for the workflow graph: the graph itself, and which node the reader has
 * opened into the session view.
 *
 * The graph is a memo over authoritative state, so it follows the same SSE
 * push the rest of the GUI does - nothing here polls. An opened node's
 * transcript rides the view-session hydration the multi-pane views use, which
 * `app.tsx` feeds from `nodeSession`.
 */
export function createSessionGraphController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  selection: ReturnType<typeof createSessionSelectionController>
}) {
  const [nodeSessionID, setNodeSessionID] = createSignal("")
  const [dismissed, setDismissed] = createSignal(readDismissed())

  const graph: Accessor<SessionGraph> = createMemo(() => {
    const session = input.selection.selectedSession()
    const snapshot = input.authoritative.snapshot()
    if (!session || !snapshot) return EMPTY_SESSION_GRAPH
    return buildSessionGraph({
      sessionID: session.id,
      workItems: input.authoritative.workItems(),
      sessions: snapshot.sessions,
      jobs: snapshot.jobs,
      swarms: snapshot.swarms,
    })
  })

  const available = createMemo(() => sessionGraphAvailable(graph()))

  const nodeSession: Accessor<Session | undefined> = createMemo(() => {
    const sessionID = nodeSessionID()
    if (!sessionID) return undefined
    return input.authoritative.snapshot()?.sessions.find((session) => session.id === sessionID)
  })

  /** Which node the canvas draws as selected: the opened one, else nothing. */
  const selectedNodeID = createMemo(() => (nodeSessionID() ? `session:${nodeSessionID()}` : ""))

  function openNode(node: SessionGraphNode) {
    // A queued job has no session to read yet; the canvas already disables it,
    // and this keeps a stale selection from surviving a programmatic call.
    if (!node.sessionID || node.root) {
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
