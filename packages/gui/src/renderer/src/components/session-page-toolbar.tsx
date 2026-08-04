import { Show } from "solid-js"
import type { SessionPageProps } from "./session-page-types"
import type { createSessionSidePanelController } from "./session-side-panel-controller"
import { SessionToolbar } from "./session-toolbar"

export function SessionPageToolbar(input: {
  props: SessionPageProps
  sidePanel: ReturnType<typeof createSessionSidePanelController>
}) {
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
          />
        )}
      </Show>
    </div>
  )
}
