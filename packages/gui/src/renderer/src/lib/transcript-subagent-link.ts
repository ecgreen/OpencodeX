import type { SessionGraph, SessionGraphNode } from "./session-graph"

/**
 * Click-through from a transcript agent row to the sub-agent it delegates to.
 *
 * The row stamps `data-subagent-session` (mirroring the `data-side-panel-*`
 * convention) and the session page's delegated click handler resolves it to
 * the same graph node the canvas opens - one open path, two entrances.
 */

/**
 * The child session a `task` tool part delegates to, readable for the whole
 * run: the task tool stamps `metadata.sessionId` before the sub-agent starts
 * (packages/opencode src/tool/task.ts), so a running agent row is already
 * addressable, not just a finished one. `undefined` for any other tool or
 * when the stamp is missing.
 */
export function taskSubagentSessionID(tool: string, metadata: Record<string, unknown>): string | undefined {
  if (tool !== "task") return undefined
  const id = metadata["sessionId"]
  return typeof id === "string" && id.length > 0 ? id : undefined
}

/**
 * The drawn graph node behind a transcript sub-agent link. Only a discovered,
 * non-root session node resolves: the embedded pane closes itself for nodes
 * the graph does not hold, so an unresolvable link must read as inert rather
 * than flash a pane that immediately vanishes.
 */
export function subagentGraphNode(
  graph: SessionGraph | undefined,
  sessionID: string,
): SessionGraphNode | undefined {
  return graph?.nodes.find((node) => node.kind === "session" && node.sessionID === sessionID && !node.root)
}

/**
 * The delegated click handler behind `data-subagent-session`. Returns true
 * when it opened a sub-agent, so the caller can fall through to the side
 * panel's file/link targets for every other click - including a stamped row
 * whose child the graph has not drawn yet.
 */
export function transcriptSubagentClick(
  event: Pick<MouseEvent, "target" | "preventDefault">,
  graph: SessionGraph | undefined,
  open: ((node: SessionGraphNode) => void) | undefined,
): boolean {
  if (!open) return false
  const target = event.target
  if (!(target instanceof Element)) return false
  const sessionID = target.closest<HTMLElement>("[data-subagent-session]")?.dataset.subagentSession
  if (!sessionID) return false
  const node = subagentGraphNode(graph, sessionID)
  if (!node) return false
  event.preventDefault()
  open(node)
  return true
}
