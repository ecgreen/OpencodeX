import { Show } from "solid-js"
import { IconButton } from "./ui"

/**
 * The window controls for the workspace column: put the session away so the
 * workspace has the whole window, and close the workspace entirely.
 *
 * They live here rather than in the session's own toolbar because that toolbar
 * is part of the session column - once it is put away, a control inside it
 * could never bring it back.
 */

export type SessionWorkspaceControls = {
  centerCollapsed: boolean
  /** False while the workspace is down, when hiding the session would empty the window. */
  collapsible: boolean
  toggleCenter: () => void
  closeWorkspace: () => void
}

export function SessionWorkspaceControls(props: { controls?: SessionWorkspaceControls }) {
  return (
    <Show when={props.controls}>
      {(controls) => (
        <div class="session-workspace-controls">
          <IconButton
            appearance="ghost"
            size="compact"
            class="session-workspace-center-toggle"
            icon={controls().centerCollapsed ? "columns" : "fit"}
            label={controls().centerCollapsed ? "Show the session" : "Hide the session"}
            pressed={controls().centerCollapsed}
            disabled={!controls().collapsible}
            onClick={() => controls().toggleCenter()}
          />
          <IconButton
            appearance="ghost"
            size="compact"
            class="session-workspace-close"
            icon="panel"
            label="Close the workspace"
            onClick={() => controls().closeWorkspace()}
          />
        </div>
      )}
    </Show>
  )
}
