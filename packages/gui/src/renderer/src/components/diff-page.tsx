import type { Session } from "@opencode-ai/sdk/v2/client"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import type { DiffFile, GuiSnapshot } from "../lib/store"
import { patchContents } from "../lib/tool-display"
import { title } from "../lib/format"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree, moveDiffSelection, nextDiffFile } from "../lib/diff-file-tree"
import { Icon } from "./icon"

export type DiffMode = "git" | "last-turn"
export type DiffView = "split" | "unified"
type DiffFocus = "files" | "patch"

const DIFF_PREF_KEY = "opencodex.gui.diff"

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
  const preferences = readDiffPreferences()
  const [view, setView] = createSignal<DiffView>(preferences.view)
  const [showTree, setShowTree] = createSignal(preferences.showTree)
  const [singlePatch, setSinglePatch] = createSignal(preferences.singlePatch)
  const [focus, setFocus] = createSignal<DiffFocus>("patch")
  const [selectedFile, setSelectedFile] = createSignal("")
  const [selectedTreeRow, setSelectedTreeRow] = createSignal("")
  const [expandedTree, setExpandedTree] = createSignal<ReadonlySet<string>>(new Set())
  const [reviewedFiles, setReviewedFiles] = createSignal<ReadonlySet<string>>(new Set())
  const diffInput = createMemo(() => ({
    mode: props.mode,
    sessionID: props.session?.id ?? "",
    session: props.session,
  }))
  const [diff, { refetch }] = createResource(diffInput, async (input) => normalizeDiffs(await props.loadDiff({ mode: input.mode, session: input.session })))
  const files = createMemo(() => diff() ?? [])
  const fileTree = createMemo(() => buildDiffFileTree(files()))
  const fileRows = createMemo(() => flattenDiffFileTree(fileTree(), expandedTree()))
  const selected = createMemo(() => files().find((file) => file.file === selectedFile()) ?? files()[0])
  const visiblePatchFiles = createMemo(() => singlePatch() ? (selected() ? [selected()!] : []) : files())
  const totals = createMemo(() => files().reduce((total, file) => ({
    additions: total.additions + file.additions,
    deletions: total.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }))

  createEffect(() => {
    const current = props.session ? props.sessionUiState[props.session.id]?.reviewedFiles ?? [] : []
    setReviewedFiles(new Set(current.filter((file) => files().some((item) => item.file === file))))
  })

  createEffect(() => {
    const rows = fileRows()
    const current = selectedTreeRow()
    if (current && rows.some((row) => row.id === current)) return
    setSelectedTreeRow(rows.find((row) => row.file)?.id ?? rows[0]?.id ?? "")
  })

  createEffect(() => {
    setExpandedTree(expandedDirectories(fileTree()))
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
  const persist = (next: Partial<DiffPreferences>) => writeDiffPreferences({ view: view(), showTree: showTree(), singlePatch: singlePatch(), ...next })
  const setPersistentView = (next: DiffView) => {
    setView(next)
    persist({ view: next })
  }
  const setPersistentTree = (next: boolean) => {
    setShowTree(next)
    persist({ showTree: next })
    if (!next) setFocus("patch")
  }
  const setPersistentSinglePatch = (next: boolean) => {
    setSinglePatch(next)
    persist({ singlePatch: next })
  }
  const selectFile = (file: string) => {
    setSelectedFile(file)
    setSelectedTreeRow(`file:${file}`)
  }
  const toggleTreeRow = (id = selectedTreeRow()) => {
    const row = fileRows().find((item) => item.id === id)
    if (!row) return
    if (row.file) {
      if (row.file.file) selectFile(row.file.file)
      setFocus("patch")
      return
    }
    setExpandedTree((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }
  const selectRelativeFile = (offset: number) => {
    const next = nextDiffFile(files(), selected()?.file ?? "", offset)
    if (next) selectFile(next)
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
    if (event.key === "f") {
      event.preventDefault()
      if (showTree()) setFocus((current) => current === "files" ? "patch" : "files")
      return
    }
    if (event.key === "t") {
      event.preventDefault()
      setPersistentTree(!showTree())
      return
    }
    if (event.key === "s") {
      event.preventDefault()
      setPersistentSinglePatch(!singlePatch())
      return
    }
    if (event.key === "v") {
      event.preventDefault()
      setPersistentView(view() === "split" ? "unified" : "split")
      return
    }
    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault()
      if (focus() === "files") setSelectedTreeRow(moveDiffSelection(fileRows(), selectedTreeRow(), 1))
      else selectRelativeFile(1)
      return
    }
    if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault()
      if (focus() === "files") setSelectedTreeRow(moveDiffSelection(fileRows(), selectedTreeRow(), -1))
      else selectRelativeFile(-1)
      return
    }
    if (event.key === "Enter" && focus() === "files") {
      event.preventDefault()
      toggleTreeRow()
      return
    }
    if (event.key === "r") {
      event.preventDefault()
      if (selected()) void toggleReviewed(selected()!.file)
    }
  }

  return (
    <section class="diff-page" tabindex="0" onKeyDown={handleKeyDown}>
      <header class="diff-header">
        <div>
          <p class="eyebrow">Diff</p>
          <h1>{props.mode === "last-turn" ? "Last Turn" : "Working Tree"}</h1>
        </div>
        <div class="diff-actions">
          <button type="button" classList={{ selected: props.mode === "git" }} onClick={() => props.setMode("git")}><Icon name="folder" /> Working tree</button>
          <button type="button" classList={{ selected: props.mode === "last-turn" }} disabled={!props.session} onClick={() => props.setMode("last-turn")}><Icon name="session" /> Last turn</button>
          <button type="button" classList={{ selected: showTree() }} onClick={() => setPersistentTree(!showTree())}><Icon name="panel" /> File tree</button>
          <button type="button" classList={{ selected: singlePatch() }} onClick={() => setPersistentSinglePatch(!singlePatch())}><Icon name="pencil" /> Single patch</button>
          <button type="button" onClick={() => setPersistentView(view() === "split" ? "unified" : "split")}><Icon name="views" /> {view() === "split" ? "Unified" : "Split"}</button>
          <button type="button" onClick={() => void refetch()}><Icon name="activity" /> Refresh</button>
          <button type="button" onClick={props.close}><Icon name="x" /> Close</button>
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
            <div class="diff-layout" classList={{ "hide-tree": !showTree(), "files-focus": focus() === "files" }}>
              <Show when={showTree()}>
                <aside class="diff-file-list">
                  <div class="diff-file-tree-toolbar">
                    <button type="button" onClick={() => setExpandedTree(expandedDirectories(fileTree()))}><Icon name="chevronDown" /> Expand all</button>
                    <button type="button" onClick={() => setExpandedTree(new Set())}><Icon name="chevronRight" /> Collapse all</button>
                  </div>
                  <For each={fileRows()}>
                    {(row) => {
                      const file = () => row.file
                      const reviewed = () => file()?.file ? reviewedFiles().has(file()!.file!) : false
                      return (
                        <button
                          type="button"
                          classList={{ selected: selectedTreeRow() === row.id || selected()?.file === file()?.file, reviewed: reviewed(), directory: row.type === "directory" }}
                          style={{ "--indent": `${row.depth * 14}px` }}
                          onClick={() => {
                            setSelectedTreeRow(row.id)
                            toggleTreeRow(row.id)
                          }}
                        >
                          <strong>{row.type === "directory" ? `${expandedTree().has(row.id) ? "v" : ">"} ${row.name}` : row.name}</strong>
                          <span>{row.path}</span>
                          <Show when={file()}>
                            {(value) => (
                              <small>
                                <em>{value().status}</em>
                                <b class="diff-additions">+{value().additions}</b>
                                <b class="diff-deletions">-{value().deletions}</b>
                              </small>
                            )}
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </aside>
              </Show>
              <main class="diff-patch-pane">
                <For each={visiblePatchFiles()}>
                  {(file) => (
                    <section class="diff-patch-file">
                      <header class="diff-file-header">
                        <div>
                          <strong>{file.file}</strong>
                          <span>{file.status}</span>
                        </div>
                        <Show when={props.mode === "last-turn" && props.session}>
                          <button type="button" onClick={() => void toggleReviewed(file.file)}>
                            <Icon name="check" /> {reviewedFiles().has(file.file) ? "Reviewed" : "Mark reviewed"}
                          </button>
                        </Show>
                      </header>
                      <Show when={file.patch} fallback={<div class="diff-empty">No patch available for this file.</div>}>
                        {(patch) => <DiffPatch file={file.file} patch={patch()} view={view()} />}
                      </Show>
                    </section>
                  )}
                </For>
              </main>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  )
}

type DiffPreferences = {
  view: DiffView
  showTree: boolean
  singlePatch: boolean
}

function readDiffPreferences(): DiffPreferences {
  if (typeof localStorage === "undefined") return { view: "split", showTree: true, singlePatch: false }
  try {
    const value = JSON.parse(localStorage.getItem(DIFF_PREF_KEY) ?? "{}") as Partial<DiffPreferences>
    return {
      view: value.view === "unified" ? "unified" : "split",
      showTree: value.showTree !== false,
      singlePatch: value.singlePatch === true,
    }
  } catch {
    return { view: "split", showTree: true, singlePatch: false }
  }
}

function writeDiffPreferences(value: DiffPreferences) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(DIFF_PREF_KEY, JSON.stringify(value))
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
