import { Button } from "./ui"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"

export function SessionSideEmptyState(props: {
  directory?: string
  openContext: () => void
  openGit: () => void
  openFile: () => void
  openTerminal: () => void
  addWebTab: () => void
}) {
  return (
    <div class="session-open-empty">
      <div class="session-open-empty-intro">
        <div class="session-open-empty-mark">
          <Icon name="browser" />
          <Icon name="branch" />
        </div>
        <div>
          <strong>Open a workspace tab</strong>
          <span>{props.directory ? compactPath(props.directory) : "No project folder selected"}</span>
        </div>
      </div>
      <div class="session-open-empty-actions">
        <Button appearance="ghost" type="button" data-tone="git" onClick={props.openGit}>
          <Icon name="branch" />
          <strong>Git</strong>
          <span>Review working tree changes and prepare a commit.</span>
        </Button>
        <Button appearance="ghost" type="button" data-tone="file" onClick={props.openFile}>
          <Icon name="folder-open" />
          <strong>Open file</strong>
          <span>Browse the project and edit source files in place.</span>
        </Button>
        <Button appearance="ghost" type="button" data-tone="terminal" onClick={props.openTerminal}>
          <Icon name="terminal" />
          <strong>Terminal</strong>
          <span>Run commands from {props.directory ? compactPath(props.directory) : "the workspace"}.</span>
        </Button>
        <Button appearance="ghost" type="button" data-tone="context" onClick={props.openContext}>
          <Icon name="context" />
          <strong>Context</strong>
          <span>Inspect session state, tools, LSP, and related metadata.</span>
        </Button>
        <Button appearance="ghost" type="button" data-tone="web" onClick={props.addWebTab}>
          <Icon name="browser" />
          <strong>Webpage</strong>
          <span>Open docs, local apps, or URLs beside the session.</span>
        </Button>
      </div>
    </div>
  )
}
