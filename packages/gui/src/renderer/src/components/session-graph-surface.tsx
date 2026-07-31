import { Show, createMemo, onCleanup, onMount } from "solid-js"
import { formatRelative } from "../lib/format"
import type { SessionData } from "../lib/session-api"
import { sessionGraphNodeAt } from "../lib/session-graph"
import type { SessionPageProps } from "./session-page-types"
import { TranscriptPanel } from "./session-transcript-panel"
import { Button, IconButton } from "./ui"

const EMPTY_NODE_DATA: SessionData = { messages: [], todos: [], diffs: [] }

/**
 * The graph's presence inside the session view: the child session a graph node
 * opens into. The way *into* the graph is a toolbar button, not a banner here -
 * a standing invitation does not deserve a row of the transcript's height.
 *
 * Mirrors `SessionSwarmTeam`, which does the same job for the swarm strip. The
 * two are mutually exclusive - the composition layer clears one when the other
 * is selected - so the session's main area only ever has one owner.
 */
export function SessionGraphSurface(props: { page: SessionPageProps }) {
  return (
    <Show when={props.page.graphNodeSessionID}>
      {(sessionID) => <SessionGraphNodePane page={props.page} sessionID={sessionID()} />}
    </Show>
  )
}

/** A graph node's session, read-only, in place of the top session's transcript. */
function SessionGraphNodePane(props: { page: SessionPageProps; sessionID: string }) {
  const node = createMemo(() => {
    const graph = props.page.graph
    return graph ? sessionGraphNodeAt(graph, `session:${props.sessionID}`) : undefined
  })
  const rootTitle = createMemo(() => {
    const graph = props.page.graph
    return (graph ? sessionGraphNodeAt(graph, graph.rootID)?.title : undefined) ?? "Top session"
  })

  // Escape is the way out of any inline drill-down in this app. It is ignored
  // once something else has handled the key, so it does not fight a dialog.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      props.page.closeGraphNode?.()
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => document.removeEventListener("keydown", onKeyDown))
  })

  return (
    <section class="session-graph-embedded">
      <header class="session-graph-embedded-header">
        <Button
          appearance="outline"
          size="compact"
          icon="chevronLeft"
          onClick={() => props.page.closeGraphNode?.()}
        >
          Back to top session
        </Button>
        <div class="session-graph-embedded-heading">
          <strong class="ds-truncate">{node()?.title ?? "Workflow step"}</strong>
          <span class="ds-truncate">
            {rootTitle()}
            {node() ? ` / ${node()!.statusLabel}` : ""}
            {node()?.updatedAt ? ` - updated ${formatRelative(node()!.updatedAt)}` : ""}
          </span>
        </div>
        <IconButton
          appearance="ghost"
          size="compact"
          icon="external"
          label="Open this step as a full session"
          onClick={() => node() && props.page.openGraphNodeFullPage?.(node()!)}
        />
      </header>
      <TranscriptPanel
        sessionID={props.sessionID}
        data={props.page.graphNodeData ?? EMPTY_NODE_DATA}
        loading={props.page.graphNodeLoading === true}
        providers={props.page.providers}
        showTimestamps={props.page.showTimestamps}
        showThinking={props.page.showThinking}
        showToolDetails={props.page.showToolDetails}
        showScrollbar={props.page.showScrollbar}
        showGenericToolOutput={props.page.showGenericToolOutput}
        concealCodeBlocks={props.page.concealCodeBlocks === true}
        running={node()?.status === "running"}
        emptyStateDismissed
      />
      <footer class="session-graph-embedded-note">
        <span>Read-only view - steer this step from the top session.</span>
      </footer>
    </section>
  )
}
