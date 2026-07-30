import type { OpencodeXTerminalSession } from "@opencode-ai/sdk/v2/client"
import { For, Show } from "solid-js"
import { Button } from "./ui"
import { TerminalSessionStatusCard } from "./session-card-list"
import { Icon } from "./icon"

/**
 * Claude Code is a different runtime, not a quieter kind of session, so it gets
 * its own section rather than a third bucket under the OpenCode ones.
 */
export function ProjectClaudeSection(props: {
  sessions: OpencodeXTerminalSession[]
  directory?: string
  terminalStatus: (terminalSessionID: string) => string
  openSession: (terminalSessionID: string) => void
  launchSession: () => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
}) {
  return (
    <section class="project-claude-section" aria-label="Claude Code">
      <header>
        <span class="project-claude-title">
          <Icon name="terminal" />
          <strong>Claude Code</strong>
          <small>{props.sessions.length}</small>
        </span>
        <Button
          appearance="outline"
          size="compact"
          icon="plus"
          disabled={!props.directory}
          title={props.directory ? `Start Claude Code in ${props.directory}` : "Add a folder to this project first"}
          onClick={props.launchSession}
        >
          Launch Claude Code
        </Button>
      </header>
      <div class="project-claude-body">
        <Show
          when={props.sessions.length > 0}
          fallback={
            <p class="project-claude-empty">
              No Claude Code sessions here yet. Launch one to run Claude in this project's folder with its own terminal.
            </p>
          }
        >
          <div class="dashboard-card-grid compact">
            <For each={props.sessions}>
              {(session) => (
                <TerminalSessionStatusCard
                  terminalSession={session}
                  status={props.terminalStatus(session.id)}
                  openSession={props.openSession}
                  pinned={props.sessionPinned(session.id)}
                  togglePinned={() => props.toggleSessionPinned(session.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}
