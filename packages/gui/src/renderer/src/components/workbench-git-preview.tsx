import type { WorkbenchGitHistoryCommit } from "../lib/store"
import { For, Show, createMemo } from "solid-js"
import { workbenchPatchRows, type WorkbenchDiffFile } from "../lib/workbench"

export function WorkbenchDiffPreview(props: { diff?: WorkbenchDiffFile; loading?: boolean; message?: string }) {
  return (
    <div class="workbench-diff-body" classList={{ "workbench-diff-refreshing": !!props.loading }}>
      <Show when={props.loading}>
        <div class="workbench-refresh-badge">Refreshing diff</div>
      </Show>
      <Show when={!props.message} fallback={<div class="workbench-empty-state">{props.message}</div>}>
        <Show when={props.diff} fallback={<div class="workbench-empty-state">{props.loading ? "Loading diff..." : "No text patch is available for the selected file."}</div>}>
          {(diff) => (
            <div class="workbench-diff-preview">
              <Show when={diff().patch} fallback={<div class="workbench-empty-state">This file has no text patch preview.</div>}>
                {(patch) => <WorkbenchUnifiedPatch patch={patch()} />}
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}

export function WorkbenchHistoryPreview(props: { commit?: WorkbenchGitHistoryCommit }) {
  return (
    <Show when={props.commit} fallback={<div class="workbench-empty-state">Select a commit to inspect its changed files.</div>}>
      {(commit) => (
        <div class="workbench-history-preview">
          <header>
            <strong>{commit().subject}</strong>
            <span>{commit().shortHash} - {commit().author} - {formatHistoryDate(commit().date)}</span>
          </header>
          <Show when={commit().body}>
            {(body) => <pre>{body()}</pre>}
          </Show>
          <div class="workbench-history-files">
            <For each={commit().files} fallback={<div class="workbench-empty-state">No file list returned for this commit.</div>}>
              {(file) => (
                <div class="workbench-history-file">
                  <span class={`workbench-file-status ${historyStatusClass(file.status)}`}>{file.status.slice(0, 1)}</span>
                  <span>{file.path}</span>
                  <Show when={file.previousPath}>
                    {(previousPath) => <small>from {previousPath()}</small>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  )
}

function WorkbenchUnifiedPatch(props: { patch: string }) {
  const rows = createMemo(() => workbenchPatchRows(props.patch))
  return (
    <div class="workbench-unified-patch" role="table" aria-label="Git diff">
      <For each={rows()}>
        {(row) => (
          <div class={`workbench-patch-row ${row.kind}`} role="row">
            <span class="line-number old">{row.oldLine ?? ""}</span>
            <span class="line-number new">{row.newLine ?? ""}</span>
            <span class="line-prefix">{patchRowPrefix(row.kind)}</span>
            <code>{row.text || " "}</code>
          </div>
        )}
      </For>
    </div>
  )
}

function patchRowPrefix(kind: "meta" | "hunk" | "context" | "addition" | "deletion") {
  if (kind === "addition") return "+"
  if (kind === "deletion") return "-"
  return ""
}

function historyStatusClass(status: string) {
  if (status.startsWith("A")) return "added"
  if (status.startsWith("D")) return "deleted"
  return "modified"
}

function formatHistoryDate(value: string) {
  if (!value) return "unknown date"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}
