import { Button } from "./ui"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"
import type { DiffFile } from "../lib/session-api"
import { For, Show } from "solid-js"

export function SessionSideEmptyState(props: {
  directory?: string
  openContext: () => void
  showContext?: boolean
  openGit: () => void
  openGraph: () => void
  openFiles: () => void
  openChangedFile: (path: string) => void
  openTerminal: () => void
  addWebTab: () => void
  diffs: DiffFile[]
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
        <Button appearance="ghost" type="button" data-empty-tone="git" onClick={props.openGit}>
          <Icon name="branch" />
          <strong>Git</strong>
          <span>Review working tree changes and prepare a commit.</span>
        </Button>
        <Button appearance="ghost" type="button" data-empty-tone="graph" onClick={props.openGraph}>
          <Icon name="graph" />
          <strong>Graph</strong>
          <span>See how this session's work fans out across agents, and where it stands.</span>
        </Button>
        <Button appearance="ghost" type="button" data-empty-tone="file" onClick={props.openFiles}>
          <Icon name="folder-open" />
          <strong>Open file</strong>
          <span>Browse the project and edit source files in place.</span>
        </Button>
        <Button appearance="ghost" type="button" data-empty-tone="terminal" onClick={props.openTerminal}>
          <Icon name="terminal" />
          <strong>Terminal</strong>
          <span>Run commands from {props.directory ? compactPath(props.directory) : "the workspace"}.</span>
        </Button>
        <Show when={props.showContext !== false}>
          <Button appearance="ghost" type="button" data-empty-tone="context" onClick={props.openContext}>
            <Icon name="context" />
            <strong>Context</strong>
            <span>Inspect session state, tools, LSP, and related metadata.</span>
          </Button>
        </Show>
        <Button appearance="ghost" type="button" data-empty-tone="web" onClick={props.addWebTab}>
          <Icon name="browser" />
          <strong>Webpage</strong>
          <span>Open docs, local apps, or URLs beside the session.</span>
        </Button>
      </div>
      <Show when={props.diffs.length > 0}>
        <div class="session-open-empty-changes">
          <header><strong>Changed in this session</strong><span>{props.diffs.length} file{props.diffs.length === 1 ? "" : "s"}</span></header>
          <For each={props.diffs.slice(0, 6)}>
            {(file) => <Button appearance="ghost" onClick={() => file.file && props.openChangedFile(file.file)}>
              <Icon name="file" /><span>{file.file}</span><small><b class="diff-additions">+{file.additions}</b><b class="diff-deletions">-{file.deletions}</b></small>
            </Button>}
          </For>
        </div>
      </Show>
    </div>
  )
}
