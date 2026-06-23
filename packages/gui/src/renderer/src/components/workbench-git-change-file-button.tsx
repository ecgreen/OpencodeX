import type { WorkbenchGitStatus } from "../lib/store"
import type { WorkbenchDiffFile } from "../lib/workbench"
import { workbenchGitFileStats } from "../lib/workbench"
import { Show } from "solid-js"
import { gitStatusSymbol } from "./workbench-page-helpers"

export function WorkbenchGitChangeFileButton(props: {
  file: WorkbenchGitStatus["files"][number]
  diff?: WorkbenchDiffFile
  selected: boolean
  selectFile: (path: string) => void
  runGit: (action: "stage" | "unstage" | "discard", path: string) => void
}) {
  const stats = () => workbenchGitFileStats(props.file, props.diff)
  return (
    <button
      type="button"
      class="workbench-change-file"
      classList={{ selected: props.selected, staged: props.file.staged }}
      onClick={() => props.selectFile(props.file.path)}
    >
      <input
        type="checkbox"
        checked={props.file.staged}
        aria-label={props.file.staged ? `Unstage ${props.file.path}` : `Stage ${props.file.path}`}
        onClick={(event) => event.stopPropagation()}
        onChange={() => props.runGit(props.file.staged ? "unstage" : "stage", props.file.path)}
      />
      <span class={`workbench-file-status ${props.file.status}`}>{gitStatusSymbol(props.file)}</span>
      <span>{props.file.path}</span>
      <small>{props.file.staged ? "staged" : props.file.untracked ? "new" : props.file.status}</small>
      <Show when={stats().total > 0}>
        <span class="workbench-change-stats" title={`${stats().additions} additions, ${stats().deletions} deletions`}>
          <span class="added">+{stats().additions}</span>
          <span class="deleted">-{stats().deletions}</span>
        </span>
      </Show>
    </button>
  )
}
