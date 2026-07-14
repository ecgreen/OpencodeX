import type { Accessor, Setter } from "solid-js"
import { For, Match, Show, Switch, createEffect, createMemo } from "solid-js"
import type { WorkbenchGitBranches, WorkbenchGitHistoryCommit, WorkbenchGitStash, WorkbenchGitStatus } from "../lib/store"
import { workbenchDiffForPath, type WorkbenchDiffFile } from "../lib/workbench"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"
import { WorkbenchGitChangeFileButton } from "./workbench-git-change-file-button"
import { WorkbenchDiffPreview, WorkbenchHistoryPreview } from "./workbench-git-preview"
import { VirtualList } from "./virtual-list"

export function WorkbenchGitPanel(props: {
  active: boolean
  status: Accessor<WorkbenchGitStatus | undefined>
  branches: Accessor<WorkbenchGitBranches | undefined>
  branchName: Accessor<string>
  setBranchName: Setter<string>
  checkoutBranch: (branch: string) => void
  runRemoteGit: (action: "fetch" | "pull" | "push" | "publish") => void
  createBranch: () => void
  view: Accessor<"changes" | "history">
  setView: Setter<"changes" | "history">
  filter: Accessor<string>
  setFilter: Setter<string>
  allFileCount: Accessor<number>
  message: Accessor<string>
  selectedFiles: Accessor<WorkbenchGitStatus["files"]>
  loading: Accessor<boolean>
  allVisibleStaged: Accessor<boolean>
  someVisibleStaged: Accessor<boolean>
  toggleVisibleSelection: () => void
  stagedFiles: Accessor<WorkbenchGitStatus["files"]>
  unstagedFiles: Accessor<WorkbenchGitStatus["files"]>
  diffs: Accessor<WorkbenchDiffFile[]>
  selectFile: (path: string) => void
  runGit: (action: "stage" | "unstage" | "discard", path: string) => void
  commitMessage: Accessor<string>
  setCommitMessage: Setter<string>
  commitBody: Accessor<string>
  setCommitBody: Setter<string>
  stagedCount: Accessor<number>
  commit: () => void
  history: Accessor<WorkbenchGitHistoryCommit[]>
  selectedCommit: Accessor<WorkbenchGitHistoryCommit | undefined>
  selectCommit: (hash: string) => void
  stashes: Accessor<WorkbenchGitStash[]>
  stashMessage: Accessor<string>
  setStashMessage: Setter<string>
  createStash: () => void
  runStash: (action: "apply" | "pop" | "drop", ref: string) => void
  selectedFile: Accessor<WorkbenchGitStatus["files"][number] | undefined>
  diffMessage: Accessor<string>
  selectedDiff: Accessor<WorkbenchDiffFile | undefined>
  diffLoading: Accessor<boolean>
}) {
  return (
    <div class="workbench-git-desktop">
      <header class="workbench-repository-bar">
        <div>
          <span>Current Branch</span>
          <strong>{props.status()?.branch ?? props.branches()?.current ?? "No branch"}</strong>
        </div>
        <div>
          <span>Remote</span>
          <strong>{props.status()?.remoteUrl ? compactPath(props.status()?.remoteUrl) : "No origin remote"}</strong>
        </div>
        <div>
          <span>Tracking</span>
          <strong title={props.status()?.upstream}>{gitTrackingLabel(props.status())}</strong>
        </div>
        <div class="workbench-repository-actions">
          <select value={props.branchName()} onChange={(event) => {
            props.setBranchName(event.currentTarget.value)
            if (event.currentTarget.value && event.currentTarget.value !== (props.status()?.branch ?? props.branches()?.current)) props.checkoutBranch(event.currentTarget.value)
          }}>
            <For each={props.branches()?.branches ?? []}>{(branch) => <option value={branch}>{branch}</option>}</For>
          </select>
          <button type="button" disabled={!props.active} onClick={() => props.runRemoteGit("fetch")}><Icon name="activity" /> Fetch</button>
          <button type="button" disabled={!props.active || !props.status()?.upstream} onClick={() => props.runRemoteGit("pull")}><Icon name="chevronDown" /> Pull</button>
          <Show
            when={props.status()?.remoteUrl && props.status()?.branch && !props.status()?.upstream}
            fallback={<button type="button" disabled={!props.active || !props.status()?.upstream} onClick={() => props.runRemoteGit("push")}><Icon name="send" /> Push</button>}
          >
            <button type="button" class="primary" disabled={!props.active} onClick={() => props.runRemoteGit("publish")}><Icon name="send" /> Publish branch</button>
          </Show>
          <details class="workbench-menu">
            <summary aria-label="More Git actions" title="More Git actions"><Icon name="more" /></summary>
            <div class="workbench-menu-popover">
              <label class="workbench-menu-field">
                <span>New branch</span>
                <input value={props.branchName()} onInput={(event) => props.setBranchName(event.currentTarget.value)} placeholder="branch name" />
              </label>
              <button type="button" disabled={!props.branchName().trim()} onClick={props.createBranch}><Icon name="plus" /> Create branch</button>
            </div>
          </details>
        </div>
      </header>
      <div class="workbench-git-main">
        <aside class="workbench-changes-panel">
          <div class="workbench-segmented" role="tablist" aria-label="Git views">
            <button type="button" classList={{ active: props.view() === "changes" }} role="tab" aria-selected={props.view() === "changes"} onClick={() => props.setView("changes")}>Changes <span>{props.allFileCount()}</span></button>
            <button type="button" classList={{ active: props.view() === "history" }} role="tab" aria-selected={props.view() === "history"} onClick={() => props.setView("history")}>History</button>
          </div>
          <div class="workbench-git-message-slot">
            <Show when={props.message()}><div class="notice error">{props.message()}</div></Show>
          </div>
          <Switch>
            <Match when={props.view() === "changes"}>
              <WorkbenchChangesPanel {...props} />
            </Match>
            <Match when={props.view() === "history"}>
              <WorkbenchHistoryPanel history={props.history} selectedCommit={props.selectedCommit} selectCommit={props.selectCommit} loading={props.loading} />
            </Match>
          </Switch>
          <WorkbenchStashesPanel {...props} />
        </aside>
        <section class="workbench-diff-panel">
          <header>
            <div>
              <strong>{props.view() === "history" ? props.selectedCommit()?.subject ?? "No commit selected" : props.selectedFile()?.path ?? "No file selected"}</strong>
              <span>{diffSubtitle(props)}</span>
            </div>
          </header>
          <Show when={props.view() === "changes"} fallback={<WorkbenchHistoryPreview commit={props.selectedCommit()} />}>
            <WorkbenchDiffPreview diff={props.selectedDiff()} loading={props.diffLoading()} message={props.diffMessage()} />
          </Show>
        </section>
      </div>
    </div>
  )
}

function WorkbenchChangesPanel(props: Parameters<typeof WorkbenchGitPanel>[0]) {
  const rows = createMemo<GitChangeRow[]>(() => {
    const staged = props.stagedFiles()
    const unstaged = props.unstagedFiles()
    return [
      ...(staged.length > 0 ? [
        { kind: "header" as const, label: "Staged", count: staged.length },
        ...staged.map((file, index) => ({ kind: "file" as const, file, position: index + 1 })),
      ] : []),
      ...(unstaged.length > 0 ? [
        { kind: "header" as const, label: "Changes", count: unstaged.length },
        ...unstaged.map((file, index) => ({ kind: "file" as const, file, position: staged.length + index + 1 })),
      ] : []),
    ]
  })

  return (
    <>
      <div class="workbench-change-stack">
        <div class="workbench-change-controls">
          <div class="workbench-git-filter">
            <Icon name="search" />
            <input value={props.filter()} onInput={(event) => props.setFilter(event.currentTarget.value)} placeholder="Filter changed files" />
            <button type="button" aria-label="Clear changed file filter" disabled={!props.filter()} onClick={() => props.setFilter("")}><Icon name="x" /></button>
          </div>
        </div>
        <div class="workbench-change-list">
          <Show
            when={props.selectedFiles().length > 0}
            fallback={<div class="workbench-empty-state">{props.loading() ? "Refreshing local changes..." : props.allFileCount() > 0 ? "No changed files match this filter." : props.status()?.message ?? "No local changes."}</div>}
          >
            <label class="workbench-change-select-all">
              <input
                type="checkbox"
                checked={props.allVisibleStaged()}
                ref={(element) => createEffect(() => {
                  element.indeterminate = props.someVisibleStaged()
                })}
                onChange={props.toggleVisibleSelection}
              />
              <span>{props.selectedFiles().length} file{props.selectedFiles().length === 1 ? "" : "s"} changed</span>
            </label>
            <VirtualList
              class="workbench-change-viewport"
              role="listbox"
              ariaLabel="Changed files"
              items={rows()}
              rowHeight={32}
              render={(row) => (
                <Switch>
                  <Match when={row.kind === "header" && row}>
                    {(header) => <header class="workbench-change-group-header"><span>{header().label}</span><small>{header().count}</small></header>}
                  </Match>
                  <Match when={row.kind === "file" && row}>
                    {(entry) => (
                    <WorkbenchGitChangeFileButton
                      file={entry().file}
                      diff={workbenchDiffForPath(props.diffs(), entry().file.path)}
                      selected={props.selectedFile()?.path === entry().file.path}
                      position={entry().position}
                      size={props.selectedFiles().length}
                      selectFile={props.selectFile}
                      runGit={props.runGit}
                    />
                    )}
                  </Match>
                </Switch>
              )}
            />
          </Show>
        </div>
      </div>
      <section class="workbench-commit-box">
        <input value={props.commitMessage()} onInput={(event) => props.setCommitMessage(event.currentTarget.value)} placeholder="Summary" />
        <textarea value={props.commitBody()} onInput={(event) => props.setCommitBody(event.currentTarget.value)} placeholder="Description" />
        <button type="button" class="primary" disabled={!props.commitMessage().trim() || props.stagedCount() === 0} onClick={props.commit}><Icon name="check" /> Commit to {props.status()?.branch ?? "branch"}</button>
      </section>
    </>
  )
}

type GitChangeRow =
  | { kind: "header"; label: string; count: number }
  | { kind: "file"; file: WorkbenchGitStatus["files"][number]; position: number }

function WorkbenchHistoryPanel(props: {
  history: Accessor<WorkbenchGitHistoryCommit[]>
  selectedCommit: Accessor<WorkbenchGitHistoryCommit | undefined>
  selectCommit: (hash: string) => void
  loading: Accessor<boolean>
}) {
  return (
    <div class="workbench-history-list" role="listbox" aria-label="Git history">
      <For each={props.history()} fallback={<div class="workbench-empty-state">{props.loading() ? "Refreshing history..." : "No commits found."}</div>}>
        {(commit) => (
          <button type="button" class="workbench-history-row" classList={{ selected: props.selectedCommit()?.hash === commit.hash }} onClick={() => props.selectCommit(commit.hash)}>
            <strong>{commit.subject || commit.shortHash}</strong>
            <span>{commit.author} - {formatHistoryDate(commit.date)}</span>
            <small>{commit.shortHash} - {commit.files.length} file{commit.files.length === 1 ? "" : "s"}</small>
          </button>
        )}
      </For>
    </div>
  )
}

function WorkbenchStashesPanel(props: Parameters<typeof WorkbenchGitPanel>[0]) {
  return (
    <details class="workbench-secondary-section">
      <summary><Icon name="panel" /> Stashes <span>{props.stashes().length}</span></summary>
      <section class="workbench-stash-box">
        <header><div><strong>Stashed changes</strong><span>{props.stashes().length} stash{props.stashes().length === 1 ? "" : "es"}</span></div></header>
        <div class="workbench-stash-create">
          <input value={props.stashMessage()} onInput={(event) => props.setStashMessage(event.currentTarget.value)} placeholder="Stash message" />
          <button type="button" disabled={props.selectedFiles().length === 0} onClick={props.createStash}><Icon name="panel" /> Stash changes</button>
        </div>
        <div class="workbench-stash-list">
          <For each={props.stashes()} fallback={<div class="empty">No stashes.</div>}>
            {(stash) => (
              <article class="workbench-stash-row">
                <div>
                  <strong>{stash.message || stash.ref}</strong>
                  <span>{stash.ref}{stash.age ? ` - ${stash.age}` : ""}</span>
                </div>
                <div class="row-actions">
                  <button type="button" onClick={() => props.runStash("apply", stash.ref)}><Icon name="check" /> Apply</button>
                  <button type="button" onClick={() => props.runStash("pop", stash.ref)}><Icon name="send" /> Pop</button>
                  <button type="button" class="danger" onClick={() => props.runStash("drop", stash.ref)}><Icon name="trash" /> Drop</button>
                </div>
              </article>
            )}
          </For>
        </div>
      </section>
    </details>
  )
}

function gitTrackingLabel(status: WorkbenchGitStatus | undefined) {
  if (!status?.upstream) return "No upstream"
  const parts = [
    status.ahead ? `${status.ahead} ahead` : "",
    status.behind ? `${status.behind} behind` : "",
  ].filter(Boolean)
  return parts.length ? `${status.upstream} (${parts.join(", ")})` : status.upstream
}

function diffSubtitle(props: Parameters<typeof WorkbenchGitPanel>[0]) {
  if (props.view() === "history") {
    return props.selectedCommit()
      ? `${props.selectedCommit()?.shortHash} - ${props.selectedCommit()?.files.length ?? 0} changed file${props.selectedCommit()?.files.length === 1 ? "" : "s"}`
      : "Select a commit to inspect."
  }
  if (props.diffMessage()) return props.diffMessage()
  if (props.selectedDiff()) return `+${props.selectedDiff()?.additions ?? 0} -${props.selectedDiff()?.deletions ?? 0}${props.diffLoading() ? " - refreshing" : ""}`
  return props.selectedFile() ? "No text patch returned for this file." : "Select a changed file to review its diff."
}

function formatHistoryDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
}
