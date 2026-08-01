import type { Session } from "@opencode-ai/sdk/v2/client"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { title } from "../lib/format"
import { Icon } from "./icon"
import { Button, IconButton } from "./ui"

export function SessionToolbar(props: {
  session: Session
  projectName?: string
  pending?: boolean
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  readyForReview?: boolean
  markSessionReviewed?: (session: Session) => void
  toggleTimestamps: () => void
  toggleThinking: () => void
  toggleToolDetails: () => void
  toggleScrollbar: () => void
  toggleGenericToolOutput: () => void
  sidePanelOpen?: boolean
  toggleSidePanel?: () => void
}) {
  const [actionsOpen, setActionsOpen] = createSignal(false)
  let actionsMenu: HTMLDetailsElement | undefined

  createEffect(() => {
    if (!actionsOpen()) return
    const closeActionsMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && actionsMenu?.contains(event.target)) return
      if (actionsMenu) actionsMenu.open = false
      setActionsOpen(false)
    }
    document.addEventListener("pointerdown", closeActionsMenu, true)
    onCleanup(() => document.removeEventListener("pointerdown", closeActionsMenu, true))
  })

  return (
    <header class="session-toolbar">
      <div class="session-titleline">
        <div>
          <h1>{title(props.session.title)}</h1>
          <Show when={props.projectName}>
            {(projectName) => <p>{projectName()}</p>}
          </Show>
        </div>
      </div>
      <div class="session-actions compact">
        <Show when={props.toggleSidePanel}>
          {(toggleSidePanel) => (
            <IconButton
              class="session-side-panel-toggle"
              icon="panel"
              label={props.sidePanelOpen ? "Close side panel" : "Open side panel"}
              pressed={props.sidePanelOpen}
              onClick={toggleSidePanel()}
            />
          )}
        </Show>
        <Show when={!props.pending}>
          <details
            class="overflow-menu"
            ref={(element) => {
              actionsMenu = element
            }}
            onToggle={(event) => setActionsOpen(event.currentTarget.open)}
          >
            <summary title="Session actions" aria-label="Session actions"><Icon name="more" /></summary>
            <div class="session-actions-menu">
              <div class="session-actions-menu-group">
                <Button appearance="ghost" class="session-actions-menu-item" onClick={() => props.renameSession(props.session)}>
                  <Icon name="pencil" />
                  <span>Rename</span>
                </Button>
                <Button appearance="ghost" class="session-actions-menu-item" onClick={() => props.moveSession(props.session)}>
                  <Icon name="folder" />
                  <span>Move to project</span>
                </Button>
                <Show when={props.readyForReview && props.markSessionReviewed}>
                  <Button appearance="ghost" class="session-actions-menu-item" onClick={() => props.markSessionReviewed?.(props.session)}>
                    <Icon name="check" />
                    <span>Mark reviewed</span>
                  </Button>
                </Show>
              </div>
              <hr />
              <div class="session-actions-menu-group">
                <Button appearance="ghost" class="session-actions-menu-item toggle" selected={props.showTimestamps} onClick={props.toggleTimestamps}>
                  <span class="session-actions-menu-indicator" data-active={props.showTimestamps ? "true" : undefined}><Icon name="check" /></span>
                  <span>Timestamps</span>
                </Button>
                <Button appearance="ghost" class="session-actions-menu-item toggle" selected={props.showThinking} onClick={props.toggleThinking}>
                  <span class="session-actions-menu-indicator" data-active={props.showThinking ? "true" : undefined}><Icon name="check" /></span>
                  <span>Thinking</span>
                </Button>
                <Button appearance="ghost" class="session-actions-menu-item toggle" selected={props.showToolDetails} onClick={props.toggleToolDetails}>
                  <span class="session-actions-menu-indicator" data-active={props.showToolDetails ? "true" : undefined}><Icon name="check" /></span>
                  <span>Tool details</span>
                </Button>
                <Button appearance="ghost" class="session-actions-menu-item toggle" selected={props.showScrollbar} onClick={props.toggleScrollbar}>
                  <span class="session-actions-menu-indicator" data-active={props.showScrollbar ? "true" : undefined}><Icon name="check" /></span>
                  <span>Scrollbar</span>
                </Button>
                <Button appearance="ghost" class="session-actions-menu-item toggle" selected={props.showGenericToolOutput} onClick={props.toggleGenericToolOutput}>
                  <span class="session-actions-menu-indicator" data-active={props.showGenericToolOutput ? "true" : undefined}><Icon name="check" /></span>
                  <span>Generic tool output</span>
                </Button>
              </div>
              <hr />
              <Button appearance="ghost" tone="danger" class="session-actions-menu-item" onClick={() => props.deleteSession(props.session)}>
                <Icon name="trash" />
                <span>Delete session</span>
              </Button>
            </div>
          </details>
        </Show>
      </div>
    </header>
  )
}
