import { Show, createMemo } from "solid-js"
import { sessionGraphAvailable, sessionGraphSummary } from "../lib/session-graph"
import { graphTopologyIncomplete } from "../lib/session-graph-fetch"
import type { SessionPageProps } from "./session-page-types"
import type { createSessionSidePanelController } from "./session-side-panel-controller"
import { SessionToolbar } from "./session-toolbar"

export function SessionPageToolbar(input: {
  props: SessionPageProps
  sidePanel: ReturnType<typeof createSessionSidePanelController>
}) {
  const workflow = createMemo(() => {
    const graph = input.props.graph
    if (!graph || !sessionGraphAvailable(graph)) return undefined
    const counts = graph.counts
    // Attention is everything a supervisor owes a look: blocked on input,
    // failed, struggling, or finished-but-awaiting-review. Review-required
    // work sits in this pool precisely so "done-looking" cards do not hide it.
    const attention = counts.blocked + counts.failed + counts.retrying + counts.needsReview
    // Active or troubled workflows earn the chip; a finished one does not need
    // a standing toolbar button - the graph tab is still one menu away.
    if (attention === 0 && counts.running === 0 && counts.queued === 0) return undefined
    // Queued-only work is queued, not running - the chip must not claim
    // motion that has not started.
    const label =
      attention > 0
        ? `Workflow: ${attention} need${attention === 1 ? "s" : ""} attention`
        : counts.running > 0
          ? `Workflow: ${counts.running} running`
          : `Workflow: ${counts.queued} queued`
    const incomplete = input.props.graphTopology ? graphTopologyIncomplete(input.props.graphTopology) : false
    return {
      label,
      attention: attention > 0,
      ariaLabel: incomplete ? `${label} - graph may be incomplete` : label,
    }
  })
  const summary = createMemo(() => {
    const graph = input.props.graph
    if (!graph || !sessionGraphAvailable(graph)) return undefined
    return sessionGraphSummary(graph).replace("Workflow graph: ", "Workflow: ")
  })
  return (
    <div class="session-page-top">
      <Show when={input.props.session?.id.startsWith("pending:") ? undefined : input.props.session}>
        {(selected) => (
          <SessionToolbar
            session={selected()}
            projectName={input.props.projectName}
            pending={input.props.pending}
            showTimestamps={input.props.showTimestamps}
            showThinking={input.props.showThinking}
            showToolDetails={input.props.showToolDetails}
            showScrollbar={input.props.showScrollbar}
            showGenericToolOutput={input.props.showGenericToolOutput}
            renameSession={input.props.renameSession}
            moveSession={input.props.moveSession}
            deleteSession={input.props.deleteSession}
            readyForReview={input.props.readyForReview}
            markSessionReviewed={input.props.markSessionReviewed}
            toggleTimestamps={input.props.toggleTimestamps}
            toggleThinking={input.props.toggleThinking}
            toggleToolDetails={input.props.toggleToolDetails}
            toggleScrollbar={input.props.toggleScrollbar}
            toggleGenericToolOutput={input.props.toggleGenericToolOutput}
            sidePanelOpen={input.sidePanel.enabled() ? input.sidePanel.open() : undefined}
            toggleSidePanel={input.sidePanel.enabled() ? input.sidePanel.toggle : undefined}
            centerCollapsible={input.sidePanel.collapsible()}
            centerCollapsed={input.sidePanel.centerCollapsed()}
            hideCenter={input.sidePanel.toggleCenter}
            workflowSummary={summary()}
            workflowChip={workflow()}
            openWorkflow={
              input.sidePanel.enabled() ? () => input.sidePanel.openTarget({ tab: "graph" }) : undefined
            }
          />
        )}
      </Show>
    </div>
  )
}
