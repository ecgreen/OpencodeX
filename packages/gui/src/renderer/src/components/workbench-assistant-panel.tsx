import type { Session } from "@opencode-ai/sdk/v2/client"
import type { SessionData } from "../lib/store"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"
import { SessionPage } from "./session-page"
import { IconButton } from "./ui"
import { Show } from "solid-js"

export function WorkbenchAssistantPanel(props: {
  session?: Session
  data: SessionData
  loading: boolean
  contextPath?: string
  contextLabel: string
  close: () => void
  sessionPage: Omit<Parameters<typeof SessionPage>[0], "session" | "data" | "loading">
}) {
  return (
    <aside class="workbench-assistant-panel session-shell">
      <header>
        <div>
          <strong>OpenCodeX</strong>
          <span>{props.contextPath ? compactPath(props.contextPath) : props.contextLabel}</span>
        </div>
        <IconButton icon="x" label="Close assistant" onClick={props.close} />
      </header>
      <Show
        when={props.session}
        fallback={<div class="workbench-placeholder"><Icon name="session" /><strong>{props.loading ? "Opening assistant..." : "Assistant unavailable"}</strong><span>{props.loading ? "Creating a project-scoped OpenCodeX session." : "Open a project or workspace to start an assistant session."}</span></div>}
      >
        {(session) => (
          <SessionPage
            session={session()}
            data={props.data}
            loading={props.loading}
            {...props.sessionPage}
          />
        )}
      </Show>
    </aside>
  )
}
