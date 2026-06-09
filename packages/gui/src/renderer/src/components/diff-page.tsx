import type { Session } from "@opencode-ai/sdk/v2/client"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import type { DiffFile, GuiSnapshot } from "../lib/store"
import { patchContents } from "../lib/tool-display"
import { title } from "../lib/format"

export type DiffMode = "git" | "last-turn"
export type DiffView = "split" | "unified"

export function DiffPage(props: {
  mode: DiffMode
  session?: Session
  sessions: Session[]
  sessionUiState: GuiSnapshot["sessionUiState"]
  setMode: (mode: DiffMode) => void
  selectSession: (sessionID: string) => void
  close: () => void
  loadDiff: (input: { mode: DiffMode; session?: Session }) => Promise<DiffFile[]>
  updateReviewedFiles: (session: Session, files: string[]) => Promise<void>
}) {
  const [view, setView] = createSignal<DiffView>("split")
  const [selectedFile, setSelectedFile] = createSignal("")
  const [reviewedFiles, setReviewedFiles] = createSignal<ReadonlySet<string>>(new Set())
  const diffInput = createMemo(() => ({
    mode: props.mode,
    sessionID: props.session?.id ?? "",
    session: props.session,
  }))
  const [diff, { refetch }] = createResource(diffInput, async (input) => normalizeDiffs(await props.loadDiff({ mode: input.mode, session: input.session })))
  const files = createMemo(() => diff() ?? [])
  const selected = createMemo(() => files().find((file) => file.file === selectedFile()) ?? files()[0])
  const totals = createMemo(() => files().reduce((total, file) => ({
    additions: total.additions + file.additions,
    deletions: total.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }))

  createEffect(() => {
    const current = props.session ? props.sessionUiState[props.session.id]?.reviewedFiles ?? [] : []
    setReviewedFiles(new Set(current.filter((file) => files().some((item) => item.file === file))))
  })

  createEffect(() => {
    const file = selectedFile()
    if (file && files().some((item) => item.file === file)) return
    setSelectedFile(files()[0]?.file ?? "")
  })

  const toggleReviewed = async (file: string) => {
    const session = props.session
    if (!session || props.mode !== "last-turn") return
    const next = new Set(reviewedFiles())
    if (next.has(file)) next.delete(file)
    else next.add(file)
    setReviewedFiles(next)
    await props.updateReviewedFiles(session, [...next])
  }

  return (
    <section class="diff-page">
      <header class="diff-header">
        <div>
          <p class="eyebrow">Diff</p>
          <h1>{props.mode === "last-turn" ? "Last Turn" : "Working Tree"}</h1>
        </div>
        <div class="diff-actions">
          <button type="button" classList={{ selected: props.mode === "git" }} onClick={() => props.setMode("git")}>Working tree</button>
          <button type="button" classList={{ selected: props.mode === "last-turn" }} disabled={!props.session} onClick={() => props.setMode("last-turn")}>Last turn</button>
          <button type="button" onClick={() => setView(view() === "split" ? "unified" : "split")}>{view() === "split" ? "Unified" : "Split"}</button>
          <button type="button" onClick={() => void refetch()}>Refresh</button>
          <button type="button" onClick={props.close}>Close</button>
        </div>
      </header>

      <div class="diff-subbar">
        <label>
          <span>Session</span>
          <select
            value={props.session?.id ?? ""}
            onChange={(event) => props.selectSession(event.currentTarget.value)}
          >
            <option value="">No session</option>
            <For each={props.sessions}>
              {(session) => <option value={session.id}>{title(session.title)}</option>}
            </For>
          </select>
        </label>
        <span>{files().length} {files().length === 1 ? "file" : "files"}</span>
        <span class="diff-additions">+{totals().additions}</span>
        <span class="diff-deletions">-{totals().deletions}</span>
      </div>

      <Show when={!diff.loading} fallback={<div class="diff-empty">Loading diff...</div>}>
        <Show when={!diff.error} fallback={<div class="diff-empty">Failed to load diff.</div>}>
          <Show when={files().length > 0} fallback={<div class="diff-empty">No diff.</div>}>
            <div class="diff-layout">
              <aside class="diff-file-list">
                <For each={files()}>
                  {(file) => {
                    const reviewed = () => reviewedFiles().has(file.file)
                    return (
                      <button
                        type="button"
                        classList={{ selected: selected()?.file === file.file, reviewed: reviewed() }}
                        onClick={() => setSelectedFile(file.file)}
                      >
                        <strong>{file.file.split(/[\\/]/).at(-1) ?? file.file}</strong>
                        <span>{file.file}</span>
                        <small>
                          <em>{file.status}</em>
                          <b class="diff-additions">+{file.additions}</b>
                          <b class="diff-deletions">-{file.deletions}</b>
                        </small>
                      </button>
                    )
                  }}
                </For>
              </aside>
              <main class="diff-patch-pane">
                <Show when={selected()}>
                  {(file) => (
                    <>
                      <header class="diff-file-header">
                        <div>
                          <strong>{file().file}</strong>
                          <span>{file().status}</span>
                        </div>
                        <Show when={props.mode === "last-turn" && props.session}>
                          <button type="button" onClick={() => void toggleReviewed(file().file)}>
                            {reviewedFiles().has(file().file) ? "Reviewed" : "Mark reviewed"}
                          </button>
                        </Show>
                      </header>
                      <Show when={file().patch} fallback={<div class="diff-empty">No patch available for this file.</div>}>
                        {(patch) => <DiffPatch file={file().file} patch={patch()} view={view()} />}
                      </Show>
                    </>
                  )}
                </Show>
              </main>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  )
}

function normalizeDiffs(files: DiffFile[]) {
  return files.flatMap((file) => file.file
    ? [{
      file: file.file,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status ?? "modified",
    }]
    : [])
}

function DiffPatch(props: { file: string; patch: string; view: DiffView }) {
  const contents = createMemo(() => patchContents(props.patch, props.file))
  return (
    <div class="diff-patch">
      <Show when={contents()} fallback={<pre>{props.patch}</pre>}>
        {(value) => (
          <FileDiffView
            mode="diff"
            before={value().before}
            after={value().after}
            diffStyle={props.view}
            virtualize={false}
            hunkSeparators="simple"
          />
        )}
      </Show>
    </div>
  )
}
