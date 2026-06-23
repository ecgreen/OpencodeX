import type { Session } from "@opencode-ai/sdk/v2/client"
import { Show } from "solid-js"
import { compactPath, title } from "../lib/format"
import { Icon } from "./icon"
import { StatusPill } from "./status-pill"
import { IconButton } from "./ui"

export function SessionToolbar(props: {
  session: Session
  status?: string
  blocked: boolean
  pending?: boolean
  concealCodeBlocks: boolean
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  toggleCodeConceal: () => void
  toggleTimestamps: () => void
  toggleThinking: () => void
  toggleToolDetails: () => void
  toggleScrollbar: () => void
  toggleGenericToolOutput: () => void
  sidePanelOpen?: boolean
  toggleSidePanel?: () => void
}) {
  return (
    <header class="session-toolbar">
      <div class="session-titleline">
        <div>
          <h1>{title(props.session.title)}</h1>
          <p>{compactPath(props.session.directory)}</p>
        </div>
      </div>
      <div class="session-actions compact">
        <Show when={props.status === "busy" || props.status === "retry" || props.blocked}>
          <IconButton icon="stop" label="Interrupt session" onClick={() => props.abortSession(props.session.id)} />
        </Show>
        <Show when={props.toggleSidePanel}>
          {(toggleSidePanel) => (
            <IconButton
              icon="panel"
              label={props.sidePanelOpen ? "Close side panel" : "Open side panel"}
              pressed={props.sidePanelOpen}
              onClick={toggleSidePanel()}
            />
          )}
        </Show>
        <StatusPill status={props.blocked ? "input_needed" : props.status ?? "idle"} />
        <Show when={!props.pending}>
          <details class="overflow-menu">
            <summary title="Session actions" aria-label="Session actions"><Icon name="more" /></summary>
            <div>
              <button type="button" onClick={() => props.renameSession(props.session)}>Rename</button>
              <button type="button" onClick={() => props.moveSession(props.session)}>Move to project</button>
              <hr />
              <button type="button" onClick={props.toggleCodeConceal}><Icon name={props.concealCodeBlocks ? "check" : "circle"} /> Code blocks</button>
              <button type="button" onClick={props.toggleTimestamps}><Icon name={props.showTimestamps ? "check" : "circle"} /> Timestamps</button>
              <button type="button" onClick={props.toggleThinking}><Icon name={props.showThinking ? "check" : "circle"} /> Thinking</button>
              <button type="button" onClick={props.toggleToolDetails}><Icon name={props.showToolDetails ? "check" : "circle"} /> Tool details</button>
              <button type="button" onClick={props.toggleScrollbar}><Icon name={props.showScrollbar ? "check" : "circle"} /> Scrollbar</button>
              <button type="button" onClick={props.toggleGenericToolOutput}><Icon name={props.showGenericToolOutput ? "check" : "circle"} /> Generic tool output</button>
              <hr />
              <button type="button" class="danger" onClick={() => props.deleteSession(props.session)}><Icon name="trash" /> Delete</button>
            </div>
          </details>
        </Show>
      </div>
    </header>
  )
}
